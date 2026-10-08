<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// MaterialImagePickerDialog.vue — 素材库图片选择弹窗（仿视频第 2 步「选择产品图」专用）
// 2026-10-03 用户裁决：点「选择产品图」弹出选择素材窗口，只显示图片 tab；选定产品图
// 后才能进行下一步（product_images 随 storyboard_generate 直传，服务端 ≥1 必需、≤6 张）。。
// 2026-10-06 用户裁决：双 tab——素材库选择（原）+ 本地上传（多图拖入/点选，入库后选用）。
// 数据面复用 materialLibraryLogic（fetchMaterialGrid/materialGridKey，mediaType=image）；
// 缩略图/确认 URL = GET /material/thumbnail|serve?material_id=（worker 以 http url 拉取）。
// 本地上传入库通道 = POST /api/storyboard/scripts/imitate/upload（素材库归一收口；
// 服务端当前仅收视频扩展名——图片被拒时原样暴露，待服务端放开图片扩展）。
// ═══════════════════════════════════════════════════════════════
import { computed, ref, watch } from 'vue'
import TButton from '@/components/common/TButton.vue'
import {
  fetchMaterialGrid,
} from '@/composables/useWorkbenchPickers'
import {
  materialGridKey,
} from '@/composables/materialLibraryLogic'
import { buildMediaServeUrl, buildMediaThumbUrl } from '@/composables/workbenchChatContext'
import { clientError } from '@/utils/clientLog'

