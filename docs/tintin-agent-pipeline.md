# TinTin 智能体链路总览

- 日期:2026-11-01(首次建立;此后每次智能体链路裁决随批追加)
- 适用:客户端四条 LLM/智能体链路的现行形态、模型来源、工具面与裁决编年
- 关联:[tintin-openfilm-port.md](tintin-openfilm-port.md)(视频剪辑移植全录,§11 智能体编年)、[cover-generation-requirements.md](cover-generation-requirements.md)(封面需求与裁决,§十三)、[tintin-openfilm-agent-alignment.md](tintin-openfilm-agent-alignment.md)(**已集成冻结**:视频剪辑对齐快照,仍有效结论已并入本文)
- 状态:本文为**智能体链路唯一现行权威源**(2026-11-01 集成);分面文档记录历史,与本文冲突时以本文+代码为准

---

## 0. 结论速览:四条链路一张表

| | DSH 主聊天(总助手) | 封面制作 | 视频剪辑 | 素材创作 |
|---|---|---|---|---|
| 会话形态 | 宿主 harness 原生会话 | 主进程 spawn 的 `dsh --profile acp` 子进程 ×1 | 同左,**每影片一个** | **无会话**,单轮 HTTP |
| 智能体 | 宿主 agentPresets(总助手等 5 预设) | 名册:DeepSeek Harness(默认)/ TinTin智能体(禁用) | 名册:DeepSeek Harness(默认)/ TinTin智能体(禁用) | 无智能体 |
| 模型来源 | **用户自配 api-key**(设置→模型,11-01 起) | 运行时拉 `GET /v1/models`,首个为默认 | 编译期常量 `deepseek-v4-flash` | 不选,model 缺省=服务端默认 |
| LLM 端点 | 用户自配 provider | `{server}/llm`(补丁内置) | `{server}/llm`(补丁内置) | `{server}/llm/chat/completions`(页面直连) |
| 工具面 | 14 个本地注册 `tintin_*` 工具 | MCP `{server}/mcp`(7 个 create_*)+ fs + 编辑器 API | MCP `{server}/mcp`(7 个 create_*)+ 内建 + openfilm CLI | 无工具,直接 REST `/generate/*` 等 |
| 会话持久化 | harness 会话 | 单会话,记录落项目 `.cover-chat/` | 按 `角色:项目` 分键,存角色隔离 home | localStorage 历史 50 条 |

**三处共享**:同一个 dsh 程序(`@deepseek-ai/dsh` vendored);同一个服务端地址(`{DSH_HOME}/tintin/config.json` 的 `server.url`,单一事实源);封面与视频剪辑共用同一份官方聊天组件源码(`tintin-resources/openfilm-shell-src/chat`,构建隔离)。

**三处独立**:进程(宿主内 vs 各自子进程);DSH_HOME(主=`.dsh-tintin`、封面=`cover-*-agent-home`、视频剪辑=`film-*-agent-home`)——会话与技能装位互不相通;provider/模型配置三源互不读写。

---

## 1. 两条设计思路与裁决现状

目标一致:**智能体只做编排(指导服务端生成图片/文字/视频/音频),生成由服务端能力承担,防止大模型空转与费用失控**。

- **思路 A(服务端编排)**:「TinTin智能体」入口的定位——编排逻辑在服务端,客户端只做会话持续与渲染。**2026-11-01 实测:服务端编排面未上线**(详见 §1.1)——客户端名册行禁用**维持**,恢复条件见 §3。
- **思路 B(客户端编排,现行主线)**:客户端 dsh 智能体编排,模型走服务端 `/llm`,经 MCP(`{server}/mcp`)调服务端能力。封面/视频剪辑现行形态即此;默认角色=DeepSeek Harness。
- 11-01 裁决:思路 A 入口(TinTin智能体)禁用、默认退回 dsh(思路 B);主聊天模型回归 api-key 自配(不再消费服务端 `/llm`)。封面/视频剪辑会话自身模型仍走 `{server}/llm`(补丁内置,不属于客户端设置域;若一并切 api-key 需解决子进程隔离 home 的凭据传递,另立裁决)。

