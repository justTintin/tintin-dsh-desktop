<!-- SkillManager.vue — 技能管理（2026-10-16 用户裁决：侧栏新增页）
     2026-10-18 界面改版（用户裁决：按 OpenFilm skill 弹窗同构）：tab 分组
     （全部=两组分区 / 服务端 / 我的，│ 分隔）+「＋ 添加 skill」（跨视图跳
     创作模式技能市场）+ 搜索框 + 分组卡片栅格（渐变封面位=无图片资产的
     等价物，emoji 大号居中）。数据与动作不变：列服务端技能库（GET /skills），
     逐技能 安装/删除——安装=写入创作模式技能表（tintin.creationStudio.skills.v1，
     同 id 幂等）+技能包落盘，装完即可在「创作模式」用 /名称 调用；删除=按
     服务端 id 从创作技能表移除（只动安装来源 skill-srv-*，用户自建/内置芯片
     不碰）。不做服务端 DELETE——注册表共享，客户端只读服务端。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useHostDark } from '../composables/hostTheme'
import {
  type ServerSkill,
  filterGenerationSkills,
  installServerSkill,
  isServerSkillInstalled,
  parseSkillsResponse,
  removeServerSkill,
  SERVER_SKILL_ID_PREFIX,
  serverSkillHasUpdate,
  serverSkillId,
  skillMatchesQuery,
} from '../composables/skillManagerLogic'
import { loadSkills, saveSkills, type CreationSkill } from '../composables/creationStudioLogic'

/* 主题跟随宿主（2026-10-18 修正：原生信号 body[data-ds-dark-theme]，同三包
   hostTheme 口径；缺 .tintin-media-scope 令牌作用域则卡片整体透明） */
const isDark = useHostDark()

const loading = ref(false)
const error = ref('')
const skills = ref<ServerSkill[]>([])
const note = ref('')
const busyId = ref('')

const creationSkills = ref<CreationSkill[]>([])

/* ── 2026-10-18 改版：tab 分组 + 搜索 ── */
const activeTab = ref<'all' | 'server' | 'mine'>('all')
const query = ref('')
const filteredServer = computed(() => skills.value.filter((s) => skillMatchesQuery(query.value, [s.name, s.description])))
const filteredMine = computed(() => clientSkills.value.filter((c) => skillMatchesQuery(query.value, [c.name, c.template])))
/** 「＋ 添加 skill」：技能新增入口在创作模式技能市场（自定义/市场目录）——
 *  跨视图先切 chrome 再发窗口总线信号（同 openBoundTool 口径） */
function addSkill(): void {
  const activate = (window as unknown as { __tintinActivateView?: (id: string) => void }).__tintinActivateView
  activate?.('creation')
  window.__tintinBus?.emit('tintin:open-market')
}

function bridge(): Record<string, (path: string) => Promise<unknown>> {
  const s = (globalThis as unknown as { tintin?: { server?: Record<string, (...a: unknown[]) => Promise<unknown>> } }).tintin?.server
  if (!s) throw new Error('window.tintin.server 桥不可用（宿主未注入）')
  return s as Record<string, (path: string) => Promise<unknown>>
}

function syncInstalled(): void {
  creationSkills.value = loadSkills()
}

async function refresh(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    syncInstalled()
    const res = await bridge().get('/skills')
    // 创作模式只承载生成素材类技能（2026-10-21 用户裁决）；全量仍在视频剪辑会话
    skills.value = filterGenerationSkills(parseSkillsResponse(res))
    // 无生成素材类技能时给出可执行的指引，而不是一张空表
    if (!skills.value.length) error.value = '暂无生成素材类技能：服务端注册时请给技能打上 generation / 生成 / 素材 等 tag'
  } catch (e) {
    error.value = (e as Error).message || '服务端不可达'
    skills.value = []
  } finally {
    loading.value = false
  }
}

function installed(id: string): boolean {
  return isServerSkillInstalled(id, creationSkills.value)
}

