<script setup lang="ts">
// 媒体工具视图根组件（WP-3）：分组卡片网格 + 内嵌工具展开（全页视图，非弹窗）。
// 2026-09-24 用户裁决：分组对齐原客户端 views/MediaTools.vue（文案脚本模板/图形/
// 音频/视频 四组；智能混剪按 A1 裁决永久不移植故不列卡）；未移植卡以「建设中」
// 角标占位（不可点，恢复一张加一张卡）。已可用：文案混剪、剪映模板、声音克隆。
import { computed, onMounted, ref } from 'vue'
import CopywritingMontage from './components/media-tools/copywriting-montage/CopywritingMontage.vue'
// 剪映模板卡启用（2026-09-24 用户裁决：去掉「建设中」，可用）：组/子类目两级浏览 +
// 从剪映同步（预设/文字模板/花字/贴纸/转场/音频）+ 字体（剪映）上传
import JianYingTemplates from './components/media-tools/JianYingTemplates.vue'
// 声音克隆（2026-09-24 用户裁决移植）：样本库/Qwen3 音色/克隆合成/批量克隆
import VoiceClone from './components/media-tools/VoiceClone.vue'

interface ToolCard {
  id: string
  title: string
  desc: string
  emoji: string
  accent: string
  /** 建设中占位：不可点 */
  disabled?: boolean
}

const GROUPS: Array<{ group: string; tools: ToolCard[] }> = [
  {
    group: '文案脚本模板',
    tools: [
      { id: 'storyboard', title: '分镜脚本创作', desc: '文案 → 分镜 → 引用素材 → 保存脚本库', emoji: '🎬', accent: 'linear-gradient(135deg,#F97316 0%,#EC4899 100%)', disabled: true },
      { id: 'jianying-templates', title: '剪映模板', desc: '从剪映同步的预设/文字模板/花字/贴纸/转场/音频，按分类浏览', emoji: '🎞️', accent: 'linear-gradient(135deg,#0EA5E9 0%,#8B5CF6 100%)' },
      { id: 'video-transcribe', title: '视频转文字', desc: '视频语音自动转写', emoji: '📄', accent: 'linear-gradient(135deg,#6366F1 0%,#A855F7 100%)', disabled: true },
    ],
  },
  {
    group: '图形',
    tools: [
      { id: 'cover-design', title: '封面制作', desc: '商品封面图快速制作', emoji: '🎨', accent: 'linear-gradient(135deg,#EC4899 0%,#F43F5E 100%)', disabled: true },
      { id: 'image-matting', title: '图像抠图', desc: '智能抠图 / 去除背景', emoji: '✂️', accent: 'linear-gradient(135deg,#0EA5E9 0%,#06B6D4 100%)', disabled: true },
    ],
  },
  {
    group: '音频',
    tools: [
      { id: 'audio-gen', title: '音频生成', desc: 'AI 生成 BGM / 音效，一键入库', emoji: '🔊', accent: 'linear-gradient(135deg,#14B8A6 0%,#0EA5E9 100%)', disabled: true },
      { id: 'voice-clone', title: '声音克隆', desc: '克隆音色生成配音', emoji: '🎵', accent: 'linear-gradient(135deg,#8B5CF6 0%,#EC4899 100%)' },
    ],
  },
  {
    group: '视频',
    tools: [
      { id: 'copywriting-montage', title: '文案混剪', desc: '按文案自动匹配素材，快速生成混剪成片', emoji: '📝', accent: 'linear-gradient(135deg,#10B981 0%,#0EA5E9 100%)' },
      { id: 'viral-clone', title: '仿爆款', desc: '拆解爆款→复刻脚本→替换本店产品', emoji: '🔥', accent: 'linear-gradient(135deg,#F43F5E 0%,#F59E0B 100%)', disabled: true },
      { id: 'live-slice', title: '直播切片', desc: '视频分析热点发现→切片与封面生成', emoji: '📡', accent: 'linear-gradient(135deg,#EF4444 0%,#DC2626 100%)', disabled: true },
      { id: 'video-repair', title: '视频修复', desc: '画质修复 / 工作流处理', emoji: '🛠️', accent: 'linear-gradient(135deg,#F59E0B 0%,#EF4444 100%)', disabled: true },
      { id: 'subtitle-removal', title: '视频去水印字幕', desc: '去除字幕 / 台标水印', emoji: '🔤', accent: 'linear-gradient(135deg,#F59E0B 0%,#EF4444 100%)', disabled: true },
      { id: 'video-download', title: '参考视频下载', desc: '粘贴 YouTube/B 站 链接选档位下载', emoji: '⬇️', accent: 'linear-gradient(135deg,#0EA5E9 0%,#6366F1 100%)', disabled: true },
    ],
  },
]