**对接面纪律(2026-10-19 用户纠偏,持续有效)**:客户端与智能体只对接 **TinTin 服务端 API**;comfygen/ComfyUI 是服务端内部的编排与渲染组件,永远不在客户端或智能体的对接面上——客户端不需要知道它的存在。生成一律走语义端点(`/generate/*`、MCP create_*),不下探到 comfygen 原生契约。

### 1.1 服务端完成情况实测(2026-11-01,HTTP 实测)

服务端 `http://192.168.111.31:8000`(freya-justin,Linux,RTX 3090 ×2):

| 面 | 实测结果 | 结论 |
|---|---|---|
| 健康面 | `GET /health` 200(GPU 2 卡/VRAM 48G) | 在线 |
| **模型供给** | `GET /v1/models` = **5 款**:deepseek-v4-flash、deepseek-v4-pro(provider=deepseek)+ **qwen3.8:27b、qwen3.8-flash-next:125b-a6b-q4_K_M(ollama-local)+ qwen3.8-flash-next-iq2_xs(strata-local)**;`/llm/models` 同清单 | **较 10 月口径(仅 deepseek 两款)扩充 3 款本地模型**——本地 GPU 推理=潜在零 API 费通道 |
| **MCP 能力面** | `{server}/mcp` tools/list = **7 工具**(与 10-30 口径一致):create_image(**mode=t2i 文生图 / mode=cover 封面图生图**,参考图 script_id/images/material_ids)、create_video(comfygen t2v,1~10s/1080p,异步)、create_music(MusicGen 同步)、create_audio(sfx/tts 声音克隆)、create_digital_human(image/lipsync)、task_status_unified、server_health | 能力面完备且描述成熟;封面图生图模式完整 |
| **编排智能体面** | `/agent` 组仅 4 条:`/agent/registry`(GET 只读)+`/agent/registry/{id}`(GET)+`/agent/memory`(GET/POST/DELETE)——纯注册表查询与记忆存取,**无会话编排端点**;MCP 面亦无编排类工具 | **思路 A 的服务端编排引擎未上线**——TinTin智能体禁用维持的实证依据 |
| REST 端点面 | openapi 512 条路径,与 2026-10-30 快照逐条对比 **零增删** | 本次更新不在 REST 结构面,在模型供给(运行时数据) |
| 语义生成/LLM | `/generate/image|video`(POST)、`/llm/chat/completions`、`/llm/keys/issue` 全在位 | 思路 B 供给正常 |

**综合判定**:服务端完成的是**能力与模型供给**侧更新(本地模型上线、工具面稳定),**编排智能体(思路 A)仍无可对接面**——客户端维持禁用是正确状态;现行主线继续走思路 B。封面会话模型清单是运行时拉取 `/v1/models`,本地 qwen 款已自动出现在其选择器;视频剪辑模型清单为编译期常量(仅 deepseek 两款),要不要把本地模型纳入=待裁决(切本地模型=省 API 费,效果需实测)。

---

## 2. 各链路详情(2026-11-01 现状)

编排语义四问速答(承自 alignment 对齐文档、按现行形态修订):**会话控制**=封面/视频剪辑各自管理本地 dsh ACP 子进程(session/new|resume|prompt),与主聊天会话互不相通;**编排**=DSH Harness 单主智能体+工具回路,无独立编排层,无多智能体编排;**子智能体**=Harness 内部线程,UI 不显示;**与原版 OpenFilm 的差异**=原版驱动用户本机 CLI(Codex/Claude Code 等),TinTin 改为随包 dsh + 服务端模型与能力(有意为之的根本替换)。

### 2.1 DSH 主聊天

- 首启向导只登记服务端地址(能力面用);聊天模型由用户在 设置→模型 自配 api-key(上游原生 CustomProviderCard 表单)。
- 旧的 tintin-server provider 自动注册/默认模型接管/占位凭据已撤;存量清理在每次页面加载幂等执行(仅清仍指向 tintin-server 的条目,用户此后自选不动)——`dsh-tintin-bundle/client.js` `installTinTinProvisioning`。
- 工具:14 个 `tintin_*` 本地工具(`dsh-tintin-bundle/lib/openfilm-tools.js`,注册点 `index.js`),含 `tintin_generate_image/video`;宿主**未挂** MCP。