/** 已装版本落后于服务端注册表（2026-10-29 用户裁决：版本检查+一键更新） */
function hasUpdate(skill: ServerSkill): boolean {
  return serverSkillHasUpdate(skill, creationSkills.value)
}

async function install(skill: ServerSkill): Promise<void> {
  if (busyId.value) return
  busyId.value = skill.id
  const wasInstalled = installed(skill.id)
  try {
    // 安装升级（2026-10-16 用户裁决）=真技能包落盘+真实指令注册一体：宿主拉
    // GET /skills/{id}/download 解压到 <DSH_HOME>/creation-skills/<id>/（2026-10-31 收紧裁决:
    // 创作专属装位,重装覆盖），
    // 并带回 SKILL.md 正文——/技能名 发送即按完整说明书执行（当晚二次裁决）
    const r = await (globalThis as unknown as {
      tintin?: { server?: { skillsInstall?: (id: string) => Promise<{ error?: string; dir?: string; skillMd?: boolean; skillMdContent?: string }> } }
    }).tintin?.server?.skillsInstall?.(skill.id)
    const full = (r && !r.error && r.skillMdContent) || ''
    const pkgNote = r && !r.error
      ? `；技能包已落盘 ${r.dir}${r.skillMd ? '' : '（警告：包内缺 SKILL.md，harness 可能不识别）'}${full ? '，按完整说明书执行' : '，按注册表简介执行（包内无 SKILL.md 正文）'}`
      : `；技能包落盘失败：${r?.error || '桥不可用'}（技能按注册表简介注册可用）`
    saveSkills(installServerSkill(skill, loadSkills(), full))
    syncInstalled()
    note.value = `${wasInstalled ? '已更新' : '已安装'}「${skill.name}」${skill.version ? `（v${skill.version}）` : ''}——创作模式输入 /${skill.name} 调用${pkgNote}`
  } catch (e) {
    note.value = `安装失败：${(e as Error).message}`
  } finally {
    busyId.value = ''
  }
}

function remove(skill: ServerSkill): void {
  if (busyId.value) return
  busyId.value = skill.id
  try {
    saveSkills(removeServerSkill(skill.id, loadSkills()))
    syncInstalled()
    note.value = `已删除「${skill.name}」`
  } catch (e) {
    note.value = `删除失败：${(e as Error).message}`
  } finally {
    busyId.value = ''
  }
}

const installedCount = computed(() => skills.value.filter((s) => installed(s.id)).length)

/** 客户端技能（2026-10-16 用户裁决：两类分组）=创作技能表里非服务端派生的条目（内置+自定义） */
const clientSkills = computed(() => creationSkills.value.filter((s) => !s.id.startsWith(SERVER_SKILL_ID_PREFIX)))

/* ── 详情弹窗（2026-10-30 用户裁决：每卡「详情」按钮，展示该技能全部信息） ── */
type SkillDetail = { kind: 'server'; skill: ServerSkill } | { kind: 'mine'; skill: CreationSkill }
const detail = ref<SkillDetail | null>(null)
function closeDetail(): void { detail.value = null }
function onDetailKey(e: KeyboardEvent): void { if (e.key === 'Escape') closeDetail() }
/** 已安装条目（取本地版本号展示） */
function installedEntry(id: string): CreationSkill | undefined {
  return creationSkills.value.find((s) => s.id === serverSkillId(id))
}
/** 注册时间展示：epoch 秒数→本地时间；其余（ISO/缺省）原样或未记录 */
function formatTime(v: string | undefined): string {
  const text = String(v ?? '').trim()
  const n = Number(text)
  if (text && Number.isFinite(n) && n > 0) return new Date(n * 1000).toLocaleString('zh-CN')
  return text || '（未记录）'
}
function backendLabel(c: CreationSkill): string {
  return c.backend === 'voiceover' ? '口播' : c.backend === 'copy' ? '复制' : 'LLM'
}

