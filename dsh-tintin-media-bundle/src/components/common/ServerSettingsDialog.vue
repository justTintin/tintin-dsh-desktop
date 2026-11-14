<!-- ServerSettingsDialog — 服务设置弹层（2026-11-14 用户裁决：素材创作/运营工具/
     媒体工具三面各配「本面」服务端地址；界面=封面制作 server-settings.tsx 同款双栏
     （2026-10-29 左右布局 + 2026-11-03 尺寸/关闭钮裁决）：左=地址表单+保存+MCP
     发现+连接状态，右=发现的 MCP 服务清单。三包字节副本（TButton 先例）。
     地址写 tintin/config.json 顶层 <surface>.serverUrl（window.tintin.config，经本包
     构建期分面重写自动携带本面调用面），空=清空、回落全局 server.url；仅改本面。
     MCP 自动发现复用封面插件路由（显式 serverUrl 覆盖，与面无关）：POST
     /tintin/ipc/cover/mcp/discover（对 <地址>/mcp 走 initialize→tools/list，成功
     覆写 tintin/mcp-discover-cache.json），GET /tintin/ipc/cover/server-config
     带回缓存清单；挂载本身仍在会话创建时按地址自动完成，此处是可视与验货。 -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { globalServerUrl, normalizeServerUrl, surfaceServerUrl } from './serverSettingsLogic'

const props = defineProps<{ visible: boolean; surface: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

/** 桥 config 通道（0.1.7 自有存储 tintin/config.json）。三包 ambient 类型形状不一
 *  （media=SRC 旧形状 get(key)/set、creation 无 config 成员、ops 无 d.ts），在此
 *  显式收敛：无参 get()=自有存储∪profile config 合并视图 {value}；merge=深合并落盘。 */
type BridgeConfigChannel = {
  get?: () => Promise<{ value?: unknown }>
  merge?: (patch: Record<string, unknown>) => Promise<unknown>
}
const configChannel = (): BridgeConfigChannel | undefined =>
  (window as unknown as { tintin?: { config?: BridgeConfigChannel } }).tintin?.config

const url = ref('')
const loaded = ref(false)
const busy = ref<'' | 'save' | 'discover'>('')
const refreshing = ref(false)
const message = ref('')
const messageOk = ref(false)
const tools = ref<Array<{ name: string; description: string }>>([])
const mcpUrl = ref('')
const globalHint = ref('')

const discoverInto = (target: string, quiet: boolean): Promise<void> =>
  new Promise((resolve) => {
    fetch('/tintin/ipc/cover/mcp/discover', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serverUrl: target }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) {
          tools.value = Array.isArray(j.tools) ? j.tools : []
          mcpUrl.value = String(j.mcpUrl ?? '')
          messageOk.value = true
          message.value = `已连接 ${j.mcpUrl}，自动发现 ${j.count} 个 MCP 服务。`
        } else if (!quiet) {
          messageOk.value = false
          message.value = `获取失败：${j?.error ?? '未知错误'}`
        } else if (tools.value.length) {
          messageOk.value = true
          message.value = `已显示上次发现的结果（${tools.value.length} 条）——自动刷新失败：${j?.error ?? '未知错误'}`
        }
      })
      .catch((e) => {
        if (!quiet) { messageOk.value = false; message.value = `获取失败：${e instanceof Error ? e.message : String(e)}` }
      })
      .finally(resolve)
  })

const load = (): void => {
  loaded.value = false
  message.value = ''
  configChannel()?.get?.().then((res) => {
    const value: unknown = (res as { value?: unknown } | null)?.value
    url.value = surfaceServerUrl(value, props.surface)
    const globalUrl = globalServerUrl(value)
    globalHint.value = globalUrl ? `（当前全局：${globalUrl}）` : ''
    loaded.value = true
    // 缓存回显 + 静默自动刷新一次（2026-10-29 封面二次裁决同款：不打断输入，失败留缓存清单）
    fetch('/tintin/ipc/cover/server-config')
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) return
        const cache = j.mcpCache
        if (cache && Array.isArray(cache.tools) && cache.tools.length) {
          tools.value = cache.tools
          mcpUrl.value = String(cache.mcpUrl ?? '')
        }
        const effective = url.value.trim() || String(j.serverUrl ?? '')
        if (effective) {
          refreshing.value = true
          void discoverInto(effective, true).finally(() => { refreshing.value = false })
        }
      })
      .catch(() => {})
  }).catch((e: unknown) => {
    message.value = `读取配置失败：${e instanceof Error ? e.message : String(e)}`
    messageOk.value = false
    loaded.value = true
  })
}

watch(() => props.visible, (visible) => { if (visible) load() })

/** 保存本面地址（normalized 空串=清空回落全局）；连接状态由「获取 MCP 服务」给出。 */
const save = (): void => {
  const normalized = normalizeServerUrl(url.value)
  if (normalized === null) {
    messageOk.value = false
    message.value = '地址需形如 http://<主机>:<端口>'
    return
  }
  busy.value = 'save'
  message.value = ''
  configChannel()?.merge?.({ [props.surface]: { serverUrl: normalized } })
    .then(() => {
      url.value = normalized
      messageOk.value = true
      message.value = normalized
        ? '已保存。本面之后的服务端调用即用新地址，正在运行中的任务不变。'
        : '已清空：本面回落全局服务端地址。'
    })
    .catch((e: unknown) => {
      messageOk.value = false
      message.value = `保存失败：${e instanceof Error ? e.message : String(e)}`
    })
    .finally(() => { busy.value = '' })
}