### 2.2 封面制作

- 会话:编辑器右栏 iframe(官方聊天组件,独立 vite 构建 `chat-shell/`)→ loopback `/tintin/cover/api/acp/*` → 主进程 `startSession` spawn dsh 子进程。
- 角色名册(页面 `cover-chat-bridge.ts` `rosterAgents`):**DeepSeek Harness 置首=默认**;TinTin智能体行保留但 `disabled`(「服务端智能体观察期,暂不可用」)。主进程归一化:任何 tintin-agent 请求统一落 deepseek(`cover-acp-bridge.js` `startSession`)。
- 模型:每次启动拉 `GET /v1/models` 首个为默认,动态写补丁(仅 tintin-agent 角色改写显示名,现不可达)。
- 技能:cover SKILL.md **无条件注入两种角色**(11-01 起随场景不随角色);用户级装位 `cover-skills/`。
- 自愈:会话死亡自动重启带 `state.agentId`(不丢角色人设)。

### 2.3 视频剪辑

- 会话:shell 页官方聊天 → preload IPC → `FilmAgentManager`(`film-acp.ts`)每影片一个 dsh 子进程,cwd=影片目录;切项目 3s 轮询跟随。
- 角色名册(`main-hook.ts` `filmAgentRows`):**DeepSeek Harness 置首=默认**;TinTin智能体行 `disabled`(代码保留:人设/补丁/home 分支不动,`film-acp.ts:25-58,66-73`)。
- 模型:编译期常量(DeepSeek-V4-Flash/Pro;TinTin智能体行显示名=角色名,现不可达)。
- 工具:补丁行进程级挂 `{server}/mcp`(7 个 create_*:`create_video/create_image/create_music/create_audio/create_digital_human/task_status_unified/server_health`,2026-10-30 实测口径)+ openfilm SKILL.md(两角色均同步)+ 服务端技能安装位 `film-agent-home/skills`。
- 存量回落:localStorage picked=tintin-agent 读入时自动回落 deepseek(`local-agent-store.ts` `load`)。

### 2.4 素材创作

- **不是智能体链路**(设计使然,轻工具定位恰好最省):聊天=`window.tintin.server.llmChat` 单轮直连服务端 `/llm/chat/completions`(不传 model);无会话、无工具选择。
- 生成任务**轮询链完整**:提交 `/generate/image|video` 拿 task_id → 每 2.5s `GET /tasks/unified/{id}`(预算图 15 分钟/视频 30 分钟,可 `POST /tasks/batch_cancel`,产物 URL 绝对化落盘);或即梦 CLI 本地后端(独立轮询)。此前外部判定表中「缺轮询」不成立——缺的是编排,轮询一直有。
- 创作芯片 copy 后端只拼提示词+剪贴板+跳媒体工具卡,不调 LLM;历史 localStorage(`tintin.creationStudio.history.v1`,50 条)。
- 与智能体体系的交集:仅共用服务端地址与 `/skills` 注册表。

---

## 3. 禁用语义与恢复(观察期)

- `RosterAgent.disabled`(`chat/lib/desktop-bridge.ts`):行保留、菜单置灰不可点、显示理由字符串;`currentAgent` 候选跳过禁用行;`ensureOptions` 探测排除禁用行(堵住"开菜单即拉起禁用会话"的唯一旁路)。
- 恢复动作(服务端智能体验收通过后):去掉两处名册行的 `disabled` 字段并回置 tintin-agent 置首(`main-hook.ts` `filmAgentRows` + `cover-chat-bridge.ts` `rosterAgents`);封面主进程归一化恢复双角色(`cover-acp-bridge.js` `startSession`);共享层 `load()` 的回落映射按需移除。人设/补丁/home/会话数据全程保留,resume 原样接回。

---

## 4. 裁决编年(智能体链路)

