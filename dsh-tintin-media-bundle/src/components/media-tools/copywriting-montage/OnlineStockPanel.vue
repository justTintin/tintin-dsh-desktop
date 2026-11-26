<script setup lang="ts">
// 在线素材搜索面板（POST /material/stock_search，Pexels/Pixabay）。
// 从 CopywritingStep2Panel 拆出：逻辑在 useOnlineStockPicker 复用。
// 2026-11-25 用户报障：拆出时样式留在了原文件（工具类全是组件内 scoped，无全局定义），
// 嵌进分镜弹窗后整块裸 HTML——图片满屏、搜索行挤压、勾选框不可见。本文件自带全套样式。
import TButton from '@/components/common/TButton.vue'
import { useOnlineStockPicker } from '@/composables/useOnlineStockPicker'
import { computed, onMounted, ref } from 'vue'
import { onlineKey, type OnlineItem } from '@/composables/useOnlineStock'

const props = withDefaults(defineProps<{ initialQuery?: string; single?: boolean }>(), { initialQuery: '', single: false })
const emit = defineEmits<{ (e: 'add', items: OnlineItem[]): void }>()
const { oKw, oKind, oItems, oLoading, oError, oMsg, oPage, oHasMore, oSelected, oThumbFailed,
  oSelectedCount, oToggle, oSelectPageAll, oClearSelection, runOnline } = useOnlineStockPicker()

// 播放预览（2026-11-26 用户裁决：点击结果卡即在右侧播放该视频/图片）
const previewItem = ref<OnlineItem | null>(null)
function preview(it: OnlineItem): void {
  previewItem.value = it
  oToggle(it)
}
const previewIsVideo = computed(() => previewItem.value?.type !== 'image')

onMounted(() => { if (props.initialQuery) { oKw.value = props.initialQuery; void runOnline(1) } })

function add(): void {
  const picked = [...oSelected.value.values()]
  emit('add', props.single ? picked.slice(0, 1) : picked)
}
</script>

<template>
  <div class="online-stock">
    <div class="ostock-cols">
      <div class="ostock-left">
        <div class="row osearch-row">
          <input v-model="oKw" class="input grow" placeholder="搜索在线素材（支持中文）…" @keydown.enter="runOnline(1)" />
          <select v-model="oKind" class="input lib-input-sm" title="素材类型" @change="runOnline(1)">
            <option value="video">视频</option>
            <option value="image">图片</option>
          </select>
          <TButton label="搜索" size="small" :loading="oLoading" @click="runOnline(1)" />
        </div>
        <div class="lib-grid-wrap">
          <div v-if="oLoading" class="muted lib-state">搜索中…</div>
          <div v-else-if="oError" class="error-msg lib-state">{{ oError }}</div>
          <div v-else-if="!oItems.length" class="muted lib-state">输入关键词搜索在线免版权素材（Pexels / Pixabay）。</div>
          <div v-else class="lib-grid">
            <button v-for="(it, i) in oItems" :key="onlineKey(it) || i" type="button"
              class="lib-card" :class="{ checked: oSelected.has(onlineKey(it)) }"
              :title="`${it.author || it.provider || '在线素材'} · 点击播放预览，勾选后确认绑定`" @click="preview(it)">
              <img v-if="it.thumb && !oThumbFailed[onlineKey(it)]" class="lib-thumb" :src="it.thumb" loading="lazy" alt="" @error="oThumbFailed[onlineKey(it)] = true" />
              <span v-else class="lib-thumb lib-thumb--ph">{{ it.type === 'image' ? '图片' : '视频' }}</span>
              <span class="lib-check" :class="{ on: oSelected.has(onlineKey(it)) }">✓</span>
              <span class="lib-name">{{ it.author || it.provider || it.id || '在线素材' }}</span>
              <span class="lib-sub">{{ it.duration_sec ? `${Number(it.duration_sec).toFixed(0)}s` : '' }} {{ it.width && it.height ? `${it.width}x${it.height}` : '' }}</span>
            </button>
          </div>
        </div>
      </div>
      <!-- 播放预览（2026-11-26 用户裁决：点击结果即在右侧播放） -->
      <div class="ostock-preview">
        <template v-if="previewItem">
          <video v-if="previewItem.type !== 'image'" class="ostock-pv-media" :src="previewItem.url" controls autoplay muted loop></video>
          <img v-else class="ostock-pv-media" :src="previewItem.url" alt="" />
          <div class="ostock-pv-meta">{{ previewItem.author || previewItem.provider || '在线素材' }}<template v-if="previewItem.duration_sec"> · {{ Number(previewItem.duration_sec).toFixed(0) }}s</template></div>
        </template>
        <div v-else class="ostock-pv-empty">
          <svg class="ostock-pv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M4 17l4.5-3.5 3.5 2.5 3-2 5 3" />
          </svg>
          <span>点击左侧结果播放预览</span>
        </div>
      </div>
    </div>
    <div class="row between">
      <div class="row">
        <TButton label="全选本页" variant="secondary" size="small" :disabled="!oItems.length" @click="oSelectPageAll" />
        <TButton label="取消全选" variant="secondary" size="small" :disabled="!oSelectedCount" @click="oClearSelection" />
        <span class="muted">已选 {{ oSelectedCount }} 项（跨页保留）</span>
      </div>
      <div class="row">
        <TButton label="上一页" variant="secondary" size="small" :disabled="oPage <= 1 || oLoading" @click="runOnline(oPage - 1)" />
        <TButton label="下一页" variant="secondary" size="small" :disabled="!oHasMore || oLoading" @click="runOnline(oPage + 1)" />
        <TButton :label="props.single ? `确认并绑定到此分镜（${oSelectedCount}）` : `加入素材池（${oSelectedCount}）`"
          :disabled="!oSelectedCount" @click="add" />
      </div>
    </div>
    <div v-if="oMsg" class="hint">{{ oMsg }}</div>
  </div>
