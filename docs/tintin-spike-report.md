# Phase 0 Spike 实测报告(D0-4)+ 基线记录(D0-5)

> 实测环境:Windows 11,本仓库 `7897d65b12` + Phase 0 工作区改动,vendored `@deepseek-ai/dsh 0.2.0-rc.2`,临时 `DSH_HOME`(junction 到 profile `node_modules`),`dsh web --patch` 叠加层,真实 Chromium 渲染验证。
> 复现脚本与叠加层:`.tintin-spike/spike.yml`(spike 期临时物,不入库;产物包 `dsh-tintin-bundle/`、`dsh-tintin-media-bundle/` 已入库)。

## Spike A — 宿主插件挂载 ✅ 通过(2026-09-30)

**问题**:tintin 宿主桥能否作为 Cordis 宿主插件在 0.2.0-rc.2 上加载并具备进程派生能力?

**方法**:`dsh-tintin-bundle/index.js`(Spike 版:`/tintin/ping` + `/tintin/spawn-probe` 两条路由,`ctx.inject(['webServer'])` 注册,与源 tintin-bundle 同型);`--patch` 叠加层 insert;junction 进 profile node_modules。

**结果**:
- `/tintin/ping` → `200 {"ok":true,"plugin":"dsh-tintin-bundle","pid":18144,...}`
- `/tintin/spawn-probe` → `200 {"ok":true,"execPath":"...node.exe","stdout":"v22.23.1"}`(spawn 子进程 + stdout 捕获成功 = ffmpeg/yt-dlp 同类能力可用)
- 无加载告警;宿主回退解析 `@deepseek-ai/cordis` 成功。

**结论**:组合机制、路由 API、进程派生三关全过。宿主桥接入层改动量降为接近零。

## Spike B — Vue 子应用挂载 ✅ 通过(2026-09-30)

**问题**:tintin-media-bundle 的真实生产 Vue 产物(1.9MB vite IIFE,自带 Vue 运行时)能否经 0.2.0 客户端模块缝加载并渲染?

**方法**:
- `dsh-tintin-bundle/client.js`(Spike 版 chrome):文件顶层安装 `window.__tintinViews` 注册表 + `window.tintin` 桩;`__ModuleLoader__.load` 注册本包客户端模块;固定右上按钮条(工作台/媒体工具)切换视图——**刻意不移植**源码的侧栏克隆注入(其依赖补丁 #17 的 `data-dsh-sidebar-*` 标记,目标框架无此标记,Phase 2 改用官方锚点)。
- `dsh-tintin-media-bundle/client.js` = 源仓库 `dist/client.js` **原样拷贝**,仅模块 id 字符串 `tintin-media-bundle`→`dsh-tintin-media-bundle`(包名对齐;Phase 2 起由构建管线产出,该文件 gitignore)。
- 真实 Chromium 打开带 token 的 web UI。

**结果**(逐阶段,按源仓库 AGENTS 的启动协议验收):
1. HTML 200、官方 Web UI 完整渲染(侧栏/会话树/输入框)。
2. **源产物的 React 插槽在 0.2.0 输入框渲染**:「+ 产品 / + 素材 / + 脚本」+「选中内容将写入工作区 task.json」上下文条(media dist 的 `registerContextBarSlot`,`exports.inject=["slots"]` 生效)。
3. 点击「媒体工具」→ 覆盖层内 Vue 应用挂载,完整渲染工具卡目录:分镜脚本创作、剪映模板、视频转文字、封面制作、图像抠图、素材库、声音克隆、文案混剪、仿爆款、直播切片、视频修复、去水印、参考视频下载。截图存证(`call_1cf84dd3...png`)。
4. 一次返工:首轮工厂返回裸对象报 "invalid plugin, expect function or object with an apply method"——证实 0.2.0 强制 CommonJS exports 契约(见 API 差异 #4),修复后通过。

**结论**:客户端模块缝与 0.1.7 同构,真实生产产物零重写挂载成功。风险 1(UI 挂载缝重做)解除。

## Spike C — 浏览器域可行性 ✅ 架构裁决通过(2026-09-30)

**问题**:tintin 浏览器域(独立 BrowserWindow + `session.partition` + netscape cookies 导出 + 媒体嗅探 + 下载管理 + 扩展装载 + 自动上架)在新框架的接入点在哪?

**实测/证据**:
- `dsh-plugin-desktop/docs/plugin-services.md:66`:`desktopWindow` 客户端服务**只读几何**,"does not expose window mutation, focus, Electron, or IPC capabilities"。
- 公开宿主服务仅 `desktopProfiles` + `desktopPnpm`;BrowserWindow/导航策略属 launcher-private(Electron main)。
- 本仓库 Electron main 拥有原生窗口先例:`src/native-ui/*`(setup-wizard、profile-selector、recovery、desktop-dialog、compatibility-chrome)。

**裁决**(依据③本仓库契约文档 + 代码实证):
- 浏览器域**不能**以第三方宿主插件形态实现(公开契约无窗口创建)。
- **可行路径**:作为 tintin 产品通道包(Phase 4 `dsh-plugin-desktop-tintin`)的 Electron main 模块集成——通道包镜像拥有 main.ts,浏览器窗口/分区 session/扩展装载直接用 Electron API(与 `src/native-ui` 同层级);宿主侧 `dsh-tintin-bundle` 经 `/tintin/ipc/*` webServer 路由 + 本地回环与 main 通信(具体 RPC 面在 Phase 4 设计,候选:复用 host-rpc 或 webServer→main 通道)。
- 机制无阻塞;排 Phase 3–4,Phase 3 先迁纯逻辑(extractors、cookies 解析、download-manager 状态机),Phase 4 接窗口。

## D0-5 基线记录(2026-09-30)

| 项 | 结果 |
|---|---|
| `git submodule update --init --recursive` | ✅ pin `639ed015`(v0.2.0-rc.2) |
| `corepack yarn install --immutable` | ✅ exit 0 |
| `corepack yarn check`(Windows) | ⚠️ 6 文件/24 用例失败,**纯净基线对照同样失败**(stash 后复跑同结果)→ Windows 平台存量问题(ELF 头/symlink 语义/exec 位/macOS 框架),CI 仅在 Ubuntu 跑全量 check,Windows 走 `check:win-package:platform`。与 Phase 0 改动无关 |
| `corepack yarn check:tintin` | ✅ 5/5 单测 + 6 锚点 |
| check:layout 各门禁(bilingual/vendored/variants/architecture/icons) | ✅(在完整 check 前置段全绿) |

## Phase 0 结论

**三个 spike 全部通过,按方案门禁进入 Phase 1。** 方案风险表更新:风险 1(模块缝 API 变化)实测解除;风险 2(补丁散佚)已由 D0-2 审计落档;新增待办:SessionDelete/FORBIDDEN/附件打开三集群整体 TRANSLATE 排入 Phase 2;Phase 2 入口注入改用 `[data-pane="sidebar"]` 官方锚点。
