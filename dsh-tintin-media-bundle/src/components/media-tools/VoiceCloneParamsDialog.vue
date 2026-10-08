<script setup lang="ts">
// ═════════════════════════════════════════════════════════════
// VoiceCloneParamsDialog.vue — 设置声音克隆弹窗（仿视频第 2 步；对齐文案混剪
// Step3 同名功能：参数随每次 TTS 请求发送，按引擎各表——
//   indextts：语速 duration_factor + 情感 emo_text + 情感强度 emo_alpha；
//   qwen3：预置音色 speaker + 指令文本 instruct（不支持语速/情感数值）；
//   voxcpm：仅样本参考文本 ref_text（由样本转写自动填充/库内样本服务端自动补）。
// 句间停顿（((pause=ms)) 拆段合成）为主进程展开能力，直连接口无此参数——
// 仿视频暂缺该功能点，待裁决/移植（如实标注不伪装）。
// ═════════════════════════════════════════════════════════════
import { reactive, watch } from 'vue'
import TButton from '@/components/common/TButton.vue'
import TSelect from '@/components/common/TSelect.vue'

const props = defineProps<{
  open: boolean
  engine: 'voxcpm' | 'qwen3' | 'indextts'
  initial: { factor: number; emo: string; alpha: number; speaker: string; instruct: string }
  voices: Array<{ value: string; label: string }>
  voicesLoading: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', p: { factor: number; emo: string; alpha: number; speaker: string; instruct: string }): void
}>()

const TTS_EMO_OPTIONS = [
  { label: '开心', value: '开心' },
  { label: '悲伤', value: '悲伤' },
  { label: '激动', value: '激动' },
  { label: '温柔', value: '温柔' },
  { label: '愤怒', value: '愤怒' },
  { label: '恐惧', value: '恐惧' },
  { label: '惊讶', value: '惊讶' },
  { label: '厌恶', value: '厌恶' },
  { label: '平静', value: '平静' },
]

const dlg = reactive({ show: false, factor: 1.0, emo: '', alpha: 0.5, speaker: '', instruct: '' })
watch(() => props.open, (open) => {
  // 可见性双向同步（2026-10-05 修复：原实现在 open=false 时提前 return，
  // dlg.show 恒 true → 取消/保存/遮罩点击全部无法关闭弹窗）
  dlg.show = open
  if (!open) return
  dlg.factor = props.initial.factor
  dlg.emo = props.initial.emo
  dlg.alpha = props.initial.alpha
  dlg.speaker = props.initial.speaker
  dlg.instruct = props.initial.instruct
})
function engineLabel(e: string): string {
  return e === 'qwen3' ? 'QwenTTS' : e === 'voxcpm' ? 'VoxCPM2' : 'IndexTTS'
}
function save(): void {
  dlg.show = false
  emit('save', { factor: dlg.factor, emo: dlg.emo, alpha: dlg.alpha, speaker: dlg.speaker, instruct: dlg.instruct })
}
</script>

<template>
  <teleport to="body"><div class="tintin-media-scope tintin-modal-layer">
    <div v-if="dlg.show" class="modal-mask" @click.self="emit('close')">
      <div class="modal">
        <span class="modal-title">设置声音克隆</span>
        <!-- 2026-09-20 用户裁决：按引擎显示各自设置——语速/情感为 IndexTTS 专属（QwenTTS 忽略，曾致「变速不起作用」） -->
        <span class="hint">以下参数在克隆声音时随每次 TTS 请求发送（当前引擎：{{ engineLabel(props.engine) }}）</span>
        <template v-if="props.engine === 'indextts'">
          <div class="cp-field">
            <div class="row between">
              <span class="label">语速（duration_factor）</span>
              <span class="cp-value">{{ dlg.factor.toFixed(1) }}x</span>
            </div>
            <input v-model.number="dlg.factor" type="range" min="0.5" max="2" step="0.1" class="grow" />
            <div class="row between cp-labels"><span>0.5x 慢</span><span>1.0x 正常</span><span>2.0x 快</span></div>
          </div>
          <div class="cp-field">
            <span class="label">情感选择（emo_text，可选）</span>
            <TSelect :model-value="dlg.emo" :options="TTS_EMO_OPTIONS" placeholder="不选择则使用样本默认情感" @update:model-value="(v: string | number) => (dlg.emo = String(v))" />
          </div>
          <div class="cp-field">
            <div class="row between">
              <span class="label">情感强度（emo_alpha）</span>
              <span class="cp-value">{{ dlg.alpha.toFixed(1) }}</span>
            </div>
            <input v-model.number="dlg.alpha" type="range" min="0" max="1" step="0.1" class="grow" />
          </div>
        </template>
        <template v-else-if="props.engine === 'qwen3'">
          <div class="cp-field">
            <span class="label">预置音色（speaker，可选）</span>
            <TSelect :model-value="dlg.speaker" :options="voices" :loading="voicesLoading" placeholder="不选择则按参考样本克隆音色" @update:model-value="(v: string | number) => (dlg.speaker = String(v))" />
          </div>
          <div class="cp-field">
            <span class="label">指令文本（instruct，可选）</span>
            <input v-model="dlg.instruct" type="text" placeholder="用自然语言描述语气/语速，如：用轻快的语速说" />
            <span class="hint">QwenTTS 不支持语速/情感数值参数；语气与语速请用指令文本描述</span>
          </div>
        </template>
        <template v-else>
          <div class="cp-field">
            <span class="hint">VoxCPM2 克隆参数只有「样本参考文本」（ref_text，库内样本由服务端自动补齐）。不支持 IndexTTS 的语速/情感数值参数，也不支持 QwenTTS 的预置音色/指令文本。</span>
          </div>
        </template>
        <div class="modal-actions">
          <TButton label="取消" plain @click="emit('close')" />
          <TButton label="保存" @click="save" />
        </div>
      </div>
    </div>
  </div></teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed; inset: 0; z-index: 1002; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.7);
}

.modal {
  display: flex; flex-direction: column; gap: 12px; width: 440px; max-width: 90vw; max-height: 80vh;
  padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg);
}

.modal-title { font-size: 15px; font-weight: 600; }

.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }

.hint { color: var(--muted-foreground); font-size: 12px; }

.label { font-size: 13px; color: var(--foreground); }

.cp-field { display: flex; flex-direction: column; gap: 6px; }

.cp-value { font-size: 13px; color: var(--primary); font-weight: 600; }

.cp-labels { font-size: 11px; color: var(--muted-foreground); }

.row { display: flex; align-items: center; gap: var(--space-3); }

.row.between { justify-content: space-between; }

.grow { flex: 1 1 auto; }
</style>