| 日期 | 裁决 | 落点 |
|---|---|---|
| 2026-10-19 | 视频剪辑智能体对齐四问定论;客户端只对接服务端 API(comfygen 不在对接面) | [tintin-openfilm-agent-alignment.md](tintin-openfilm-agent-alignment.md) |
| 2026-10-23 | 聊天第三行形态:官方聊天 UI + 本地 ACP 智能体(A 方案过渡列退役为兜底) | [tintin-openfilm-port.md](tintin-openfilm-port.md) §11 |
| 2026-10-30 | 「TinTin智能体」入册置首(定位=调度服务端子智能体);/mcp 42→7 工具(服务端收敛);模式切换按钮删除 | port.md §11、cover-req §十三 |
| 2026-10-31 | 封面名册双智能体(与视频剪辑同款);MCP 挂载定式=补丁行进程级(rc.2 会话参数挂载死路) | cover-req §十三.20 |
| 2026-11-01 | TinTin智能体=服务端编排智能体定位定稿;服务端功能观察期→**行禁用、默认 DeepSeek Harness**;主聊天模型回归 api-key 自配(撤 tintin-server provider 自动注册+存量清理);封面 SKILL 注入随场景不随角色 | 本文;port.md §11 追记、cover-req §十三.21 |
| 2026-11-01(续) | **防空转护栏第一步落地**:deepseek 默认角色补丁补「编排工作纪律」(system-prompt.personaPrefix,每轮可见)——生成唯一出口=服务端 create_*、异步必轮询(≥5s/≤60 次)、失败重试≤2 次、禁本地自制生成物;视频剪辑 `FILM_AGENT_WORK_RULES`(`film-acp.ts`)、封面 `COVER_AGENT_WORK_RULES`(`cover-acp-bridge.js`)。此前该纪律只随已禁用的 TinTin智能体人设存在,默认反转后一度消失 | 本文 §5;film-acp.spec.ts 断言更新 |
| 2026-11-01(再续) | **上限校准实测**:harness 无现成回合上限配置(关键词族零命中)但事件流自带 turn/step 序号(桥层计数零成本);既有样本=11 次/32 次/0 次每回合——白盒初值 15/30 被实测 32 推翻,定**告警 40/硬中止 60**;轮询上限改挂任务预算时长(视频 30 分钟),纪律中「≤60 次」偏紧待批改 | 本文 §6 |
| 2026-11-01(第 2 步) | **桥层回合护栏落地**:两条链路 update 转发处计数非轮询类 tool_call,40 告警/60 `session/cancel` 中止本回合(进程与会话保留),done 事件带 toolCalls 计数;轮询纪律同步批改为预算 30 分钟;权限收窄评估=暂不动(pwsh 高频+ask 档审批地狱+10-29 永挂先例,替代路径=tools.restrict 白名单列远期) | 本文 §6.5/§6.6;film-acp.spec.ts 护栏用例组 |
| 2026-11-01(第 2 步收尾+第 4 步) | **四链路身份区分落地**(--film/--cover/--rest 占位 key 分值+REST 面 Authorization,§6.7);**端到端验收两链路 PASS 并揪出存量 bug**:封面补丁 MCP 行缺 `- insert:` 包裹(10-31 重构起封面会话一直无 MCP 工具、模型被迫 curl 绕行)已修;cover SKILL 生图节与工作纪律对齐(生成统一 create_image,禁 curl 直调 REST;matting 保留);film BGM 全链 97s/13 次、cover 底图全链 536s/21 次调用(护栏精确豁免轮询 9 次) | 本文 §6.7/§7 |
| 2026-11-01(第 3 步+技能通道区分) | **任务层兜底落地**:两桥登记 create_* 异步 task_id(tool_call_update 观察),60s 看门狗,超 30 分钟未终态→task-stale 事件+日志(只提一次),提取/结算纯函数含单测;**两份本地技能加「本地 vs 服务端」通道分类**(用户指令:本地技能必须与服务端明确区别)——cover SKILL 加能力通道表,openfilm SKILL 加 Channel map(纠正其 tintin_* 工具节=主聊天形态、film 会话不存在的错位,给出 MCP 映射与无对应能力清单) | 本文 §5;film-acp.spec.ts 任务兜底用例 |
| 2026-11-01(历史残留清扫) | **会话侧 REST 生成教学全部退役**(用户指令:走 MCP,清除历史设计残留)——openfilm SKILL Fallback 节收窄(仅查询类可 `openfilm get call`/curl;生成类一律 MCP,缺工具如实说明,删除了 curl 直调服务端示例);cover 桥动态附录标注编辑器 API 会话用途只剩导出 render;cover-plugin-route 注释口径更正(generate-background/product 消费方=编辑器界面按钮,不再服务会话);全仓扫描确认会话侧无 REST 生成教学残留(curl/端点出现处全为禁令或 matting 例外) | cover-acp-bridge.js、cover-plugin-route.js、两份 SKILL |

