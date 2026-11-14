<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// OtProductLibrary.vue — 产品资料（运营工具 · P1 实装）
// 2026-08-30 落地：对齐原客户端 product_library_page.py 完整链路——
//   从仓库同步（服务端 ERP 同步+轮询）/ 关键词搜索（300ms 防抖）/
//   品类→品牌→型号 树 / 表单增删改（仓库条目 8 字段只读）/
//   智能挖掘（单条，挖掘即持久化）/ 全量挖掘（再点停止）。
// Excel 导入导出：待引入 SheetJS 单独批次（原版 openpyxl）。
// 分层（IRON-06）：业务全在 useOpsProductLibrary（HTTP 编排/轮询）+
// opsProductLibraryLogic（纯函数，有单测）；本组件只绘制 + 事件转发。
// ═══════════════════════════════════════════════════════════════

import { computed, inject, onMounted, ref, watch } from 'vue'
import {
  BASIC_FIELDS,
  PRODUCT_FIELDS,
  productSixViewSlots,
} from '@/composables/opsProductLibraryLogic'
import { useOpsProductLibrary } from '@/composables/useOpsProductLibrary'
import { TOOL_TAB_CTX, NOOP_TOOL_TAB_CTX, useToolTabBusy } from '@/composables/useToolTabs'
import { loadTabSession, saveTabSession } from '@/composables/tabSessionState'
import OtCopywritingPanel from './OtCopywritingPanel.vue'
import OtPickMaterialDialog from './OtPickMaterialDialog.vue'

const P = useOpsProductLibrary()

/* ── 六视图（2026-10-09 服务端 8f073bbf：详情内嵌 item.six_views；
   2026-10-10 e44a8b66：+逐视图上传替换，纯替换语义=其余五张不动；
   2026-11-08 用户裁决：图库选图收拢为顶部一枚「图库」钮——弹窗右栏改为
   六视图槽位格，左侧卡片拖入槽位=绑定该视图（已有图=替换），替代原
   逐视图「图库」钮（一视图一选一往返）── */
const serverUrl = ref('')
const sixSlots = computed(() => productSixViewSlots(P.sixViews.value))
/** 服务端 url/thumbnail 为相对路径（/material/serve|thumbnail?material_id=N），拼服务端地址 */
function sixImgUrl(u: string): string {
  if (!u) return ''
  return /^https?:\/\//.test(u) ? u : `${serverUrl.value}${u}`
}
function onDeleteView(view: string, label: string): void {
  if (window.confirm(`确定删除「${label}」视图吗？删除后可重新组装补齐。`)) void P.deleteSixView(view)
}
/** 隐藏文件选择：点槽位「替换/上传」记下目标视角，选完文件交 composable 纯替换 */
const sixFileInput = ref<HTMLInputElement | null>(null)
let sixPendingView = ''
function onUploadView(view: string): void {
  sixPendingView = view
  sixFileInput.value?.click()
}
function onSixFilePicked(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = '' // 同一文件可重复选择
  const view = sixPendingView
  sixPendingView = ''
  if (file && view) void P.uploadSixView(view, file)
}

/* ── 图库拖放绑定（2026-11-08 用户裁决）：选择素材弹窗六视图模式——
   右栏=当前六视图槽位（已有图显示、拖入即替换）；槽位缩略图随
   P.sixViews 响应式刷新（每次绑定成功 loadSixViews 回读）。绑定走
   既有绑定 B（fetch 字节→File→uploadSixView，服务端 upload 端点
   暂只收文件）。 ── */