const props = defineProps<{
  open: boolean
  /** 已选中的 material key（回显勾选；跨次打开保留由父级持久化） */
  selectedKeys?: string[]
  /** 与 selectedKeys 按序对齐的名称（回显选中池展示用；缺省回退键名） */
  selectedNames?: string[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** urls=每张图的 /material/serve 绝对地址（worker httpx 直接拉取）；names=文件名；
   *  keys=素材键（父级回显勾选用） */
  (e: 'confirm', payload: { urls: string[]; names: string[]; keys: string[] }): void
}>()

/** 服务端地址（同 MaterialLibrary 口径：env serverPing 单一来源；预览环境为空串） */
const serverUrl = ref('')
async function resolveServerUrl(): Promise<void> {
  if (serverUrl.value) return
  try {
    const ping = await (window as unknown as { tintin?: { env?: { serverPing?: () => Promise<{ url?: unknown }> } } }).tintin?.env?.serverPing?.()
    serverUrl.value = String(ping?.url || '')
  } catch { serverUrl.value = '' }
}

// ── 双 tab（2026-10-06 用户裁决：素材库选择 / 本地上传）──
const tab = ref<'library' | 'local'>('library')

type GridItem = Record<string, unknown>
const PAGE_SIZE = 24
const page = ref(1)
const total = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const loading = ref(false)
const error = ref('')
const kw = ref('')
const items = ref<GridItem[]>([])
const thumbFailed = ref<Record<string, boolean>>({})

/** 多选（≤6 张=服务端上限；两 tab 合并计数，跨页保留，按 material key 去重） */
const selectedMap = ref(new Map<string, GridItem>())

async function run(p = 1): Promise<void> {
  page.value = Math.max(1, p)
  loading.value = true
  error.value = ''
  thumbFailed.value = {}
  try {
    const r = await fetchMaterialGrid({
      search: kw.value,
      mediaType: 'image',
      page: page.value,
      size: PAGE_SIZE,
    })
    items.value = r.items as GridItem[]
    total.value = r.total
    // 回显父级已选键（2026-10-08 修「自动配图不同步进选择池」：open 时 items 尚未
    // 加载、回显跑在空列表上=恒不勾选。页数据就绪后按 selectedKeys 再勾一次，
    // 与 open 时的键级种子幂等——同一键后到者以真实 GridItem 覆盖种子）
    for (const it of items.value) {
      const k = keyOf(it)
      if (k && props.selectedKeys?.includes(k)) selectedMap.value.set(k, it)
    }
  } catch (e) {
    items.value = []
    total.value = 0
    error.value = (e as Error)?.message || String(e)
  } finally {
    loading.value = false
  }
}

function keyOf(it: GridItem): string {
  return materialGridKey(it) || ''
}
function thumbUrl(it: GridItem): string {
  const k = keyOf(it)
  return k ? buildMediaThumbUrl(serverUrl.value, k) : ''
}
function isSelected(it: GridItem): boolean {
  return selectedMap.value.has(keyOf(it))
}
function toggleSelect(it: GridItem): void {
  const k = keyOf(it)
  if (!k) return
  if (selectedMap.value.has(k)) {
    selectedMap.value.delete(k)
    return
  }
  if (totalSelected() >= MAX_SELECT) return // 服务端 ≤6 张
  selectedMap.value.set(k, it)
}
function clearSelection(): void {
  selectedMap.value.clear()
}
function prevPage(): void { void run(page.value - 1) }
function nextPage(): void { void run(page.value + 1) }

// ── 本地上传 tab（多图拖入/点选；确认时经 imitate/upload 入库→material_id→serve URL）──
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
const MAX_SELECT = 6
interface LocalItem { file: File; name: string; preview: string }
const localItems = ref<LocalItem[]>([])
const localSelected = ref(new Set<LocalItem>())
const localBusy = ref(false)
const localError = ref('')
const localDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const localSelectedItems = computed(() => localItems.value.filter((it) => localSelected.value.has(it)))
/** 选中池（2026-10-08 用户裁决：右侧常显已选图片，跨素材库/本地两 tab，单张可移除） */
const poolEntries = computed(() => {
  const entries: Array<{ key: string; thumb: string; name: string; remove: () => void }> = []
  for (const [k, it] of selectedMap.value) {
    entries.push({ key: k, thumb: thumbUrl(it), name: String(it?.filename || k), remove: () => { selectedMap.value.delete(k) } })
  }
  for (const it of localItems.value) {
    if (localSelected.value.has(it)) {
      entries.push({ key: `local-${it.name}-${it.file.size}`, thumb: it.preview, name: it.name, remove: () => { localSelected.value.delete(it) } })
    }
  }
  return entries
})
function totalSelected(): number {
  return selectedMap.value.size + localSelected.value.size
}

function addLocalFiles(files: FileList | File[] | null): void {
  if (!files?.length) return
  localError.value = ''
  for (const f of Array.from(files)) {
    const ext = f.name.split('.').pop()?.toLowerCase() || ''
    if (!IMAGE_EXTS.includes(ext)) {
      localError.value = `不支持的图片格式：${f.name}（支持 ${IMAGE_EXTS.join('/')}）`
      continue
    }
    if (localItems.value.some((x) => x.name === f.name && x.file.size === f.size)) continue
    if (totalSelected() >= MAX_SELECT) {
      localError.value = `最多选 ${MAX_SELECT} 张（服务端上限）——已忽略多余文件`
      break
    }
    const item: LocalItem = { file: f, name: f.name, preview: URL.createObjectURL(f) }
    localItems.value.push(item)
    localSelected.value.add(item)
  }
}
function onLocalDrop(e: DragEvent): void {
  localDragging.value = false
  addLocalFiles(e.dataTransfer?.files ?? null)
}
function toggleLocalSelect(it: LocalItem): void {
  if (localSelected.value.has(it)) {
    localSelected.value.delete(it)
    return
  }
  if (totalSelected() >= MAX_SELECT) return
  localSelected.value.add(it)
}
function removeLocal(it: LocalItem): void {
  localSelected.value.delete(it)
  URL.revokeObjectURL(it.preview)
  localItems.value = localItems.value.filter((x) => x !== it)
}
function clearLocal(): void {
  for (const it of localItems.value) URL.revokeObjectURL(it.preview)
  localItems.value = []
  localSelected.value.clear()
  localError.value = ''
}

/** 单个本地文件入库（imitate/upload 素材库归一通道）→ /material/serve 绝对 URL */
async function ingestLocalFile(it: LocalItem): Promise<string> {
  const form = new FormData()
  form.append('file', it.file, it.name)
  const resp = (await (window as unknown as {
    tintin?: { server?: { upload?: (p: string, f: FormData) => Promise<Record<string, unknown> | null> } }
  }).tintin?.server?.upload?.('/api/storyboard/scripts/imitate/upload', form)) as Record<string, unknown> | null
  const mid = resp?.material_id ?? (resp?.material as Record<string, unknown> | undefined)?.id
  if (mid === undefined || mid === null || mid === '') {
    const keys = resp ? Object.keys(resp).join(',') : 'null'
    throw new Error(`入库响应缺 material_id（实得字段：${keys}）`)
  }
  return `${serverUrl.value}/material/serve?material_id=${mid}`
}

watch(() => props.open, (open) => {
  if (!open) {
    clearLocal()
    tab.value = 'library'
    return
  }
  void resolveServerUrl().then(() => run(1))
  // 回显父级已选项（跨次打开保留）：open 时网格尚未加载（items 空/旧页）——
  // 按 selectedKeys 键级直接种子 selectedMap（最小 GridItem 形态，缩略图/确认
  // URL 都由键推导），页加载后 run() 内再按真实 GridItem 覆盖升级。
  // （原实现只对 items.value 回显——打开瞬间恒空，自动配图的图从未进过选择池。）
  selectedMap.value.clear()
  const names = props.selectedNames || []
  for (const k of props.selectedKeys || []) {
    if (!k) continue
    const idx = (props.selectedKeys || []).indexOf(k)
    selectedMap.value.set(k, { id: k, material_id: k, filename: names[idx] || k, media_type: 'image' })
  }
})

async function confirmSelection(): Promise<void> {
  const urls: string[] = []
  const names: string[] = []
  const keys: string[] = []
  for (const [k, it] of selectedMap.value) {
    const url = buildMediaServeUrl(serverUrl.value, keyOf(it))
    if (url) {
      urls.push(url)
      names.push(String(it?.filename || it?.name || k))
      keys.push(k)
    }
  }
  if (localSelectedItems.value.length) {
    localBusy.value = true
    localError.value = ''
    try {
      for (const it of localSelectedItems.value) {
        try {
          urls.push(await ingestLocalFile(it))
          names.push(it.name)
          keys.push(`local-${it.name}-${it.file.size}`)
        } catch (e) {
          const msg = (e as Error)?.message || String(e)
          localError.value = `本地上传入库失败：${it.name}——${msg}（服务端 imitate/upload 当前仅收视频扩展名，图片入库需服务端放开）`
          clientError('imitation-video', `产品图本地上传入库失败 ${it.name}`, e)
          return // 保留弹窗与已选状态，用户可见错误后重试/改选
        }
      }
    } finally {
      localBusy.value = false
    }
  }
  if (!urls.length) return
  emit('confirm', { urls, names, keys })
}
</script>

<template>
  <teleport to="body"><div class="tintin-media-scope tintin-modal-layer">
    <div v-if="open" class="modal-mask" @click.self="emit('close')">
      <div class="modal modal--picker">
        <div class="picker-main">
        <span class="modal-title">选择产品图（图片，最多 6 张）</span>
        <div class="row picker-tabs">
          <button class="picker-tab" :class="{ 'is-on': tab === 'library' }" @click="tab = 'library'">素材库选择</button>
          <button class="picker-tab" :class="{ 'is-on': tab === 'local' }" @click="tab = 'local'">本地上传</button>
        </div>

        <!-- 素材库选择 tab -->
        <template v-if="tab === 'library'">
          <div class="row picker-toolbar">
            <input v-model="kw" class="input grow" placeholder="按关键词搜索素材图片" @keyup.enter="run(1)" />
            <TButton label="搜索" @click="run(1)" />
          </div>
          <span v-if="error" class="picker-error">{{ error }}</span>
          <div v-else class="picker-grid">
            <div
              v-for="(it, i) in items"
              :key="keyOf(it) || i"
              class="picker-card"
              :class="{ 'is-selected': isSelected(it) }"
              @click="toggleSelect(it)"
            >
              <div class="picker-thumb-wrap">
                <img
                  v-if="!thumbFailed[keyOf(it)]"
                  :src="thumbUrl(it)"
                  class="picker-thumb"
                  loading="lazy"
                  @error="thumbFailed[keyOf(it)] = true"
                />
                <div v-else class="picker-thumb picker-thumb--fail">缩略图加载失败</div>
              </div>
              <span class="picker-name">{{ String(it?.filename || keyOf(it)) }}</span>
              <span class="picker-check" :class="{ 'is-on': isSelected(it) }"></span>
            </div>
            <div v-if="!items.length && !loading" class="muted">无图片素材</div>
            <div v-if="loading" class="muted">加载中…</div>
          </div>
          <div class="row between">
            <span class="muted">已选 {{ totalSelected() }}/6 ｜ 第 {{ page }}/{{ totalPages }} 页</span>
            <div class="row">
              <TButton label="上一页" :disabled="page <= 1 || loading" @click="prevPage" />
              <TButton label="下一页" :disabled="page >= totalPages || loading" @click="nextPage" />
              <TButton label="清空选择" plain @click="clearSelection" />
            </div>
          </div>
        </template>

        <!-- 本地上传 tab（多图拖入/点选；确认时入库→material_id→serve URL） -->
        <template v-else>
          <div
            class="local-dropzone"
            :class="{ 'is-active': localDragging }"
            @click="fileInput?.click()"
            @dragover.prevent="localDragging = true"
            @dragleave.prevent="localDragging = false"
            @drop.prevent="onLocalDrop"
          >
            <span class="local-dropzone__main">拖入图片到此处，或点击选择（可多选）</span>
            <span class="local-dropzone__hint">支持 PNG / JPG / JPEG / WEBP / GIF / BMP，最多选 {{ MAX_SELECT }} 张</span>
          </div>
          <input ref="fileInput" type="file" :accept="IMAGE_EXTS.map((e) => '.' + e).join(',')" multiple class="local-input" @change="addLocalFiles(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''" />
          <span v-if="localError" class="picker-error">{{ localError }}</span>
          <div v-if="localItems.length" class="picker-grid">
            <div
              v-for="(it, i) in localItems"
              :key="it.name + it.file.size"
              class="picker-card"
              :class="{ 'is-selected': localSelected.has(it) }"
              @click="toggleLocalSelect(it)"
            >
              <div class="picker-thumb-wrap">
                <img :src="it.preview" class="picker-thumb" :alt="it.name" />
              </div>
              <span class="picker-name">{{ it.name }}</span>
              <span class="picker-check" :class="{ 'is-on': localSelected.has(it) }"></span>
              <button class="local-remove" title="移除" @click.stop="removeLocal(it)">×</button>
            </div>
          </div>
          <div v-else class="muted">尚未添加本地图片。</div>
          <div class="row between">
            <span class="muted">已选 {{ totalSelected() }}/6（含素材库 tab）</span>
            <TButton label="清空本地列表" plain @click="clearLocal" />
          </div>
        </template>

        <div class="modal-actions">
          <TButton label="取消" plain @click="emit('close')" />
          <TButton label="确定选用" :disabled="totalSelected() < 1 || localBusy" :loading="localBusy" @click="confirmSelection" />
        </div>
        </div>
        <!-- 选中池（2026-10-08 用户裁决：右侧常显已选图片，跨两 tab，单张可移除——
             类似文案混剪选择素材的选中态常显） -->
        <aside class="picker-pool">
          <span class="picker-pool-title">选中池（{{ totalSelected() }}/6）</span>
          <div v-if="!poolEntries.length" class="muted">尚未选择图片</div>
          <div v-else class="picker-pool-list">
            <div v-for="e in poolEntries" :key="e.key" class="picker-pool-item">
              <img :src="e.thumb" :alt="e.name" loading="lazy" />
              <span class="picker-pool-name" :title="e.name">{{ e.name }}</span>
              <button class="picker-pool-del" title="移除" @click="e.remove()">×</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </div></teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed; inset: 0; z-index: 1002; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.7);
}

