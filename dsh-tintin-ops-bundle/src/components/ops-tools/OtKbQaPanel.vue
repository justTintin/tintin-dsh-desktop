<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// OtKbQaPanel.vue — 智能问答系统（运营工具 · 产品知识组）
// 2026-11-08 用户裁决：进入后加载服务端的 kb 问答前端（iframe 嵌入）。
// 地址链（1108 实测）：主服务 GET /system/kb/status → { port, reachable,
// unit_active }（独立 systemd 单元，engine=dify）→ 前端页 =
// http://<server-host>:<port>/static/kb-app/index.html#/data-record/index
// （8787 实测 307 → 该页 200 HTML）。服务端地址经 env.serverPing 取回，
// 与 OtProductLibrary 同口径；iframe 无 CSP 限制（宿主 chrome 无 frame-src）。
// 分层（IRON-06）：本组件只编排取址 + 绘制 iframe，无业务逻辑。
// ═══════════════════════════════════════════════════════════════
import { onMounted, ref } from 'vue'

const loading = ref(true)
const error = ref('')
const kbUrl = ref('')

async function loadKbUrl(): Promise<void> {
  loading.value = true
  error.value = ''
  kbUrl.value = ''
  try {
    const t = (window as unknown as {
      tintin?: {
        env?: { serverPing?: () => Promise<{ url?: unknown }> }
        server?: { get?: (path: string, query?: Record<string, unknown>) => Promise<unknown> }
      }
    }).tintin
    const ping = await t?.env?.serverPing?.()
    const base = String(ping?.url || '').trim().replace(/\/$/, '')
    if (!base) throw new Error('服务端地址未配置（env.serverPing 无返回）')
    const status = (await t?.server?.get?.('/system/kb/status')) as {
      config_enabled?: boolean
      port?: number
      unit_active?: boolean
      reachable?: boolean
      probe?: { reachable?: boolean }
    } | null
    if (!status || typeof status.port !== 'number') throw new Error('kb 服务状态不可读（/system/kb/status 无 port）')
    if (status.reachable === false || status.probe?.reachable === false) throw new Error('kb 问答服务未运行（服务端 reachable=false）')
    const origin = new URL(base)
    kbUrl.value = `${origin.protocol}//${origin.hostname}:${status.port}/static/kb-app/index.html#/data-record/index`
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadKbUrl() })
</script>

<template>
  <div class="kbqa">
    <div v-if="loading" class="kbqa-state">正在连接服务端 kb 问答前端…</div>
    <div v-else-if="error" class="kbqa-state kbqa-state--error">
      <span>{{ error }}</span>
      <button type="button" class="kbqa-retry" @click="loadKbUrl()">重试</button>
    </div>
    <iframe
      v-else-if="kbUrl"
      class="kbqa-frame"
      :src="kbUrl"
      title="智能问答系统"
    />
  </div>
</template>

<style scoped>
/* 组件根占满 .tool-body（OpsApp 方案1骨架：页头固定+本层内滚）；
   iframe 铺满自身区域，不产生外层滚动 */
.kbqa {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.kbqa-frame {
  flex: 1 1 auto;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-container);
  min-height: 0;
}
.kbqa-state {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  font-size: var(--font-size-body);
  color: var(--muted-foreground);
}
.kbqa-state--error { color: var(--destructive, #e5484d); }
.kbqa-retry {
  height: 30px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-container);
  color: var(--foreground);
  cursor: pointer;
}
.kbqa-retry:hover { border-color: var(--primary); color: var(--primary); }
</style>
