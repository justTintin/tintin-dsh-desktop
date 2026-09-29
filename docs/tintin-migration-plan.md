# TinTin 业务移植方案

> 状态:提案(未开工)。Phase 0 启动前本文档为唯一权威方案;开工后每个交付物回填实际结果。
> 建立日期:2026-09-30。基线:本仓库 `838ba60fd7`(运行时 vendored `0.2.0-rc.2`),源仓库 `D:\Project\tintin-dsh-desktop`(`bf7e7cd`,运行时 npm `0.1.7-rc.2`)。
> 源仓库文档(`tintin-dsh-desktop/docs/`)为只读参考,不在本仓库内修改。
> 强制门禁:[工程移植铁律](tintin-iron-rules.md)(D0-1 交付物,先立门禁再动代码)。

## 一、背景与终态

源仓库是 dataelement 血统的 DSH Desktop fork,其上叠有约 6.4 万行 TinTin 视频创作业务(宿主桥、剪映导出、montage/TTS、Vue 媒体工具、浏览器域、角色预设)。本方案把该业务整体移植到本仓库的 anywhere-labs 架构(Yarn 4 workspace + vendored 运行时 + profile 组合插件)。

```
dsh-desktop(Yarn 4 monorepo,运行时 0.2.0-rc.2 vendored)
├── dsh-plugin-desktop          Stable(不动)
├── dsh-plugin-desktop-beta     Beta = 开发验证通道(只增组合项,不改 src/)
├── dsh-plugin-desktop-tintin   ★ 新增第三通道:TinTin 产品壳(品牌/更新/打包)
├── dsh-tintin-bundle           ★ 新增:宿主 Cordis 插件(IPC 路由/剪映/montage/TTS/媒体代理/FastAPI 代理/角色预设)
├── dsh-tintin-media-bundle     ★ 新增:Vue 媒体工具 client 子应用 + 入口注入
└── 浏览器域:tintin 通道包内 Electron-main 模块 + extraResources(抽取器/扩展/媒体二进制)
```

总量判断:单人全职约 8–11 周;前两周(Phase 0)的三个 spike 决定真实成本,任何 spike 不通即停止并修订本方案。

## 二、三原则

1. **业务代码"搬",接入层"重写"**:剪映导出、montage、TTS 逻辑、媒体代理、Vue 组件等纯业务原样迁移(铁律 1:只搬不写);tintin 的接入机制(patch.yml insert、`window.tintin` polyfill、npm `file:` 依赖)全部换成本框架对应物(workspace 包 + profile 组合 + client 插件)。
2. **tintin 业务代码不进 `dsh-plugin-desktop(-beta)/src/`**:变体镜像门禁强制 Stable/Beta 源码逐字节一致,业务只住独立 workspace 包,经组合装载。
3. **先 Beta 验证,后拆产品通道**:Phase 1–3 期间所有能力以"插件挂到 Beta"方式跑通;品牌/更新器/安装包等不可逆决策推迟到 Phase 4。

## 三、资产映射