const sixPickOpen = ref(false)
function onSearchGallery(): void {
  if (!P.editingId.value || P.sixUploading.value) return
  sixPickOpen.value = true
}
/** 弹窗槽位格数据（view/label/绝对化 url；空 url=缺图虚位） */
const sixPickSlots = computed(() => sixSlots.value.map((s) => ({
  view: s.view,
  label: s.label,
  url: s.entry ? sixImgUrl(s.entry.thumbnail || s.entry.url) : '',
})))
function onSixAssign(payload: { view: string; item: Record<string, unknown> }): void {
  const mid = String(payload?.item?.material_id ?? payload?.item?.id ?? '').trim()
  if (!mid) { P.sixStatus.value = '未取到素材 ID，未绑定。'; return }
  if (!P.editingId.value) { P.sixStatus.value = '请先在左侧选择产品。'; return }
  if (P.sixUploading.value) { P.sixStatus.value = '上一张视图仍在处理中，请等状态栏提示后再拖入。'; return }
  void P.bindSixViewFromMaterial(payload.view, mid, serverUrl.value)
}

/* ── Excel 导入（服务端 /import 自解析，客户端只传文件）── */
const importFileInput = ref<HTMLInputElement | null>(null)
function onImportClick(): void {
  importFileInput.value?.click()
}
function onImportFilePicked(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = '' // 同一文件可重复选择
  if (file) void P.importExcel(file)
}
function onDownloadTemplate(): void {
  void P.downloadImportTemplate(serverUrl.value)
}

/* ── 大类折叠已随扁平分页列表退役（2026-11-14 用户裁决：品类/品牌折叠树由
   分类/品牌下拉过滤替代，见左栏 flat-filters/flat-pager） ── */

/* ── 过滤下拉=可输入组合框（2026-11-14 用户裁决「选择下拉框也是可以输入的」）：
   输入即过滤（子串，直接落到 flatCategory/flatBrand），候选=当前数据派生；
   点选/Enter 提交并收起，Esc/失焦还原为当前过滤值 ── */
const catDraft = ref('')
const brandDraft = ref('')
const comboOpen = ref<'' | 'cat' | 'brand'>('')
function comboOptions(kind: 'cat' | 'brand'): string[] {
  const all = kind === 'cat' ? P.flatOptions.value.categories : P.flatOptions.value.brands
  const draft = (kind === 'cat' ? catDraft.value : brandDraft.value).trim().toLowerCase()
  if (!draft) return all
  return all.filter((v) => v.toLowerCase().includes(draft))
}
function pickCombo(kind: 'cat' | 'brand', v: string): void {
  if (kind === 'cat') { P.flatCategory.value = v; catDraft.value = v }
  else { P.flatBrand.value = v; brandDraft.value = v }
  P.flatPage.value = 1
  comboOpen.value = ''
}
function closeCombo(kind: 'cat' | 'brand'): void {
  if (kind === 'cat') catDraft.value = P.flatCategory.value
  else brandDraft.value = P.flatBrand.value
  comboOpen.value = ''
}

/** 表单字段双列渲染（基本资料 11 字段；locked 只读，对齐 _apply_field_locks） */
const basicRows = BASIC_FIELDS

/* ── LRU discard 会话快照（2026-11-13 用户裁决根治·方案 B）：多 Tab 保活
   上限 8，超限时最久未激活的 tab 被卸载、切回重建=全部 ref 重置。本卡把
   交互状态（搜索关键字/选中产品/表单含未保存修改/只读锁/状态文字）按 tab
   实例键控留内存快照，重建时恢复；六视图从服务端回读（loadSixViews）。
   快照随输入即写（内存 Map，零成本）；tab 关闭不清——条目数百字节级，
   应用退出即清。 ── */
const tabCtx = inject(TOOL_TAB_CTX, NOOP_TOOL_TAB_CTX)
const sessionKey = `product-library:${tabCtx.tabId || 'standalone'}`
interface ProductLibrarySnapshot {
  keyword: string
  editingId: string | null
  form: Record<string, string>
  lockedFields: Record<string, boolean>
  formStatus: string
}
function persistSnapshot(): void {
  saveTabSession<ProductLibrarySnapshot>(sessionKey, {
    keyword: P.keyword.value,
    editingId: P.editingId.value,
    form: { ...P.form.value },
    lockedFields: { ...P.lockedFields.value },
    formStatus: P.formStatus.value,
  })
}
// 快照写入：关键字/选中/表单（deep）任一变化即写（JSON 串比对 = 廉价 deep watch）
watch(
  () => JSON.stringify([P.keyword.value, P.editingId.value, P.form.value]),
  () => { persistSnapshot() },
)

