<!-- CreationMarket.vue — 创作模式·技能市场弹窗（2026-10-30 自 App.vue 原样提取）
     纯代码搬移不改行为（2026-10-16/17 即梦市场形态：分类页签 + 字典卡片网格 +
     ＋自定义编辑器 + 恢复默认 + 我的技能管理行）；技能表状态归父层（芯片行/
     菜单共用单一真源），本组件只出事件：toggle-catalog/upsert/remove/reset/close。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  CREATION_CATALOG,
  CREATION_CATALOG_CATEGORIES,
  type CreationCatalogEntry,
  type CreationSkill,
  newSkillId,
  TOOL_OPTIONS,
} from '../composables/creationStudioLogic'

const props = defineProps<{
  skills: ReadonlyArray<CreationSkill>
}>()

const emit = defineEmits<{
  'toggle-catalog': [entry: CreationCatalogEntry]
  upsert: [skill: CreationSkill]
  remove: [skill: CreationSkill]
  reset: []
  close: []
}>()

const marketCategory = ref<CreationCatalogEntry['category'] | '全部'>('全部')
const marketEntries = computed(() => {
  if (marketCategory.value === '全部') return CREATION_CATALOG
  return CREATION_CATALOG.filter((e) => e.category === marketCategory.value)
})
function isAdded(entry: CreationCatalogEntry): boolean {
  return props.skills.some((s) => s.name === entry.name)
}

/* ── 编辑器（自定义/编辑既有技能）── 后端/绑定工具草稿与本组件内聚 */
const editing = ref<CreationSkill | null>(null)
const editingTool = ref<string>('')
const editingBackend = ref<'llm' | 'voiceover' | 'copy'>('llm')
function startEdit(skill: CreationSkill): void {
  editing.value = { ...skill }
  editingTool.value = skill.tool ?? ''
  editingBackend.value = skill.backend ?? 'llm'
}
function saveEditing(): void {
  const draft = editing.value
  if (!draft) return
  if (!draft.name.trim() || !draft.template.trim()) return
  const next: CreationSkill = {
    ...draft,
    name: draft.name.trim(),
    template: draft.template,
    backend: (editingBackend.value === 'llm' ? undefined : editingBackend.value) as CreationSkill['backend'],
    ...(editingTool.value ? { tool: editingTool.value as CreationSkill['tool'] } : {}),
  }
  emit('upsert', next)
  editing.value = null
}
</script>

<template>
  <div class="market-mask" @click.self="emit('close')">
    <div class="market">
      <div class="market-head">
        <span class="market-title">技能市场</span>
        <span class="market-actions">
          <button type="button" class="mini" @click="startEdit({ id: newSkillId(), name: '', emoji: '🧩', template: '请围绕下面的想法进行创作：{{输入}}{{主体}}', backend: 'llm' })">＋ 自定义</button>
          <button type="button" class="mini" @click="emit('reset')">恢复默认</button>
          <button type="button" class="mini" @click="emit('close')">×</button>
        </span>
      </div>
      <div class="market-cats">
        <button type="button" class="cat" :class="{ 'is-active': marketCategory === '全部' }" @click="marketCategory = '全部'">全部</button>
        <button v-for="c in CREATION_CATALOG_CATEGORIES" :key="c" type="button" class="cat" :class="{ 'is-active': marketCategory === c }" @click="marketCategory = c">{{ c }}</button>
      </div>
      <!-- 编辑器（自定义/编辑既有技能） -->
      <div v-if="editing" class="editor">
        <label class="field"><span>名称</span><input v-model="editing.name" class="field-input" placeholder="如：口播带货脚本"></label>
        <label class="field"><span>图标</span><input v-model="editing.emoji" class="field-input field-emoji" maxlength="4"></label>
        <label class="field field-wide"><span>发送后端</span>
          <select v-model="editingBackend" class="field-input">
            <option value="llm">AI 生成（LLM）</option>
            <option value="voiceover">口播文案（服务端十稿）</option>
            <option value="copy">仅组合提示词（复制/跳转）</option>
          </select>
        </label>
        <label class="field field-wide"><span>绑定工具（发送后可直达）</span>
          <select v-model="editingTool" class="field-input">
            <option v-for="o in TOOL_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
        <label class="field field-wide"><span>提示词模板（占位符：双大括号包住「输入」=用户输入、「主体」=@主体列表）</span>
          <textarea v-model="editing.template" class="field-input" rows="6" />
        </label>
        <div class="editor-ops">
          <button type="button" class="mini is-primary" :disabled="!editing.name.trim() || !editing.template.trim()" @click="saveEditing">保存</button>
          <button type="button" class="mini" @click="editing = null">取消</button>
        </div>
      </div>
      <!-- 字典卡片网格（对照即梦：封面/名称/添加/作者/赞/使用量/描述） -->
      <div v-else class="market-grid">
        <div v-for="e in marketEntries" :key="e.id" class="mcard">
          <div class="mcard-cover" :class="`cat-${e.category}`">
            <span class="mcard-name">{{ e.name }}</span>
            <button type="button" class="mcard-add" :class="{ 'is-added': isAdded(e) }" @click="emit('toggle-catalog', e)">{{ isAdded(e) ? '已添加' : '添加' }}</button>
          </div>
          <div class="mcard-meta">@{{ e.author }} · {{ e.likes }} 赞 {{ e.usage }}</div>
          <div class="mcard-desc">{{ e.description }}</div>
        </div>
      </div>
      <!-- 已添加技能管理行 -->
      <div class="market-mine">
        <div class="market-mine-title">我的技能（{{ skills.length }}）</div>
        <div class="mine-rows">
          <span v-for="s in skills" :key="s.id" class="mine-row">
            {{ s.emoji }} /{{ s.name }}
            <button type="button" class="mini" @click="startEdit(s)">编辑</button>
            <button v-if="!s.builtin" type="button" class="mini is-danger" @click="emit('remove', s)">移除</button>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.market-mask { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,0.5); display: flex; align-items: flex-start; justify-content: center; overflow: auto; padding: 40px 16px; }
