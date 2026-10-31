<!-- CreationVoiceoverOptions.vue — 创作模式·口播上下文选项（2026-10-30）
     选中口播后端技能时出现在 composer 工具行下方的紧凑选项行：
     平台 / 写法 / 目标时长——字典全部来自服务端整改后的
     GET /copywriting/platforms|formulas（抖音/小红书/公众号、痛点式等），
     缺省「自动」=不携带该字段（服务端缺省抖音、写法自动出多稿候选）。
     字典拉取失败静默降级为仅「自动」档，不阻塞口播发送。 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchFormulas, fetchPlatforms, type CopywritingDictEntry } from '../composables/creationServer'

const platform = defineModel<string>('platform', { default: '' })
const formula = defineModel<string>('formula', { default: '' })
const duration = defineModel<number>('duration', { default: 30 })

const platforms = ref<CopywritingDictEntry[]>([])
const formulas = ref<CopywritingDictEntry[]>([])
const dictNote = ref('')

/** 时长档（服务端 duration_s 目标秒；30=服务端缺省档） */
const DURATION_OPTIONS = [15, 30, 45, 60, 90] as const

onMounted(async () => {
  const [ps, fs] = await Promise.allSettled([fetchPlatforms(), fetchFormulas()])
  platforms.value = ps.status === 'fulfilled' ? ps.value : []
  formulas.value = fs.status === 'fulfilled' ? fs.value : []
  if (!platforms.value.length || !formulas.value.length) {
    dictNote.value = '口播字典拉取失败，仅「自动」档可用（检查服务端连接后重进本视图）'
  }
})
</script>

<template>
  <div class="vo-row" :title="dictNote || '口播选项：缺省「自动」=服务端缺省平台与写法自动多稿'">
    <span class="vo-label">🎙 口播</span>
    <label class="vo-field">
      <span>平台</span>
      <select v-model="platform" class="vo-select">
        <option value="">自动</option>
        <option v-for="p in platforms" :key="p.name" :value="p.name" :title="p.guide">{{ p.name }}</option>
      </select>
    </label>
    <label class="vo-field">
      <span>写法</span>
      <select v-model="formula" class="vo-select">
        <option value="">自动（多稿候选）</option>
        <option v-for="f in formulas" :key="f.name" :value="f.name" :title="f.guide">{{ f.name }}</option>
      </select>
    </label>
    <label class="vo-field">
      <span>时长</span>
      <select v-model.number="duration" class="vo-select">
        <option v-for="d in DURATION_OPTIONS" :key="d" :value="d">{{ d }}s</option>
      </select>
    </label>
    <span v-if="dictNote" class="vo-note">{{ dictNote }}</span>
  </div>
</template>

<style scoped>
.vo-row { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.vo-label { font-size: 12px; font-weight: 700; color: var(--primary); white-space: nowrap; }
.vo-field { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted-foreground); white-space: nowrap; }
.vo-select { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); font: inherit; font-size: 12px; padding: 3px 6px; border-radius: 8px; outline: none; max-width: 150px; cursor: pointer; }
.vo-select:focus { border-color: var(--primary); }
.vo-note { font-size: 11px; color: #d97706; }
</style>
