<script setup lang="ts">
// ═════════════════════════════════════════════════════════════
// CopywritingStep1Panel.vue — 文案混剪 Step1 文案编写面板
// 2026-10-03 用户裁决：①场景选择与时间限制删除——写法维度由服务端 FORMULAS 承担
// （POST /copywriting/voiceover 十稿全量），时长走服务端缺省预算；本行保留平台下拉。
// ②生成改调服务端十稿全量：每次返回约 10 种文案写法，客户端弹窗挑选确认一种写入
// 文案框（单稿形态直接采用免弹窗）。③高级脚本设置整体删除（自定义文案要求随入口
// 退役，hint 不传）；原「产品/高级设置」+「平台/AI 生成」两行合一行，AI 生成右对齐。
// 状态经 inject 解构回原名（零改动）；生成编排在 useCopywritingMontage。
// ═════════════════════════════════════════════════════════════
import { ref, computed, onMounted, inject } from 'vue'
import TButton from '@/components/common/TButton.vue'
import CopywritingStoryboard from './CopywritingStoryboard.vue'
import VdStepBar from '../VdStepBar.vue'
import WbPickProductDialog from '@/components/workbench/WbPickProductDialog.vue'
import VoiceoverPickerDialog from '../VoiceoverPickerDialog.vue'
import { copywritingMontageShellKey } from './copywritingMontageUiContext'

const shell = inject(copywritingMontageShellKey)!
const { step, go, steps } = shell
const {
  // 文案编写（2026-10-03 用户裁决：平台选择 + 服务端十稿全量，客户端挑选确认）
  sharedProductInfo, applyScriptProduct, clearScriptProduct,
  manualCopy, manualCopyBusy, activeNarrative,
  scriptPlatform, platformOptions, loadPlatforms,
  voiceoverCandidates, voiceoverFailedFormulas, voiceoverDlgOpen, voiceoverSelectedIdx, closeVoiceoverDlg,
  genVoiceoverCandidates, confirmVoiceoverCandidate,
} = shell.s

/* ── 选择产品（公共弹窗；选中后显示在按钮后面，写入 sharedProductInfo 单一来源）── */
const pickDlgVisible = ref(false)
const productLabel = computed(() => {
  const i = sharedProductInfo.value
  const base = [i.brand, i.product, i.model].map((v) => String(v || '').trim()).filter(Boolean).join(' / ')
  const extras = String(i.extra || '').split('\n').map((s) => s.trim()).filter(Boolean)
  return extras.length ? `${base}（${extras.length} 条卖点）` : base
})

onMounted(() => { void loadPlatforms() })
</script>

<template>
      <section class="card">
        <VdStepBar :step="step" :steps="steps" @go="go" />

        <!-- 产品+平台+AI 生成行（2026-10-03 用户裁决：高级脚本设置删除，原两行合一行，
             AI 生成按钮右对齐；平台=结构化参数直传，字典 GET /copywriting/platforms） -->
        <div class="row action-row">
          <TButton label="选择产品" icon="search" @click="pickDlgVisible = true" />
          <template v-if="productLabel">
            <span class="product-chip" :title="productLabel">当前产品：{{ productLabel }}</span>
            <button class="product-clear" title="清除已选产品" @click="clearScriptProduct">×</button>
          </template>
          <label class="field-label">平台</label>
          <select v-model="scriptPlatform" class="scene-select" title="投放平台（平台口播风格指引由服务端织入生成）">
            <option v-for="p in platformOptions" :key="p.name" :value="p.name">{{ p.name }}</option>
            <option v-if="!platformOptions.length" value="抖音">抖音</option>
          </select>
          <span class="spacer"></span>
          <!-- 未选产品禁用（2026-10-03 用户裁决：生成按选中产品出 10 稿，产品必选——
               服务端 product_desc 必填；选中后持久化，重启保留） -->
          <TButton
            label="✨ 点击使用AI生成视频文案"
            :loading="manualCopyBusy"
            :disabled="!productLabel"
            :title="productLabel ? '' : '请先「选择产品」——服务端按产品信息生成 10 种文案写法'"
            @click="genVoiceoverCandidates"
          />
        </div>

        <div class="field">
          <label class="field-label">
            视频文案（可选）
            <span class="info-i" title="可直接手动编写，或点击上方按钮由 AI 生成 10 种文案写法后挑选一种。口播文案与分镜脚本绑定——有分镜脚本时本框即激活分镜的旁白（克隆声音以此为准），无分镜时为全局草稿（随本地设置保存）">ⓘ</span>
          </label>
          <textarea
            v-model="activeNarrative"
            class="input ta ta--copy"
            rows="12"
            placeholder="在此编写视频文案，或点击上方按钮由 AI 生成"
          />
        </div>

        <!-- 分镜脚本（2026-09-21 用户裁决：生成脚本的界面与逻辑自第二步移到本页文案下方；
             生成后作为四步公共显示组件，每步都有、只是状态不同——本步为编辑态） -->
        <CopywritingStoryboard mode="edit" />


      </section>

      <!-- 底部导航条 -->
      <div class="row">
        <span class="spacer"></span>
        <TButton label="下一步：口播配音" icon="right" @click="go(1)" />
      </div>

      <!-- 选择产品公共弹窗（WbPickProductDialog：TDialog 壳 + WbPickProductPanel，单选上报后自动关闭） -->
      <WbPickProductDialog
        :visible="pickDlgVisible"
        @close="pickDlgVisible = false"
        @pick="applyScriptProduct"
      />

      <!-- 十稿挑选弹窗（共享组件；默认选中第一种，点卡片切换，确定写入文案框） -->
      <VoiceoverPickerDialog
        :open="voiceoverDlgOpen"
        :candidates="voiceoverCandidates"
        :failed-formulas="voiceoverFailedFormulas"
        :selected-idx="voiceoverSelectedIdx"
        @update:selected-idx="voiceoverSelectedIdx = $event"
        @confirm="confirmVoiceoverCandidate"
        @close="closeVoiceoverDlg"
      />
</template>

<style scoped>
.card { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); }

/* 产品+平台+AI 生成行（2026-10-03：两行合一，AI 生成右对齐） */
.action-row .scene-select { min-width: 96px; width: 96px; }
.modal--voice { width: 720px; }

.field { display: flex; flex-direction: column; gap: 6px; }

.field-label { font-size: 13px; color: var(--foreground); display: inline-flex; align-items: center; gap: 4px; }

.info-i { color: var(--muted-foreground); font-size: 12px; cursor: help; }

.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }

.spacer { flex: 1; }

.input { height: 32px; padding: 0 10px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--foreground); outline: none; font-size: 13px; }

.input:focus { border-color: var(--primary); }

/* textarea：源序在 .input 之后覆盖其 height:32px / padding:0 10px */
.ta {
  height: auto; min-height: 72px; padding: 8px 10px;
  line-height: 1.6; font-family: inherit; resize: vertical;
}

.ta--copy { min-height: 260px; }

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