---

## 5. 遗留与待裁决

- **思路 A 解除禁用的前置**=服务端编排端点上线(2026-11-01 实测仅有 registry/memory 只读面,见 §1.1);上线后按 §3 恢复动作解除,并补一轮服务端编排验收实录进本文。
- **防空转护栏**:第 1 步(工作纪律)、第 2 步(桥层回合护栏+权限评估+四链路身份区分,§6.5-§6.7)、第 3 步(**任务层兜底已落**:两桥从 tool_call_update 提取 create_* 返回的 task_id 登记,60s 看门狗,超 30 分钟未观察到终态→`task-stale` 事件+日志只提一次;提取/结算纯函数含单测——聊天 UI 对新事件的呈现后续接,当前进事件流与日志)、第 4 步(端到端验收 PASS,§7)全部完成;两周期满用 §6.4 数据管道的真实分布 P95×2 替换 40/60 初值。**技能文档通道区分(2026-11-01 用户指令)**:cover/openfilm 两份本地技能已加「本地通道 vs 服务端工具」分类——本地技能(桌面端注入 home)≠服务端技能;openfilm SKILL 此前教的一整节 `tintin_*` 工具是主聊天宿主形态、film 会话根本没有,已加 Channel map 指向本会话真实工具面(MCP create_*,含映射表与无对应能力清单);cover SKILL 加能力通道表(服务端 MCP=生成唯一出口/本地=排版导出/matting 例外)。

---

## 6. 回合/调用上限:校准依据与初值(2026-11-01 实测)

### 6.1 harness 有没有现成配置——没有,但桥层计数零成本

`maxTurns / maxIterations / max_steps / iterationLimit / turnLimit / toolCallLimit / budget` 关键词族在 `deepseek-harness/packages` 全部源码与 vendored `@deepseek-ai/dsh` 运行时 lib 中**零命中**——上游没有暴露回合工具调用上限配置,上限需客户端桥层自研 + 服务端网关兜底。但有利条件:dsh 会话事件流(`session.v4.jsonl`)的 `tool/call` 事件自带 `data.turn` / `data.step` 序号与 `data.name` 工具名——**桥层(film-acp/cover-bridge)已在转发 session/update,超限计数只需数事件,分回合都不用自己做**。

### 6.2 既有会话样本统计(明文 3 份;zstd 会话库本机无解压工具,未纳入)

| 样本 | 回合 | 工具调用 | 明细 | 回合时长 |
|---|---|---|---|---|
| 视频剪辑 ACP 会话(one-prompt 2 项目) | 1 | **11 次** | pwsh×8 + glob + read + skill(编排探查型) | 17 秒 |
| 视频项目 app-shell 会话(one-prompt) | 1 | **32 次** | tintin_generate_image×4 + vision_analyze×4 + tintin_sfx×3 + write×6 + pwsh×5 + read×2 + skill + capabilities(多产物任务:多图+多音效+分析) | —(文件跨度含 idle,不计) |
| 纯文本会话(主会话) | — | **0 次** | 无工具 | — |

封面侧 `.cover-chat` 现存记录为空(50 字节 record),无样本。

### 6.3 初值(白盒 × 实测修正)

