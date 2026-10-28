# dsh-tintin-cover-plugin — TinTin 封面制作插件

需求文档:[docs/cover-generation-requirements.md](../docs/cover-generation-requirements.md)(§九 编辑器 / §五 工作包)。
状态:**WP-1 引擎 + WP-6 编辑器 MVP 已实现**(独立安装,未入根 workspaces;入链与菜单注册为收尾项,见下)。

## 结构

```
templates/          Remotion 模板(Cover/ProductCover/VideoCover + remotion-entry 打包入口)
src/registry.ts     模板注册表 + props 校验(纯逻辑,受铁律 15 锚点保护)
src/engine.ts       WP-1 渲染引擎:{templateId, props} → PNG;兼 CLI(冒烟/批量种子)
src/editor/         WP-6 三栏编辑器(图层树 | @remotion/player 画布 | 会话/导出占位)
scripts/serve.mjs   本地服务:托管编辑器 + POST /api/render
scripts/smoke-props.json  冒烟参数
test/               12 例单测(注册表/校验/目录解析/入参防线)
```

## 用法

**主入口(已接线)**:TinTin 客户端侧边栏「封面制作」菜单 → bundle webServer(`/tintin/cover/editor`,见 `dsh-tintin-bundle/lib/cover-plugin-route.js`)。改动后需重建:

```powershell
npm run build:editor       # 编辑器 UI → dist/editor/(vite)
npm run build:engine       # 引擎 → dist/engine.mjs(esbuild,remotion 外置)
npm run test               # 12 例单测
```

**独立调试(可选)**:`npx tsx scripts/serve.mjs` → http://127.0.0.1:3927/
**CLI 直出**:`npx tsx src/engine.ts video '@scripts/smoke-props.json' smoke.png`

- 产物目录:`<TINTIN_WORKSPACE_DIR | ~/Documents/tintin-workspace>/cover/`(可用 `TINTIN_COVER_DIR` 覆盖)
- 首次渲染会下载 headless Chromium(随包方案落地前为运行时拉取)

## 收尾项(对应需求文档工作包)

1. ~~通道打包链~~ ✅ **已接线(2026-10-27)**:生产载荷 vendor 于 `tintin-resources/cover-plugin/`(dist 三件套 + 生产 node_modules),extraResources → `resources/cover-plugin`(node_modules 需**显式单列**条目,electron-builder 默认跳过——openfilm 同款先例)。~~Chromium 随包~~ ✅ **已实现**:`node_modules/.remotion/` 内含 Chrome Headless Shell(~282MB,staging 阶段执行一次渲染冒烟即自动播种;@remotion/renderer 沿依赖链就近发现,打包版首渲离线可用)。更新流程:改模板/引擎后重跑三件 build,同步 `dist/`+`public/` 到 staging 并 `npm install --omit=dev`,再跑一次 staged 渲染冒烟刷新浏览器缓存;
2. WP-7 会话接线(§9.4 七工具面,复用 openfilm-tools 既有的 ComfyUI/文生图工具做底图);
3. WP-3 AI 底图通道;WP-2 竖版模板。

**打包更新流程**:改模板/引擎后需重跑 `npm run build:bundle && npm run build:engine && npm run build:editor`,再同步 `dist/`+`public/` 到 `tintin-resources/cover-plugin/` 并在该目录 `npm install --omit=dev`(建议后续脚本化进 prepare 链)。