| # | TinTin 资产 | 源位置 | 去向 | 改造量 |
|---|---|---|---|---|
| 1 | 宿主桥(路由/任务表/设置探测) | `packages/tintin-bundle/index.js` | `dsh-tintin-bundle` host 插件;`/tintin/ipc/*`、`/tintin/jobs` 注册方式改 0.2.0 Cordis API | 接入重写,逻辑保留 |
| 2 | 剪映导出(轨道/花字/字体/模板) | `tintin-bundle/lib/jianying/` | 原样迁入 `dsh-tintin-bundle/lib/` | 几乎为零 |
| 3 | montage/声音 IPC/品牌读音词典 | `lib/montage/`、`voice-tts-logic.js` | 同上 | 几乎为零 |
| 4 | 媒体代理(rembg/VSR/归档)+ ytdlp | `lib/media-proxy.js` | 同上;`TINTIN_BIN_DIR` spawn 不变 | 小 |
| 5 | FastAPI 服务代理 + SSE 流 | `lib/server-proxy.js` + 契约类型 | 同上;`contract:gen` 保留,生成物提交 | 小 |
| 6 | 5 个角色预设 + 生成管线 | `tintin-bundle/presets/`、`scripts/build-tintin-presets.mjs` | 管线保留,基底换成 0.2.0-rc.2 standard 预设重新生成;agentPresets 注册按 0.2.0 API 校对 | 中 |
| 7 | context-task / legacy-config | `lib/context-task.js`、`legacy-config.js` | 原样迁 | 小 |
| 8 | Vue 媒体应用(12+ 工具卡/分镜/素材库/ops 工具) | `tintin-media-bundle/src/**` | `dsh-tintin-media-bundle`,vite 构建不变 | 组件零改动,挂载缝重做 |
| 9 | Tab/侧栏入口 + `window.tintin` polyfill | `tintin-bundle/client.js` | 重写为标准 client 插件(参照 `dsh-plugin-desktop/src/client/` 做法) | 重写 |
| 10 | 浏览器域(独立窗口/cookies/嗅探/下载/抽取器/扩展) | `src/main/tintin/browser/**`、`build/extractors/`、`build/ext-assets/` | tintin 通道的 Electron-main 模块 + host RPC 面;资源进 extraResources | 中-大 |
| 11 | 自动上架编排 | `browser/auto-listing/scripts/` | 随浏览器域 | 中 |
| 12 | 首启动种子/自愈、旧预设迁移 | `tintin-first-boot.ts`、`state/legacy-preset-migration.ts` | 对照本框架 onboarding/setup-wizard 重放到 tintin 通道 | 中 |
| 13 | `.dshpreset` 导入导出 | `packages/dsh-desktop-preset-transfer` | 先查本框架是否已有等价物;没有则独立迁入 | 小 |
| 14 | 媒体二进制(~300MB)+ 搬运脚本 | `resources/bin`、`fetch-tintin-binaries.mjs`、`fetch-tintin-ext-assets.mjs` | 脚本原样保留(源仍指 `TinTin_Client_Electron`),产物进 tintin 通道 extraResources | 小 |
| 15 | 33 个 tintin 测试 + 剪映/SSE 测试 | `test/tintin-*.test.ts` | 拆进对应 workspace 包,纳入根 `corepack yarn test` | 小 |
| 16 | FastAPI 服务端 | 外部内网服务 | 不动 | 零 |

**不迁移**(逐项裁决后确认):`src/main/state/` 30+ 个 Profile/插件/恢复状态机(与本框架 `profile-manager`/`package-overlay`/startup-recovery 重叠,按功能对照表裁决,预计大部分废弃)、`dsh-desktop-market-installer`(本框架有更完整市场)、tintin 手机 LAN 桥(Phase 4 决策:AA 桥 vs 保留)。

## 四、26 个补丁处置分类

完整逐 hunk 裁决见 D0-2 交付物 `docs/tintin-patch-audit.md`(铁律 13)。

| 处置 | 已知示例 | 说明 |
|---|---|---|
| 丢弃(机制被取代) | `@deepseek-ai+dsh`(宿主包注入) | 本框架 embedded launcher + profile 组合已做同一件事 |
| 很可能已被本框架覆盖(审计后丢弃) | `dsh-app-boot`、`dsh-plugin-manager`、`dsh-client-ui-conversation/sidebar/settings-*`、`cordis-plugin-loader` | 本框架 0.2.0 代有同名补丁;tintin 特有 hunk(如媒体卡接线)**重基底**到本框架补丁上 |
| 待验证 0.2.0 是否内置(内置则丢弃) | `dsh-api-session-controller`(SessionDelete)、`dsh-session-persistence(+jsonl)` | 0.1.7 能力缺口补丁,0.2.0 大概率已含,须实测(D0-3) |
| 转译保留(tintin 专属) | `dsh-client-ui-agent-preset`、`dsh-llm-deepseek`(若为 provider 种子则改配置实现) | patch-package → yarn `patch:` 协议,按版本分代进 `patches/`,纳入 vendored 管线 |

## 五、阶段计划与交付物

### Phase 0 — 基线 + spike + 补丁审计(1.5–2 周)★ 决定成败

内容:
- 基线三连:`git submodule update --init --recursive` → `corepack yarn install` → `corepack yarn check` 全绿 → `yarn workspace dsh-plugin-desktop-beta dev` 应用可启动。
- Spike A(最关键):tintin-bundle 缩成 `/tintin/ping` + 1 条 IPC 路由 + 1 次 ffmpeg spawn 的最小 host 插件,挂进 Beta 组合跑通。验证 0.2.0 插件注册、webServer 路由 API、`TINTIN_BIN_DIR` 二进制注入。
- Spike B:`tintin-media-bundle` 的 `dist/client.js` 在 0.2.0 客户端模块缝(`__ModuleLoader__`/dsh-client-modules)下挂载渲染。UI 侧最大风险点;不通则写适配插件。
- Spike C:浏览器域可行性——确认本框架 Electron 窗口/session 控制能力归属面,定接入模式。

