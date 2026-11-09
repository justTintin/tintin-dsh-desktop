<script setup lang="ts">
/**
 * TDialog 模态弹窗组件
 * 点击遮罩层关闭，提供默认与底部插槽。
 */
import { watch, onBeforeUnmount } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 是否可见 */
    visible?: boolean
    /** 标题 */
    title?: string
    /** 宽度（像素或 CSS 值） */
    width?: string | number
    /** 是否显示底部确认/取消按钮 */
    showFooter?: boolean
    /** 确认按钮文字 */
    confirmText?: string
    /** 取消按钮文字 */
    cancelText?: string
    /** 是否在点击遮罩时关闭 */
    closeOnClickMask?: boolean
  }>(),
  {
    visible: false,
    title: '',
    width: 480,
    showFooter: true,
    confirmText: '确认',
    cancelText: '取消',
    closeOnClickMask: true
  }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm'): void
}>()

// 弹窗宽度样式
function widthStyle(): Record<string, string> {
  const w = typeof props.width === 'number' ? `${props.width}px` : props.width
  return { width: w, maxWidth: 'calc(100vw - 48px)' }
}

// 点击遮罩层
function handleMaskClick() {
  if (props.closeOnClickMask) {
    emit('close')
  }
}

// 阻止内容区点击冒泡
function handleStop(event: MouseEvent) {
  event.stopPropagation()
}

function handleConfirm() {
  emit('confirm')
}

function handleCancel() {
  emit('close')
}

// ESC 键关闭弹窗
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.visible) {
    emit('close')
  }
}

// 监听可见性，控制 body 滚动锁与 ESC 监听
watch(
  () => props.visible,
  (val) => {
    if (val) {
      window.addEventListener('keydown', handleKeydown)
    } else {
      window.removeEventListener('keydown', handleKeydown)
    }
  }
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <!-- 2026-09-25 用户报障「弹窗类按钮点击无反应」加固：蒙层不再包 <Transition>。
       原收起过渡依赖 transitionend/双 rAF——窗口被遮挡/后台时 rAF 停摆，收起
       卡死会让蒙层滞留 DOM（fixed 全屏 z-modal），挡掉页面全部点击（与
       App.vue 同日移除的 out-in 卡死同家族）。改为 v-if 即时移除（出场零过渡，
       结构上无滞留点）；入场用 CSS animation（无结束依赖，不拦交互）。 -->
  <div v-if="visible" class="t-dialog__mask" @click="handleMaskClick">
    <div class="t-dialog" :style="widthStyle()" @click="handleStop">
      <!-- 头部 -->
      <div class="t-dialog__header">
        <span class="t-dialog__title">{{ title }}</span>
        <button class="t-dialog__close" title="关闭" @click="handleCancel">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <!-- 内容区（默认插槽） -->
      <div class="t-dialog__body">
        <slot />
      </div>
      <!-- 底部 -->
      <div v-if="showFooter || $slots.footer" class="t-dialog__footer">
        <slot name="footer">
          <button class="t-dialog__btn t-dialog__btn--secondary" @click="handleCancel">
            {{ cancelText }}
          </button>
          <button class="t-dialog__btn t-dialog__btn--primary" @click="handleConfirm">
            {{ confirmText }}
          </button>
        </slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.t-dialog__mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

.t-dialog {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 48px);
  overflow: hidden;
}

.t-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.t-dialog__title {
  font-size: var(--font-size-lead);
  font-weight: var(--font-weight-semibold);
  color: var(--foreground);
}

.t-dialog__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--muted-foreground);
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast) var(--easing-default),
    background var(--duration-fast) var(--easing-default);
}

.t-dialog__close:hover {
  color: var(--foreground);
  background: var(--surface-container-high);
}

.t-dialog__body {
  padding: var(--space-5);
  overflow-y: auto;
  color: var(--foreground);
}

.t-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5) var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

/* 内置按钮样式 */
.t-dialog__btn {
  height: var(--size-button-height);
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  transition: background var(--duration-fast) var(--easing-default),
    filter var(--duration-fast) var(--easing-default);
}

.t-dialog__btn--primary {
  background: var(--primary);
  color: var(--primary-foreground);
}
.t-dialog__btn--primary:hover {
  background: var(--primary-hover);
}

.t-dialog__btn--secondary {
  background: var(--surface-container);
  color: var(--foreground);
  border: 1px solid var(--border);
}
.t-dialog__btn--secondary:hover {
  background: var(--surface-container-high);
}

/* 过渡动画 */
/* 入场动画只做内部对话框的 pop（卡在首帧也只是看得见，不拦交互）。
   蒙层本身禁止透明度入场：opacity from 0 + pointer-events auto 在动画被
   遮挡/后台冻结时会变成看不见但拦截全部点击的蒙层（2026-09-25 用户
   报障「弹窗类按钮点击无反应」根因，旧 Transition enter-from 同陷阱）。
   出场即时移除（见模板注记）。 */
.t-dialog {
  animation: t-dialog-pop var(--duration-normal, 0.2s) var(--easing-default, ease);
}

@keyframes t-dialog-pop {
  from { transform: scale(0.96) translateY(-8px); opacity: 0; }
}
</style>
