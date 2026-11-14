<script setup lang="ts">
// ═════════════════════════════════════════════════════════════
// CopywritingStep1Panel.vue — 文案混剪 Step1 文案编写面板
// 2026-10-03 用户裁决：①场景选择与时间限制删除——写法维度由服务端 FORMULAS 承担
// （POST /copywriting/voiceover 十稿全量），时长走服务端缺省预算；本行保留平台下拉。
// ②生成改调服务端十稿全量。③高级脚本设置整体删除。
// 2026-11-05 用户裁决四改：①生成文案=两方案显式呈现——方案一=选择产品（原入口原
// 语义：开公共弹窗、已选可重选、不触发生成），方案二=输入提示词（无产品时的生成
// 依据；提示红色、输入框两行）；两方案必须有一个（产品优先，无产品按提示词）。
// ②平台下拉=通用设置，移到「AI生成口播文案」前（与方案选择无关）。
// ③挑选弹窗改多选——按勾选个数各装载一份文案（每种勾选稿一个分镜标签，
// 「AI 生成分镜脚本」批量补全分镜）。
// 状态经 inject 解构回原名（零改动）；生成编排在 useCopywritingMontage。
// ═════════════════════════════════════════════════════════════
import { ref, computed, onMounted, inject, watch } from 'vue'
import TButton from '@/components/common/TButton.vue'
import CopywritingStoryboard from './CopywritingStoryboard.vue'
import VdStepBar from '../VdStepBar.vue'
import WbPickProductDialog from '@/components/workbench/WbPickProductDialog.vue'
import VoiceoverPickerDialog from '../VoiceoverPickerDialog.vue'
import type { PickerItem } from '@/composables/useWorkbenchPickers'
import { copywritingMontageShellKey } from './copywritingMontageUiContext'

const shell = inject(copywritingMontageShellKey)!
const { step, go, steps } = shell
const {
  // 文案编写（2026-10-03 用户裁决：平台选择 + 服务端十稿全量；2026-11-05 二改：提示词
  // 兜底 + 弹窗多选按勾选个数装载）
  sharedProductInfo, applyScriptProduct, clearScriptProduct,
  copyPrompt,
  manualCopy, manualCopyBusy, storyboards,
  scriptPlatform, platformOptions, loadPlatforms,
  voiceoverCandidates, voiceoverFailedFormulas, voiceoverDlgOpen, voiceoverSelectedIdxs, closeVoiceoverDlg,
  genVoiceoverCandidates, confirmVoiceoverCandidates,
} = shell.s

/* ── 根据产品生成文案（公共弹窗；选中后显示在按钮后面，写入 sharedProductInfo 单一来源）── */
const pickDlgVisible = ref(false)
const productLabel = computed(() => {
  const i = sharedProductInfo.value
  const base = [i.brand, i.product, i.model].map((v) => String(v || '').trim()).filter(Boolean).join(' / ')
  const extras = String(i.extra || '').split('\n').map((s) => s.trim()).filter(Boolean)
  return extras.length ? `${base}（${extras.length} 条卖点）` : base
})
/** 可生成=已选产品或已输入提示词（2026-11-05 用户裁决：有产品按产品、无产品按提示词） */
const canGenCopy = computed(() => !!productLabel.value || !!copyPrompt.value.trim())
/** 已有生成的分镜脚本（2026-11-05 用户裁定：分镜未生成时下一步不可执行——
 *  纯文案装载 tab（无镜头）不算，须至少一个 tab 生成了镜头） */
const hasSplitStoryboards = computed(() => storyboards.value.some((t) => t.shots.length))

onMounted(() => { void loadPlatforms() })

/* ── 方案二提示词样本（2026-11-13 用户需求）：占位提示按当前平台动态给出详细
 *    范例——要素齐（数量/钩子/卖点/场景/CTA/差异化风格），用户照着改即可用；
 *    未命中映射的平台回退带平台名插值的通用版。 ── */
