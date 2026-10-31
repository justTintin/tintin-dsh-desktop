<!-- CreationBackend.vue — 创作模式·后端切换（2026-10-25 用户裁决：双后端）
     「TinTin 服务」（原链路，缺省）⇄「即梦 CLI」（本机 dreamina 真生成）。
     自包含独立域（同 CreationReferences/CreationHistory 先例，独立域不与宿主
     视图文件交织）：pill + 下拉菜单 + CLI 状态行（版本/登录态/积分）+ OAuth
     设备码登录引导（loginHeadless 取材料 → 用户网页授权 → loginCheck 收尾，
     2026-10-25 实测流程）。池状态归父层：只 emit change/notice，不持偏好。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getTintin } from '../composables/creationServer'
import { TinIcon } from './tinIcons'
import {
  CREATION_BACKENDS,
  backendLabel,
  type CreationBackendId,
} from '../composables/creationDreaminaLogic'

const props = defineProps<{
  backend: CreationBackendId
  disabled?: boolean
}>()

const emit = defineEmits<{
  change: [id: CreationBackendId]
  notice: [text: string, ok: boolean]
}>()

/* ── 下拉菜单（点一次开、再点关 + 点击外部收起，同 2026-10-30 菜单口径） ── */
const menuOpen = ref(false)
function toggleMenu(): void {
  if (props.disabled) return
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) void refreshStatus()
}
function onDocPointerDown(e: PointerEvent): void {
  const t = e.target as HTMLElement | null
  if (t?.closest('.backend-root')) return
  menuOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown))