onMounted(() => {
  void refresh()
  window.addEventListener('keydown', onDetailKey)
})
onUnmounted(() => window.removeEventListener('keydown', onDetailKey))
</script>

<template>
  <!-- tintin-media-scope：搬运 tokens/global css 的作用域根（同 App/OpsApp/CreationStudio） -->
  <div class="tintin-media-scope skm" :class="{ dark: isDark }">
    <div class="page">
      <div class="head">
        <div class="title">技能管理</div>
        <div class="sub">服务端技能库（{{ skills.length }}）· 已安装 {{ installedCount }} · 我的技能 {{ clientSkills.length }} —— 安装后在「创作模式」输入 /技能名 调用</div>
      </div>

      <!-- 工具行（改版同构：tab 分组│我的 ‖ ＋添加 skill + 搜索 + 刷新） -->
      <div class="toolbar">
        <div class="tabs" role="tablist">
          <button type="button" class="tab" :class="{ 'is-active': activeTab === 'all' }" @click="activeTab = 'all'">全部</button>
          <button type="button" class="tab" :class="{ 'is-active': activeTab === 'server' }" @click="activeTab = 'server'">服务端</button>
          <span class="tab-sep" />
          <button type="button" class="tab" :class="{ 'is-active': activeTab === 'mine' }" @click="activeTab = 'mine'">我的</button>
          <span class="tab-info" title="安装=写入创作模式技能表并落盘技能包，输入 /技能名 调用；删除=仅移除安装来源条目。服务端注册表共享，客户端只读。">ⓘ</span>
        </div>
        <span class="spacer" />
        <button type="button" class="add-btn" title="到创作模式 · 技能市场添加自定义技能" @click="addSkill">＋ 添加 skill</button>
        <label class="search">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" /><path d="m10.6 10.6 3 3" />
          </svg>
          <input v-model="query" placeholder="搜索 skill">
        </label>
        <button type="button" class="refresh" :disabled="loading" title="重新拉取服务端技能库" @click="refresh">{{ loading ? '…' : '刷新' }}</button>
      </div>
      <div v-if="note" class="note">{{ note }}</div>
      <div v-if="error" class="banner error">加载失败：{{ error }}</div>

      <!-- 服务端技能库（全部/服务端 tab 可见） -->
      <template v-if="activeTab !== 'mine'">
        <div class="section-title">服务端技能</div>
        <div v-if="!loading && !error && skills.length === 0" class="banner">服务端技能库为空（或不可达）——点「刷新」重试。</div>
        <div v-else-if="filteredServer.length === 0" class="banner">没有匹配「{{ query }}」的服务端技能。</div>
        <div v-else class="grid">
          <div v-for="s in filteredServer" :key="s.id" class="card">
            <div class="cover">
              <span class="cover-emoji">🧩</span>
              <span v-if="hasUpdate(s)" class="cover-badge is-update" title="服务端有更新版本——点「更新」覆盖本地">⟳ 有新版本</span>
              <span v-else-if="installed(s.id)" class="cover-badge">✓ 已安装</span>
            </div>
            <div class="card-body">
              <div class="card-name">{{ s.name }}</div>
              <div class="card-chips">
                <span v-if="s.version" class="chip">v{{ s.version }}</span>
                <span class="chip" :title="'执行方：' + (s.executor || 'client_tool')">{{ s.executor || 'client_tool' }}</span>
              </div>
              <div class="card-desc" :title="s.description">{{ s.description || '（无描述）' }}</div>
            </div>
            <div class="card-foot">
              <button type="button" class="btn ghost" title="查看此技能的全部信息" @click="detail = { kind: 'server', skill: s }">详情</button>
              <button v-if="hasUpdate(s)" type="button" class="btn primary" :disabled="busyId === s.id" @click="install(s)">
                {{ busyId === s.id ? '更新中…' : '更新' }}
              </button>
              <button v-if="!installed(s.id)" type="button" class="btn primary" :disabled="busyId === s.id" @click="install(s)">
                {{ busyId === s.id ? '安装中…' : '安装' }}
              </button>
              <button v-else type="button" class="btn danger" :disabled="busyId === s.id" @click="remove(s)">
                {{ busyId === s.id ? '处理中…' : '删除' }}
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- 我的技能（全部/我的 tab 可见）=创作技能表内置+自定义 -->
      <template v-if="activeTab !== 'server'">
        <div class="section-title">我的技能</div>
        <div v-if="filteredMine.length === 0" class="banner">
          {{ query ? `没有匹配「${query}」的技能。` : '客户端暂无技能（内置芯片被清空且无自定义）——点「＋ 添加 skill」去添加。' }}
        </div>
        <div v-else class="grid">
          <div v-for="c in filteredMine" :key="c.id" class="card">
            <div class="cover"><span class="cover-emoji">{{ c.emoji || '🧩' }}</span></div>
            <div class="card-body">
              <div class="card-name">/{{ c.name }}</div>
              <div class="card-chips">
                <span class="chip">{{ c.builtin ? '内置' : '自定义' }}</span>
                <span class="chip">{{ c.backend === 'voiceover' ? '口播' : c.backend === 'copy' ? '复制' : 'LLM' }}</span>
                <span v-if="c.tool" class="chip" title="绑定媒体工具卡">直达工具</span>
              </div>
              <div class="card-desc" :title="c.template">{{ c.template }}</div>
            </div>
            <div class="card-foot">
              <button type="button" class="btn ghost" title="查看此技能的全部信息" @click="detail = { kind: 'mine', skill: c }">详情</button>
            </div>
          </div>
        </div>
      </template>

      <!-- 技能详情弹窗：注册表/本地技能表可见的全部字段（Esc/遮罩/✕ 关闭） -->
      <div v-if="detail" class="modal-mask" @click.self="closeDetail">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-head">
            <div class="modal-title">{{ detail.kind === 'server' ? detail.skill.name : `/${detail.skill.name}` }}</div>
            <button type="button" class="modal-close" title="关闭" @click="closeDetail">✕</button>
          </div>
          <div class="modal-body">
            <template v-if="detail.kind === 'server'">
              <div class="row"><span class="row-key">名称</span><span class="row-val">{{ detail.skill.name }}</span></div>
              <div class="row"><span class="row-key">ID</span><span class="row-val mono">{{ detail.skill.id }}</span></div>
              <div class="row"><span class="row-key">版本</span><span class="row-val">{{ detail.skill.version ? `v${detail.skill.version}` : '（未标注）' }}</span></div>
              <div class="row"><span class="row-key">执行方</span><span class="row-val">{{ detail.skill.executor || 'client_tool' }}</span></div>
              <div class="row"><span class="row-key">标签</span><span class="row-val"><span v-for="t in detail.skill.tags" :key="t" class="chip">{{ t }}</span><span v-if="!detail.skill.tags.length">（无）</span></span></div>
              <div class="row"><span class="row-key">注册者</span><span class="row-val">{{ detail.skill.registeredBy || '（未记录）' }}</span></div>
              <div class="row"><span class="row-key">注册时间</span><span class="row-val">{{ formatTime(detail.skill.createdAt) }}</span></div>
              <div class="row"><span class="row-key">安装状态</span>
                <span class="row-val">
                  <template v-if="hasUpdate(detail.skill)">已安装 v{{ installedEntry(detail.skill.id)?.version || '?' }}——服务端有新版本 v{{ detail.skill.version }}，点卡片「更新」升级</template>
                  <template v-else-if="installed(detail.skill.id)">已安装{{ installedEntry(detail.skill.id)?.version ? ` v${installedEntry(detail.skill.id)?.version}` : '' }}</template>
                  <template v-else>未安装</template>
                </span>
              </div>
              <div class="row"><span class="row-key">调用方式</span><span class="row-val">「创作模式」输入 <b>/{{ detail.skill.name }}</b> 调用（安装后）</span></div>
              <div class="row"><span class="row-key">安装位置</span><span class="row-val mono">{{ installed(detail.skill.id) ? `技能主目录 /skills/${detail.skill.id}/` : '—（未安装）' }}</span></div>
              <div class="row"><span class="row-key">描述</span><span class="row-val">{{ detail.skill.description || '（无描述）' }}</span></div>
              <div class="row"><span class="row-key">指令正文</span><pre class="row-pre">{{ detail.skill.instruction || '（注册表无指令正文）' }}</pre></div>
            </template>
            <template v-else>
              <div class="row"><span class="row-key">名称</span><span class="row-val">/{{ detail.skill.name }}</span></div>
              <div class="row"><span class="row-key">类型</span><span class="row-val">{{ detail.skill.builtin ? '内置' : '自定义' }}</span></div>
              <div class="row"><span class="row-key">执行后端</span><span class="row-val">{{ backendLabel(detail.skill) }}</span></div>
              <div v-if="detail.skill.tool" class="row"><span class="row-key">直达工具</span><span class="row-val">{{ detail.skill.tool }}</span></div>
              <div v-if="detail.skill.version" class="row"><span class="row-key">版本</span><span class="row-val">v{{ detail.skill.version }}</span></div>
              <div class="row"><span class="row-key">调用方式</span><span class="row-val">「创作模式」输入 <b>/{{ detail.skill.name }}</b> 调用</span></div>
              <div class="row"><span class="row-key">模板全文</span><pre class="row-pre">{{ detail.skill.template }}</pre></div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { width: 100%; min-height: 100%; padding: var(--space-6); box-sizing: border-box; }
