<script setup lang="ts">
// ═════════════════════════════════════════════════════════════
// CopywritingStoryboard.vue — 文案混剪分镜脚本公共显示组件（四步共用，状态不同）
// 2026-09-21 用户裁决：生成脚本的界面与逻辑在第一步文案下方；生成后整个脚本
// 作为四步公共组件，每一步都有、只是状态不同：
//   edit（第一步）    = ✨AI 生成分镜 + 全字段可编辑（镜别/时长/画面/旁白/音效，增删镜）
//   voice（第二步）   = 只读（旁白已整体克隆为声音，按分镜时间轴对齐）
//   material（第三步）= 只读 + 智能匹配绑定的素材镜头列表（copywritingMontageAssignLogic 方案C）
//   fx（第四步）      = 只读（字幕/花字/文字模板挂接的旁白与画面依据）
// 数据源 = shell.s.copyShots（四步共享同一份分镜数据）；组件自注入 shell。
// ═════════════════════════════════════════════════════════════
import { computed, reactive, ref, inject } from 'vue'
import TButton from '@/components/common/TButton.vue'
import SbCollapseToggle from '../SbCollapseToggle.vue'
import { storyboardShotsExpanded } from '@/composables/storyboardShotsState'
import { fmtDur } from '@/composables/copywritingMontageLogic'
import { toFileUrl } from '@/utils/fileUrl'
import type { StoryboardShot } from '@/composables/opsStoryboardLogic'
import { ratioToOrient } from '@/composables/opsStoryboardLogic'
import type { OnlineItem } from '@/composables/useOnlineStock'
import { useHostDark } from '@/composables/hostTheme'
import { resolveShotTrack, type ShotTrack } from '@/composables/copywritingMontageTrackLogic'
import { copywritingMontageShellKey } from './copywritingMontageUiContext'
import OnlineStockPanel from './OnlineStockPanel.vue'
import TrackTile from './TrackTile.vue'
import TrackBatchBar from './TrackBatchBar.vue'

const props = defineProps<{
  mode: 'edit' | 'voice' | 'material' | 'fx'
  sfxBusy?: boolean
  singleScript?: boolean
  /** 第三步左右分栏态（2026-11-26 用户裁决）：左=脚本内容，右=文案声音/A-Roll/
   *  素材库/AI生成四组（后两组由上层 #side 注入）；分割线可拖，默认 6:4 */
  sidePanel?: boolean
}>()
const emit = defineEmits<{ (e: 'sfx-regen', shot: StoryboardShot): void; (e: 'sfx-remove', shot: StoryboardShot): void }>()

const isDark = useHostDark() // 弹窗 teleport 到 body（App 根外），暗色类需显式绑定（2026-11-05 白弹窗同款）
const shell = inject(copywritingMontageShellKey)!
const {
  copyShots, copyShotsStale, genStoryboard, storyboardBusy, activeNarrative,
  scenes, shotClipGroup, removeShotClipAt, unbindShotMaterial, toAbsolute, shotBatchProgressOf,
  storyboards, activeStoryboardId, setActiveStoryboard, renameStoryboardTab, removeStoryboardTab, COPY_STORYBOARD_MAX,
  splitResolution,
  shotMatMsg, addOnlineShotMaterial,
  shotGenActiveOf, shotGenStateOf,
} = shell.s

const shotOnlineIdx = ref(-1)
function onShotOnlineAdd(items: OnlineItem[]): void {
  const i = shotOnlineIdx.value
  if (i < 0 || !items.length) return
  void addOnlineShotMaterial(i, items[0]) // 2026-11-26 四源四轨：产物写该镜搜索轨占位
  shotOnlineIdx.value = -1
}

// ── 四源四轨（2026-11-26 用户裁决重申：三复选互不影响多选——1126 单选裁决仅指
//    在线搜索弹窗结果选择；产物各归各轨占位）──
const TRACK_KEYS = ['gen', 'stock', 'aroll'] as const
function setMark(shot: StoryboardShot, kind: 'material' | 'aroll' | 'ai', on: boolean): void {
  if (kind === 'material') shot.markMaterial = on || undefined
  else if (kind === 'aroll') shot.markARoll = on || undefined
  else shot.markAI = on || undefined
}
function slotLocal(i: number, track: 'gen' | 'stock' | 'aroll'): string {
  const local = copyShots.value[i]?.slots?.[track]?.local || ''
  return local ? toFileUrl(local) : ''
}