/* ── 任务态 busy 上报（方案 B 落地后收窄）：交互状态已由会话快照根治恢复，
   busy 只保留既有「任务运行中」语义（不被 LRU 中止 + 关 tab 确认），
   与媒体包 7 卡同款口径。 ── */
useToolTabBusy(() => {
  if (P.syncing.value || P.mining.value || P.bulkMining.value
    || !!P.sixUploading.value || P.sixAssembling.value || P.importing.value) return true
  return false
})

onMounted(() => {
  // LRU discard 重建恢复：先回放快照（关键字→loadTree 用它，搜索结果与丢失前
  // 一致；表单=本地未保存修改优先于服务端详情），六视图再从服务端回读。
  const saved = loadTabSession<ProductLibrarySnapshot>(sessionKey)
  if (saved) {
    P.keyword.value = saved.keyword
    P.form.value = { ...saved.form }
    P.editingId.value = saved.editingId
    P.lockedFields.value = { ...saved.lockedFields }
    P.formStatus.value = saved.formStatus || '已恢复上次编辑状态。'
    if (saved.editingId) void P.loadSixViews(saved.editingId)
  }
  void P.loadTree()
  void (window as unknown as { tintin?: { env?: { serverPing?: () => Promise<{ url?: unknown }> } } })
    .tintin?.env?.serverPing?.().then((p) => { serverUrl.value = String(p?.url || '') }).catch(() => { serverUrl.value = '' })
})

/** 删除确认（对齐原 QMessageBox.question 默认 No） */
function onDelete() {
  if (!P.editingId.value) { P.formStatus.value = '当前为新增模式，无可删除条目。'; return }
  const name = `${P.form.value.brand ?? ''} ${P.form.value.model ?? ''}`.trim()
  if (window.confirm(`确定删除「${name}」吗？此操作不可撤销。`)) void P.remove()
}
</script>