.head { margin-bottom: var(--space-4); }
.title { margin: 0 0 var(--space-1); font-size: 24px; font-weight: 700; line-height: 1.2; color: var(--foreground); }
.sub { margin: 0; font-size: var(--font-size-body); color: var(--muted-foreground); }

/* 工具行：tab 组（激活=药丸描边）│分隔‖ 右簇 添加+搜索+刷新（2026-10-18 改版） */
.toolbar { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); flex-wrap: wrap; }
.spacer { flex: 1 1 auto; }
.tabs { display: flex; align-items: center; gap: 2px; }
.tab { border: 1px solid transparent; background: transparent; color: var(--muted-foreground); font: inherit; font-size: 13px; padding: 5px 14px; border-radius: 999px; cursor: pointer; }
.tab:hover { color: var(--foreground); }
.tab.is-active { background: var(--surface); border-color: var(--border); color: var(--foreground); font-weight: 600; }
.tab-sep { width: 1px; height: 14px; background: var(--border); margin: 0 8px; }
.tab-info { font-size: 12px; color: var(--muted-foreground); cursor: help; margin-left: 2px; }
.add-btn {
  border: 1px solid var(--border); background: var(--card); color: var(--foreground);
  border-radius: 999px; padding: 6px 14px; font: inherit; font-size: 13px; cursor: pointer;
}
.add-btn:hover { border-color: var(--primary); color: var(--primary); }
.search {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--border); background: var(--surface); color: var(--muted-foreground);
  border-radius: 999px; padding: 6px 12px; min-width: 180px;
}
.search input { border: none; outline: none; background: transparent; color: var(--foreground); font: inherit; font-size: 13px; width: 100%; }
.refresh {
  border: 1px solid var(--border); background: var(--card); color: var(--foreground);
  border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 13px; cursor: pointer;
}
.refresh:disabled { opacity: 0.6; cursor: default; }
.note { font-size: 12px; color: var(--muted-foreground); margin-bottom: var(--space-3); }

