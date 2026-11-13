# 即梦 CLI 支持需求文档（封面服务设置登录 + 会话工具化）

> 状态：**待确认**（2026-11-12 用户发起；本文档先确认再实现）
> 范围：①封面「服务设置」弹窗增加即梦 CLI 登录配置；②会话（图2 输入框 MCP 芯片行）增加「即梦 CLI」选择，智能体经此调用本机 `dreamina` CLI。
> 关联：[cover-generation-requirements.md](cover-generation-requirements.md)、[cover-editor-optimization.md](cover-editor-optimization.md) §6.5 系、`dsh-tintin-shared/lib/{dreamina,dreamina-logic}.js`（2026-10-25 创作模式「即梦 CLI」裁决的既有宿主门）。

## 1. 背景与现状

### 1.1 即梦 CLI 宿主门已存在（零新开发的资产盘点）

| 资产 | 位置 | 能力 |
|---|---|---|
| CLI 进程封装 | `dsh-tintin-shared/lib/dreamina.js` | `createDreaminaApi`：spawn `dreamina` CLI + 输出归一；二进制定位链 `TINTIN_DREAMINA_BIN` > `%USERPROFILE%\bin\dreamina.exe` > `~/.local/bin/dreamina` > PATH，找不到呈现「未安装」态不炸装 |
| 策略/参数/解析 | `dsh-tintin-shared/lib/dreamina-logic.js` | 生成命令白名单：`text2image / image2image / text2video / image2video / frames2video / multiframe2video / multimodal2video / image_upscale`；比例字典（图片 8 种/视频 6 种）；login 设备码材料解析（`key: value` 行）；登录态判定（`未检测到有效登录态`） |
| 宿主通道（bundle 侧） | `dsh-tintin-bundle/lib/channel-table.js` | `dreamina:status / credit / generate / query / tasks / loginHeadless / loginCheck / logout` 八通道 |
| 登录 UI 先例 | `dsh-tintin-creation-bundle/src/components/CreationBackend.vue` | 创作模式「TinTin 服务 ⇄ 即梦 CLI」后端切换卡：`loginHeadless` 取设备码材料 → 渲染层引导授权 → `loginCheck({deviceCode, poll:120})` 轮询补登 → 成功/退出提示 |
| 封面侧消费 | `dsh-tintin-cover-plugin/lib/cover-background.js` | 底图/产品图生成 `engine='jimeng'` 已走 CLI（text2image/image2image） |

**结论**：CLI 二进制、命令面、解析、登录流、UI 形态全部有实测先例；本需求 = 把这条已验证链路**接到封面服务设置弹窗**与**会话工具面**，不新造机制。

### 1.2 缺口（本需求要补的两块）

1. **封面「服务设置」弹窗**（`dsh-tintin-cover-plugin/src/editor/server-settings.tsx`，图1 红框区）当前只有服务端地址 + MCP 自动发现，没有即梦 CLI 的状态/登录入口——用户装完 CLI 后只能去创作模式登录，封面侧无感知、无引导。
2. **会话工具面**：智能体（封面会话/视频剪辑会话，ACP 进程）当前只能用服务端 MCP 工具箱（`mcp__tintin-server__*`，进程级补丁挂载，`film-acp.ts` / `cover-acp-bridge.js`）。即梦 CLI 是**本机进程**，ACP 智能体无法触达宿主 `window.tintin` 桥（架构终裁：Harness 子进程无 electron 能力）——需要把 CLI 包成**会话可挂载的工具源**。

## 2. 需求一：服务设置弹窗增加「即梦 CLI」配置（登录）

### 2.1 位置与形态

图1 红框区（连接状态卡下方）加一张「即梦创作 CLI」卡，与左栏「服务端地址」卡同宽、同视觉系：

- **状态行**：二进制定位结果（找到=路径+版本；未找到=「未安装」+ 官方安装命令提示）、登录态（已登录/未登录，来自 `user_credit` 的登录态判定）、积分余额（可取到时显示）。
- **「登录即梦（OAuth 设备码）」按钮**：点击 → `dreamina login`（headless）取设备码材料 → 卡内展示授权链接/设备码（复用 CreationBackend.vue 的引导形态）→ 自动轮询 `loginCheck`（poll 120）→ 成功打绿字提示；失败/超时给可重试错误（禁止死路文案，[[tintin-ux-auto-sync-principle]]）。
- **「退出登录」按钮**（已登录时显示）。
- 刷新语义：打开弹层静默查一次状态（同 MCP 缓存回显模式）；登录/退出成功后即时刷新状态行。
- 数据通道：**封面插件路由**（`/tintin/ipc/cover/dreamina/status|login|login-check|logout`，node 侧直接 import `createDreaminaApi`）——弹窗是纯 fetch 消费方（现状如此），**不经** bundle 的 `window.tintin` 桥（编辑器 webview 无该桥）。

### 2.2 登录态的作用域

CLI 登录态存于 CLI 自身配置（本机全局），**一处登录处处可用**：封面会话、剪辑会话、创作模式、封面底图生成共用。服务设置弹窗只做「可视与验货 + 登录入口」，不是第二份凭证存储（对齐弹窗头注「不是第二份配置」的既有裁决）。