const ALL_TOOLS = GROUPS.flatMap((g) => g.tools)
const active = ref<string | null>(null)
const activeTool = computed(() => ALL_TOOLS.find((t) => t.id === active.value) ?? null)

function openTool(t: ToolCard): void {
  if (t.disabled) return
  active.value = t.id
}

// 主题跟随宿主：源项目靠 <html class="dark">；面板注入宿主 DOM，取宿主
// dark 类 + 系统偏好一次性判定（挂载时求值，不做监听——面板生命周期短）。
const isDark = ref(false)
onMounted(() => {
  const hostDark = document.documentElement.classList.contains('dark')
  isDark.value = hostDark || window.matchMedia('(prefers-color-scheme: dark)').matches
})
</script>

<template>
  <!-- tintin-media-scope：搬运的 tokens/global css 的作用域根（见 src/styles/） -->
  <div class="tintin-media-scope root" :class="{ dark: isDark }">
    <Transition name="tm-fade" mode="out-in">
      <!-- ═══ 卡片网格 ═══ -->
      <div v-if="!active" key="grid" class="page">
        <div class="head">
          <div class="title">媒体工具</div>
          <div class="sub">选择需要执行的 AI 生产能力</div>
        </div>
        <div v-for="g in GROUPS" :key="g.group" class="group-block">
          <div class="group-label">{{ g.group }}</div>
          <div class="grid">
            <button
              v-for="t in g.tools"
              :key="t.id"
              type="button"
              class="card"
              :class="{ 'is-disabled': t.disabled }"
              :style="{ '--card-accent': t.accent }"
              :disabled="t.disabled"
              @click="openTool(t)"
            >
            <span v-if="t.disabled" class="badge">即将上线</span>
            <div class="card-top">
              <div class="icon" :style="{ background: t.accent }"><span>{{ t.emoji }}</span></div>
            </div>
            <div class="card-title">{{ t.title }}</div>
            <div class="card-desc">{{ t.desc }}</div>
            <div class="card-foot">
              <span class="arrow" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14" />
                  <path d="M12 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </button>
          </div>
        </div>
      </div>

      <!-- ═══ 工具详情（同面板内嵌展开，非弹窗） ═══ -->
      <div v-else key="detail" class="page">
        <div class="bar">
          <button type="button" class="back" @click="active = null">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            返回媒体工具
          </button>
          <div class="bar-title">
            <span class="bar-emoji">{{ activeTool?.emoji }}</span>
            {{ activeTool?.title }}
          </div>
        </div>
        <CopywritingMontage v-if="active === 'copywriting-montage'" />
        <JianYingTemplates v-else-if="active === 'jianying-templates'" />
        <VoiceClone v-else-if="active === 'voice-clone'" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 全页视图布局（2026-09-23 入口裁决）：容器 el 为 100% 宽 × 100% 高、
   overflow auto 的视图区（tintin-bundle Tab 栏传入），本组件铺满宽度、
   高度按内容增长，滚动交由容器。padding 对照源 MediaTools 页。 */
.root {
  width: 100%;
  min-height: 100%;
  padding: var(--space-6);
}

.page { display: flex; flex-direction: column; }

.head { margin-bottom: var(--space-5); }
.title { margin: 0 0 var(--space-1); font-size: 24px; font-weight: 700; line-height: 1.2; color: var(--foreground); }
.sub { margin: 0; font-size: var(--font-size-body); color: var(--muted-foreground); }

