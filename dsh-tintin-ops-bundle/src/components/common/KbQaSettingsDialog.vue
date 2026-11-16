<!--
KbQaSettingsDialog — 智能问答系统地址设置弹窗（2026-11-15 用户裁决：问答系统卡
右上角加设置，问答地址可配置而非写死推导）。
地址写 tintin/config.json 顶层 ops.kbQaUrl（window.tintin.config 通道，与
ops.serverUrl 同库同法）；空=清空、回落自动推导（主服务 /system/kb/status 的
port+主机拼页，见 OtKbQaPanel）；非空必须 http(s)://… 整体 URL（normalizeServerUrl
同款校验）。弹窗形态=TDialog 复用（OtPickMaterialDialog 同款 80vw 骨架的最小变体）。
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import TDialog from './TDialog.vue'
import { normalizeServerUrl } from './serverSettingsLogic'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

type BridgeConfigChannel = {
  get?: () => Promise<{ value?: unknown }>
  merge?: (patch: Record<string, unknown>) => Promise<unknown>
}
const configChannel = (): BridgeConfigChannel | undefined =>
  (window as unknown as { tintin?: { config?: BridgeConfigChannel } }).tintin?.config

const url = ref('')
const loaded = ref(false)
const busy = ref(false)
const message = ref('')
const messageOk = ref(false)
const fallbackHint = ref('')

const load = (): void => {
  busy.value = true
  configChannel()
    ?.get?.()
    .then((doc) => {
      const v = (doc?.value as Record<string, Record<string, unknown>> | undefined)?.ops?.kbQaUrl
      url.value = typeof v === 'string' ? v : ''
    })
    .catch(() => { /* 读失败=空态,保存覆盖 */ })
    .finally(() => { loaded.value = true; busy.value = false })
}

watch(() => props.visible, (v) => { if (v) { message.value = ''; load() } })

const save = (): void => {
  const cleaned = normalizeServerUrl(url.value)
  if (cleaned === null) { messageOk.value = false; message.value = '地址格式不对——应为 http(s)://主机[:端口]/路径 整体 URL，留空=自动推导。'; return }
  busy.value = true
  message.value = ''
  configChannel()
    ?.merge?.({ ops: { kbQaUrl: cleaned } })
    .then(() => {
      messageOk.value = true
      message.value = cleaned
        ? '已保存。下次打开「智能问答系统」即用此地址（已打开的页签重开生效）。'
        : '已清空。下次打开将回落自动推导（主服务 /system/kb/status）。'
    })
    .catch((e) => { messageOk.value = false; message.value = `保存失败：${e instanceof Error ? e.message : String(e)}` })
    .finally(() => { busy.value = false })
}

const inputStyle = 'width:100%;box-sizing:border-box;background:var(--surface-container);border:1px solid var(--border);border-radius:var(--radius-md);color:var(--foreground);font-size:13px;padding:8px 10px;outline:none'
</script>

<template>
  <TDialog :visible="visible" title="问答系统地址" width="520px" @close="emit('close')">
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="font-size:12px;line-height:1.7;color:var(--muted-foreground)">
        留空 = 自动推导（主服务 GET /system/kb/status 取端口，页 = 主机:端口/static/kb-app/index.html）。
        填写完整地址后，问答系统固定用它（服务端 kb 前端挪端口/部署在其它机器时用）。
      </div>
      <input
        v-model="url"
        :style="inputStyle"
        :disabled="!loaded || busy"
        placeholder="http://192.168.x.x:8787/static/kb-app/index.html（留空=自动推导）"
        @keydown.enter.prevent="save"
      />
      <div style="display:flex;align-items:center;gap:10px">
        <button
          type="button"
          :disabled="busy || !loaded"
          style="height:32px;padding:0 16px;border-radius:var(--radius-md);border:0;background:var(--primary);color:var(--primary-foreground);font-size:13px;cursor:pointer"
          @click="save"
        >{{ busy ? '保存中…' : '保存' }}</button>
        <span v-if="message" :style="{ fontSize: 12, color: messageOk ? 'var(--ok)' : 'var(--destructive, #e5484d)' }">{{ message }}</span>
      </div>
    </div>
  </TDialog>
</template>