## 3. 需求二：会话里增加「即梦 CLI」选择（图2 芯片行）

### 3.1 机制：CLI 包成本机 MCP server（stdio），挂进会话补丁

图2 的芯片行（`tintin-server`、`deepseek-…`）是会话 MCP 工具源的呈现。即梦 CLI 不是 MCP server，需要一层**极薄包装**：

- **新文件 `dsh-tintin-shared/lib/dreamina-mcp.js`**（共享叶子包，封面/剪辑两宿主共用）：stdio MCP server 入口（`node dreamina-mcp.js`），工具面 = `createDreaminaApi` 的 1:1 映射：

| 工具名 | 对应通道 | 说明 |
|---|---|---|
| `dreamina_status` | status | 二进制/版本/登录态/积分 |
| `dreamina_generate` | generate | text2image / image2image / text2video / image2video 等 8 命令，白名单+比例校验复用 logic 层；异步提交返回 submit_id |
| `dreamina_query` | query | 按 submit_id 轮询取结果（download=true 落盘后回路径） |
| `dreamina_tasks` | tasks | list_task 只读清单 |
| `dreamina_credit` | credit | 余额 |

  **不暴露给智能体**：`login / login-check / logout`（凭证操作只归设置 UI，智能体不碰登录态）。
- **挂载点**（与 `mcp-tintin-server` 同一补丁块，`- insert:` 语义）：
  - 视频剪辑会话：`dsh-plugin-desktop-tintin/src/tintin/film-acp.ts` `filmAgentPatchText` 增加 `mcp-dreamina-cli` 条目（`transport: stdio`，`command: node`，`args: [<dsh-tintin-shared>/lib/dreamina-mcp.js]`）。
  - 封面会话：`dsh-tintin-cover-plugin/lib/cover-acp-bridge.js` 会话补丁同法。
- 芯片呈现：官方前端按会话挂载的 MCP 条目渲染芯片（`tintin-server` 现状即此路径）——新增条目后「即梦CLI」芯片自动出现；**实现时第一步用 CDP 探针验证芯片清单来源**（若官方前端另有服务清单源，以探针实测定备选方案，不猜）。

### 3.2 会话里的「选择」语义

- 芯片出现后，启用/停用跟随官方前端既有的会话级 MCP 开关语义（有则用，无则常驻）。
- 智能体侧提示：会话系统提示（persona/工作规则段）补一行即梦工具箱说明（何时优先本机 CLI vs 服务端 comfygen：**本机 CLI=用户已登录即梦账号、不吃服务端队列；服务端=comfygen 统一算力**——冲突时默认服务端，用户点名「即梦」才走 CLI）。

## 4. 非目标

- 不做 CLI 安装器（只提示官方安装命令）；不做积分充值/任务管理 UI；不改封面底图生成现有 `engine='jimeng'` 链路；不给智能体暴露 login/logout。

## 5. 验收清单

1. 未安装 CLI：服务设置卡显示「未安装 + 安装命令」，按钮置灰/点击给引导文案；会话芯片仍出现但工具调用报「未找到 dreamina 可执行文件」。
2. 已安装未登录：状态行「未登录」；点登录 → 设备码材料展示 → CLI 侧授权 → 轮询成功 → 状态行变「已登录 + 积分」。
3. 已登录：剪辑会话输入框出现「即梦CLI」芯片（CDP 截图取证）；会话内让智能体 `dreamina_generate text2image` → 落盘 → `dreamina_query` 回路径，全链截图取证。
4. 封面会话同验（若确认纳入范围）。
5. 回归：创作模式即梦卡、封面底图 jimeng 通道不受影响；`check:tintin` 全绿。

## 6. 开放问题（2026-11-12 提问未收到选择——以下为推荐默认，用户裁决可覆盖）

1. **芯片范围**：图2 是视频剪辑会话。**默认=剪辑+封面会话同批**（两处挂载机制同构，一次做对）；总助手后续另议。
2. **登录入口位置**：**默认=只放封面服务设置弹窗**（登录态本机全局共享，功能上一处够；剪辑/创作模式不重复做入口）。
3. **传输兜底**：**默认=stdio 优先、探针定案**（实现第一步验证 `dsh-mcp-client` 支持 stdio 则用之，agent 本机 spawn 零常驻进程；不支持则回退插件宿主起 loopback HTTP MCP，与 tintin-server 同 transport）。
4. **智能体可调的生成命令面**：**默认=全部 8 命令**（含视频类；按「提交/查询两段」设计，智能体不同步阻塞等待分钟级任务）。

## 7. 风险

- 官方前端芯片清单来源未实证（§3.1 探针步骤兜底）。
- CLI 设备码授权窗口期（用户不扫码则 loginCheck 轮询到超时）——文案给「稍后在弹窗重试」。
- `dreamina generate` 长任务（视频类分钟级）——工具面按「提交/查询两段」设计，不让智能体同步阻塞等待。