交付物:
- **D0-1** 移植铁律落档 + `check:tintin` 门禁骨架(锚点 grep + 单文件行数基线 + media-bundle tsc 接入根 check)。
- **D0-2** `docs/tintin-patch-audit.md`:26 补丁逐 hunk 裁决(丢弃/已覆盖/转译),每条带四类依据之一。
- **D0-3** 0.1.7→0.2.0 API 差异实测清单(agentPresets、模块缝、webServer 路由、预设格式、session 持久化)。
- **D0-4** Spike A/B/C 实测报告。
- **D0-5** 基线三连通过记录。

验收门禁:**三个 spike 全通才进入 Phase 1;任何一个不通,回本方案修订后再继续。**

### Phase 1 — 宿主能力层(1.5–2 周)

- 建 `dsh-tintin-bundle` workspace:迁资产 #2–#7;预设按 0.2.0 基底重新生成;`contract:gen` 接通;对应测试迁入全绿。
- 验收:Beta 内可 ping,可走通一条完整链路(whisper 转写经 FastAPI 代理返回)。

### Phase 2 — 前端能力层(1.5–2 周)

- 建 `dsh-tintin-media-bundle`:Vue 源码整体迁入(组件不动),重写挂载缝与入口注入;dev-probe 探针页机制保留用于离线调组件。
- 验收:分镜卡、素材库、声音克隆三张代表性卡在 Beta 内正常渲染并调通后端。

### Phase 3 — 浏览器域 + 打包资源(2–3 周)

- 迁 #10、#11、#14:浏览器域 Electron 模块、抽取器、扩展、自动上架;extraResources(含 300MB bin)接入 electron-builder;`afterPack` 校验扩展。
- 验收:浏览器域窗口 + B 站/抖音抽取器在**打包目录安装版**可用(非 dev 目录)。

### Phase 4 — TinTin 产品通道(1–2 周)

- 建 `dsh-plugin-desktop-tintin`:`src/` 与 Beta 镜像 + `product-identity.ts`(appId `com.tintin.desktop`、独立 DSH_HOME);`verify-desktop-variants` 扩为三方校验(tintin = 镜像 + 允许清单增量);AGENTS.md 同步改规则;Windows 签名链移植;更新器指向 TinTin 自己的版本服务;根 `dist:tintin` 链接入 `market:prepare`/`aa:prepare-release` 同样的新鲜度门禁。
- 决策点(到此再定,列入附录待裁决清单):手机桥用 AA 还是保留 LAN 桥;`.dshpreset` 传输是否保留;mac 二进制来源。

### Phase 5 — 收敛与门禁(1 周)

- `verify:customizations` grep 锚点改造成 `check:tintin` 并入根 `check` 与 `dist:tintin`;补丁 hunk 计数等价物纳入;`corepack yarn check` + 三平台打包验证 + Windows 安装包冒烟。

## 六、风险(按杀伤力排序)

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 客户端模块缝 API 变化(0.1.7→0.2.0)导致 Vue 挂载重做 | Spike B 前置,第一周暴露 |
| 2 | 补丁语义散佚("测试全绿但定制丢了") | D0-2 审计 + 铁律 13 hunk 门禁 + 锚点核查 |
| 3 | 三方镜像门禁是治理变更 | Phase 4 前定稿 AGENTS.md 规则,先门禁后代码 |
| 4 | mac 侧媒体二进制缺失(当前基本为 Windows 形态) | `TinTin_Client_Electron` 先补 mac bin,或 Phase 4 裁决仅发 Windows |
| 5 | Electron 43→44、builder 26.15.3→26.15.7、npm→Yarn 机械差异 | 逐包过,量小面广 |

## 七、待裁决清单(附录 E,四类依据之"用户裁决"挂起项)

1. TinTin 产品更新通道:沿用 TinTin 自有版本服务,还是接入 `dshdesktop.cn` 渠道体系。
2. 手机桥:AA 桥 vs 保留 tintin LAN 桥(cloudflared/pinggy)。
3. `.dshpreset` 导入导出是否保留为本框架能力。
4. 迁移期间源仓库 `tintin-dsh-desktop` 是否冻结大改(建议:Phase 0–3 冻结,避免双线漂移)。
5. mac 通道发布范围(仅 Windows 首发?)。