const PROMPT_SAMPLES: Array<{ match: string[]; sample: string }> = [
  {
    match: ['抖音'],
    sample: '例：帮我写 5 条「罗技 K828 键盘 + 冰淇淋小鼠鼠标垫」的抖音信息流带货文案。要求：前 3 秒强钩子开场（痛点/悬念/反常识，禁止自我介绍式开头）；口语化短句，每条约 45 秒；核心卖点=静音机械轴手感 + 人体工学腕托 + 马卡龙配色颜值；场景要给具体画面（深夜赶方案 / 宿舍开黑）；每条结尾引导行动（点购物车 / 评论区扣"想要"）；5 条风格差异化：痛点种草、剧情反转、参数对比、价格惊喜、闺蜜安利各一条。',
  },
  {
    match: ['快手'],
    sample: '例：帮我写 5 条「罗技 K828 键盘 + 冰淇淋小鼠鼠标垫」的快手带货文案，受众是老铁。要求：接地气不端着，像朋友聊天一样讲为什么值得买；开头直给实惠感（"今天这套键盘鼠标，打工人闭眼入"）；突出耐用抗造、静音不吵室友、颜值在线；场景给出租屋加班、网吧开黑等真实画面；每条结尾引导点小黄车下单；5 条分别主打性价比、耐用、颜值、送礼、学生党。',
  },
  {
    match: ['视频号'],
    sample: '例：帮我写 5 条「罗技 K828 键盘 + 冰淇淋小鼠鼠标垫」的视频号种草文案。要求：语速沉稳、真诚分享感，像懂行的朋友做推荐；开头从痛点切入（久打字手腕酸 / 机械轴吵到家人）；强调人体工学腕托与静音轴对长期办公的健康价值；场景偏居家办公与职场；结尾自然引导"转发给需要的朋友 / 点下方链接"；5 条角度：健康护腕、效率提升、桌面美学、职场好物、节日送礼。',
  },
  {
    match: ['小红书'],
    sample: '例：帮我写 5 条「罗技 K828 键盘 + 冰淇淋小鼠鼠标垫」的小红书种草笔记。要求：标题式开头带情绪词（"谁懂啊""真的会谢"）；正文分点用 emoji（✅键盘：全键无冲 / 静音轴；🍦鼠标垫：冰淇淋配色 / 记忆棉腕托）；每条 200 字内、口语种草感；场景=宿舍 / 出租屋桌面改造；结尾引导"收藏起来慢慢看 / 评论区求链接"；5 条角度：桌面改造、学生党平价、办公好物、闺蜜礼物、颜值控必入。',
  },
  {
    match: ['哔哩哔哩', 'b站', 'bilibili'],
    sample: '例：帮我写 5 条「罗技 K828 键盘 + 冰淇淋小鼠鼠标垫」的 B 站测评 / 种草口播文案。要求：参数党与玩梗并重，开头抛悬念（"百元价位能打出旗舰手感？"）；正文有具体参数对比（轴体 / 键帽 / 回弹 vs 高端款）；允许适度玩梗（"冰淇淋配色，甜但不齁"）；结尾引导一键三连 + 评论区讨论；5 条角度：横评对比、开箱上手、外设科普、宿舍装备、退款挑战。',
  },
]
/** 按平台取详细样本：未命中映射的平台回退通用版（带平台名插值）。 */
function sampleForPlatform(platform: string): string {
  const p = String(platform || '').trim()
  const hit = PROMPT_SAMPLES.find((s) => s.match.some((m) => p.toLowerCase().includes(m)))
  if (hit) return hit.sample
  return `例：帮我写 5 条「你的产品名」的短视频带货文案，投放平台为${p || '抖音'}。要求：①开头 3 秒抓人（痛点 / 悬念 / 反常识，禁自我介绍）；②口语化短句，每条 45 秒左右；③突出 2-3 个核心卖点并给具体使用场景；④结尾引导行动（下单 / 关注 / 评论）；⑤5 条风格差异化：痛点种草、场景剧情、参数对比、价格惊喜、好友安利各一条。`
}
const promptPlaceholder = computed(() => sampleForPlatform(scriptPlatform.value))