.modal {
  display: flex; flex-direction: column; gap: 12px; width: 440px; max-width: 90vw; max-height: 80vh;
  padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg);
}

.modal--picker { width: 1080px; flex-direction: row; align-items: stretch; gap: 14px; }
.picker-main { display: flex; flex-direction: column; gap: 12px; flex: 1 1 auto; min-width: 0; min-height: 0; }
/* 选中池（2026-10-08 用户裁决：右侧常显已选图片，跨两 tab，单张可移除） */
.picker-pool { flex: 0 0 230px; display: flex; flex-direction: column; gap: 8px; min-width: 0;
  border-left: 1px solid var(--border); padding-left: 14px; }
.picker-pool-title { font-size: 13px; font-weight: 600; }
.picker-pool-list { display: flex; flex-direction: column; gap: 8px; overflow-y: auto;
  min-height: 0; flex: 1 1 auto; }
.picker-pool-item { position: relative; display: flex; gap: 8px; align-items: center;
  border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px; }
.picker-pool-item img { width: 64px; height: 64px; object-fit: cover; border-radius: 4px;
  flex: none; background: #101010; }
.picker-pool-name { font-size: 12px; color: var(--foreground); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; min-width: 0; }
.picker-pool-del { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; padding: 0;
  line-height: 15px; font-size: 12px; background: rgba(0, 0, 0, 0.55); color: #fff;
  border: none; border-radius: 50%; cursor: pointer; }
.picker-pool-del:hover { background: var(--danger, #e74c3c); }

.modal-title { font-size: 15px; font-weight: 600; }

.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }

.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }

.row.between { justify-content: space-between; }

.grow { flex: 1 1 auto; }

.input { height: 32px; padding: 0 10px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--foreground); outline: none; font-size: 13px; }

