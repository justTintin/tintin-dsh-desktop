<!-- CreationGenerateTask.vue — 创作模式·服务端真生成任务条（2026-10-30）
     职责：按 taskId 轮询 /tasks/unified 到终态（status 归一在
     creationGenerateLogic），进行中显示进度/耗时并可取消（batch_cancel），
     完成渲染媒体条（图片/视频）+「保存到本地」（saveFile 选路径 +
     server:downloadResult 落盘，与素材库下载同口径）。提交在父层 send 链；
     本组件只管轮询/展示，done/failed/cancelled 上抛记史。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  cancelUnifiedTasks,
  fetchUnifiedTask,
  getTintin,
  resolveServerBase,
} from '../composables/creationServer'
import {
  absoluteMediaUrl,
  generatePollBudget,
  generateResultSummary,
  parseGenerateResult,
  truncateServerError,
  unifiedPhase,
  unifiedProgressLabel,
  type GenerateKind,
  type GenerateResultMedia,
} from '../composables/creationGenerateLogic'

const props = defineProps<{
  taskId: string
  kind: GenerateKind
}>()

const emit = defineEmits<{
  done: [result: { summary: string; urls: string[] }]
  failed: [message: string]
  cancelled: []
}>()

const status = ref('running')
const progress = ref(0)
const errorText = ref('')
const media = ref<GenerateResultMedia | null>(null)
const elapsedS = ref(0)
const saving = ref(false)
const savedPaths = ref<string[]>([])

let timer: ReturnType<typeof setTimeout> | undefined
let tick: ReturnType<typeof setInterval> | undefined
const startedAt = Date.now()
const budgetMs = generatePollBudget(props.kind)
const phase = computed(() => unifiedPhase(status.value))
const progressLabel = computed(() => unifiedProgressLabel(status.value, progress.value))
const urls = computed(() => media.value?.urls ?? [])

function stopTimers(): void {
  if (timer) clearTimeout(timer)
  if (tick) clearInterval(tick)
  timer = undefined
  tick = undefined
}

function finishFailed(message: string): void {
  stopTimers()
  errorText.value = message
  emit('failed', message)
}

async function poll(): Promise<void> {
  if (phase.value !== 'active') return
  if (Date.now() - startedAt > budgetMs) {
    finishFailed(`等待超时（${kindLabel.value}生成超时未完成）：任务仍在服务端排队/生成，可稍后按任务号 ${props.taskId} 复查`)
    return
  }
  let task: Record<string, unknown>
  try {
    task = await fetchUnifiedTask(props.taskId)
  } catch (e) {
    finishFailed(e instanceof Error ? e.message : String(e))
    return
  }
  status.value = String(task.status ?? 'running')
  progress.value = Number(task.progress) || 0
  const state = unifiedPhase(status.value)
  if (state === 'completed') {
    const parsed = parseGenerateResult(task.result)
    if (!parsed.urls.length) {
      finishFailed('生成完成但服务端未返回产物地址（可按任务号向服务端复查）')
      return
    }
    const base = await resolveServerBase()
    media.value = { ...parsed, urls: parsed.urls.map((u) => absoluteMediaUrl(base, u)) }
    stopTimers()
    emit('done', { summary: generateResultSummary({ media: media.value, taskId: props.taskId }), urls: media.value.urls })
    return
  }
  if (state === 'failed') {
    finishFailed(truncateServerError(task.error) || '生成失败（服务端返回失败态）')
    return
  }
  if (state === 'cancelled') {
    stopTimers()
    emit('cancelled')
    return
  }
  timer = setTimeout(() => { void poll() }, 2500)
}

/** 取消：batch_cancel 后等 cancelled 终态收尾（取消失败给提示，轮询继续） */
const cancelling = ref(false)
async function cancel(): Promise<void> {
  if (cancelling.value || phase.value !== 'active') return
  cancelling.value = true
  const n = await cancelUnifiedTasks([props.taskId])
  cancelling.value = false
  if (!n) errorText.value = '取消请求未生效（任务可能已完成）——稍候自动收尾'
}

