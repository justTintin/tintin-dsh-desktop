<!-- ServerSettingsDialog — 服务设置弹层（2026-11-14 用户裁决：素材创作/运营工具/
     媒体工具三面各配「本面」服务端地址）。地址写 tintin/config.json 顶层
     <surface>.serverUrl（window.tintin.config，经本包构建期分面重写自动携带本面调用面），
     空=清空、回落全局 server.url；仅改本面。
     2026-11-25 封面制作整体删除：原「获取 MCP 服务」 discovers 复用封面插件路由
     /tintin/ipc/cover/*，随封面下线一并移除；MCP 仍在会话创建时按地址自动挂载。 -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { globalServerUrl, normalizeServerUrl, surfaceServerUrl } from './serverSettingsLogic'

const props = defineProps<{ visible: boolean; surface: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

/** 桥 config 通道（0.1.7 自有存储 tintin/config.json）。三包 ambient 类型形状不一，
 *  在此显式收敛：无参 get()=自有存储∪profile config 合并视图 {value}；merge=深合并落盘。 */
type BridgeConfigChannel = {
  get?: () => Promise<{ value?: unknown }>
  merge?: (patch: Record<string, unknown>) => Promise<unknown>
}
const configChannel = (): BridgeConfigChannel | undefined =>
  (window as unknown as { tintin?: { config?: BridgeConfigChannel } }).tintin?.config

const url = ref('')
const loaded = ref(false)
const busy = ref<'' | 'save'>('')
const message = ref('')
const messageOk = ref(false)
const globalHint = ref('')

const load = (): void => {
  loaded.value = false
  message.value = ''
  configChannel()?.get?.().then((res) => {
    const value: unknown = (res as { value?: unknown } | null)?.value
    url.value = surfaceServerUrl(value, props.surface)
    const globalUrl = globalServerUrl(value)
    globalHint.value = globalUrl ? `（当前全局：${globalUrl}）` : ''
    loaded.value = true
  }).catch((e: unknown) => {
    message.value = `读取配置失败：${e instanceof Error ? e.message : String(e)}`
    messageOk.value = false
    loaded.value = true
  })
}

watch(() => props.visible, (visible) => { if (visible) load() })

/** 保存本面地址（normalized 空串=清空回落全局）。宿主 config:merge 失败经 200 {error}
 *  透传，须显式读回比对，避免写入失败被吞成「已保存」。 */
const save = (): void => {
  const normalized = normalizeServerUrl(url.value)
  if (normalized === null) {
    messageOk.value = false
    message.value = '地址需形如 http://<主机>:<端口>'
    return
  }
  busy.value = 'save'
  message.value = ''
  const channel = configChannel()
  Promise.resolve(channel?.merge?.({ [props.surface]: { serverUrl: normalized } }))
    .then(async (j) => {
      if (j && typeof j === 'object' && 'error' in (j as Record<string, unknown>)) {
        throw new Error(String((j as Record<string, unknown>).error))
      }
      const res = await Promise.resolve(channel?.get?.())
      const written = surfaceServerUrl((res as { value?: unknown } | null)?.value, props.surface)
      if (written !== normalized) {
        throw new Error(`保存未生效：配置读回「${written || '(空)'}」≠ 写入「${normalized || '(空)'}」——请重试；反复出现请查看宿主日志`)
      }
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
</script>

<template>
  <div v-if="visible" class="ssd-mask" @click.self="emit('close')">
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
            服务端调用立即改用新地址，其他工具面与视频剪辑不受影响。本面会话的 MCP 工具
            在会话创建时按此地址自动挂载。
          </p>
          <label class="ssd-label" for="ssd-url">服务端地址</label>
          <input
            id="ssd-url" v-model="url" class="ssd-input" type="text" autocomplete="off" spellcheck="false"
            placeholder="http://192.168.x.x:8000" :disabled="busy !== '' || !loaded" @keydown.enter.prevent="save"
          />
          <div class="ssd-actions">
            <button type="button" class="ssd-btn ssd-btn--primary" :disabled="busy !== '' || !loaded" @click="save">
              {{ busy === 'save' ? '保存中…' : '保存地址' }}
            </button>
          </div>
          <p v-if="message" class="ssd-msg" :class="messageOk ? 'ssd-msg--ok' : 'ssd-msg--err'">{{ message }}</p>
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
  width: min(560px, calc(100vw - 64px));
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
.ssd-body { flex: 1; min-height: 0; display: flex; }
.ssd-left {
  flex: 1;
  padding: 12px 22px 22px;
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
.ssd-input:focus { border-color: var(--primary); }
.ssd-actions { display: flex; gap: var(--space-3); margin-top: var(--space-3); }
.ssd-btn {
  flex: 1;
  padding: 8px 0;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border: 0;
}
.ssd-btn:disabled { opacity: 0.55; cursor: default; }
.ssd-btn--primary { background: var(--primary); color: var(--primary-foreground); }
.ssd-msg {
  margin: var(--space-3) 0 0;
  font-size: 12px;
  line-height: 1.7;
  word-break: break-all;
}
.ssd-msg--ok { color: var(--primary); }
.ssd-msg--err { color: var(--danger); }
</style>