// ── 第三步左右分栏（2026-11-26 用户裁决：默认 6:4，分割线拖拽调节，localStorage 记忆；
//    与智能混剪页 vd-split 同交互形态）──
const SB_SPLIT_KEY = 'copy-sb-split-pct'
const sbSplitPct = ref(Math.min(80, Math.max(35, Number((typeof localStorage !== 'undefined' && localStorage.getItem(SB_SPLIT_KEY)) || 0) || 70)))
const sbLeftStyle = computed(() => ({ flex: `0 0 calc(${sbSplitPct.value}% - 6px)` }))
function onSbDivDown(e: MouseEvent): void {
  e.preventDefault()
  const pane = (e.currentTarget as HTMLElement).parentElement
  if (!pane) return
  const rect = pane.getBoundingClientRect()
  const onMove = (ev: MouseEvent) => {
    sbSplitPct.value = Math.min(80, Math.max(35, Math.round(((ev.clientX - rect.left) / rect.width) * 100)))
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    localStorage.setItem(SB_SPLIT_KEY, String(sbSplitPct.value))
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
// ── 素材状态行（2026-11-26 用户裁决：显示该镜生效源——A-Roll/AI生成/在线素材/
//    实拍素材/未绑定素材，单行不换行；与合成取用同一解析 resolveShotTrack）──
const TRACK_LABEL: Record<ShotTrack, string> = { aroll: 'A-Roll', gen: 'AI生成', stock: '在线素材', material: '实拍素材' }
function trackStatus(i: number): { text: string; none: boolean; material: boolean } {
  const shot = copyShots.value[i]
  const resolved = shot ? resolveShotTrack(shot, boundClips(i).length > 0) : null
  if (!resolved) return { text: '未绑定素材', none: true, material: false }
  return { text: TRACK_LABEL[resolved.track] || resolved.track, none: false, material: resolved.track === 'material' }
}
/** 该镜是否有任一视频源绑定（解绑全部按钮的显隐判据：素材绑定组或三轨占位任一有货） */
function trackHasAnySource(i: number): boolean {
  const shot = copyShots.value[i]
  if (!shot) return false
  return boundClips(i).length > 0 || TRACK_KEYS.some((t) => !!shot.slots?.[t]?.local)
}
/** 解绑该镜全部视频源（2026-11-26 用户裁决：不只素材轨——素材绑定组 +
 *  AI生成/在线搜索/A-Roll 三轨占位一并解绑，供生成剪辑方案逐镜检查重新计量） */
function unbindAllSources(i: number): void {
  unbindShotMaterial(i)
  const shot = copyShots.value[i]
  if (shot) shot.slots = undefined
}
/** 是否有任一镜任一轨在生成（顶部全局状态行的新旧样式判据） */
const shotGenAnyActive = computed(() => copyShots.value.some((_, i) =>
  TRACK_KEYS.some((t) => shotGenActiveOf(i, t))))
/** 轨道瓦片占位比例（2026-11-26 用户裁决：默认按分镜脚本输出画幅——竖屏 9:16 /
 *  横屏 16:9 /「与分割视频一致」按分割分辨率换算，解析失败回落竖屏） */
const tileAspect = computed(() => {
  const layout = activeMeta.value?.layout || 'vertical'
  if (layout === 'horizontal') return '16 / 9'
  if (layout === 'vertical') return '9 / 16'
  const m = /(\d+)\s*[x×]\s*(\d+)/.exec(splitResolution.value || '')
  return m ? `${m[1]} / ${m[2]}` : '9 / 16'
})
/** A-Roll 组标题计数（2026-11-26 用户裁决：每组标题后带该组视频素材信息，
 *  随左列复选变化；生成 A-Roll 时跑的就是这个数量） */
const arollBatch = computed(() => shotBatchProgressOf('aroll'))
/** 横屏画幅时四瓦片 2×2（2026-11-26 用户裁决：两个在上两个在下；竖屏保持一排）——
 *  按 tileAspect 宽高比判定，覆盖 horizontal 与「与分割视频一致」的横版分辨率 */
const tracksGrid = computed(() => {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(tileAspect.value)
  return !!m && Number(m[1]) > Number(m[2])
})
/** 输出画幅回显（2026-11-27 用户再裁决：用比例不用分辨率——与运营分镜
 *  RATIO_OPTIONS/ratioToOrient 同口径；source=与分割视频一致按分割分辨率换算，
 *  本身就是分辨率概念保留原样；未知值回落竖屏口径） */
const layoutFull = (v: unknown): string => {
  if (v === 'horizontal') return '16:9（横屏）'
  if (v === 'source') return splitResolution.value ? `与分割视频一致 (${splitResolution.value})` : '与分割视频一致'
  return '9:16（竖屏）'
}

const editable = computed(() => props.mode === 'edit')
/** 生成时画幅（2026-11-27 用户裁决：「AI 生成分镜脚本」按钮前选择，用比例；
 *  默认竖屏=2026-09-21 文案混剪输出口径；生成时经 GEN_RATIO_LAYOUT 写入
 *  tab.layout 贯穿各步，生成后脚本锁定。1:1 不进本链——layout 域无方形分支） */
const GEN_ASPECT_OPTIONS = ['9:16', '16:9'] as const
const GEN_RATIO_LAYOUT: Record<string, string> = { '9:16': 'vertical', '16:9': 'horizontal' }
const genAspect = ref<(typeof GEN_ASPECT_OPTIONS)[number]>('9:16')
/** 激活分镜 tab（脚本基本信息来源：topic/scriptId 均为服务端原值字段，2026-09-22
 *  用户裁决：显示与服务端返回字段定义对齐，不做截断/改名加工） */
const activeMeta = computed(() => storyboards.value.find((t) => t.id === activeStoryboardId.value) || null)
/** 分镜预计总时长（各镜 duration 求和） */
const shotsTotalSec = computed(() => copyShots.value.reduce((s, x) => s + (Number(x.duration) || 0), 0))
/** 多稿装载待补全数（2026-11-05 用户裁决：仅文案 tab，shots 为空，待 AI 生成分镜批量补全） */
const pendingCopyCount = computed(() =>
  storyboards.value.filter((t) => t.narrative.trim() && !t.shots.length).length)

// ── 分镜 tab 管理（多分镜：每 tab 一个脚本对应一个视频；上限 10；双击重命名；
//    删除=2026-09-22 用户裁决改弹窗确认——原「确认」挤在 × 图标上重叠）──
const renamingId = ref('')
const renameValue = ref('')
const delDlg = reactive({ show: false, id: '', name: '' })
function startRename(id: string, name: string): void {
  renamingId.value = id
  renameValue.value = name
}
function commitRename(id: string): void {
  if (renamingId.value !== id) return
  renameStoryboardTab(id, renameValue.value)
  renamingId.value = ''
}
function onTabClose(id: string): void {
  const sb = storyboards.value.find((s) => s.id === id)
  if (!sb) return
  delDlg.id = id
  delDlg.name = sb.name
  delDlg.show = true
}
/** 切换激活分镜 tab（2026-11-05 用户再裁：点 tab 只切换显示——分镜卡显隐仅由
 *  展开/收起钮控制，不再联动展开） */
function onTabActivate(id: string): void {
  setActiveStoryboard(id)
}
function confirmDelTab(): void {
  if (delDlg.id) removeStoryboardTab(delDlg.id)
  delDlg.show = false
  delDlg.id = ''
}

/** 第 i 镜绑定的分割素材组（2026-09-22 用户裁决：一镜多片——按序返回已解析片段行） */
function boundClips(i: number) {
  const g = shotClipGroup.value[i] || []
  return g
    .map((idx) => scenes.value.find((s) => s.idx === idx))
    .filter((s): s is NonNullable<typeof s> => !!s)
}
/** 第 i 镜装填覆盖时长（Σ片段全长；裁剪在预合成渲染时落地，此处按全长估算） */
function coveredSec(i: number): number {
  return boundClips(i).reduce((acc, s) => acc + (Number(s.duration) || 0), 0)
}
/** 装填达标徽标（2026-09-22 用户裁决 B2，方案文档 §六）：|Σ−标|/标 <15% 绿（超装
 *  无害——渲染时裁到镜标，同样计绿）；欠装按程度黄（≥50%）/红（<50%）；
 *  镜标未知/未绑定 → 无徽标 */
function fillBadge(i: number): { cls: string; text: string } | null {
  const target = Number(copyShots.value[i]?.duration) || 0
  if (target <= 0 || !boundClips(i).length) return null
  const ratio = coveredSec(i) / target
  if (ratio >= 0.85) return { cls: 'fill-ok', text: '达标' }
  if (ratio >= 0.5) return { cls: 'fill-warn', text: '欠装' }
  return { cls: 'fill-lack', text: '素材不足' }
}
/** 第 i 镜的视频预览地址 = 该镜首个绑定片段（相对路径拼服务端地址） */
function previewSrc(i: number): string {
  const first = boundClips(i)[0]
  return first ? toAbsolute(first.clipUrl || '') : ''
}

const MODE_STATUS: Record<string, string> = {
  voice: '口播状态：旁白整体克隆为声音，按分镜时间轴对齐',
  // material 条目已删（2026-11-27 用户裁决：基本信息行不再显示「按各镜时长自动
  // 分配已分割素材」——素材分配状态已由四轨分组计数与逐镜状态行承担）
  fx: '特效状态：字幕/花字/文字模板按旁白与画面挂接',
}
const EMPTY_HINT: Record<string, string> = {
  edit: '还没有分镜：点击「✨ AI 生成分镜」，AI 会把旁白按时间轴拆解成镜头，并补充镜别/画面描述/音效建议',
  voice: '尚未生成分镜：请回到「1. 文案编写」点击「✨ AI 生成分镜」',
  material: '尚未生成分镜：请回到「1. 文案编写」点击「✨ AI 生成分镜」，生成后此处按分镜自动分配素材',
  fx: '尚未生成分镜：请回到「1. 文案编写」点击「✨ AI 生成分镜」',
}
</script>

<template>
  <div class="sb-block">
    <!-- 第三步左右分栏（2026-11-26 用户裁决）：sidePanel 态文案/声音不顶置，移右栏
         「口播文案及声音」组；其余步骤（非 sidePanel）照旧顶置 -->
    <template v-if="!sidePanel">
    <!-- 2026-11-05 用户裁定：视频文案在分镜脚本顶部显示（有激活脚本才显示；进默认
         无脚本不显示）；文案与激活脚本一一对应——编辑即改该脚本旁白，克隆声音以此为准。
         文案框不受收起控制（收起/展开只控制下方分镜卡） -->
    <div v-if="mode === 'edit' && activeMeta" class="sb-copy-edit">
      <label class="sb-copy-lbl">
        口播文案（可选）
        <span class="sb-copy-tip" title="该脚本绑定的口播文案（=激活分镜的旁白，克隆声音以此为准）；由方案一/二生成后随标签装载，也可就地编辑">ⓘ</span>
      </label>
      <textarea v-model="activeNarrative" class="input carry-textarea sb-copy-ta" rows="8"
        placeholder="该脚本的口播文案（由方案一/二生成后随标签装载，可就地编辑）"></textarea>
    </div>
    <!-- 2026-11-05 用户裁定：voice 态不再显示本行——口播文案框（面板移到 tab 上方）即为
         文案展示，避免重复；material/fx 态保留只读行 -->
    <div v-else-if="mode !== 'edit' && mode !== 'voice' && activeMeta?.narrative" class="sb-copy" :title="activeMeta.narrative">文案：{{ activeMeta.narrative }}</div>

    <!-- 克隆声音（2026-11-05 用户裁定：口播配音批量克隆完成的声音显示在每个 tab 的
         视频文案下面，随标签切换；与文案框同层不受收起控制） -->
    <div v-if="activeMeta?.voiceWav" class="sb-voice-row">
      <span class="sb-voice-lbl">克隆声音</span>
      <audio
        :key="activeMeta.voiceWav"
        class="sb-voice-audio"
        controls
        preload="auto"
        :src="toFileUrl(activeMeta.voiceWav)"
        :title="`分镜「${activeMeta.name}」克隆声音（${activeMeta.voiceDurSec > 0 ? fmtDur(activeMeta.voiceDurSec) : '时长未知'}）`"
      />
      <span class="sb-voice-dur" :class="{ none: !activeMeta.voiceDurSec }">{{ activeMeta.voiceDurSec > 0 ? fmtDur(activeMeta.voiceDurSec) : '--:--' }}</span>
    </div>
    </template><!-- /非 sidePanel 顶置文案声音 -->

    <!-- 左右分栏容器（仅 sidePanel 生效）：左=脚本内容（tab 条+分镜卡），右=文案声音/
         A-Roll/上层注入组；分割线夹中可拖 -->
    <div :class="{ 'sb-cols': sidePanel }">
      <div class="sb-col-main" :style="sidePanel ? sbLeftStyle : undefined">

    <!-- 分镜 tab 条（多分镜：每 tab 一个脚本对应一个视频；双击重命名，删除二次确认，上限 10。
         2026-11-05 用户裁定：行尾收起/展开钮（控制分镜卡显示，不控制视频文案）——加长样式） -->
    <div class="sb-tabs">
      <div v-for="sb in storyboards" :key="sb.id" class="sb-tab" :class="{ active: sb.id === activeStoryboardId }"
        @click="onTabActivate(sb.id)">
        <template v-if="renamingId === sb.id">
          <input v-model="renameValue" class="sb-rename" @click.stop
            @keyup.enter="commitRename(sb.id)" @keyup.esc="renamingId = ''" @blur="commitRename(sb.id)" />
        </template>
        <template v-else>
          <span class="sb-tab-name" :title="`${sb.name}（双击重命名）`" @dblclick.stop="startRename(sb.id, sb.name)">{{ sb.name }}</span>
        </template>
        <button v-if="!singleScript" class="sb-tab-close" title="删除该分镜"
          @click.stop="onTabClose(sb.id)">×</button>
      </div>
      <!-- singleScript（仿视频=一个视频脚本）：多分镜添加提示/删除入口不适用 -->
      <!-- 2026-11-26 用户裁决：余量提示居中显示（绝对定位水平居中于标签行），
           不再跟在末尾标签后顶左——与标签数无关恒居中 -->
      <span v-if="!singleScript && storyboards.length < COPY_STORYBOARD_MAX" class="sb-info sb-add-hint" title="生成新的分镜：点击「✨ AI 生成分镜脚本」">{{ storyboards.length ? '' : '' }}可再添加 {{ COPY_STORYBOARD_MAX - storyboards.length }} 个分镜</span>
      <span v-else-if="!singleScript" class="sb-info sb-add-hint">已达分镜数量上限（{{ COPY_STORYBOARD_MAX }}）</span>
      <span class="sb-flex"></span>
    </div>

    <!-- 分镜卡区（2026-11-05 用户裁决：默认收起——收起时卡片/信息行不显示；
         无任何分镜时保持引导提示可见不受收起影响） -->
    <div class="row between">
      <!-- 2026-09-22 用户裁决：脚本头部显示服务端脚本基本信息（选题/脚本库 id）——
           取回分镜脚本后基本信息随 tab 保存，不再只显示镜数/时长 -->
      <span class="sb-info sb-meta-big">分镜脚本{{ copyShots.length ? `：共 ${copyShots.length} 镜 ｜ 总时长 ${shotsTotalSec} 秒` : '' }}<template v-if="activeMeta && copyShots.length"> ｜ 选题：{{ activeMeta.topic || '—' }}</template><template v-if="activeMeta?.scriptId"> ｜ 脚本 {{ activeMeta.scriptId }}</template>
      <!-- 输出画幅在脚本基本信息行（2026-11-27 用户裁决：改纯文字只读——画面描述
           按生成时画幅写死，生成后改画幅必然图文不符；画幅唯一修改入口=
           「AI 生成分镜脚本」按钮前的画幅选择，生成时定死贯穿各步） -->
      <template v-if="activeMeta"> ｜ 输出画幅：{{ layoutFull(activeMeta.layout) }}</template>
        <span v-if="copyShotsStale" class="sb-stale">⚠ 分镜基于旧版文案（文案已修改），克隆将使用当前旁白全文；请重新生成分镜</span>
      </span>
      <span v-if="mode !== 'edit' && MODE_STATUS[mode]" class="sb-info">{{ MODE_STATUS[mode] }}</span>
      <SbCollapseToggle v-if="storyboards.length" />
    </div>
    <div v-if="shotMatMsg" class="sb-info" :class="shotGenAnyActive ? '' : 'sb-stale'">{{ shotGenAnyActive ? '生成中… ' : '' }}{{ shotMatMsg }}</div>
    <!-- A-Roll 数字人组（2026-11-26 用户裁决：图2 红框位——分镜标签行下方独立分组；
         人物图素材 ID 组内共用，批量生成所有勾选「生成A-Roll」的分镜） -->
    <TrackBatchBar v-if="mode === 'material' && !sidePanel" kind="aroll" />

    <template v-if="!storyboards.length || storyboardShotsExpanded">
    <template v-if="copyShots.length">
      <!-- 2026-11-26 用户裁决：分镜卡列表默认显示约 6 个分镜，更多的列表内滚动——
           页面不再被整条拉长（来回刷新要移动的太多了）。「＋ 添加镜头」在列表外仍常驻 -->
      <div class="seg-list">
      <div v-for="(shot, i) in copyShots" :key="i" class="seg-card seg-card--row">
          <div class="seg-main">
        <div class="seg-head">
          <span class="seg-no">#{{ i + 1 }}</span>
          <template v-if="editable">
            <label class="seg-field head-field"><span class="lbl">镜别</span>
              <input v-model="shot.shot_type" class="input w70" placeholder="特写/中景" />
            </label>
            <label class="seg-field head-field"><span class="lbl">时长(秒)</span>
              <input v-model.number="shot.duration" type="number" min="1" max="15" class="input w60" />
            </label>
            <span class="spacer"></span>
            <TButton label="删除" variant="secondary" size="small" @click="copyShots.splice(i, 1)" />
          </template>
          <template v-else>
            <span class="sb-info">{{ shot.shot_type || '未定镜别' }} ｜ {{ shot.duration }}s</span>
            <span class="spacer"></span>
          </template>
        </div>
        <!-- 声音拆分完成标识（2026-11-26 用户裁决：每个分镜都要有——已拆分=绿字对号
             「✓ 声音拆分完成（切片 N）」；未拆分=灰字「拆分口播：未绑定」。共享组件
             一处改=四个步骤全脚本生效） -->
        <div class="sb-line sb-split" :class="shot.splitAudioId ? 'sb-split--done' : 'sb-split--none'">
          {{ shot.splitAudioId ? `✓ 声音拆分完成（切片 ${shot.splitAudioId}）` : '拆分口播：未绑定' }}
        </div>

        <label v-if="editable" class="seg-field"><span class="lbl">画面描述（视频生成提示词）</span>
          <textarea v-model="shot.visual" rows="2" class="input carry-textarea" placeholder="具体的画面/动作链/镜头运动/光影（点「AI 生成分镜」自动填写，也可手写）"></textarea>
        </label>
        <div v-else-if="shot.visual" class="sb-line">画面：{{ shot.visual }}</div>

        <label v-if="editable" class="seg-field"><span class="lbl">旁白（该镜覆盖的文案原文片段）</span>
          <textarea v-model="shot.audio" rows="1" class="input carry-textarea carry-textarea--sm" placeholder="该镜对应的旁白"></textarea>
        </label>
        <div v-else-if="shot.audio" class="sb-line sb-audio">旁白：{{ shot.audio }}</div>

        <label v-if="editable" class="seg-field"><span class="lbl">音效建议</span>
          <input v-model="shot.sfx" class="input" placeholder="可选：如 按键声 / 轻快 BGM 起拍" />
        </label>
        <div v-else-if="shot.sfx" class="sb-line">音效：{{ shot.sfx }}</div>
        <!-- 音效包装产物（2026-09-22 用户裁决：AI 按音效提示词生成的音效挂在对应镜，就地试听；
             2026-09-22 二次裁决：行尾右对齐「重新生成音效」按钮——单镜重生成，与批量共享忙态） -->
        <div v-if="mode === 'fx' && shot.sfxWavUrl" class="sfx-row">
          <audio
            class="sfx-audio"
            controls
            preload="none"
            :src="toAbsolute(shot.sfxWavUrl)"
            :title="`AI 生成音效（${shot.sfx}）`"
          />
          <TButton
            label="删除音效"
            variant="secondary"
            size="small"
            class="sfx-del"
            :disabled="!!sfxBusy"
            title="移除该镜已绑定的音效（音效建议文字保留，可重新匹配/生成）"
            @click="emit('sfx-remove', shot)"
          />
          <TButton
            label="重新生成音效"
            variant="secondary"
            size="small"
            class="sfx-regen"
            :disabled="!!sfxBusy"
            :title="sfxBusy ? '音效生成进行中' : '按该镜音效提示词重新生成音效'"
            @click="emit('sfx-regen', shot)"
          />
        </div>

        <!-- 素材状态行（2026-11-26 用户裁决：四轨制下显示该镜生效源——A-Roll/AI生成/
             在线素材/实拍素材，无则「未绑定素材」；单行不换行。实拍素材=素材绑定轨时
             保留片数/Σ/达标徽标与逐片管理。2026-11-26 用户裁决：「解绑全部」移到本行
             最右——清空该镜全部视频源绑定（素材绑定+AI/搜索/A-Roll 四轨全清）；
             「选择素材（追加）」按钮删除） -->
        <template v-if="mode === 'material' || mode === 'fx'">
          <div class="seg-field">
            <div class="sb-line track-status" :class="{ 'track-status--none': trackStatus(i).none }">
              <span class="track-status-text">素材状态：{{ trackStatus(i).text }}<template v-if="trackStatus(i).material && boundClips(i).length"> · 共 {{ boundClips(i).length }} 片 · Σ {{ coveredSec(i).toFixed(1) }}s / 标 {{ shot.duration }}s</template><span v-if="trackStatus(i).material && fillBadge(i)" class="fill-badge" :class="fillBadge(i)!.cls"
                title="Σ片段全长 vs 镜标：差值<15% 达标；欠装时预合成按现有片段合成（末端裁剪照常）">{{ fillBadge(i)!.text }}</span></span>
              <span class="spacer"></span>
              <TButton v-if="mode === 'material' && trackHasAnySource(i)" label="解绑全部" variant="secondary" size="small"
                title="清空该镜全部视频源绑定：素材绑定组 + AI生成/在线搜索/A-Roll 三轨占位一并解绑" @click="unbindAllSources(i)" />
            </div>
            <div v-if="trackStatus(i).material && boundClips(i).length" class="sb-line track-status">
              <span v-for="(s, j) in boundClips(i)" :key="s.idx" class="bound-clip">
                {{ j + 1 }}. {{ s.name }}（{{ s.duration > 0 ? s.duration.toFixed(1) + 's' : '—' }}）
                <button v-if="mode === 'material'" class="unbind-btn" title="移除该片段" @click="removeShotClipAt(i, j)">×</button>
              </span>
            </div>
          </div>
        </template>
          </div><!-- /seg-main -->
          <!-- 四轨占位瓦片（TrackTile 三态，比例随脚本画幅；2026-11-26 用户裁决大改：
               右列复选/搜索钮退役——复选上瓦片右上角（大面积热点，仅第三步显示），
               视频中央半透明大图标点击播放/暂停（与右上复选热点不重叠），在线搜索钮
               移入搜索瓦片下半；逻辑不变=点击瓦片上的复选即选择。横屏 2×2 竖屏一排） -->
          <div class="seg-right">
            <!-- 2026-11-26 用户裁决：四轨顺序=A-Roll→素材→AI生成→在线搜索；
                 共享组件一处改=四个步骤全脚本生效 -->
            <div class="seg-tracks" :class="{ 'seg-tracks--grid': tracksGrid }">
              <div class="track-cell">
                <TrackTile label="A-Roll" :aspect="tileAspect" :video-src="slotLocal(i, 'aroll')" :state="shotGenStateOf(i, 'aroll')" fallback="A-Roll" />
                <button v-if="mode === 'material'" type="button" class="cell-check" :class="{ on: !!copyShots[i]?.markARoll }"
                  title="勾选后由上方 A-Roll 组批量生成数字人（读该镜拆分口播音频）"
                  @click.stop="setMark(copyShots[i]!, 'aroll', !copyShots[i]?.markARoll)">
                  <span class="cell-check-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5 11-11" /></svg></span>
                </button>
              </div>
              <div class="track-cell">
                <TrackTile label="素材" :aspect="tileAspect" :video-src="previewSrc(i)" fallback="未绑定素材" />
                <button v-if="mode === 'material'" type="button" class="cell-check" :class="{ on: !!copyShots[i]?.markMaterial }"
                  title="勾选后参与素材匹配/绑定（默认勾选；「解绑全部」清空该镜全部视频源）"
                  @click.stop="setMark(copyShots[i]!, 'material', !copyShots[i]?.markMaterial)">
                  <span class="cell-check-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5 11-11" /></svg></span>
                </button>
              </div>
              <div class="track-cell">
                <TrackTile label="AI" :aspect="tileAspect" :video-src="slotLocal(i, 'gen')" :state="shotGenStateOf(i, 'gen')" fallback="AI 生成" />
                <button v-if="mode === 'material'" type="button" class="cell-check" :class="{ on: !!copyShots[i]?.markAI }"
                  title="勾选后由「AI生成」组批量生成视频（与其他勾选互不影响）"
                  @click.stop="setMark(copyShots[i]!, 'ai', !copyShots[i]?.markAI)">
                  <span class="cell-check-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5 11-11" /></svg></span>
                </button>
              </div>
              <div class="track-cell">
                <TrackTile label="搜索" :aspect="tileAspect" :video-src="slotLocal(i, 'stock')" :state="shotGenStateOf(i, 'stock')" fallback="" /><!-- 1126：占位文字不显示，避免与下半「在线搜索」钮重叠 -->
                <button v-if="mode === 'material'" type="button" class="cell-search" :disabled="shotGenActiveOf(i, 'stock')"
                  title="在线搜索素材到该镜搜索轨" @click.stop="shotOnlineIdx = i">
                  <span class="cell-search-btn">在线搜索</span>
                </button>
              </div>
            </div>
          </div>
      </div>
      </div><!-- /seg-list 分镜卡内滚列表 -->

      <!-- 2026-09-29 用户裁决：「保存脚本」按钮删除——脚本随批量克隆完成/生成剪辑
           方案/导出草稿三个里程碑自动同步，不再需要手动保存（原 0925 右对齐布局随
           按钮移除；「＋ 添加镜头」保留） -->
      <div v-if="editable" class="row">
        <TButton label="＋ 添加镜头" variant="secondary" size="small" @click="copyShots.splice(copyShots.length, 0, {
          index: copyShots.length + 1, shot_type: '', visual: '', audio: '', sfx: '', duration: 3,
          material_path: '', material_type: '', material_hash: '', material_id: 0,
          markARoll: true,
          markMaterial: true,
        })" />
      </div>
    </template>
    <div v-else class="muted">
      <!-- 2026-11-05 用户裁决：进入模块不激活任何分镜（文案框默认空）——有分镜未激活时提示点标签 -->
      <template v-if="storyboards.length && !activeStoryboardId">已加载 {{ storyboards.length }} 个分镜脚本，点击上方标签查看或编辑</template>
      <!-- 2026-11-05 用户裁决：多稿装载态（仅文案 tab）提示批量补全入口 -->
      <template v-else-if="editable && pendingCopyCount">已装载 {{ pendingCopyCount }} 份文案（每份一个标签）：点击「✨ AI 生成分镜脚本」将为每份文案各生成一套分镜</template>
      <template v-else>{{ EMPTY_HINT[mode] }}</template>
    </div>
    </template><!-- /分镜脚本卡（收起/展开） -->

    <!-- 2026-11-05 用户裁定：AI 生成分镜脚本按钮移到分镜区底部（红框位），全宽；
         2026-11-27 用户裁决：按钮前加画幅比例选择（用比例不用分辨率，口径同运营
         分镜 RATIO_OPTIONS）——画面描述与后续素材生成都按此画幅，生成时写入脚本
         layout 锁定（基本信息行只读回显） -->
    <div v-if="mode === 'edit'" class="row sb-actions">
      <label class="sb-gen-aspect" title="本次 AI 生成分镜脚本的画幅比例：画面描述按此生成，写入脚本后贯穿各步（基本信息行只读回显）">
        <span class="sb-gen-aspect-lbl">画幅比例:</span>
        <select v-model="genAspect" class="input w150" :disabled="storyboardBusy">
          <option v-for="r in GEN_ASPECT_OPTIONS" :key="r" :value="r">{{ r }}（{{ ratioToOrient(r) }}）</option>
        </select>
      </label>
      <TButton class="sb-gen-btn" label="✨ AI 生成分镜脚本" :loading="storyboardBusy" @click="genStoryboard(GEN_RATIO_LAYOUT[genAspect])" />
    </div>
      </div><!-- /sb-col-main 脚本内容 -->

      <!-- 右栏（2026-11-26 用户裁决）：口播文案及声音 / 视频素材：A-Roll 两组组件内
           自持，「视频素材：素材库」「视频素材：AI生成」由上层 #side 注入（次序=注入序） -->
      <template v-if="sidePanel">
        <div class="sb-div" title="拖拽调节左右比例" @mousedown="onSbDivDown"></div>
        <div class="sb-col-side">
          <section class="sb-side-g">
            <div class="sb-side-title">口播文案及声音</div>
            <div v-if="mode === 'edit' && activeMeta" class="sb-copy-edit">
              <label class="sb-copy-lbl">
                口播文案（可选）
                <span class="sb-copy-tip" title="该脚本绑定的口播文案（=激活分镜的旁白，克隆声音以此为准）；由方案一/二生成后随标签装载，也可就地编辑">ⓘ</span>
              </label>
              <textarea v-model="activeNarrative" class="input carry-textarea sb-copy-ta" rows="8"
                placeholder="该脚本的口播文案（由方案一/二生成后随标签装载，可就地编辑）"></textarea>
            </div>
            <div v-else-if="mode !== 'edit' && mode !== 'voice' && activeMeta?.narrative" class="sb-copy" :title="activeMeta.narrative">文案：{{ activeMeta.narrative }}</div>
            <div v-if="activeMeta?.voiceWav" class="sb-voice-row">
              <span class="sb-voice-lbl">克隆声音</span>
              <audio
                :key="activeMeta.voiceWav"
                class="sb-voice-audio"
                controls
                preload="auto"
                :src="toFileUrl(activeMeta.voiceWav)"
                :title="`分镜「${activeMeta.name}」克隆声音（${activeMeta.voiceDurSec > 0 ? fmtDur(activeMeta.voiceDurSec) : '时长未知'}）`"
              />
              <span class="sb-voice-dur" :class="{ none: !activeMeta.voiceDurSec }">{{ activeMeta.voiceDurSec > 0 ? fmtDur(activeMeta.voiceDurSec) : '--:--' }}</span>
            </div>
          </section>
          <section v-if="mode === 'material'" class="sb-side-g">
            <div class="sb-side-title">视频素材：A-Roll<span class="sb-side-info">已选 {{ arollBatch.total }} 镜：完成 {{ arollBatch.done }}{{ arollBatch.active ? ` · 进行中 ${arollBatch.active}` : '' }}{{ arollBatch.failed ? ` · 失败 ${arollBatch.failed}` : '' }}</span></div>
            <TrackBatchBar kind="aroll" />
          </section>
          <slot name="side" />
        </div>
      </template>
    </div><!-- /sb-cols -->

    <!-- 单镜在线搜索弹窗（2026-11-26 四源四轨：产物进该镜搜索轨占位） -->
    <teleport to="body"><div class="tintin-media-scope tintin-modal-layer" :class="{ dark: isDark }">
      <div v-if="shotOnlineIdx >= 0" class="modal-mask" @click.self="shotOnlineIdx = -1">
        <div class="modal" style="width:min(1400px,96vw);height:min(86vh,900px)">
          <div class="modal-head">
            <span class="modal-title">为分镜 #{{ shotOnlineIdx + 1 }} 在线搜索素材（按画面描述匹配）</span>
            <button type="button" class="modal-x" title="关闭" @click="shotOnlineIdx = -1">×</button>
          </div>
          <OnlineStockPanel :initial-query="copyShots[shotOnlineIdx]?.visual || ''" :single="true" @add="onShotOnlineAdd" />
        </div>
      </div>
    </div></teleport>

    <!-- 删除分镜确认弹窗（2026-09-22 用户裁决：删除确认改大弹窗——原「确认」挤在
         × 图标上重叠不可读；分镜内容已同步服务端脚本库的仍保留在库中） -->
    <teleport to="body"><div class="tintin-media-scope tintin-modal-layer" :class="{ dark: isDark }">
      <div v-if="delDlg.show" class="modal-mask" @click.self="delDlg.show = false">
        <div class="modal">
          <span class="modal-title">删除分镜脚本</span>
          <div class="del-body">
            确定删除分镜「<b>{{ delDlg.name }}</b>」？
            <span class="del-hint">该分镜的镜头编排与绑定将一并移除；已同步到服务端脚本库的内容仍保留在库中。</span>
          </div>
          <div class="modal-actions">
            <TButton label="取消" plain @click="delDlg.show = false" />
            <TButton label="删除" @click="confirmDelTab" />
          </div>
        </div>
      </div>
    </div></teleport>
  </div>