/* ── 默认预填（2026-11-13 用户裁决「默认提示词给详细样本」）：输入框为空，或内容
 *    仍是上一次填入的样本（用户未改）时，随平台切换自动更新为当前平台的样本——
 *    打开页面框里即有可用的详细提示词；用户一旦自己改过就绝不覆盖。 ── */
let lastSampleFilled = ''
watch(scriptPlatform, (platform) => {
  const sample = sampleForPlatform(platform)
  if (!copyPrompt.value.trim() || copyPrompt.value === lastSampleFilled) {
    copyPrompt.value = sample
    lastSampleFilled = sample
  }
}, { immediate: true })
function fillSample(): void {
  copyPrompt.value = sampleForPlatform(scriptPlatform.value)
  lastSampleFilled = copyPrompt.value
}
</script>

<template>
      <!-- 2026-11-05 用户裁定：步骤条布局等级最高——显示在卡片框上面（与上一步/下一步同层） -->
      <VdStepBar :step="step" :steps="steps" @go="go" />
      <section class="card">

        <!-- 方案一=选择产品（2026-11-05 用户裁定：提示信息+与方案二同构胶囊标签；
             本按钮=纯产品选择入口，开公共弹窗、已选可重选，不触发生成） -->
        <div class="scheme-row">
          <span class="scheme-tag">方案一</span>
          <span class="scheme-hint">选择产品来生成文案</span>
        </div>
        <div class="row action-row">
          <TButton label="选择产品" icon="search" @click="pickDlgVisible = true" />
          <template v-if="productLabel">
            <span class="product-chip" :title="productLabel">当前产品：{{ productLabel }}</span>
            <button class="product-clear" title="清除已选产品" @click="clearScriptProduct">×</button>
          </template>
        </div>

        <!-- 方案二=输入提示词（2026-11-05 用户裁定：无产品时按提示词生成；提示红色、
             输入框两行。平台=通用设置，移到生成按钮前，与方案选择无关） -->
        <div class="gen-block">
          <div class="scheme-row">
            <span class="scheme-tag">方案二</span>
            <span class="scheme-hint scheme-hint--danger">没有产品？直接输入提示词生成文案</span>
          </div>
          <textarea
            v-model="copyPrompt"
            class="input gen-textarea"
            rows="4"
            :placeholder="promptPlaceholder"
            title="默认已按当前平台预填详细提示词样本——改产品名与卖点即可生成；点「平台样本」可重新插入"
          ></textarea>
          <div class="gen-actions">
            <label class="field-label">平台</label>
            <select v-model="scriptPlatform" class="scene-select" title="投放平台（平台口播风格指引由服务端织入生成）">
              <option v-for="p in platformOptions" :key="p.name" :value="p.name">{{ p.name }}</option>
              <option v-if="!platformOptions.length" value="抖音">抖音</option>
            </select>
            <TButton
              label="📝 平台样本"
              style="flex: 0 0 auto;"
              title="插入当前平台的详细提示词样本（覆盖输入框，改产品名与卖点即可生成）"
              @click="fillSample"
            />
            <TButton
              label="✨ AI生成口播文案"
              :loading="manualCopyBusy"
              :disabled="!canGenCopy"
              :title="canGenCopy ? '' : '两个方案必须有一个：请「选择产品」，或输入提示词'"
              @click="genVoiceoverCandidates"
            />
          </div>
        </div>

        <!-- 分镜脚本（2026-09-21 用户裁决：生成脚本的界面与逻辑自第二步移到本页文案下方；
             生成后作为四步公共显示组件，每步都有、只是状态不同——本步为编辑态） -->
        <!-- 2026-11-05 用户裁定：视频文案随分镜脚本显示（迁入分镜组件顶部；
             进默认无脚本不显示，每份文案对应一个分镜脚本） -->
        <CopywritingStoryboard mode="edit" />


      </section>

      <!-- 底部导航条 -->
      <div class="row">
        <span class="spacer"></span>
        <TButton label="下一步：口播配音" icon="right" :disabled="!hasSplitStoryboards"
          :title="hasSplitStoryboards ? '' : '尚未生成分镜脚本：点击「✨ AI 生成分镜脚本」生成后再进入下一步'"
          @click="go(1)" />
      </div>

      <!-- 选择产品公共弹窗（WbPickProductDialog：TDialog 壳 + WbPickProductPanel，单选上报后自动关闭） -->
      <WbPickProductDialog
        :visible="pickDlgVisible"
        @close="pickDlgVisible = false"
        @pick="applyScriptProduct"
      />

      <!-- 十稿挑选弹窗（共享组件 multiple 多选形态；勾选个数=装载份数，每份一个分镜标签） -->
      <VoiceoverPickerDialog
        :open="voiceoverDlgOpen"
        :candidates="voiceoverCandidates"
        :failed-formulas="voiceoverFailedFormulas"
        multiple
        :selected-idxs="voiceoverSelectedIdxs"
        @update:selected-idxs="voiceoverSelectedIdxs = $event"
        @confirm="confirmVoiceoverCandidates"
        @close="closeVoiceoverDlg"
      />
