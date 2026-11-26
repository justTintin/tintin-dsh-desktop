<script setup lang="ts">
// TrackBatchBar.vue — 分镜批量生成组（2026-11-26 四源四轨裁决）：
//   kind='aroll' = A-Roll 数字人组（人物图素材ID 共用 + 生成A-Roll 按钮；放分镜脚本组内）
//   kind='ai'    = AI 生成组（生成剪辑方案上方；批量跑所有勾选 AI生成 的分镜）
// 自注入 shell（与面板同源状态）；进度行=标记数/完成/进行中/失败 就地汇总。
import { computed, inject, ref } from 'vue'
import TButton from '@/components/common/TButton.vue'
import { copywritingMontageShellKey } from './copywritingMontageUiContext'

const props = defineProps<{ kind: 'aroll' | 'ai' }>()
const shell = inject(copywritingMontageShellKey)!
const { shotMatBusy, shotMatMsg, shotBatchAI, shotBatchARoll, shotBatchProgressOf } = shell.s

const arollPersonId = ref('')
const progress = computed(() => shotBatchProgressOf(props.kind))
const progressText = computed(() => {
  const p = progress.value
  if (!p.total) {
    return props.kind === 'aroll'
      ? '在分镜右侧勾选「生成A-Roll」后点生成（需先完成第 2 步口播配音）'
      : '在分镜右侧勾选「AI生成」后点生成'
  }
  return `已选 ${p.total} 镜：完成 ${p.done}${p.active ? ` · 进行中 ${p.active}` : ''}${p.failed ? ` · 失败 ${p.failed}` : ''}`
})

function run(): void {
  if (props.kind === 'aroll') void shotBatchARoll(arollPersonId.value)
  else void shotBatchAI()
}
</script>

<template>
  <div class="tbatch" :class="`tbatch--${kind}`">
    <span class="tbatch-title">{{ kind === 'aroll' ? 'A-Roll 数字人' : 'AI 生成' }}</span>
    <input v-if="kind === 'aroll'" v-model="arollPersonId" class="input tbatch-person" placeholder="人物图素材ID"
      title="素材库图片 ID（本组勾选分镜共用该数字人形象）" />
    <TButton :label="kind === 'aroll' ? '生成A-Roll' : 'AI生成勾选分镜'" size="small" :disabled="shotMatBusy" @click="run" />
    <span class="muted tbatch-progress">{{ progressText }}</span>
    <span v-if="shotMatMsg" class="tbatch-msg">{{ shotMatMsg }}</span>
  </div>
</template>

<style scoped>
.tbatch { display: flex; align-items: center; gap: var(--space-3, 12px); flex-wrap: wrap; padding: 8px 12px;
  border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-container); }
.tbatch--ai { border: none; background: transparent; padding: 4px 0; }
.tbatch-title { font-size: 13px; font-weight: 600; color: var(--foreground); flex: none; }
.tbatch-person { width: 140px; flex: none; }
.tbatch-progress { font-size: 12px; }
.tbatch-msg { font-size: 12px; color: var(--muted-foreground); word-break: break-all; }
.muted { color: var(--muted-foreground); }
</style>