</template>
<style scoped>
/* ── 布局与通用 ── */
.sb-block { display: flex; flex-direction: column; gap: 6px; }
/* 第三步左右分栏（2026-11-26 用户裁决：左=脚本内容 6，右=文案声音/A-Roll/素材库/AI生成 4，
   分割线拖拽可调；sb-side-g 同时被上层 #side 槽复用，槽内容样式由上层同款定义） */
.sb-cols { display: flex; align-items: flex-start; gap: 6px; }
.sb-col-main { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.sb-col-side { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.sb-div { flex: 0 0 6px; align-self: stretch; min-height: 260px; border-radius: 3px; background: var(--border); cursor: col-resize; }
.sb-div:hover { background: var(--primary); opacity: 0.35; }
.sb-side-g { display: flex; flex-direction: column; gap: 8px; padding: var(--space-5); background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.sb-side-title { font-size: 13px; font-weight: 600; color: var(--foreground); }
.sb-info { font-size: 12px; color: var(--muted-foreground); }
.sb-actions { display: flex; align-items: center; gap: var(--space-3, 12px); }
/* 画幅比例在 AI 生成按钮前（2026-11-27 用户裁决）；按钮仍占余宽 */
.sb-gen-aspect { display: flex; align-items: center; gap: 6px; flex: none; }
.sb-gen-aspect-lbl { font-size: 12px; color: var(--foreground); white-space: nowrap; }
.sb-actions :deep(.sb-gen-btn.t-button), .sb-actions :deep(.t-button) { flex: 1 1 0; }
.sb-line { font-size: 12px; color: var(--foreground); line-height: 1.5; }
/* 脚本头部文案行（2026-11-05 用户裁定：每个分镜脚本头部显示其绑定的文案，超两行截断、悬停看全文） */
.sb-copy {
  font-size: 12px; color: var(--foreground); line-height: 1.6;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
/* 侧栏口播文案（2026-11-26 用户裁决再调：默认显示 20 行，多的滚动） */
.sb-side .sb-copy, .sb-col-side .sb-copy {
  display: block; -webkit-line-clamp: unset;
  max-height: calc(20 * 1.6 * 12px + 2px); overflow-y: auto;
}
/* 克隆声音播放行（2026-11-05 用户裁定：随文案框显示在每个 tab 的视频文案下面） */
.sb-voice-row { display: flex; align-items: center; gap: 8px; }
.sb-voice-lbl { font-size: 12px; color: var(--muted-foreground); flex: none; }
.sb-voice-audio { flex: 1 1 auto; height: 28px; min-width: 0; }
.sb-voice-dur { font-size: 12px; color: var(--muted-foreground); flex: none; }
.sb-voice-dur.none { color: var(--border); }

/* 视频文案编辑框（edit 态分镜脚本顶部；2026-11-05 用户裁定随脚本显示） */
.sb-copy-edit { display: flex; flex-direction: column; gap: 6px; }
.sb-copy-lbl { font-size: 13px; color: var(--foreground); display: inline-flex; align-items: center; gap: 4px; }
.sb-copy-tip { color: var(--muted-foreground); font-size: 12px; cursor: help; }
.sb-copy-ta { min-height: 160px; }
.sb-audio { color: var(--primary); }
.sb-stale { color: var(--warning, #f1c40f); font-weight: 600; margin-left: 8px; }
.muted { color: var(--muted-foreground); font-size: 12px; }
.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.row.between { justify-content: space-between; }
.spacer { flex: 1; }

/* ── 分镜 tab 条（多分镜：切换/双击重命名/删除二次确认，上限 10） ── */
/* 脚本名行：按上限 10 个等分占用，单行不换行；每个名称在自己份额内尽量完整显示 */
.sb-tabs { position: relative; display: flex; align-items: stretch; gap: 4px; flex-wrap: nowrap; }
/* 余量提示居中（2026-11-26 用户裁决）：绝对定位水平垂直居中于标签行，不占 flex 流 */
.sb-add-hint { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); white-space: nowrap; pointer-events: auto; }
/* 行尾弹性占位（收起/展开钮推到最右——2026-11-05 用户裁定） */
.sb-flex { flex: 1 1 auto; min-width: 0; }
.sb-tab {
  display: inline-flex; align-items: center; gap: 6px; flex: 0 1 calc(10% - 4px); max-width: calc(10% - 4px); min-width: 0;
  min-height: 30px; height: auto; padding: 4px 10px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md);
  cursor: pointer; font-size: 12px; color: var(--muted-foreground);
}
.sb-tab.active { color: var(--primary); font-weight: 600; border-color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, var(--surface-container)); }
.sb-tab-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 第三步改画幅警示行（2026-11-26 用户裁决：修改画幅会导致视频可能出现裁切） */
.sb-aspect-warn { font-size: 12px; color: var(--warning, #f59e0b); }
.sb-rename { width: 90px; max-width: 100%; box-sizing: border-box; height: 22px; padding: 0 6px; font-size: 12px; }
.sb-tab-close {
  width: 18px; height: 18px; padding: 0; line-height: 1; font-size: 12px; flex: none;
  background: transparent; color: var(--muted-foreground); border: none; border-radius: 50%; cursor: pointer;
}
.sb-tab-close:hover { color: var(--danger, #e74c3c); }
.sb-tab-close.warn { color: #fff; background: var(--danger, #e74c3c); }

/* ── 镜头卡 ── */
/* 分镜卡列表内滚（2026-11-26 用户裁决：默认约 5 卡，更多内滚；卡间距与页一致） */
.seg-list { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 1380px; scrollbar-width: thin; }
.seg-card {
  display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md);
}
.seg-card--row { flex-direction: row; align-items: stretch; }
.seg-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.seg-head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.seg-no { font-weight: 700; color: var(--primary); }
.seg-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
.seg-field.head-field { flex: 0 0 auto; flex-direction: row; align-items: center; gap: 6px; }
.seg-field .lbl { font-size: 12px; color: var(--muted-foreground); flex: none; }
.seg-field .input { width: 100%; }
.seg-field.head-field .input { width: auto; }
.w70 { width: 90px; } .w150 { width: 150px; }
.w60 { width: 64px; }

.input { height: 32px; padding: 0 10px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--foreground); outline: none; font-size: 13px; }
.input:focus { border-color: var(--primary); }
/* 源序在 .input 之后（覆盖其 height:32px / padding:0 10px） */
.carry-textarea { height: auto; min-height: 72px; padding: 8px 10px; line-height: 1.6; font-family: inherit; resize: vertical; }
.carry-textarea--sm { min-height: 48px; }

.sb-stale { }

/* ── 每镜视频预览（material/fx 态：右侧预览该镜绑定的素材视频；
     2026-09-21 用户裁决：宽 100px、顶部对齐不随卡片拉伸） ── */
.seg-video {
  flex: 0 0 100px; align-self: flex-start; display: flex; align-items: center; justify-content: center;
  background: #101010; border-radius: var(--radius-md); overflow: hidden;
}
.seg-video video { width: 100%; height: auto; object-fit: contain; display: block; }
.seg-video-empty { padding: 12px; text-align: center; }
/* 拆分口播绑定回显（2026-11-26：A-Roll 组拆分后逐镜绑定；未绑定时灰显） */
.sb-split { font-size: 12px; color: var(--primary); }
.sb-split--none { color: var(--muted-foreground); }
/* 声音拆分完成标识（2026-11-26 用户裁决：已拆分=绿字对号，口径同达标徽标） */
.sb-split--done { color: var(--success); font-weight: 600; }
/* 侧栏分组标题尾计数（2026-11-26 用户裁决：右行弱化展示） */
.sb-side-title { display: flex; align-items: center; gap: 8px; }
.sb-side-info { margin-left: auto; font-size: 12px; font-weight: 400; color: var(--muted-foreground); white-space: nowrap; }
/* 素材状态行（2026-11-26 用户裁决：单行不换行；无源灰显） */
/* 素材状态行改 flex（2026-11-26 用户裁决：解绑全部钉行最右）；文本段保持单行省略 */
.track-status { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--foreground); }
.track-status-text { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.track-status .spacer { flex: 1 1 auto; }
/* 脚本基本信息行（2026-11-26 用户裁决：大字体醒目色，所有步骤统一） */
.sb-meta-big { font-size: 14px; font-weight: 600; color: var(--primary); }
.track-status--none { color: var(--muted-foreground); }
/* ── 四源四轨（2026-11-26 用户裁决）：material 态右列=四轨占位瓦片（TrackTile 自带
   三态样式，垂直居中不靠上）+ 最右控制列（两复选框互不排斥 + 在线搜索素材按钮，
   均布到分镜卡全高） ── */
.seg-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; align-self: stretch; }
.seg-tracks { display: flex; gap: 6px; }
/* 横屏画幅 2×2（2026-11-26 用户裁决：两个在上两个在下；竖屏不变） */
/* flex 用固定 basis + min-width:0——视频元素未加载元数据时的 intrinsic 宽度会把
   首个瓦片顶成独占一行（1+3），钉死 basis 才稳 2×2 */
/* 瓦片必须定宽：seg-right 是内容自适应宽（flex:0 0 auto），百分比基宽对自动宽容器
   是循环解析——素材匹配后有真实视频（intrinsic ~960px）时容器被内容撑爆、左列文案
   被挤没（1126 报障实锤）。定宽 176px 与竖屏 104px 同一模式，2×2=358px 稳定 */
.seg-tracks--grid { flex-wrap: wrap; }
.seg-tracks--grid .track-cell { flex: 0 0 176px; width: 176px; }
.seg-tracks--grid .track-cell :deep(.track-tile) { flex: 1 1 auto; width: 100%; min-width: 0; }
/* 瓦片内嵌控件（2026-11-26 用户裁决：右列复选/搜索钮退役——控件上瓦片）。
   cell 收缩包住瓦片，覆盖层锚定 cell=与瓦片对齐 */
.track-cell { position: relative; display: flex; flex-direction: column; align-items: stretch; width: fit-content; flex: none; }
/* 复选热点=右上角大面积（60%×42%），勾选框视觉钉角上；z 高于瓦片、低于弹窗 */
.cell-check {
  position: absolute; top: 0; right: 0; width: 60%; height: 42%;
  display: flex; align-items: flex-start; justify-content: flex-end; padding: 5px;
  border: 0; background: transparent; cursor: pointer; z-index: 3;
}
.cell-check-box {
  width: 20px; height: 20px; border-radius: 5px; display: flex; align-items: center; justify-content: center;
  border: 1.5px solid rgba(255, 255, 255, 0.7); background: rgba(0, 0, 0, 0.35); color: transparent;
}
.cell-check.on .cell-check-box { background: var(--primary); border-color: var(--primary); color: #fff; }
.cell-check-box svg { width: 13px; height: 13px; }
/* 在线搜索钮=搜索瓦片下半（大面积热点），视觉为半透明胶囊钉底部 */
.cell-search {
  position: absolute; left: 0; right: 0; bottom: 0; height: 50%;
  display: flex; align-items: flex-end; padding: 6px;
  border: 0; background: transparent; cursor: pointer; z-index: 2;
}
.cell-search-btn {
  width: 100%; padding: 5px 0; font-size: 11px; text-align: center; white-space: nowrap;
  color: rgba(255, 255, 255, 0.85); background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.35); border-radius: var(--radius-sm);
}
.cell-search:disabled { cursor: not-allowed; }
.cell-search:disabled .cell-search-btn { opacity: 0.5; }

/* ── 弹窗通用 ── */
.modal-mask {
  position: fixed; inset: 0; z-index: 1002; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.7);
}
.modal {
  display: flex; flex-direction: column; gap: 12px; width: 520px; max-width: 90vw; max-height: 80vh;
  padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg);
}
.modal-title { font-size: 15px; font-weight: 600; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
/* 弹窗标题行（标题左 + 右上角标准 × 关闭钮——2026-11-26 用户裁决：在线搜索弹窗
   去掉底部「关闭」，确认即确定，右上角 × 兜底关闭） */
.modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.modal-x {
  width: 26px; height: 26px; padding: 0; line-height: 1; font-size: 15px; flex: none;
  background: transparent; border: none; color: var(--muted-foreground); cursor: pointer;
  border-radius: var(--radius-sm);
}
.modal-x:hover { color: var(--foreground); background: var(--surface-container-high); }
.script-list { display: flex; flex-direction: column; gap: 6px; max-height: 50vh; overflow-y: auto; }
.script-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border);
  border-radius: var(--radius-md); background: var(--surface-container); cursor: pointer; text-align: left; }
.script-row:hover { border-color: var(--primary); }
.script-topic { font-size: 12px; color: var(--foreground); flex: none; }
.script-meta { color: var(--muted-foreground); font-size: 12px; }
.script-empty { padding: 12px; text-align: center; }

/* 弹窗内列表行（单镜选素材弹窗复用；原选择脚本弹窗已随按钮删除退役） */
.script-list { flex: 1 1 auto; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.script-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; text-align: left;
  background: var(--surface-container); border: 1px solid var(--border);
  border-radius: var(--radius-md); cursor: pointer; color: var(--foreground); font-size: 13px;
}
.script-row:hover { border-color: var(--primary); }
.script-topic { font-weight: 600; }
.script-meta { color: var(--muted-foreground); font-size: 12px; }
.script-empty { padding: 12px; text-align: center; }

/* 一镜多片绑定（2026-09-22 用户裁决：逐片列表 + 移除） */
.bound-clip {
  display: inline-flex; align-items: center; gap: 2px; margin-right: 8px;
  padding: 1px 6px; background: var(--surface-container); border: 1px solid var(--border);
  border-radius: var(--radius-sm); font-size: 12px; color: var(--foreground);
}
/* 音效包装播放条（fx 态音效信息行内嵌，2026-09-22 用户裁决） */
.sfx-audio { width: 240px; height: 28px; margin-top: 2px; }
/* 音效行：播放条 + 右对齐重生成按钮（2026-09-22 二次裁决） */
.sfx-row { display: flex; align-items: center; gap: 8px; }
.sfx-row .sfx-del { margin-left: auto; }
.sfx-row .sfx-regen { margin-left: 0; }
/* 装填达标徽标（2026-09-22 用户裁决 B2，方案文档 §六：差值<15% 绿、欠装黄/红） */
.fill-badge { padding: 1px 6px; border-radius: var(--radius-sm); font-size: 11px; font-weight: 600; }
.fill-badge.fill-ok { color: #2ecc71; background: rgba(46, 204, 113, 0.12); }
.fill-badge.fill-warn { color: #f39c12; background: rgba(243, 156, 18, 0.12); }
.fill-badge.fill-lack { color: #e74c3c; background: rgba(231, 76, 60, 0.12); }
/* 删除分镜确认弹窗（2026-09-22 用户裁决：大弹窗替代图标上内联确认） */
.del-body { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--foreground); }
.del-hint { font-size: 12px; color: var(--muted-foreground); }
</style>