<template>
  <section class="opl">
    <!-- ═══ 顶条：仓库同步 + 全量挖掘 + Excel 导入 + 状态 ═══ -->
    <div class="opl-toolbar">
      <button class="btn primary" :disabled="P.syncing.value" @click="P.startSync">
        {{ P.syncing.value ? '同步中…' : '⟳ 从仓库同步' }}
      </button>
      <button
        class="btn"
        :class="{ danger: P.bulkMining.value }"
        :title="P.bulkMining.value ? '点击停止批量挖掘' : '批量为所有产品自动挖掘性能参数和核心卖点'"
        @click="P.mineAll"
      >
        {{ P.bulkMining.value ? '⏹ 停止挖掘' : '⚡ 全量挖掘' }}
      </button>
      <button class="btn" :disabled="P.importing.value" title="下载服务端标准导入模板（product_import_template.xlsx）" @click="onDownloadTemplate">
        📄 导入模板
      </button>
      <button class="btn" :disabled="P.importing.value" title="导入 Excel 产品表（服务端解析入库，字段以模板为准）" @click="onImportClick">
        {{ P.importing.value ? '⏳ 导入中…' : '📥 导入 Excel' }}
      </button>
      <input ref="importFileInput" class="import-file" type="file" accept=".xlsx,.xls,.csv" @change="onImportFilePicked" />
      <span class="toolbar-status">{{ P.syncing.value || P.syncStatus ? P.syncStatus : (P.importing.value || P.importStatus ? P.importStatus : P.mineStatus) }}</span>
    </div>

    <div class="opl-main">
      <!-- ═══ 左卡：过滤 + 搜索 + 扁平分页列表（2026-11-14 用户裁决：参考 ERP 列表
           ——过滤条件在搜索之上、行分割线、客户端分页；原品类/品牌折叠树由
           分类/品牌下拉过滤替代，数据源 /grouped 与 /search 不变） ═══ -->
      <div class="opl-left">
        <div class="card-title">产品库</div>
        <div class="flat-filters">
          <!-- 过滤下拉=可输入组合框(2026-11-14 用户裁决「选择下拉框也是可以输入的」):
               输入即过滤(子串), 选项=当前数据派生候选; 点选/Enter 提交, Esc 还原 -->
          <div class="combo">
            <input
              class="input"
              :value="catDraft"
              placeholder="全部分类"
              title="按品类过滤（可输入）"
              @focus="catDraft = P.flatCategory.value; comboOpen = 'cat'"
              @input="catDraft = ($event.target as HTMLInputElement).value; P.flatCategory.value = catDraft.trim(); P.flatPage.value = 1; comboOpen = 'cat'"
              @keydown.enter.prevent="pickCombo('cat', catDraft.trim())"
              @keydown.esc.prevent="closeCombo('cat')"
              @blur="closeCombo('cat')"
            />
            <div v-if="comboOpen === 'cat' && comboOptions('cat').length" class="combo-list custom-scroll">
              <div class="combo-opt" :class="{ active: !P.flatCategory.value }" @mousedown.prevent="pickCombo('cat', '')">全部分类</div>
              <div v-for="c in comboOptions('cat')" :key="c" class="combo-opt" :class="{ active: P.flatCategory.value === c }" @mousedown.prevent="pickCombo('cat', c)">{{ c }}</div>
            </div>
          </div>
          <div class="combo">
            <input
              class="input"
              :value="brandDraft"
              placeholder="全部品牌"
              title="按品牌过滤（可输入）"
              @focus="brandDraft = P.flatBrand.value; comboOpen = 'brand'"
              @input="brandDraft = ($event.target as HTMLInputElement).value; P.flatBrand.value = brandDraft.trim(); P.flatPage.value = 1; comboOpen = 'brand'"
              @keydown.enter.prevent="pickCombo('brand', brandDraft.trim())"
              @keydown.esc.prevent="closeCombo('brand')"
              @blur="closeCombo('brand')"
            />
            <div v-if="comboOpen === 'brand' && comboOptions('brand').length" class="combo-list custom-scroll">
              <div class="combo-opt" :class="{ active: !P.flatBrand.value }" @mousedown.prevent="pickCombo('brand', '')">全部品牌</div>
              <div v-for="b in comboOptions('brand')" :key="b" class="combo-opt" :class="{ active: P.flatBrand.value === b }" @mousedown.prevent="pickCombo('brand', b)">{{ b }}</div>
            </div>
          </div>
        </div>
        <div class="flat-search">
          <input
            class="input search"
            type="text"
            placeholder="搜索 型号 / 货号 / 编码 / 条码 ..."
            :value="P.keyword.value"
            @input="P.onKeywordInput(($event.target as HTMLInputElement).value)"
            @keydown.enter="P.loadTree()"
          />
          <button class="btn" :disabled="P.treeLoading.value" title="按当前关键字与过滤条件查询" @click="P.loadTree()">查询</button>
        </div>
        <div class="tree custom-scroll">
          <template v-if="P.treeLoading.value">加载中…</template>
          <template v-else-if="P.treeError.value">加载失败：{{ P.treeError.value }}</template>
          <template v-else-if="!P.filteredFlat.value.length">暂无产品，请先「从仓库同步」或调整过滤条件</template>
          <template v-else>
            <button
              v-for="row in P.pagedFlat.value.rows"
              :key="row.id || row.label"
              class="flat-row"
              :class="{ active: P.editingId.value === row.id }"
              type="button"
              :title="`${row.category} / ${row.brand}\n货号: ${row.goodsNo || '—'}\n可用库存: ${row.availableNum || '—'}`"
              @click="P.selectNode(row.id)"
            >
              <span class="flat-name">{{ row.label }}</span>
              <span class="flat-stock" :class="{ 'flat-stock--zero': row.availableNum === '0' }">{{ row.availableNum || '—' }}</span>
            </button>
          </template>
        </div>
        <div class="flat-pager">
          <span class="page-info">共 {{ P.pagedFlat.value.total }} 条</span>
          <button class="btn page-btn" :disabled="P.pagedFlat.value.page <= 1 || P.treeLoading.value" @click="P.flatPage.value--">上一页</button>
          <span class="page-info">第 {{ P.pagedFlat.value.page }} / {{ P.pagedFlat.value.totalPages }} 页</span>
          <button class="btn page-btn" :disabled="P.pagedFlat.value.page >= P.pagedFlat.value.totalPages || P.treeLoading.value" @click="P.flatPage.value++">下一页</button>
          <label class="page-info">每页:</label>
          <input
            v-model.number="P.flatPageSize.value"
            class="input page-size"
            type="number"
            min="10"
            max="200"
            step="10"
            :disabled="P.treeLoading.value"
            @change="P.flatPage.value = 1"
          />
        </div>
        <!-- 2026-09-05 用户裁决：删除「新增型号（清空表单）」——与右侧操作栏「清空」按钮
             重复（同为 P.clearForm），且仅清空表单不创建数据，无独立价值 -->
      </div>

      <!-- ═══ 右侧：基本资料 + 智能挖掘 ═══ -->
      <div class="opl-right">
        <div class="opl-card">
          <div class="card-title">产品基本资料</div>
          <p class="card-tip">
            仓库同步的产品：仅「商品名称/型号、品类、备注」可改，其余为仓库只读数据；所有修改仅保存在本地，不会回写仓库。
          </p>
          <div class="form-grid">
            <label v-for="f in basicRows" :key="f.key" class="form-field">
              <span class="form-label">{{ f.label }}<i v-if="f.key === 'brand' || f.key === 'model'" class="req"> *</i></span>
              <input
                class="input"
                type="text"
                :readonly="P.lockedFields.value[f.key]"
                :class="{ readonly: P.lockedFields.value[f.key] }"
                v-model="P.form.value[f.key]"
              />
            </label>
          </div>
        </div>

        <div class="opl-card">
          <div class="card-title-row">
            <div class="card-title">智能挖掘（性能参数 &amp; 核心卖点）</div>
            <button
              class="btn primary"
              :disabled="P.mining.value || !(P.form.value.brand || '').trim() || !(P.form.value.model || '').trim()"
              :title="(P.form.value.brand || '').trim() && (P.form.value.model || '').trim() ? '按品牌+型号自动挖掘性能参数和核心卖点' : '请先选择产品或填写品牌与型号'"
              @click="P.mineSingle"
            >
              {{ P.mining.value ? '⏳ 正在挖掘...' : '🪄 智能挖掘' }}
            </button>
          </div>
          <div class="mine-grid">
            <label class="mine-field">
              <span class="form-label">性能参数</span>
              <textarea
                class="input ta"
                :placeholder="P.mining.value ? '挖掘中…' : '点击【智能挖掘】自动从大模型获取性能参数，或在此手动输入...'"
                v-model="P.form.value.features"
              ></textarea>
            </label>
            <label class="mine-field">
              <span class="form-label">核心卖点</span>
              <textarea
                class="input ta"
                :placeholder="P.mining.value ? '挖掘中…' : '点击【智能挖掘】自动从大模型获取核心卖点，或在此手动输入...'"
                v-model="P.form.value.selling_points"
              ></textarea>
            </label>
          </div>
          <div v-if="P.mineStatus.value" class="mine-status">{{ P.mineStatus.value }}</div>
        </div>

        <!-- ═══ 产品六视图（2026-10-09 服务端 8f073bbf：详情 item.six_views 内嵌；
             生成=views/assemble 异步任务轮询；错图单张 DELETE 后可重组） ═══ -->
        <div class="opl-card">
          <div class="card-title-row">
            <div class="card-title">产品六视图（{{ P.sixViews.value.length }}/6）</div>
            <div class="six-actions">
              <button
                class="btn primary"
                :disabled="!P.editingId.value || !!P.sixUploading.value"
                :title="P.editingId.value ? '打开素材图库：左侧图片拖到右侧视图位绑定（已有图=替换），一次弹窗可填满六个视图' : '请先在左侧选择产品'"
                @click="onSearchGallery"
              >🖼 从图库选择</button>
              <label class="six-opt" title="素材库匹配永远第一优先；此开关只决定缺图时是否网络搜图兜底（服务端缺省=关）">
                <input type="checkbox" v-model="P.allowWeb.value" /> 网络搜图兜底</label>
              <label class="six-opt" title="素材库匹配永远第一优先；此开关只决定缺图时是否 AI 生成兜底（服务端缺省=开）">
                <input type="checkbox" v-model="P.allowAi.value" /> AI 生成兜底</label>
              <button
                class="btn primary"
                :disabled="P.sixAssembling.value || !P.editingId.value"
                :title="P.editingId.value ? '素材库匹配永远第一优先，勾选项仅作缺图兜底（异步任务，完成后自动刷新）' : '请先在左侧选择产品'"
                @click="P.assembleSixViews"
              >
                {{ P.sixAssembling.value ? '⏳ 组装中…' : '🎬 生成 / 重新生成' }}
              </button>
            </div>
          </div>
          <div class="six-grid">
            <template v-for="s in sixSlots" :key="s.view">
              <div v-if="s.entry" class="six-cell">
                <img :src="sixImgUrl(s.entry.thumbnail || s.entry.url)" :alt="s.view" class="six-img" loading="lazy" />
                <span class="six-label">{{ s.label }}<i v-if="s.entry.source" class="six-src">{{ s.entry.source }}</i></span>
                <button class="six-up" :disabled="!P.editingId.value || !!P.sixUploading.value"
                  :title="!P.editingId.value ? '请先在左侧选择产品' : '上传替换该视图（仅替换此张，其余五张不动；上传图入素材库）'"
                  @click="onUploadView(s.view)">{{ P.sixUploading.value === s.view ? '…' : '替换' }}</button>
                <button class="six-del" title="删除该视图（不可逆，可重新组装补齐）" @click="onDeleteView(s.view, s.label)">×</button>
              </div>
              <div v-else class="six-cell six-cell--empty">
                <span class="six-miss">缺</span>
                <div class="six-empty-actions">
                  <button class="six-up six-up--empty" :disabled="!P.editingId.value || !!P.sixUploading.value"
                    :title="!P.editingId.value ? '请先在左侧选择产品' : '上传该视图（仅补此张，其余五张不动；上传图入素材库）'"
                    @click="onUploadView(s.view)">{{ P.sixUploading.value === s.view ? '上传中…' : '上传' }}</button>
                </div>
                <span class="six-label">{{ s.label }}</span>
              </div>
            </template>
          </div>
          <input ref="sixFileInput" class="six-file" type="file" accept="image/*" @change="onSixFilePicked" />
          <OtPickMaterialDialog
            :visible="sixPickOpen"
            title="搜索图库（拖入右侧视图位绑定）"
            image-only
            purpose="product"
            :six-slots="sixPickSlots"
            :six-busy="P.sixUploading.value"
            @close="sixPickOpen = false"
            @assign="onSixAssign"
          />
          <div v-if="P.sixStatus.value" class="mine-status">{{ P.sixStatus.value }}</div>
        </div>

        <!-- 底部操作条（2026-09-05 用户裁决：按钮靠右，保存最右；状态占位左侧） -->
        <div class="opl-actions">
          <span class="form-status">{{ P.formStatus.value }}</span>
          <button class="btn" @click="P.clearForm">清空</button>
          <button class="btn" :disabled="!P.editingId.value" title="删除当前选中的产品" @click="onDelete">🗑 删除</button>
          <button class="btn primary" :disabled="P.saving.value" @click="P.save">
            {{ P.saving.value ? '保存中…' : (P.editingId.value ? '💾 保存修改' : '💾 保存（新增）') }}
          </button>
        </div>

        <!-- ═══ 文案生成（2026-09-05 用户裁决：自媒体工具·产品知识页迁入） ═══
             产品上下文 = 当前树选中条目（editingId/form）；性能参数/核心卖点
             直接读上方智能挖掘表单，新增模式（editingId 空）时生成被拦截 -->
        <OtCopywritingPanel
          :product-id="P.editingId.value ?? ''"
          :features="String(P.form.value.features ?? '')"
          :selling-points="String(P.form.value.selling_points ?? '')"
          :product="P.form.value"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.opl { display: flex; flex-direction: column; gap: var(--space-4); height: 100%; }
