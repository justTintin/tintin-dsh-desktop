<script setup lang="ts">
// TrackBatchBar.vue — 分镜批量生成组（2026-11-26 四源四轨裁决）：
//   kind='aroll' = A-Roll 数字人组（人物图选择 + 生成A-Roll 按钮；放分镜脚本组内。
//     人物图 2026-11-26 三次裁决=一次上传直生成——本地选图保留本地路径，批量时与
//     整段克隆口播 wav 一起 multipart 直传 /digital-human/aroll（服务端入库+按镜
//     拆分对齐+逐镜生成+镜级回写），不再走 product-upload 预上传）
//   kind='ai'    = AI 生成组（生成剪辑方案上方；批量跑所有勾选 AI生成 的分镜）
// 自注入 shell（与面板同源状态）；进度行=标记数/完成/进行中/失败 就地汇总。
import { computed, inject, ref } from 'vue'
import TButton from '@/components/common/TButton.vue'
import { copywritingMontageShellKey } from './copywritingMontageUiContext'

const props = defineProps<{ kind: 'aroll' | 'ai' }>()
const shell = inject(copywritingMontageShellKey)!
const { shotMatBusy, shotMatMsg, shotBatchAI, shotBatchARoll, shotBatchProgressOf } = shell.s

const personRef = ref('') // 人物图本地路径（批量时 multipart 直传）
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

async function pickPersonImage(): Promise<void> {
  const picked = await window.tintin.dialog.openFiles({
    title: '选择人物图',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    multi: true,
  })
  const path = picked && picked[0]
  if (!path) return
  personRef.value = path
}

function run(): void {
  if (props.kind === 'aroll') void shotBatchARoll(personRef.value)
  else void shotBatchAI()
}
</script>

<template>
  <div class="tbatch" :class="`tbatch--${kind}`">
    <span class="tbatch-title">{{ kind === 'aroll' ? 'A-Roll 数字人' : 'AI 生成' }}</span>
    <template v-if="kind === 'aroll'">
      <TButton :label="personRef ? '重选人物图' : '上传人物图'" variant="secondary" size="small"
        title="选本地图片为数字人形象（本组勾选分镜共用；提交时与整段口播一起上传）" @click="pickPersonImage" />
      <span v-if="personRef" class="muted tbatch-file" :title="personRef">已选：{{ personRef.split(/[\\/]/).pop() }}</span>
    </template>
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
.tbatch-file { font-size: 12px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tbatch-progress { font-size: 12px; }
.tbatch-msg { font-size: 12px; color: var(--muted-foreground); word-break: break-all; }
.muted { color: var(--muted-foreground); }
</style>