.banner {
  border: 1px dashed var(--border); border-radius: var(--radius-md);
  padding: 12px 14px; margin: var(--space-2) 0 var(--space-4);
  font-size: var(--font-size-body); color: var(--muted-foreground);
}
.banner.error { color: var(--danger, #e74c3c); border-color: var(--danger, #e74c3c); }

.section-title { margin: var(--space-4) 0 var(--space-2); font-size: var(--font-size-body); font-weight: 700; color: var(--foreground); }
/* 卡片栅格（OpenFilm 同构：封面 16:9 + 标题 + 两行描述） */
.grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
.card {
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-xl);
}
.cover {
  position: relative; aspect-ratio: 16 / 9; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 16%, var(--surface)), var(--surface) 65%);
  border-bottom: 1px solid var(--border);
}
.cover-emoji { font-size: 40px; line-height: 1; filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.18)); }
.cover-badge {
  position: absolute; top: 8px; right: 8px; font-size: 11px; font-weight: 600;
  color: var(--primary); background: color-mix(in srgb, var(--primary) 14%, var(--card));
  border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent); border-radius: 999px; padding: 1px 8px;
}
/* 有新版本角标（2026-10-29 用户裁决：版本检查+一键更新）——暖色与「已安装」区分 */
.cover-badge.is-update {
  color: var(--warning, #e8890c); background: color-mix(in srgb, var(--warning, #e8890c) 14%, var(--card));
  border-color: color-mix(in srgb, var(--warning, #e8890c) 40%, transparent);
}
.card-body { flex: 1 1 auto; min-width: 0; padding: 10px 12px 0; }
.card-name { font-size: var(--font-size-h4); font-weight: 700; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-chips { display: flex; gap: var(--space-1); flex-wrap: wrap; margin-top: 4px; }
.chip { font-size: 11px; color: var(--muted-foreground); background: rgba(127, 127, 127, 0.14); border-radius: 999px; padding: 1px 8px; }
.card-desc {
  margin-top: 6px; font-size: var(--font-size-body); line-height: var(--line-height-body);
  color: var(--muted-foreground);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.card-foot { padding: 10px 12px 12px; display: flex; justify-content: flex-end; gap: var(--space-2); }
.btn { font: inherit; border-radius: var(--radius-md); padding: 5px 16px; cursor: pointer; border: 1px solid transparent; }
.btn:disabled { opacity: 0.6; cursor: default; }
.btn.primary { background: var(--primary); color: var(--primary-foreground); }
.btn.danger { background: transparent; color: var(--danger, #e74c3c); border-color: var(--danger, #e74c3c); }
.btn.ghost { background: transparent; color: var(--foreground); border-color: var(--border); }
.btn.ghost:hover { border-color: var(--primary); color: var(--primary); }

/* 详情弹窗（2026-10-30 用户裁决）：遮罩+居中面板，键值行+指令正文/模板全文块 */
.modal-mask {
  position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.modal {
  width: min(680px, calc(100vw - 48px)); max-height: 82vh; display: flex; flex-direction: column;
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-xl);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
}
.modal-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: 12px 16px; border-bottom: 1px solid var(--border); }
.modal-title { font-size: var(--font-size-h4); font-weight: 700; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.modal-close { border: none; background: transparent; color: var(--muted-foreground); font: inherit; font-size: 14px; cursor: pointer; padding: 4px 8px; border-radius: var(--radius-md); }
.modal-close:hover { color: var(--foreground); }
.modal-body { overflow: auto; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 8px; }
.row { display: grid; grid-template-columns: 76px 1fr; gap: 10px; align-items: baseline; }
.row-key { font-size: 12px; color: var(--muted-foreground); }
.row-val { font-size: var(--font-size-body); color: var(--foreground); min-width: 0; overflow-wrap: anywhere; }
.row-val.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.row-val b { color: var(--primary); }
.row-val .chip { margin-right: 4px; }
.row-pre {
  margin: 0; padding: 8px 10px; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-md); font-size: 12px; line-height: 1.6; color: var(--foreground);
  white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow: auto;
}
</style>