.input:focus { border-color: var(--primary); }

.muted { color: var(--muted-foreground); font-size: 12px; }

.picker-error { color: var(--danger, #e74c3c); font-size: 12px; }

.picker-tabs { gap: 8px; }
.picker-tab {
  height: 30px; padding: 0 14px; font-size: 13px; cursor: pointer;
  background: var(--card); color: var(--muted-foreground);
  border: 1px solid var(--border); border-radius: var(--radius-md);
}
.picker-tab.is-on { color: var(--primary); border-color: var(--primary); font-weight: 600; background: color-mix(in srgb, var(--primary) 8%, var(--card)); }

.local-dropzone {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  min-height: 120px; padding: 16px; cursor: pointer; text-align: center;
  background: color-mix(in srgb, var(--primary) 6%, var(--card));
  border: 1.5px dashed color-mix(in srgb, var(--primary) 40%, var(--border)); border-radius: var(--radius-lg);
  color: var(--muted-foreground);
  transition: border-color var(--duration-fast, 0.15s), background var(--duration-fast, 0.15s);
}
.local-dropzone:hover, .local-dropzone.is-active { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, var(--card)); }
.local-dropzone__main { font-size: 13px; font-weight: 600; color: var(--foreground); }
.local-dropzone__hint { font-size: 12px; }
.local-input { display: none; }
.local-remove {
  position: absolute; top: 4px; left: 6px; width: 18px; height: 18px; padding: 0; line-height: 1;
  font-size: 12px; border: none; border-radius: 50%; cursor: pointer;
  background: rgba(0,0,0,.55); color: #fff;
}

.picker-grid {
  display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px;
  min-height: 0; overflow-y: auto; max-height: 52vh; padding: 2px;
}

.picker-card {
  position: relative; display: flex; flex-direction: column; gap: 4px; padding: 6px; min-width: 0;
  background: color-mix(in srgb, var(--primary) 4%, var(--card));
  border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer;
  transition: border-color var(--duration-fast, 0.15s), background var(--duration-fast, 0.15s);
}

.picker-card:hover { border-color: var(--primary); }

.picker-card.is-selected {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--card));
}

.picker-thumb-wrap { width: 100%; aspect-ratio: 1 / 1; overflow: hidden; border-radius: var(--radius-sm, 4px); background: var(--border); display: flex; align-items: center; justify-content: center; }
.picker-thumb { width: 100%; height: 100%; object-fit: cover; }
.picker-thumb--fail { font-size: 12px; color: var(--muted-foreground); }

.picker-name {
  min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: var(--foreground);
}

.picker-check {
  position: absolute; top: 10px; right: 10px; width: 18px; height: 18px; border-radius: 50%;
  border: 1px solid var(--border); background: var(--card);
}

.picker-check.is-on { border-color: var(--primary); background: var(--primary); }
</style>