/** 保存到本地：saveFile 选路径 + downloadResult 落盘（素材库下载同口径） */
async function saveLocal(url: string): Promise<void> {
  if (saving.value) return
  const t = getTintin()
  if (!t?.dialog?.saveFile || !t?.server?.downloadResult) return
  const ext = props.kind === 'video' ? 'mp4' : 'png'
  const savePath = await t.dialog.saveFile({
    title: '保存生成结果',
    defaultPath: `tintin-generate-${Date.now().toString(36)}.${ext}`,
    filters: [props.kind === 'video'
      ? { name: '视频文件', extensions: ['mp4', 'webm'] }
      : { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  if (!savePath) return
  saving.value = true
  try {
    const res = await t.server.downloadResult(url, savePath)
    if (res === null) throw new Error('服务端不可达')
    if (res && typeof res === 'object' && 'error' in (res as Record<string, unknown>)) {
      throw new Error(String((res as Record<string, unknown>).error || '下载失败'))
    }
    savedPaths.value = [...savedPaths.value, String(res)]
  } catch (e) {
    errorText.value = `保存失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    saving.value = false
  }
}

const kindLabel = computed(() => (props.kind === 'video' ? '视频' : '图片'))

onMounted(() => {
  tick = setInterval(() => { elapsedS.value = Math.round((Date.now() - startedAt) / 1000) }, 1000)
  void poll()
})
onUnmounted(stopTimers)
</script>

<template>
  <div class="gen-task">
    <div class="task-head">
      <span class="task-title">服务端生成 · {{ kindLabel }}</span>
      <span class="task-meta">任务 {{ taskId }}</span>
      <span class="spacer" />
      <span v-if="phase === 'active'" class="task-state is-waiting">{{ progressLabel || '生成中' }} · {{ elapsedS }}s</span>
      <span v-else-if="phase === 'completed'" class="task-state is-ok">完成</span>
      <span v-else-if="phase === 'failed'" class="task-state is-err">失败</span>
      <span v-else class="task-state">已取消</span>
      <button v-if="phase === 'active'" type="button" class="mini" :disabled="cancelling" @click="cancel">{{ cancelling ? '取消中…' : '取消' }}</button>
    </div>
    <div v-if="phase === 'active'" class="task-bar"><i :style="{ width: `${Math.min(100, Math.max(4, progress))}%` }" /></div>
    <p v-if="errorText" class="task-err">{{ errorText }}</p>
    <div v-if="urls.length" class="media" :class="`is-${kind}`">
      <template v-if="kind === 'image'">
        <a v-for="u in urls" :key="u" class="media-img" :href="u" target="_blank" rel="noopener" title="点击打开原图">
          <img :src="u" loading="lazy" alt="生成结果">
        </a>
      </template>
      <template v-else>
        <video v-for="u in urls" :key="u" class="media-video" :src="u" controls preload="metadata" />
      </template>
    </div>
    <div v-if="urls.length" class="task-ops">
      <button v-for="u in urls" :key="u" type="button" class="mini" :disabled="saving" @click="saveLocal(u)">{{ saving ? '保存中…' : '保存到本地' }}</button>
      <span v-if="savedPaths.length" class="task-dir" :title="savedPaths.join('\n')">已保存 {{ savedPaths.length }} 个文件</span>
      <span v-if="media?.engine" class="task-dir">引擎 {{ media.engine }}</span>
    </div>
  </div>
</template>

<style scoped>
.gen-task { margin-top: var(--space-3); background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: var(--space-3); display: flex; flex-direction: column; gap: 8px; }
.task-head { display: flex; align-items: center; gap: 8px; }
.task-title { font-size: 13px; font-weight: 700; color: var(--foreground); }
.task-meta { font-size: 11px; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spacer { flex: 1 1 auto; }
.task-state { font-size: 12px; font-weight: 600; white-space: nowrap; }
.task-state.is-waiting { color: #d97706; }
.task-state.is-ok { color: #16a34a; }
.task-state.is-err { color: #ef4444; }
.task-bar { height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--muted-foreground) 16%, transparent); overflow: hidden; }
.task-bar i { display: block; height: 100%; border-radius: 999px; background: var(--primary); transition: width 0.6s ease; }
.task-err { margin: 0; font-size: 12px; line-height: 1.6; color: #ef4444; word-break: break-word; white-space: pre-line; }
.media { display: grid; gap: 6px; }
.media.is-image { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
.media-img { display: block; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
.media-img img { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; }
.media-video { width: 100%; max-height: 320px; border-radius: 10px; border: 1px solid var(--border); background: #101010; }
.task-ops { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mini { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); font: inherit; font-size: 12px; padding: 3px 9px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.mini:hover { border-color: var(--primary); color: var(--primary); }
.mini:disabled { opacity: 0.55; cursor: not-allowed; }
.task-dir { font-size: 11px; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