const discover = (): void => {
  busy.value = 'discover'
  message.value = ''
  void discoverInto(url.value.trim(), false).finally(() => { busy.value = '' })
}
</script>

<template>
  <div v-if="visible" class="ssd-mask" @click.self="emit('close')">
    <!-- 弹层尺寸=技能弹窗/封面服务设置同款（2026-11-03 裁决）；内容左右布局 -->
    <div class="ssd-card" role="dialog" aria-modal="true" aria-label="服务设置">
      <div class="ssd-head">
        <span class="ssd-title">服务设置</span>
        <button type="button" class="ssd-close" title="关闭" aria-label="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div class="ssd-body">
        <div class="ssd-left">
          <p class="ssd-note">
            本工具面独立的服务端地址：留空 = 跟随全局服务端地址{{ globalHint }}；保存后本面的
            服务端调用立即改用新地址，其他工具面与封面/视频剪辑不受影响。本面会话的 MCP 工具
            在会话创建时按此地址自动挂载。
          </p>
          <label class="ssd-label" for="ssd-url">服务端地址</label>
          <input
            id="ssd-url" v-model="url" class="ssd-input" type="text" autocomplete="off" spellcheck="false"
            placeholder="http://192.168.x.x:8000" :disabled="busy !== '' || !loaded" @keydown.enter.prevent="discover"
          />
          <div class="ssd-actions">
            <button type="button" class="ssd-btn ssd-btn--primary" :disabled="busy !== '' || !loaded" @click="save">
              {{ busy === 'save' ? '保存中…' : '保存地址' }}
            </button>
            <button type="button" class="ssd-btn ssd-btn--ghost" :disabled="busy !== '' || !loaded || !url.trim()" @click="discover">
              {{ busy === 'discover' ? '获取中…' : '获取 MCP 服务' }}
            </button>
          </div>
          <p v-if="message" class="ssd-msg" :class="messageOk ? 'ssd-msg--ok' : 'ssd-msg--err'">{{ message }}</p>
        </div>
        <div class="ssd-right">
          <div class="ssd-list-head">
            发现的 MCP 服务（{{ tools.length }}）<span v-if="refreshing"> · 正在刷新…</span>
            <span v-if="mcpUrl" class="ssd-list-url"> · {{ mcpUrl }}</span>
          </div>
          <div v-if="tools.length" class="ssd-list">
            <div v-for="t in tools" :key="t.name" class="ssd-tool">
              <div class="ssd-tool-name">{{ t.name }}</div>
              <div v-if="t.description" class="ssd-tool-desc">{{ t.description }}</div>
            </div>
          </div>
          <div v-else class="ssd-empty">
            {{ loaded ? '还没有发现记录——填好服务端地址后点「获取 MCP 服务」。' : '正在加载…' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ssd-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal, 1300);
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ssd-card {
  width: min(1200px, calc(100vw - 64px));
  height: min(800px, calc(100vh - 80px));
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-3);
  overflow: hidden;
}
.ssd-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 14px 18px 0;
  flex-shrink: 0;
}
.ssd-title {
  flex: 1;
  font-size: 16px;
  font-weight: 800;
  color: var(--foreground);
}
.ssd-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  border-radius: var(--radius-md);
  color: var(--muted-foreground);
  cursor: pointer;
}
.ssd-close:hover {
  color: var(--foreground);
  background: var(--surface-container);
}
.ssd-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.ssd-left {
  width: 300px;
  flex-shrink: 0;
  padding: 12px 22px 22px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.ssd-note {
  margin: 0 0 var(--space-4);
  font-size: 12px;
  line-height: 1.7;
  color: var(--muted-foreground);
}
.ssd-label {
  margin-bottom: var(--space-2);
  font-size: 12px;
  font-weight: 700;
  color: var(--foreground);
}
.ssd-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--surface-container);
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
}
.ssd-input:focus {
  border-color: var(--primary);
}
.ssd-actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-3);
}
.ssd-btn {
  flex: 1;
  padding: 8px 0;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border: 0;
}
.ssd-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.ssd-btn--primary {
  background: var(--primary);
  color: var(--primary-foreground);
}
.ssd-btn--ghost {
  background: transparent;
  color: var(--muted-foreground);
  border: 1px solid var(--border);
}
.ssd-btn--ghost:hover:not(:disabled) {
  color: var(--foreground);
  border-color: var(--primary);
}
.ssd-msg {
  margin: var(--space-3) 0 0;
  font-size: 12px;
  line-height: 1.7;
  word-break: break-all;
}
.ssd-msg--ok {
  color: var(--primary);
}
.ssd-msg--err {
  color: var(--danger);
}
.ssd-right {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 12px 22px 22px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.ssd-list-head {
  font-size: 12px;
  font-weight: 700;
  color: var(--foreground);
  margin-bottom: var(--space-2);
}
.ssd-list-url {
  font-weight: 400;
  color: var(--muted-foreground);
}
.ssd-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}
.ssd-tool {
  flex-shrink: 0;
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 6px 10px;
}
.ssd-tool-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
}
.ssd-tool-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted-foreground);
  margin-top: 2px;
}
.ssd-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 12px;
  line-height: 1.8;
  color: var(--muted-foreground);
}
</style>