- **回合非轮询工具调用:告警 40 / 硬中止 60。** 白盒估算曾给 15/30,被实测推翻——真实多产物回合已到 32 次(生成类 8-12 + 文件/命令类 10-15 + 杂项 ≈5,正常上界 ~40)。硬限取上界 ×1.5=60;失控模式(10-30 事故=404 重试风暴 360 次)与正常上界隔一个数量级,60 仍拦得住。**触发行为=中止该回合+如实报告(已调用 N 次、卡在哪、task_id)+用户可显式续**,禁静默死路。
- **轮询类(task_status_unified)不设裸次数,挂任务预算时长**:同步类(音乐/音效/口播)即时;异步视频/数字人=30 分钟(沿用素材创作既有预算先例,源自服务端实测典型完成时长;1080p 单卡独占排队属正常)。原工作纪律「≤60 次(=5 分钟)」偏紧,**已于同日批改为「到终态或超预算即停、超时报告 task_id 供续查」**(FILM/COVER_AGENT_WORK_RULES 同步更新,film-acp.spec.ts 断言随改)。
- **会话级费用闸门**:单回合成本 P95 ×10 触发「需用户确认才继续」(P95 从服务端 /llm 计量取;四链路身份区分是前置)。

### 6.4 数据管道(用真实分布替换初值)

桥层计数落地后,每回合的调用数/工具名/时长随 `.film/logs` 与轮次缓存自动积累;两周期满用分布的 **P95×2** 替换硬限初值。zstd 会话库(角色 home `sessions/**/*.jsonl.zstd`)是更早的历史,接入需先备解压工具(python zstandard 或 zstd CLI),列为可选。

### 6.5 第 2 步落地形态(2026-11-01 已实施)

- **桥层计数已接线**(零服务端改动):harness `tool/call` 事件经 ACP 投影为 `sessionUpdate: 'tool_call'`(工具名在 `title`,MCP 公开名 `mcp__tintin-server__<raw>`),两条桥在 update 转发处逐次计数——视频剪辑 `film-acp.ts`(`advanceToolCallGuard` 纯函数+`bumpGuard`,回合作用域 `turnGuard`)、封面 `cover-acp-bridge.js`(同款 `bumpGuard`,状态挂 `state.guard`)。轮询类(`__task_status_unified` 结尾)不计入(按任务预算时长管理,工作纪律第 2 条)。
- **触发行为**:计数达 40 → `limit` 事件(level=warn,进事件流与轮次日志);达 60 → `limit` 事件(level=stop)+ 调既有 `session/cancel` **中止本回合**——cancel 只中止回合不杀进程,会话保留,下一条 prompt 正常(resume 原样)。每回合 `done` 事件与 `.film/logs` done 行附带 `toolCalls` 计数(数据管道自此自动积累)。
- **回归**:`film-acp.spec.ts` 护栏用例组(阈值/轮询类识别/39-40-41-60 边界)。
- **harness 侧更深的挂点(备选,未用)**:服务端 `ctx.tools.guard(fn)`(`core/tools`,排在 pre-execute waterfall 后,返回字符串即拒绝执行)与 `ctx.tools.restrict({allow,deny})`(subagent 先例)——若未来要在工具执行前硬拦(而非回合级中止),走这两个 API 需 harness 侧插件,列为远期。

### 6.6 权限收窄评估结论(2026-11-01,评估后暂不动)

现状两条链路 `DSH_PERMISSION_MODE: danger-full-access`(沙箱不限+审批 never)。调研结论:**harness 档位仅 read-only / workspace-write / danger-full-access 三档**,非 full-access 一律落审批 `ask`(每条 pwsh/写操作发 requestPermission 到聊天卡)。不动的理由:①实测样本里 pwsh 8 次/回合是正常编排高频工具,ask 档会把正常任务变成审批弹卡流(8 次点选),体验劣化远大于收益;②2026-10-29 用户裁决先例——审批卡链路一旦没接住即「正在处理」永挂,当时为此选定 full-access;③真正的费用风险已由回合护栏(§6.5)+工作纪律(第 1 步)覆盖。**替代收窄路径(更优)**:per-tool 白名单走 harness `tools.restrict`(yml 配置面无此键,需 harness 插件,与 §6.5 备选同载体)——待出现实际滥用案例再立项。
- 封面/视频剪辑会话模型是否随主聊天一并切 api-key(子进程凭据传递方案)——待裁决。
- 视频剪辑会话要不要纳入服务端新上线的本地模型(qwen ollama/strata 款,`/v1/models` 已 5 款;本地推理=零 API 费,效果需实测)——待裁决;封面选择器已运行时可见。
- 主聊天 14 个 `tintin_*` 本地工具与 MCP create_* 的能力重复(工具面三源收敛)——待裁决。
- /llm 网关按入口计量限流(四链路现共用占位 key,服务端无法分账)——服务端侧待办。

