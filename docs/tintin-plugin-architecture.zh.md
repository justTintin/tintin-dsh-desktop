# TinTin 移植插件拓扑与分发/升级架构（2026-09-23）

> 状态：插件拓扑已确认（2026-09-23 用户裁决：运营工具、媒体工具各一个插件，tintin-bundle 为地基）。**执行分解见 `docs/tintin-port-execution-plan.zh.md`（任务/命令/验收的门禁均以该文档为准）。**事实基线：本仓库锁 `@deepseek-ai/dsh@0.1.5-rc.3`（npm `next` 通道，2026-09-23 从 rc.2 升级，28 个补丁全部干净套用），TinTin 源项目实读勘察（`D:\Project\TinTin_Client_Electron`，约 6.6 万行渲染层 + 2.3 万行主进程）。上游文档快照见 `docs/tintin/`；本文是对《客户端集成DeepSeek-Harness实现方案_2026-09-12》§插件形态的细化与修订，不推翻其 P0/V1~V11 闸门。

## 0. 结论摘要

1. **插件拓扑：1 个地基插件 + 2 个业务域插件**（tintin-bundle 基座 / tintin-media-bundle / tintin-ops-bundle）。**卡片不做插件**，是各域插件内的注册项。
2. **默认预装**（内置三件套，PPT 先例），保留市场/tarball 安装路作为逃生门与 P0 验证路径。
3. **原「工作台」不移植，由 harness 会话 UI 原生替代**；其独有件（上下文选择器/任务队列/定时任务/技能广场）以 slot、host 路由、工具、技能四种形态挂入。
4. **dsh 升级走既有 runbook**：锁 latest/next 通道、整应用单一版本单元随 electron-updater 发布，每次升级全量门禁 + tintin 冒烟。
5. **智能混剪永久不移植、产品入口标记过期废用（2026-09-23 用户裁决）**；同日追加：**媒体工具 P1 = 文案混剪 + 剪映模板两卡，其余卡片入口暂不实现**（P2 逐张恢复）。"本地合成+导出"重链路在 P1 由文案混剪覆盖；源项目 2026-09-22 裁决服务端合成暂时停用、本地 ffmpeg 直出为主。命名已落定（源仓库 2026-09-23 三连提交）：产品名**文案混剪**（"方案混剪"为误称已纠正），代码前缀最终为 `copywriting-montage`。完整功能点处置清单见执行文档附录 D。

## 1. 源项目关键事实（勘察结论）

- `desktop/` 才是 Electron 壳：Vue 3 + Pinia + vue-router，主进程 76 文件约 2.29 万行、240 个 IPC 通道；渲染层约 6.6 万行。
- **「工作台」是 AI 聊天会话界面**（`views/Workbench.vue` + 15 个 `Wb*.vue` + 6 个 useWorkbench 组合式，共约 5.7k 行 UI）：会话侧栏/消息流/上下文选择器/定时任务/通知中心/任务队列——与 harness Web UI 的会话/审批/技能/任务**功能同构**。
- 卡片式启动器是另外两个 Tab：媒体工具 4 组 14 卡（约 2.5~3 万行，重本地流水线：ffmpeg/yt-dlp/剪映草稿），运营工具 3 组 6 卡（约 4~5 千行，几乎纯 HTTP）。卡片清单是代码内常量（`views/MediaTools.vue`、`views/OpsTools.vue` 的 GROUP_TOOLS），非配置文件。
- 公共层清晰：`window.tintin` 桥（约 30 方法域，最大单点）、openapi 生成契约链（`api/tintin-client.ts` + `contract:gen`/`verify` 工具链）、设计系统 `components/common/`（11 组件）、Pinia stores、`useFilePicker`/`useServerTask` 等通用组合式、`machine-id` 租户头。
- 两个 Tab 互相引用对方目录 4 个组件（OtStoryboard/ReversePrompt×2 的历史迁移），按目录物理拆分前需先理顺归属。
- **浏览器域**（BrowserView 厚壳/扩展安装/B站抖音抽取/自动上架/热点采集）与**本地 AI**（模型下载/ONNX/向量库）是 Electron 壳级深度能力，不天然落在 harness host 插件里——单独分期，不进首批。

## 2. 插件拓扑与理由