.btn {
  height: 32px; padding: 0 14px; border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--surface-container);
  color: var(--foreground); font-size: 13px; font-weight: 500; cursor: pointer;
  transition: all var(--duration-fast); white-space: nowrap;
}
.btn:hover { border-color: var(--primary); color: var(--primary); }
.btn.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
.btn.primary:hover { opacity: 0.9; }
.btn.danger { background: var(--error, #EF4444); border-color: var(--error, #EF4444); color: #fff; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.input {
  height: 32px; padding: 0 10px; border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--background);
  color: var(--foreground); font-size: 13px; width: 100%; box-sizing: border-box;
}
.input.readonly { opacity: 0.6; cursor: not-allowed; }

/* 顶条 */
/* 2026-11-14 用户裁决：工具条与上方 tab 栏保持一定间距（gap 只管子项之间，管不到顶边） */
.opl-toolbar { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-2); }
.toolbar-status {
  flex: 1; min-width: 0; font-size: 12px; color: var(--muted-foreground);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 主区（2026-11-07 用户裁决·方案1：左树/右栏各自独立内滚——此前 .opl height:100%
   对 auto 父级解析失效，整页只有宿主视图区一个滚动点，滚左树右栏跟着跑） */
.opl-main { display: grid; grid-template-columns: minmax(240px, 1fr) 2fr; gap: var(--space-4); flex: 1; min-height: 0; }
.opl-left, .opl-card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: var(--space-4);
  display: flex; flex-direction: column; gap: var(--space-3);
}
.opl-left { min-height: 0; overflow: hidden; } /* 网格项默认 min-height:auto 放不下约束，收掉后 .tree 的 overflow-y:auto 才生效 */
.card-title { font-size: 14px; font-weight: 700; color: var(--foreground); }
.card-title-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.card-tip { margin: 0; font-size: 12px; line-height: 1.5; color: var(--muted-foreground); }