.market { width: min(980px, 96vw); background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-3); padding: var(--space-4); }
.market-head { display: flex; align-items: center; justify-content: space-between; font-size: 16px; font-weight: 700; color: var(--foreground); margin-bottom: var(--space-3); }
.market-actions { display: inline-flex; gap: 8px; }
.market-cats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: var(--space-3); }
.cat { border: 1px solid var(--border); background: transparent; color: var(--muted-foreground); font: inherit; font-size: 13px; padding: 5px 14px; border-radius: 999px; cursor: pointer; }
.cat.is-active { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); font-weight: 600; }
.mini { border: 1px solid var(--border); background: transparent; color: var(--foreground); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer; white-space: nowrap; }
.mini:hover { border-color: var(--primary); color: var(--primary); }
.mini:disabled { opacity: 0.45; cursor: not-allowed; }
.mini.is-danger { color: #ef4444; border-color: color-mix(in srgb, #ef4444 40%, transparent); }
.mini.is-primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
.market-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
.mcard { border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: var(--surface); display: flex; flex-direction: column; }
.mcard-cover { position: relative; aspect-ratio: 16 / 9; display: flex; align-items: flex-end; padding: 10px; }
.mcard-cover.cat-广告营销 { background: linear-gradient(135deg, #7C3AED33 0%, #EC489933 100%); }
.mcard-cover.cat-影视作品 { background: linear-gradient(135deg, #0EA5E933 0%, #6366F133 100%); }
.mcard-cover.cat-平面设计 { background: linear-gradient(135deg, #14B8A633 0%, #0EA5E933 100%); }
.mcard-cover.cat-电商 { background: linear-gradient(135deg, #F59E0B33 0%, #EF444433 100%); }
.mcard-cover.cat-动画动漫 { background: linear-gradient(135deg, #EC489933 0%, #8B5CF633 100%); }
.mcard-cover.cat-其他 { background: linear-gradient(135deg, #64748B33 0%, #94A3B833 100%); }
.mcard-name { font-size: 15px; font-weight: 700; color: var(--foreground); text-shadow: 0 1px 6px rgba(0,0,0,0.25); padding-right: 56px; }
.mcard-add { position: absolute; top: 8px; right: 8px; border: none; border-radius: 8px; background: color-mix(in srgb, var(--card) 85%, transparent); color: var(--foreground); font: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer; }
.mcard-add:hover, .mcard-add.is-added { background: var(--primary); color: var(--primary-foreground); }
.mcard-meta { font-size: 11px; color: var(--muted-foreground); padding: 8px 10px 0; }
.mcard-desc { font-size: 12px; line-height: 1.55; color: var(--muted-foreground); padding: 4px 10px 10px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; flex: 1 1 auto; }
.editor { display: grid; grid-template-columns: 1fr 90px; gap: 10px; padding: var(--space-3) 0; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted-foreground); }
.field-wide { grid-column: 1 / -1; }
.field-input { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--foreground); font: inherit; font-size: 13px; padding: 8px 10px; outline: none; }
.field-emoji { text-align: center; font-size: 16px; }
.editor-ops { grid-column: 1 / -1; display: flex; gap: 8px; justify-content: flex-end; }
.market-mine { margin-top: var(--space-4); border-top: 1px solid var(--border); padding-top: var(--space-3); }
.market-mine-title { font-size: 13px; font-weight: 700; color: var(--foreground); margin-bottom: 8px; }
.mine-rows { display: flex; flex-wrap: wrap; gap: 8px; }
.mine-row { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; font-size: 12px; color: var(--foreground); }
</style>