</template>

<style scoped>
.card { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); }

/* 方案一/二（2026-11-05 用户裁定：两方案同构——同款胶囊标签+提示行；提示行文案色
   方案二为红（用户指定），方案一中性） */
.scheme-row { display: flex; align-items: center; gap: 8px; }
.scheme-tag {
  padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; flex: none;
  color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 35%, var(--border));
}
.scheme-hint { font-size: 12px; color: var(--muted-foreground); }
.scheme-hint--danger { color: var(--danger, #e74c3c); }
.modal--voice { width: 720px; }

/* 提示词生成区（2026-11-05 用户裁决：无产品按提示词生成；AI 生成按钮在输入框下。
   二改：提示红色、输入框两行） */
.gen-block { display: flex; flex-direction: column; gap: 6px; } /* 与方案一平级：外框删除（2026-11-05 用户裁定） */
/* textarea：源序在 .input 之后覆盖其 height:32px / padding:0 10px */
.gen-textarea { height: auto; min-height: 56px; padding: 8px 10px; line-height: 1.6; font-family: inherit; resize: vertical; }
.gen-actions { display: flex; align-items: center; justify-content: flex-start; gap: var(--space-3); }
.gen-actions .scene-select { min-width: 96px; width: 96px; }
/* 2026-11-05 用户裁定：生成按钮占用该行剩余空间（平台之后的全部宽度） */
.gen-actions :deep(.t-button) { flex: 1 1 auto; }

.field-label { font-size: 13px; color: var(--foreground); display: inline-flex; align-items: center; gap: 4px; }

.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }

.spacer { flex: 1; }

.input { height: 32px; padding: 0 10px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--foreground); outline: none; font-size: 13px; }

.input:focus { border-color: var(--primary); }


.product-chip {
  max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 4px 10px; background: color-mix(in srgb, var(--primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 35%, var(--border));
  border-radius: 999px; font-size: 12px; color: var(--foreground);
}

.product-clear {
  width: 22px; height: 22px; padding: 0; line-height: 1; font-size: 14px; flex: none;
  background: transparent; color: var(--muted-foreground);
  border: 1px solid var(--border); border-radius: 50%; cursor: pointer;
}

.product-clear:hover { color: var(--danger, #e74c3c); border-color: var(--danger, #e74c3c); }

</style>