/* ── 扁平分页列表（2026-11-14 用户裁决：参考 ERP 列表——过滤在搜索之上、
      行分割线、客户端分页；替代原品类/品牌折叠树） ── */
.flat-filters { display: flex; gap: var(--space-2); }
.flat-filters .input { flex: 1 1 0; min-width: 0; }
/* 可输入组合框（2026-11-14 用户裁决）：输入即过滤，候选浮层随焦点开合 */
.combo { position: relative; flex: 1 1 0; min-width: 0; }
.combo .input { width: 100%; }
.combo-list {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 40;
  max-height: 220px; overflow-y: auto;
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md);
  box-shadow: var(--shadow-3);
}
.combo-opt { padding: 6px 10px; font-size: 12px; color: var(--foreground); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.combo-opt:hover { background: var(--surface-container); }
.combo-opt.active { color: var(--primary); font-weight: 700; }
.flat-search { display: flex; gap: var(--space-2); }
.flat-search .input { flex: 1 1 auto; }
.tree { flex: 1; min-height: 160px; overflow-y: auto; display: flex; flex-direction: column; }
.tree-empty { font-size: 12px; color: var(--muted-foreground); padding: var(--space-2); }
.flat-row {
  display: flex; align-items: center; gap: var(--space-2); width: 100%;
  flex: 0 0 auto; height: 34px; padding: 0 var(--space-2);
  border: none; border-bottom: 1px solid var(--border);
  background: transparent; color: var(--foreground);
  font-size: 12px; text-align: left; cursor: pointer;
  transition: background var(--duration-fast);
}
.flat-row:last-child { border-bottom: none; }
.flat-row:hover { background: var(--surface-container); }
.flat-row:hover .flat-name { color: var(--primary); }
.flat-row.active {
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  box-shadow: inset 3px 0 0 var(--primary);
}
.flat-name {
  flex: 1 1 auto; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; font-weight: 600;
  transition: color var(--duration-fast);
}
.flat-stock {
  flex: 0 0 auto; min-width: 44px; text-align: right;
  color: var(--muted-foreground); font-variant-numeric: tabular-nums;
}
.flat-stock--zero { color: var(--error, #EF4444); }
.flat-pager { flex-shrink: 0; display: flex; align-items: center; gap: var(--space-2); }
.page-info { font-size: 12px; color: var(--muted-foreground); white-space: nowrap; }
.page-btn { height: 28px; padding: 0 10px; font-size: 12px; }
.page-size { width: 64px; }

/* 右侧布局 */
.opl-right { display: flex; flex-direction: column; gap: var(--space-4); min-height: 0; overflow-y: auto; }
.form-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-2) var(--space-3); }
.form-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.form-label { font-size: 12px; color: var(--muted-foreground); }
.req { color: var(--error, #EF4444); font-style: normal; }
.mine-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.mine-field { display: flex; flex-direction: column; gap: 4px; }
.ta { height: 192px; padding: 8px 10px; resize: vertical; line-height: 1.5; } /* 2026-09-05 用户裁决：96→192px，参数/卖点篇幅加倍 */
.mine-status { font-size: 12px; color: var(--muted-foreground); }

/* 产品六视图卡 */
.six-actions { display: flex; align-items: center; gap: var(--space-3); }
.six-opt { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted-foreground); cursor: pointer; }
.six-file, .import-file { display: none; }
.six-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: var(--space-2); }
.six-cell { position: relative; aspect-ratio: 1 / 1; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; background: var(--surface-container); }
.six-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.six-cell--empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border-style: dashed; }
.six-miss { font-size: 16px; color: var(--muted-foreground); opacity: 0.6; }
.six-label { position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 6px; font-size: 11px; color: #fff; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; gap: 4px; }
.six-src { font-style: normal; font-size: 10px; opacity: 0.8; }
.six-del {
  position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; line-height: 16px;
  border: none; border-radius: 50%; background: rgba(0, 0, 0, 0.55); color: #fff;
  font-size: 12px; cursor: pointer; padding: 0;
}
.six-del:hover { background: var(--error, #EF4444); }
.six-up {
  position: absolute; top: 2px; left: 2px; height: 18px; padding: 0 6px;
  border: none; border-radius: 9px; background: rgba(0, 0, 0, 0.55); color: #fff;
  font-size: 10px; cursor: pointer;
}
.six-up:hover { background: var(--primary); }
.six-up:disabled { opacity: 0.6; cursor: wait; }
.six-cell--empty .six-up { position: static; height: 20px; padding: 0 10px; font-size: 11px; border-radius: 10px; }
.six-empty-actions { display: flex; gap: 4px; }
/* 逐视图「图库」浮层钮已随 2026-11-08 收拢裁决删除——图库入口=顶部一枚（.six-actions 内） */

/* 底部操作条 */
.opl-actions { display: flex; align-items: center; gap: var(--space-3); }
.form-status { flex: 1; min-width: 0; font-size: 12px; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 1000px) {
  .opl-main { grid-template-columns: 1fr; overflow-y: auto; } /* 单列堆叠时主区自身滚动，两卡都能看到 */
  .form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mine-grid { grid-template-columns: 1fr; }
}
</style>