```
packages/
├── tintin-bundle          # 地基（host 为主）：桥服务端 + 原生能力 + 公共工具
│   ├── /tintin/ipc/* 路由（window.tintin 桥的 host 端）、/tintin/jobs/* 进度、/tintin/media 流式
│   ├── server-proxy（FastAPI 转发 + X-Machine-ID）、machine-id、config
│   ├── ffmpeg / yt-dlp / 剪映草稿模块（纯逻辑模块按主方案 §3.2 原样搬）
│   └── ctx.provide('tintinBridge'…) 服务，供两个域插件 inject
├── tintin-media-bundle    # 媒体工具 14 卡（Vue 工作台 chunk + 卡片注册表 + 专属工具/路由）
└── tintin-ops-bundle      # 运营工具 6 卡（轻量）
```

- **为什么不是每卡一插件**：20 卡 = 20 份三件套接线（根依赖 + patch.yml insert + dsh 闭包注入，`test/desktop-plugin-closure.test.ts` 守护）× 20 份 peer 对齐 × 20 个 slot 占用；卡片间共享桥/设计系统/契约层/stores 极重，拆成插件只会复制或制造跨插件依赖；安装管理收益为零（受控产品，非第三方生态）。跨目录互引的 4 个组件也说明"目录≠归属"。
- **为什么 2 个域插件而非 1 个**：媒体与运营的依赖重量（原生流水线 vs 纯 HTTP）、变更节奏（剪映工程频繁 vs 表单稳定）、可禁用粒度（支持场景：禁用媒体包保底运营）都不同；2~3 个包的接线成本可忽略。
- **卡片升级路径**：卡片注册表设计成"插件内声明式条目"，将来若出现真第三方需求，单卡可再拆包——market generation 路径天然支持。
- **插件间接缝**：宿主单例（react/@deepseek-ai/*）之外的共享代码（设计系统 chunk、契约类型）允许插件私有依赖各带一份（约 2.5k 行，体积可接受）；跨插件调用走 Cordis `ctx.provide/inject`（market-installer 提供 desktopProfiles/desktopPnpm 的先例）。
- 与主方案差异：主方案写的是单 `tintin-bundle`；P0 仍按单包建骨架（V1~V11 验证的就是地基），P1 起落地为上述三包，P0 包演进为地基。

## 3. 分发：默认预装，保留安装路

- **默认安装好 = 内置三件套**：根 package.json `file:packages/...` 依赖 → `build/dsh-desktop.patch.yml` insert 行 → `patches/@deepseek-ai+dsh+<ver>.patch` 依赖闭包注入。PPT 即此先例（"PPT remains preinstalled"，bundle reconciliation 会剔除用户重复声明）。
- 理由：首启离线可用（market 首装需网络+pnpm）；版本单元唯一（见 §5）；支持面简单。
- 可禁用：用户层 `cordis.patch.yml` `- id: <row> disabled: true` 机制现成（`src/main/state/plugin-disable.ts`）。
- 逃生门：`dsh plugin --profile web add <tarball|路径>`（P0-3 安装路必验）保持同包可独立安装，供未来灰度/热更评估。
- **与官方 dsh-desktop 并存隔离（2026-09-23 查证）**：数据隔离由架构保证——DSH_HOME 派生自各应用自身 userData（`index.ts:818` `<userData>/harness`），userData 目录名/appName 硬编码在 `configureAppIdentity()`（index.ts:574-586）。fork 必须改身份三件套（userData 目录名、appId `io.dsh.desktop`、productName，dev 配置同步），否则与用户已装的官方版共享 `%APPDATA%/dsh-desktop` 与同一 profiles 闭包（两个 dsh 版本写同一 `profiles/node_modules` 必坏）、且 NSIS 同 appId 互相覆盖安装。改后：并装互不可见、卸载互不影响；并装验收已入执行文档门禁矩阵。

## 4. 原「工作台」→ agent 能力映射

> 定位修正（2026-09-23 用户裁决）：**TinTin 媒体业务由会话交互驱动**（"说需求→智能体拆解编排执行"），**会话形态保留**——复用 harness 会话 UI 作对话引擎，TinTin 往里挂业务组件。不替换会话 UI、不做独立工作台。

换引擎不换形态的根因（2026-09-23 用户裁决）：原会话对 agent 的调用效率与判断不足——任务编排与拆解在服务端实现，脑（服务端）手（客户端本地 ffmpeg/剪映/文件）分离，本地执行靠 `client-task-thread.js` 轮询领取→执行→上报闭环驱动，链路长且服务端编排为定制实现（V2 多智能体编排仍处接口需求阶段）。dsh 的 agent 回路（agent-loop/subagent/plan-mode/goal-round/compaction/审批/技能）为产品级实现且与本地工具同进程，调用与判断均优——**换的是编排引擎，会话外壳沿用**。

| 原工作台件 | 去向（2026-09-23 修正） |
| --- | --- |
| 会话/消息流/输入框/审批 | **复用 harness 会话 UI**（对话引擎 harness 出，非替换 TinTin 会话形态） |
| 业务上下文选择器（产品/素材/脚本/音色） | 会话输入区 `conversation.input.accessory` slot 挂 TinTin 上下文条（WP-5b，ppt 先例），选择结果 → task.json |
| 运营/媒体工具入口（顶部 Tab 形态） | **会话标题栏右侧挂入口，落点 `conversation.session.header.actions` slot**（2026-09-23 用户确认；现成插件 slot，jobs/schedule/subagent 先例，非 patch 非壳层定制），点击展开工具面板/页 |
| 智能体切换（总助手/编导/制作/质检/素材库） | harness 原生 **agent preset**（WP-5c）：五 preset 目录注册，人设按 dsh 模型重写（不照搬 SRC 服务端编排人设） |
| 识图/视觉研判 | **服务端 `/llm/vision`（qwen-vl）**，在媒体工具 `defineTool.execute` 内部调用——不经对话 LLM（WP-5d，成本与延迟原因） |
| 定时任务 | host 侧 local-scheduler 逻辑搬入地基 + 工具/面板 |
| 通知中心/任务队列 | `/tintin/jobs/*` + harness 原生任务/审批 |
| 技能广场 | `ctx.skills.registerProvider`（dsh-image-generation 先例）+ TinTin 技能包（text-storyboard、viral-writer）转 SKILL.md |
| agent 编排 | `defineTool` 先粗后细（montage_full_pipeline → 步骤级），模型经 provider 指向 TinTin LLM 代理 |
| 工作区 | harness 工作区 = 媒体项目目录（组织素材/产物/任务，**非编程工程**）；默认 `Documents\tintin-workspace`（裁决已录 §4 注） |

浏览器域、本地 AI（ONNX/向量库）不在首批：属 Electron 壳进程能力或重原生闭包，另行分期设计（壳层实现 + 独立面板窗口或 loopback 桥，参照上游 `*-panel.html` 先例）。

**dsh 无内置浏览器（2026-09-23 静态实读证据）**：壳层 `WebContentsView` 仅用于窗口菜单（`src/main/index.ts:519`）和 Safe Mode 遮罩（`src/main/safe-mode-overlay.ts`），无通用浏览视图；运行时依赖闭包无任何浏览器引擎（全锁文件仅 electron-builder 内部的 `chromium-pickle-js`/`electron-to-chromium` 两处误命中）；harness 的网页能力是 agent 工具 `dsh-tool-web`——`dsh-web-fetch-http`（undici + ipaddr.js SSRF 防护）抓取 + `turndown` HTML→Markdown 供模型阅读，另有 `dsh-web-search-deepseek` 搜索。即「agent 能读匿名网页」，不提供登录态会话、DOM 渲染、扩展或交互浏览——TinTin 的平台抽取（B站/抖音/快手/微信/小红书，需登录 Cookie + 真实 DOM + 扩展注入）HTTP 抓取替代不了。工具行为级细节（web 工具的会话内 UX）P0 装好运行时后复核。

**浏览器域的插件化形态（2026-09-23 讨论定案）**：浏览器域规划为独立能力单元（对用户可呈现为可独立启停的「浏览器」能力），但实现形态与运营/媒体插件不同——host 插件运行在 harness Node 子进程，无 Electron API（BrowserView/session/扩展加载均不可达），纯 host 插件做不了内嵌浏览。采用三层：

1. **引擎（壳层）**：TinTin 浏览器域代码本就全是主进程模块（`thickShell-ipc`/`browser-window`/`ext-manager`/`extractors`/`auto-listing`/`hotspot-capture`，约 7k 行），近乎 1:1 搬入 fork `src/main/tintin/browser/` 隔离目录（集中放置以控制 fork 对上游的差异面），IPC 壳改为壳内服务。
2. **门面（host 侧）**：tintin-bundle 地基（或独立门面包）经本机 loopback 服务（token 鉴权，参照 harness 自身 auth 模式）把引擎能力暴露为 `/tintin/browser/*` 路由与 agent 工具（`browser_open`/`page_extract`/`hotspot_capture`/`auto_listing_run`…）——这是 agent 驱动浏览器的通道，也是浏览器域接入 dsh agent 能力的价值点。
3. **UI**：壳层 overlay 视图（`safe-mode-overlay`/`windowsMenuView` 先例）或独立面板窗口（`*-panel.html` 先例）。

备选路线评估：harness UI 内 `<webview>` 标签（需壳在主窗口启用 webviewTag + 独立 partition，安全性/扩展加载/生命周期待验，P2 spike 验证）；独立 Chrome + CDP（纯 host 插件可达成但失去内嵌体验、体积与复杂度爆炸，弃）；iframe（平台 X-Frame-Options/CSP 挡死，弃）。当前只定接缝不实现：loopback 契约在 tintin-bundle 地基设计中预留。

## 4.5 成本通道：哪些走 LLM、哪些不走（2026-09-23 依据服务端 openapi 实读归通道）

原则：LLM 只承担「意图理解 + 编排决策 + 文案生成」；专用模型调用全部发生在工具内部（FastAPI 自路由），对话模型不吞音视频原始数据；确定性逻辑纯代码零模型成本。卡片 UI 直操永远零 token（LLM 是第二入口非唯一入口）。

| 通道 | 计费形态 | 覆盖功能 |
| --- | --- | --- |
| 对话/编排 LLM（`/llm/chat/completions`，dsh provider 同源） | token | 会话与意图理解、工具编排决策、脚本文案（`/storyboard/scripts`、`/copywriting/voiceover`）、反推提示词（`/prompt/image|video`，vision）、`/evaluate` 判断类 |
| 服务端专用模型（GPU 按次/时长） | 非 token | TTS/克隆（`/indextts`、`/voice`）、ASR（`/whisper`）、抠图（`/matting`）、超分（`/vsr`）、CLIP 相似度（`/clip`）、合成流水线（`/montage/*`、`/viral/clone/*`、`/editor/render`）、图像生成（`/mg`、`/comfyui`、`/product-image`、`/three-view`、`/dreamina`、`/runninghub`）、音频分析（`/audio/*`、`/wemm`）、素材分析打标（`/material/analyze|score|ocr|similar`） |
| 纯接口/本地代码 | 零模型成本 | 素材库/产品库/任务/审核 CRUD（`/material/list` 等管理族、`/product-library/*`、`/scheduled`、`/review/*`）、模板资产（`/fancy`、`/text_templates`、`/subtitle_styles`）、本地 ffmpeg/剪映/yt-dlp/文件管理、license/激活 |

成本护栏：工具输出摘要化（defineTool output 只回结构化摘要不回灌原始数据）；task.json 结构化装配省对话轮次；成熟流程用粗粒度工具一次编排一次执行，只把需判断的环节细拆；服务端 `/ollama/*` 自托管 qwen 通道保留给低成本判断；dsh compaction 控长会话上下文。原 `/agent/*` 服务端编排退役，其 token 花费转移至 dsh 回路，净结构不变、决策轮次因重试减少而更省。注：源项目 2026-09-22 裁决**服务端合成暂时停用**（文案混剪本地 ffmpeg 直出为主），上表合成流水线通道归类保留——服务端 `/montage/*` 能力仍在，恢复启用时成本通道不变。

## 4.6 服务端配套改造清单（2026-09-23 依 dsh 0.1.5-rc.3 实读定）

dsh 侧事实（node_modules 实证）：provider 走 `dsh-llm-deepseek`，`baseURL` 可配置（默认 api.deepseek.com，尾斜杠归一，拼 `<baseURL>/chat/completions`）；`tools` 序列化与 `tool_calls` 解析在 provider 层实现；流式贯穿全栈（dsh-llm 87 处引用含流式不变量）；鉴权支持 Authorization Bearer / api-key 头。

**必改（P0-V11 前置）**：
1. `/llm/chat/completions` 补齐完整 OpenAI 兼容——`tools`/`tool_choice` 字段透传且模型侧真支持 function calling、`tool_calls` 增量流式返回、parallel tool calls、SSE `stream:true`、稳定 `usage`。旧工作台只走过纯补全，工具调用与流式路径大概率未验过；agent 回路的命根子在这条。
2. 修复 `/v1/chat/completions`（2026-09-12 实测 500/挂起）——顺手获得 OpenAI 生态兼容与双路径冗余（约 0.5d）。

**应改（安全与运营）**：
3. `/llm` 加鉴权：现状不鉴权，dsh 接入后等于向可达网络开放免费模型入口。最小方案 Bearer API key（激活时随 license 下发，provider 配置携带）；可复用 `/system/license/*` 体系。
4. per-key 限流与用量审计：agent 回路使调用次数比旧 UI 高一个量级（每决策轮一次），落 `/llm/records`/`/llm/stats` 审计，防单用户打满。

**明确不改**：约 260 个算力端点（montage/voice/indextts/whisper/matting/comfyui/evaluate…）原样供 bundle 工具包装；任务进度沿用现有 `/tasks` 队列语义由 host 侧适配；`/output/` URL 改写留在客户端 host 桥；MCP 不做（无人值守需求出现时再立项）。

## 5. dsh 升级策略

- **通道**：只跟 npm `latest`，不追 alpha（仓库升级史惯例；上游源码在手，需要特性再单独评估）。
- **版本单元**：宿主 + 三个 tintin 插件锁步随安装包发布（electron-updater），插件不独立热更；插件 peerDependencies 按 `^0.1.5-rc.x` 同段预发布语义写（照抄 packages/ 现有写法）。
- **每次升级跑**：改精确版本 → `npm ci`（postinstall 补丁重放，失败按 patches/AGENTS.md 重做不机械修）→ peer 区间校验 → `npm test`（754 用例含 release/desktop-plugin-closure/patch-hunk-counts）→ `typecheck` → `build` → `scripts/verify-harness-auth.mjs` → 真实子进程 web+safe-mode 引导 → **tintin V1~V11 冒烟子集**（ping/路由/client module/工具注册）→ Windows `verify-target` 打包验证。
- **控制 fork 差异面**：能力一律走公开扩展点（slot/工具/路由/技能），tintin 自有 patch 越少升级越顺；确需新 slot 时按上游先例（conversation patch 加 slot + slots.d.ts 同步）并记录版本/移除条件。src/main 只保留最小钩子（如 TINTIN_BIN_DIR env 注入）。
- **0.1.6 前瞻（2026-09-23 实测 alpha.2 vs rc.3，升 0.1.6-rc 时复核）**：插件 API 面四包有实质 lib 变化——`dsh-tools`（240 行差异，schema 相关演进，未见 defineTool/注册改名）、`dsh-client-modules`（526 行，graph/revision/inject 发现协议内部重构，`dsh.client` 字段与 `__ModuleLoader__` 仍在）、`dsh-client-ui-slots`、`dsh-skill`；`dsh-host-webserver` 路由与 `dsh-settings` 的 lib 未动。风险敞口最大的是 client-modules 发现协议（先打 dsh-desktop 自己的补丁面），tintin 侧只要模块加载字段协议不变则零改动——升级冒烟第一项（V3 client module）即可抓牢。

## 6. 开放问题（P0 定夺）

1. 大面积 UI slot 是否存在/是否加 patch（P0-V4）；兜底 = 输入区附件 slot 或壳开独立 BrowserWindow。
2. Vue chunk 挂 slot 容器在真实 web UI 的可行性（模块系统只强制 react/@deepseek-ai 单例，理论可行、无先例——P1 首个验证点）。
3. http 页面本地媒体预览改 `/tintin/media` Range 流（主方案 §3.4）。
4. Vue 工程形态：参照 ppt-runtime"源码维护 + 编译成 tgz"还是 packages 内直构（涉 typecheck 门禁如何覆盖 TS/Vue 源）。

## 7. 工程规范铁律的挂载

`AGENTS.md` §5 已挂为移植任务强制门禁（typecheck、契约逐字段对齐、失败打点、操作四类依据、1000 行基线锁定）。注意边界：铁律的作用域是移植代码；仓库 `src/` 原有"不设统一行数硬阈值"规则不受影响，两者按目录作用域并存。
