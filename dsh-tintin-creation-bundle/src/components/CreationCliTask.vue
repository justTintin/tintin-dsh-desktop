<!-- CreationCliTask.vue — 创作模式·即梦 CLI 任务条（2026-10-25，自包含子组件）
     职责：按 submit_id 轮询 dreamina:query 到终态（SKILL.md 口径：gen_status=
     success 才算成功；querying 仅代表已受理）、成功渲染媒体条（图片/视频）、
     「保存到本地」（download_dir 落 Documents/tintin-workspace/dreamina/<id>/）。
     提交在父层 send 链；本组件只管查询/展示，done/failed 上抛记史。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getTintin } from '../composables/creationServer'
import {
  dreaminaPollBudget,
  dreaminaTerminal,
  cliResultSummary,
  type DreaminaTaskKind,
} from '../composables/creationDreaminaLogic'

const props = defineProps<{
  submitId: string
  kind: DreaminaTaskKind
  command: string
}>()

const emit = defineEmits<{
  done: [result: { submitId: string; mediaUrls: string[]; localDir?: string; summary: string }]
  failed: [message: string]
  notice: [text: string, ok: boolean]
}>()

interface QueryResult {
  ok?: boolean
  error?: string
  genStatus?: string
  failReason?: string
  mediaUrls?: string[]
  localDir?: string
  stderr?: string
}

const genStatus = ref('querying')
const mediaUrls = ref<string[]>([])
const localDir = ref('')
const failReason = ref('')
const elapsedS = ref(0)
const saving = ref(false)
const saved = ref(false)

let timer: ReturnType<typeof setTimeout> | undefined
let tick: ReturnType<typeof setInterval> | undefined
const startedAt = Date.now()
const budgetMs = dreaminaPollBudget(props.kind)
const terminal = computed(() => dreaminaTerminal(genStatus.value))

async function queryOnce(download = false): Promise<QueryResult | null> {
  const t = getTintin()
  if (!t?.server?.dreaminaQuery) return null
  return await t.server.dreaminaQuery({ submitId: props.submitId, download }) as QueryResult | null
}

function finish(ok: boolean, res?: QueryResult | null): void {
  stopTimers()
  if (ok) {
    const urls = (res?.mediaUrls ?? []).filter(Boolean)
    mediaUrls.value = urls
    localDir.value = String(res?.localDir ?? '')
    const summary = cliResultSummary({
      submitId: props.submitId,
      mediaUrls: urls,
      localDir: localDir.value || undefined,
      failReason: failReason.value || undefined,
    })
    emit('done', { submitId: props.submitId, mediaUrls: urls, ...(localDir.value ? { localDir: localDir.value } : {}), summary })
  } else {
    emit('failed', failReason.value || '生成失败（可稍后按 submit_id 复查）')
  }
}

function stopTimers(): void {
  if (timer) clearTimeout(timer)
  if (tick) clearInterval(tick)
  timer = undefined
  tick = undefined
}

async function poll(): Promise<void> {
  if (terminal.value !== 'querying') return
  if (Date.now() - startedAt > budgetMs) {
    failReason.value = '等待超时：任务仍在生成，可稍后在即梦内或按 submit_id 复查'
    finish(false)
    return
  }
  const res = await queryOnce()
  if (!res) { finish(false, res); return }
  if (res.error) { failReason.value = res.error; finish(false, res); return }
  genStatus.value = String(res.genStatus ?? 'querying')
  failReason.value = String(res.failReason ?? '')
  if (res.mediaUrls?.length) mediaUrls.value = res.mediaUrls.filter(Boolean)
  const state = dreaminaTerminal(genStatus.value)
  if (state === 'success') finish(true, res)
  else if (state === 'fail') finish(false, res)
  else timer = setTimeout(() => { void poll() }, 4000)
}

/** 「保存到本地」：download_dir 落盘后回填目录注记 */
async function saveLocal(): Promise<void> {
  if (saving.value || terminal.value !== 'success') return
  saving.value = true
  try {
    const res = await queryOnce(true)
    if (res?.ok && dreaminaTerminal(String(res.genStatus ?? '')) === 'success') {
      localDir.value = String(res.localDir ?? '')
      saved.value = true
      emit('notice', `已保存到 ${localDir.value || '下载目录'}`, true)
    } else {
      emit('notice', `保存失败：${String(res?.error ?? res?.stderr ?? '未知错误')}`, false)
    }
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  tick = setInterval(() => { elapsedS.value = Math.round((Date.now() - startedAt) / 1000) }, 1000)
  void poll()
})
onUnmounted(stopTimers)
</script>

<template>
  <div class="cli-task">
    <div class="task-head">
      <span class="task-title">即梦 CLI · {{ command }}</span>
      <span class="task-meta">submit_id {{ submitId }}</span>
      <span class="spacer" />
      <span v-if="terminal === 'querying'" class="task-state is-waiting">生成中 {{ elapsedS }}s…</span>
      <span v-else-if="terminal === 'success'" class="task-state is-ok">完成</span>
      <span v-else class="task-state is-err">失败</span>
    </div>
    <p v-if="terminal === 'fail' && failReason" class="task-err">{{ failReason }}</p>
    <div v-if="mediaUrls.length" class="media" :class="`is-${kind}`">
      <template v-if="kind === 'image'">
        <a v-for="u in mediaUrls" :key="u" class="media-img" :href="u" target="_blank" rel="noopener">
          <img :src="u" loading="lazy" alt="生成结果">
        </a>
      </template>
      <template v-else>
        <video v-for="u in mediaUrls" :key="u" class="media-video" :src="u" controls preload="metadata" />
      </template>
    </div>
    <div class="task-ops">
      <button v-if="terminal === 'success' && mediaUrls.length" type="button" class="mini" :disabled="saving || saved" @click="saveLocal">{{ saved ? '已保存' : (saving ? '保存中…' : '保存到本地') }}</button>
      <a v-if="localDir" class="task-dir" :title="localDir">{{ localDir }}</a>
    </div>
  </div>
</template>

<style scoped>
.cli-task { margin-top: var(--space-3); background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: var(--space-3); display: flex; flex-direction: column; gap: 8px; }
.task-head { display: flex; align-items: center; gap: 8px; }
.task-title { font-size: 13px; font-weight: 700; color: var(--foreground); }
.task-meta { font-size: 11px; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spacer { flex: 1 1 auto; }
.task-state { font-size: 12px; font-weight: 600; white-space: nowrap; }
.task-state.is-waiting { color: #d97706; }
.task-state.is-ok { color: #16a34a; }
.task-state.is-err { color: #ef4444; }
.task-err { margin: 0; font-size: 12px; line-height: 1.6; color: #ef4444; word-break: break-word; }
.media { display: grid; gap: 6px; }
.media.is-image { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
.media-img { display: block; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
.media-img img { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; }
.media-video { width: 100%; max-height: 320px; border-radius: 10px; border: 1px solid var(--border); background: #101010; }
.task-ops { display: flex; align-items: center; gap: 8px; }
.mini { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); font: inherit; font-size: 12px; padding: 3px 9px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.mini:hover { border-color: var(--primary); color: var(--primary); }
.mini:disabled { opacity: 0.55; cursor: not-allowed; }
.task-dir { font-size: 11px; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
