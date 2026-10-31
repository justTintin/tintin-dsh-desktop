<!-- CreationSubjectCard.vue — @主体产品档案悬停卡（2026-10-30 自 App.vue 原样提取）
     悬停触发在父层芯片（.subject-chip:hover 使本组件根 .subject-card 显示）；
     内容=型号/品牌 + 六视图缩略 + 卖点/参数 + 注入说明脚注。 -->
<script setup lang="ts">
import type { CreationSubjectProduct } from '../composables/creationStudioLogic'

defineProps<{
  name: string
  product: CreationSubjectProduct
}>()
</script>

<template>
  <span class="subject-card">
    <span class="sc-line sc-head">🧾 {{ product.model || name }}<template v-if="product.brand"> · {{ product.brand }}</template></span>
    <span v-if="product.sixViews?.length" class="sc-views">
      <img v-for="v in product.sixViews.slice(0, 6)" :key="v.view" :src="v.url" :title="v.view" class="sc-thumb" loading="lazy">
    </span>
    <span v-if="product.sellingPoints?.length" class="sc-line">卖点：{{ product.sellingPoints.join('；') }}</span>
    <span v-if="product.features?.length" class="sc-line">参数：{{ product.features.join('；') }}</span>
    <span class="sc-foot">产品档案已注入创作上下文（六视图：{{ product.sixViews?.length ?? 0 }} 张）</span>
  </span>
</template>

<style scoped>
.subject-card { display: none; position: absolute; top: calc(100% + 8px); left: 0; z-index: 45; width: 264px; flex-direction: column; gap: 6px; text-align: left; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-3); padding: 10px 12px; cursor: default; white-space: normal; }
.sc-line { font-size: 12px; line-height: 1.55; color: var(--foreground); word-break: break-word; }
.sc-head { font-weight: 700; }
.sc-views { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
.sc-thumb { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 6px; background: #101010; border: 1px solid var(--border); }
.sc-foot { font-size: 11px; color: var(--muted-foreground); border-top: 1px solid var(--border); padding-top: 6px; }
</style>
