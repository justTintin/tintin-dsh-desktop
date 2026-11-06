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
import { ref, computed, onMounted, inject } from 'vue'
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
            rows="2"
            placeholder="输入提示词，如：无线电竞鼠标，主打低延迟与长续航"
          ></textarea>
          <div class="gen-actions">
            <label class="field-label">平台</label>
            <select v-model="scriptPlatform" class="scene-select" title="投放平台（平台口播风格指引由服务端织入生成）">
              <option v-for="p in platformOptions" :key="p.name" :value="p.name">{{ p.name }}</option>
              <option v-if="!platformOptions.length" value="抖音">抖音</option>
            </select>
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