</template>

<style scoped>
/* 面板布局（2026-11-26 用户裁决：弹窗默认即全尺寸 + 左列表右播放预览双栏） */
.online-stock { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; }
.ostock-cols { display: flex; gap: 12px; flex: 1 1 auto; min-height: 220px; }
.ostock-left { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.online-stock .lib-grid-wrap { flex: 1 1 auto; min-height: 160px; overflow-y: auto; overscroll-behavior: contain; }
/* 播放预览栏（点击结果卡即在此播放） */
.ostock-preview { flex: 0 0 300px; display: flex; flex-direction: column; gap: 6px; align-items: stretch; justify-content: center;
  background: #101010; border-radius: var(--radius-md); padding: 10px; min-height: 0; }
.ostock-pv-media { width: 100%; max-height: 430px; object-fit: contain; background: #000; border-radius: var(--radius-sm); }
.ostock-pv-meta { font-size: 12px; color: var(--foreground); text-align: center; }
.ostock-pv-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--muted-foreground); height: 100%; }
.ostock-pv-icon { width: 34px; height: 34px; opacity: 0.5; }
.ostock-pv-empty span { font-size: 12px; }
/* 搜索行：整行铺满（2026-11-25 用户裁决「关键词行要占整行」） */
.row { display: flex; align-items: center; gap: var(--space-3, 12px); flex-wrap: wrap; }
.row.between { justify-content: space-between; }
.input.grow { flex: 1 1 auto; min-width: 0; }
.lib-input-sm { width: 110px; flex: none; }
/* 结果网格卡（样式自 CopywritingStep2Panel 素材库 tab 同款平移） */
.lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; align-content: start; }
.lib-card {
  position: relative; display: flex; flex-direction: column; gap: 3px;
  padding: 6px; border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--surface-container); text-align: left; cursor: pointer;
  transition: border-color var(--duration-fast), background var(--duration-fast);
}
.lib-card:hover { border-color: var(--primary); }
.lib-card.checked { border-color: var(--primary); background: var(--surface-container-high); }
.lib-check {
  position: absolute; top: 5px; right: 5px; width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.92); color: transparent; font-size: 11px; font-weight: 700;
}
.lib-check.on { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
.lib-thumb { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: var(--radius-sm); background: var(--surface-container-high); }
.lib-thumb--ph { display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--muted-foreground); }
.lib-name { font-size: 12px; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-sub { font-size: 11px; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-state { padding: var(--space-5, 24px) var(--space-3, 12px); text-align: center; }
.muted { color: var(--muted-foreground); font-size: 12px; }
.hint { font-size: 12px; color: var(--muted-foreground); }
.error-msg { color: var(--danger, #e5484d); font-size: 12px; }
</style>