### 6.7 四链路身份区分(第 2 步收尾,2026-11-01 已落)

服务端 `/llm` 无鉴权不校验 key 值 → 占位 key 按链路分值即可分账,零协议变更:

| 链路 | 标记 | 载体 |
|---|---|---|
| 视频剪辑 ACP 子进程 | `sk-tintin-local--film` | spawn env `TINTIN_SERVER_API_KEY`(`film-acp.ts`) |
| 封面 ACP 子进程 | `sk-tintin-local--cover` | spawn env(`cover-acp-bridge.js`) |
| 页面 REST llmChat 面(素材创作/媒体/运营) | `sk-tintin-local--rest` | 宿主 `httpRequest` 对 `/llm/*` 附加 `Authorization`(`server-proxy.js`,调用方已带不覆盖) |
| 主聊天 | 用户自配 api-key | 天然可区分 |

服务端侧计量/限额按 key 前缀分账即可(服务端待办)。

---

## 7. 第 4 步端到端验收实录(2026-11-01,deepseek 默认角色+工作纪律)

验收法:探针直接复用生产件(`ensureFilmAgentPatch`/cover 桥导出 `startSession/prompt`),真实 spawn dsh ACP 子进程、真实服务端任务。

### 7.1 视频剪辑:生成 5 秒欢快纯音乐 —— **PASS(一次过)**

- 工具序列:pwsh×2(探查)→ **`create_music`**(服务端 MCP)→ skill+pwsh×9(下载/校验/落盘);无轮询(同步工具)。
- 产物:`assets/tintin/bgm-cheerful-5s.wav`(纪律第 3 条的 bgm- 前缀与目录被遵守);97 秒;非轮询调用 13 次(<40 告警线);`usage_update` 事件 14 次(token 数据面在)。
- 结论:纪律遵守——生成唯一出口、产物路径规范,无手搓、无 REST 绕行。

### 7.2 封面制作:生成 9:16 美妆精华液底图 —— **PASS(六轮排障后),并揪出一个存量 bug**

- **第 1~4 轮(失败)暴露两层问题**:①模型用 pwsh curl REST `/generate/image` 绕行,根因=cover SKILL.md 生图节还教着编辑器 REST 端点且明言「优先编辑器端点、不要绕道(服务端 MCP)」——技能文档与工作纪律正面冲突;②改 SKILL 后仍绕行且 560s 超时重试风暴(10-30 烧钱事故同款模式),深挖出**真正根因:封面补丁的 MCP 行缺 `- insert:` 包裹**——顶层 `- id:` 是「更新已存在条目」语义,目标不存在=**整行静默忽略**,即封面会话自 10-31 writePatch 重构起 MCP 就没挂上过,模型根本没有 create_image 可用,绕行是被迫的。该缺陷同时解释了「封面挂 /mcp」自 10-31 起再无实测记录的缺口。
- **修复两处**:补丁 mcp 行补 `- insert:`(照 film 版);SKILL.md 生图节改为「生成统一走 create_image,禁止 curl 直调 /generate/* 与编辑器 generate-background/generate-product;matting 抠图保留 curl;失败重试 ≤2 次」。
- **第 6 轮(修复后)PASS**:skill → **`create_image`(mode=t2i)** → `task_status_unified`×9(按纪律轮询,pwsh 控间隔)→ read_image(校验)→ 落盘 `essence-bg-c_5ce35516-0.png`;536 秒(异步出图真实排队);总调用 21 次、**护栏计数 12(轮询 9 次被精确豁免)**——轮询不计入配额的设计在真实会话验证通过;`usage_update` 22 次。

### 7.3 验收结论

两条链路的「deepseek 默认角色+编排工作纪律+服务端工具」链路行为达标:生成唯一出口=服务端 create_*、异步按纪律轮询、产物按规范落盘、护栏计数精确(轮询豁免)。token 侧:`usage_update` 事件每步都在,后续按 §6.4 数据管道积累即可量化 P95。封面 MCP insert 缺失属**存量缺陷由本次验收抓出修复**(此前封面会话一直无 MCP 工具)。