/* 分组（2026-09-24 对齐原 MediaTools 分组 Launcher） */
.group-block { margin-bottom: var(--space-6); }
.group-block:last-child { margin-bottom: 0; }
.group-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted-foreground); margin-bottom: var(--space-3);
}

/* 全宽自适应列（宽屏两卡铺开，窄屏自动单列） */
.grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }

/* 卡片视觉对照源 MediaTools.vue（accent 光晕 + hover 毛玻璃），压缩到面板尺寸 */
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--space-5);
  text-align: left;
  font: inherit;
  background: var(--card);
  border: none;
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition:
    transform var(--duration-normal) var(--easing-default),
    box-shadow var(--duration-normal) var(--easing-default),
    background var(--duration-fast);
}
.card::before {
  content: '';
  position: absolute;
  inset: -60%;
  z-index: 0;
  background: var(--card-accent, #6366f1);
  opacity: 0.07;
  filter: blur(40px);
  pointer-events: none;
  transition: opacity 0.4s;
}
.card:hover::before { opacity: 0.16; }
.card > * { position: relative; z-index: 1; }
.card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-3);
  background: color-mix(in srgb, var(--card) 62%, transparent);
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
}
.card.is-disabled { cursor: not-allowed; }
.card.is-disabled .icon { filter: grayscale(0.6); opacity: 0.75; }
.card.is-disabled:hover { transform: none; box-shadow: none; }
.badge {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  font-size: 11px;
  font-weight: 600;
  color: var(--muted-foreground);
  background: var(--surface-container);
  border: 1px dashed var(--border);
  border-radius: 999px;
  padding: 2px 10px;
  pointer-events: none;
}
.card-top { display: flex; margin-bottom: var(--space-4); }
.icon {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  font-size: 26px;
  line-height: 1;
  color: #fff;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
}
.card-title { margin-bottom: var(--space-2); font-size: var(--font-size-h3); font-weight: 700; line-height: var(--line-height-tight); color: var(--foreground); }
.card-desc { flex: 1 1 auto; margin: 0; font-size: var(--font-size-body); line-height: var(--line-height-body); color: var(--muted-foreground); }
.card-foot { display: flex; justify-content: flex-end; margin-top: -2px; }
.arrow {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--primary);
  background: var(--surface-container);
  transition: transform var(--duration-fast), background var(--duration-fast);
}
.card:hover:not(.is-disabled) .arrow { transform: translateX(2px); background: var(--primary); color: var(--primary-foreground); }

/* 工具详情顶栏（对照源 tool-bar 压缩版） */
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding-bottom: var(--space-4);
  margin-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 var(--space-3);
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.back:hover { border-color: var(--primary); color: var(--primary); }
.bar-title { display: flex; align-items: center; gap: var(--space-2); font-size: 20px; font-weight: 700; color: var(--foreground); }
.bar-emoji { font-size: 22px; line-height: 1; }

/* 网格 ↔ 详情 切换（对照源 slide-up，缩短位移适配面板） */
.tm-fade-enter-active,
.tm-fade-leave-active {
  transition: opacity 0.2s var(--easing-out), transform 0.2s var(--easing-out);
}
.tm-fade-enter-from { opacity: 0; transform: translateY(12px); }
.tm-fade-leave-to { opacity: 0; transform: translateY(-6px); }
</style>

<style>
/* 弹层定位说明（2026-09-24 二次修正）：向导弹层（高级脚本设置/选择分镜脚本/
   素材选择/删除确认等）teleport 到 `.tintin-media-scope` 根元素——不再用 body。
   原因：teleport 到 body 会脱离 .tintin-media-scope 令牌作用域，var(--card) 等
   全部解析为空 → 弹窗背景透明（第一版 body>modal-mask z-index 覆盖还曾因
   特异度低于 scoped 规则而失效，弹窗被覆盖层压住不可见）。改挂到 scope 根后
   令牌/暗色/全局样式自动继承；弹层 fixed 全屏、z 1002 在覆盖层堆叠上下文内
   高于向导内容。已知取舍：顶部 Tab 栏（9999）仍高于弹层蒙层，弹窗打开时
   Tab 栏不被蒙住（原版为全窗变暗，此处为作用域化的必要让步）。 */
</style>
