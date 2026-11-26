<script setup lang="ts">
// TrackBatchBar.vue — 分镜批量生成组（2026-11-26 四源四轨裁决）：
//   kind='aroll' = A-Roll 数字人组（人物图上传 + 生成A-Roll 按钮；放分镜脚本组内。
//     人物图=本地选图 → 宿主 server:uploadImage（product-upload）落服务端路径，
//     路径随 scheduled stage=aroll 任务下发（worker 在服务端主机读图））
//   kind='ai'    = AI 生成组（生成剪辑方案上方；批量跑所有勾选 AI生成 的分镜）
// 自注入 shell（与面板同源状态）；进度行=标记数/完成/进行中/失败 就地汇总。
import { inject, ref } from 'vue'
import TButton from '@/components/common/TButton.vue'
import { copywritingMontageShellKey } from './copywritingMontageUiContext'

const props = defineProps<{ kind: 'aroll' | 'ai' }>()
const shell = inject(copywritingMontageShellKey)!
const { shotMatBusy, shotMatMsgs, shotBatchAI, shotBatchARoll } = shell.s
// 2026-11-26 用户裁决：分组消息各自独立（shotMatMsgs[kind]）——A-Roll 的提示不再串进 AI 生成组
// 2026-11-26 用户裁决：组计数信息（已选 N 镜：完成 M）移到分组标题行（Storyboard/
// Step2Panel 标题消费 shotBatchProgressOf），本组件不再重复展示

const personRef = ref('') // 人物图服务端路径（product-upload 返回）
const personName = ref('')
const personUploading = ref(false)
const personError = ref('')

async function pickPersonImage(): Promise<void> {
  personError.value = ''
  const picked = await window.tintin.dialog.openFiles({
    title: '选择人物图',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    multi: true,
  })
  const path = picked && picked[0]
  if (!path) return
  personUploading.value = true
  try {
    const res = await window.tintin.server.uploadImage(path)
    if (res && typeof res === 'object' && 'error' in res) throw new Error(String(res.error || '上传失败'))
    const serverPath = res && typeof res === 'object' && Array.isArray(res.paths) ? res.paths[0] : ''
    if (!serverPath) throw new Error('上传响应缺服务端路径')
    personRef.value = String(serverPath)
    personName.value = path.split(/[\\/]/).pop() || path
  } catch (e) {
    personError.value = e instanceof Error ? e.message : String(e)
  } finally { personUploading.value = false }
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
      <TButton :label="personUploading ? '上传中…' : (personRef ? '重传人物图' : '上传人物图')" variant="secondary" size="small"
        :disabled="personUploading" title="选本地图片上传为数字人形象（本组勾选分镜共用）" @click="pickPersonImage" />
      <span v-if="personName" class="muted tbatch-file" :title="personRef">已选：{{ personName }}</span>
      <span v-if="personError" class="tbatch-err">{{ personError }}</span>
    </template>
    <!-- 2026-11-26 用户裁决：生成按钮换行占整行 -->
    <TButton class="tbatch-run" :label="kind === 'aroll' ? '生成A-Roll' : 'AI生成分镜'" size="small" :disabled="shotMatBusy" @click="run" />
    <span v-if="shotMatMsgs[kind]" class="tbatch-msg">{{ shotMatMsgs[kind] }}</span>
  </div>
</template>

<style scoped>
.tbatch { display: flex; align-items: center; gap: var(--space-3, 12px); flex-wrap: wrap; padding: 4px 0;
  border: none; background: transparent; }
.tbatch-title { font-size: 13px; font-weight: 600; color: var(--foreground); flex: none; }
.tbatch-file { font-size: 12px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 生成按钮换行占整行（2026-11-26 用户裁决） */
.tbatch-run { flex: 1 1 100%; }
.tbatch-msg { font-size: 12px; color: var(--muted-foreground); word-break: break-all; }
.muted { color: var(--muted-foreground); }
</style>