/* ── CLI 状态（菜单打开/操作后拉取；不阻塞菜单渲染） ── */
interface DreaminaStatus {
  available?: boolean
  version?: string
  loggedIn?: boolean
  credit?: number
  vipLevel?: string
  error?: string
}
const status = ref<DreaminaStatus | null>(null)
const statusLoading = ref(false)
async function refreshStatus(): Promise<void> {
  const t = getTintin()
  if (!t?.server?.dreaminaStatus) { status.value = { available: false, error: '宿主桥未就绪' }; return }
  statusLoading.value = true
  try {
    const res = await t.server.dreaminaStatus()
    status.value = res && typeof res === 'object' ? res as DreaminaStatus : { available: false, error: '状态响应异常' }
  } catch (e) {
    status.value = { available: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    statusLoading.value = false
  }
}
const statusLine = computed(() => {
  const s = status.value
  if (!s) return statusLoading.value ? '状态查询中…' : '即梦 CLI'
  if (!s.available) return `未安装 CLI${s.error && s.error !== '未登录' ? `（${s.error}）` : ''}`
  const ver = s.version ? `v${s.version}` : ''
  if (!s.loggedIn) return `${ver} · 未登录`
  return `${ver} · 已登录${s.vipLevel ? `（${s.vipLevel}）` : ''}${Number.isFinite(s.credit) ? ` · 积分 ${s.credit}` : ''}`
})

function choose(id: CreationBackendId): void {
  menuOpen.value = false
  if (id !== props.backend) emit('change', id)
}

/* ── OAuth 设备码登录引导（2026-10-25 实测：headless 材料 → 网页授权 → checklogin） ── */
const loginOpen = ref(false)
const loginBusy = ref(false)
const loginMaterial = ref<{ verificationUri: string; userCode: string; deviceCode: string } | null>(null)
async function startLogin(): Promise<void> {
  const t = getTintin()
  if (!t?.server?.dreaminaLoginHeadless) { emit('notice', '宿主桥未就绪，无法登录', false); return }
  loginBusy.value = true
  try {
    const res = await t.server.dreaminaLoginHeadless()
    if (!res || res.error || !res.deviceCode) {
      emit('notice', `获取登录材料失败：${String(res?.error ?? '响应异常')}`, false)
      return
    }
    loginMaterial.value = { verificationUri: String(res.verificationUri ?? ''), userCode: String(res.userCode ?? ''), deviceCode: String(res.deviceCode ?? '') }
    loginOpen.value = true
  } catch (e) {
    emit('notice', `获取登录材料失败：${e instanceof Error ? e.message : String(e)}`, false)
  } finally {
    loginBusy.value = false
  }
}
async function confirmLogin(): Promise<void> {
  const material = loginMaterial.value
  if (!material || loginBusy.value) return
  const t = getTintin()
  loginBusy.value = true
  try {
    const res = await t.server.dreaminaLoginCheck({ deviceCode: material.deviceCode, poll: 120 })
    if (res && res.ok) {
      loginOpen.value = false
      loginMaterial.value = null
      emit('notice', '即梦 CLI 登录成功', true)
      void refreshStatus()
    } else {
      emit('notice', `登录未完成：${String(res?.error ?? res?.stderr ?? '等待授权超时，可重试')}`, false)
    }
  } catch (e) {
    emit('notice', `登录失败：${e instanceof Error ? e.message : String(e)}`, false)
  } finally {
    loginBusy.value = false
  }
}
async function logout(): Promise<void> {
  const t = getTintin()
  if (!t?.server?.dreaminaLogout) return
  const res = await t.server.dreaminaLogout().catch(() => null)
  emit('notice', res?.ok ? '已退出即梦登录' : '退出失败（可重试）', Boolean(res?.ok))
  void refreshStatus()
}
</script>

<template>
  <span class="backend-root">
    <button type="button" class="toolbar-item" :class="{ 'is-open': menuOpen }" :disabled="disabled" @click="toggleMenu">
      <TinIcon icon="backend" />
      <span>{{ backendLabel(backend) }}</span><span class="spark">✦</span>
    </button>
    <div v-if="menuOpen" class="menu menu-backend">
      <div class="menu-title">发送后端</div>
      <div class="menu-list">
        <button v-for="b in CREATION_BACKENDS" :key="b.id" type="button" class="menu-item" :class="{ 'is-picked': b.id === backend }" @click="choose(b.id)">
          <span class="menu-name">{{ b.label }}</span>
          <span v-if="b.id === backend" class="menu-check">✓</span>
        </button>
      </div>
      <div class="menu-desc">{{ CREATION_BACKENDS.find((b) => b.id === backend)?.desc }}</div>
      <div class="menu-foot">
        <span class="status-line" :class="{ 'is-warn': status && (!status.available || !status.loggedIn) }">{{ statusLine }}</span>
        <span class="foot-ops">
          <button v-if="status?.available && !status?.loggedIn" type="button" class="mini is-primary" :disabled="loginBusy" @click="startLogin">登录</button>
          <button v-if="status?.available && status?.loggedIn" type="button" class="mini" @click="logout">退出</button>
          <button type="button" class="mini" @click="refreshStatus">刷新</button>
        </span>
      </div>
    </div>

    <!-- 设备码登录引导浮层 -->
    <div v-if="loginOpen" class="mask" @click.self="loginOpen = false">
      <div class="dialog">
        <div class="dialog-head">
          <span>登录即梦（OAuth 设备码）</span>
          <button type="button" class="mini" @click="loginOpen = false">×</button>
        </div>
        <template v-if="loginMaterial">
          <p class="dialog-line">1. 打开授权页，核对用户码一致后点「确认授权」：</p>
          <a class="auth-link" :href="loginMaterial.verificationUri" target="_blank" rel="noopener">{{ loginMaterial.verificationUri || '（未取到链接，请重试）' }}</a>
          <p class="dialog-line">2. 用户码：<code class="user-code">{{ loginMaterial.userCode }}</code></p>
          <p class="dialog-line">3. 授权完成后回来点击下面的按钮收尾（10 分钟内有效）。</p>
        </template>
        <div class="dialog-ops">
          <button type="button" class="mini is-primary" :disabled="loginBusy || !loginMaterial" @click="confirmLogin">{{ loginBusy ? '等待授权…' : '我已完成授权' }}</button>
          <button type="button" class="mini" :disabled="loginBusy" @click="startLogin">重新获取</button>
        </div>
      </div>
    </div>
  </span>
</template>

<style scoped>
.backend-root { position: relative; display: inline-flex; }
/* 即梦非 Agent pill 口径（同 CreationGenParams）：中性灰白+细线图标+蓝 ✦ 角标 */
.toolbar-item { display: inline-flex; align-items: center; gap: 5px; border: none; background: transparent; color: var(--muted-foreground); font: inherit; font-size: 13px; font-weight: 500; padding: 4px 7px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.toolbar-item:hover { color: var(--foreground); background: color-mix(in srgb, var(--foreground) 6%, transparent); }
.toolbar-item.is-open { color: var(--foreground); background: color-mix(in srgb, var(--primary) 10%, transparent); }
.toolbar-item:disabled { opacity: 0.55; cursor: not-allowed; }
.toolbar-item .ti { width: 14px; height: 14px; display: block; opacity: 0.9; }
.spark { color: var(--primary); font-size: 10px; line-height: 1; margin-left: 1px; }
.menu { position: absolute; left: 0; top: calc(100% + 8px); z-index: 40; width: 300px; background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-3); overflow: hidden; text-align: left; }
.menu-title { padding: 10px 14px 2px; font-size: 12px; color: var(--muted-foreground); }
.menu-list { padding: 6px; }
.menu-item { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: transparent; color: var(--foreground); font: inherit; font-size: 14px; text-align: left; padding: 9px 10px; border-radius: 10px; cursor: pointer; }
.menu-item:hover { background: var(--surface); }
.menu-item.is-picked { color: var(--primary); font-weight: 600; }
.menu-name { flex: 1 1 auto; font-weight: 600; }
.menu-check { color: var(--primary); }
.menu-desc { padding: 0 14px 10px; font-size: 12px; line-height: 1.6; color: var(--muted-foreground); }
.menu-foot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted-foreground); }
.status-line { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-line.is-warn { color: #d97706; }
.foot-ops { display: inline-flex; gap: 6px; flex: 0 0 auto; }
.mini { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); font: inherit; font-size: 12px; padding: 3px 9px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.mini:hover { border-color: var(--primary); color: var(--primary); }
.mini:disabled { opacity: 0.55; cursor: not-allowed; }
.mini.is-primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); font-weight: 600; }
.mask { position: fixed; inset: 0; z-index: 90; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; justify-content: center; }
.dialog { width: min(92%, 460px); background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-3); padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.dialog-head { display: flex; align-items: center; justify-content: space-between; font-size: 14px; font-weight: 700; color: var(--foreground); }
.dialog-line { font-size: 13px; line-height: 1.7; color: var(--foreground); margin: 0; }
.auth-link { font-size: 12px; color: var(--primary); word-break: break-all; line-height: 1.6; }
.user-code { font-size: 13px; font-weight: 700; color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, transparent); border-radius: 6px; padding: 2px 8px; }
.dialog-ops { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
</style>
