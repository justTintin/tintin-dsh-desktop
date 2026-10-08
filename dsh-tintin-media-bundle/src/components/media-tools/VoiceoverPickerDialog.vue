<script setup lang="ts">
// ═════════════════════════════════════════════════════════════
// VoiceoverPickerDialog.vue — 十稿全量挑选弹窗（文案混剪 Step1 与仿视频第 2 步共用）
// 2026-10-03 用户裁决：服务端 /copywriting/voiceover formula 缺省=每次返回约 10 种
// 文案写法；弹窗默认选中第一种（selectedIdx 由父组件置 0），点击卡片切换选中，
// 「确定采用选中文案」交父组件写入各自文案框。出稿失败写法列出但不阻塞。
// ═════════════════════════════════════════════════════════════
import TButton from '@/components/common/TButton.vue'
import type { VoiceoverCandidate } from '@/composables/copywritingMontageStep2ConcatLogic'

defineProps<{
  open: boolean
  candidates: VoiceoverCandidate[]
  failedFormulas: string[]
  selectedIdx: number
}>()

const emit = defineEmits<{
  (e: 'update:selectedIdx', i: number): void
  (e: 'confirm'): void
  (e: 'close'): void
}>()
</script>

<template>
  <teleport to="body"><div class="tintin-media-scope tintin-modal-layer">
    <div v-if="open" class="modal-mask" @click.self="emit('close')">
      <div class="modal modal--voice">
        <span class="modal-title">选择文案写法（{{ candidates.length }} 种）</span>
        <span v-if="failedFormulas.length" class="muted">出稿失败写法：{{ failedFormulas.join('、') }}</span>
        <div class="voice-list">
          <button
            v-for="(c, i) in candidates"
            :key="`${c.formula}-${i}`"
            class="voice-card"
            :class="{ 'is-selected': i === selectedIdx }"
            :title="c.text"
            @click="emit('update:selectedIdx', i)"
          >
            <span class="voice-head">
              <span class="voice-radio" :class="{ 'is-on': i === selectedIdx }"></span>
              <b class="voice-formula">{{ c.formula || '文案' }}</b>
              <span class="muted">{{ c.chars }} 字<template v-if="c.durationS"> · 约 {{ c.durationS }} 秒</template></span>
            </span>
            <span class="voice-text">{{ c.text }}</span>
          </button>
        </div>
        <div class="modal-actions">
          <TButton label="关闭" plain @click="emit('close')" />
          <TButton label="确定采用选中文案" @click="emit('confirm')" />
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

.modal--voice { width: 720px; }

.modal-title { font-size: 15px; font-weight: 600; }

.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }

.muted { color: var(--muted-foreground); font-size: 12px; }

.voice-list { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto; }

.voice-card {
  display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; text-align: left;
  background: color-mix(in srgb, var(--primary) 4%, var(--card));
  border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer;
  transition: border-color var(--duration-fast, 0.15s), background var(--duration-fast, 0.15s);
}

.voice-card:hover { border-color: var(--primary); }

.voice-card.is-selected {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--card));
}

.voice-head { display: flex; align-items: center; gap: 8px; }

.voice-radio {
  width: 14px; height: 14px; flex: none; border-radius: 50%;
  border: 1px solid var(--border); background: var(--card);
}

.voice-radio.is-on {
  border-color: var(--primary);
  background: radial-gradient(circle, var(--primary) 0 45%, transparent 50%);
}

.voice-formula { font-size: 13px; color: var(--foreground); }

.voice-text {
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 12px; line-height: 1.6; color: var(--muted-foreground);
}
</style>
