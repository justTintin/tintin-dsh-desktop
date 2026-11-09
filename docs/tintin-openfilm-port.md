# TinTin 视频剪辑 × OpenFilm 移植说明(第三行形态)

状态:现行 · 依据:2026-10-18/23/24 用户裁决 + 官方 openfilm 0.2.7 源码(pin `b7673b5`)+ 实测(铁律 12/14) · 关联:[移植方案](tintin-migration-plan.md)、[验收追踪表](tintin-openfilm-alignment-acceptance.md)、[服务端兼容说明](tintin-openfilm-server-providers.md)

## 0. 本文范围

本文是**视频剪辑功能整体从 OpenFilm 移植的说明**:OpenFilm 是什么、我们采用哪种形态、页内三份桥面契约、影片视图、ACP 智能体、持久化、媒体 provider、技能、在线素材库、角色名册、**移植文件清单(锚点)**、生命周期与自愈、服务端契约、验收口径。后续任何视频剪辑相关改动以本文为唯一入口。

## 1. OpenFilm 是什么(上游资产)+ 功能全景盘点

OpenFilm 是开源 AI 视频智能体(仓库 `github.com/openfilm/openfilm`):Studio 编辑器(影片 = HTML 页面 + 时间线)+ 应用壳(聊天列驱动智能体写影片)。官方桌面端 = 编辑器与聊天**同一页编译**(`apps/desktop/shell`),经 `window.openfilmDesktop` 桥把 Studio 与聊天接起来。我们**不重写编辑器、不重写聊天**,以官方源码为资产移植。

**上游文档(功能全景的出处)**:`README.md` / `README.zh-CN.md`(产品全貌)、`apps/desktop/README.md`(桌面 = Studio + 聊天窗)、`packages/openfilm/README.md`(命令)、`packages/openfilm/MANUAL.md`(智能体手册)、`packages/openfilm/SPEC.md`(影片格式协议 0.1)、`skills/openfilm/SKILL.md`(技能)、各包 `CHANGELOG.md`。

### 1.1 功能全景 → TinTin 视频剪辑状态

| # | OpenFilm 功能(上游文档) | TinTin 集成 | 状态 |
|---|---|---|---|
| 1 | **film.html 格式**:`<section>`=轨道(第一条在最上)、片段=页面/视频/静态图/声音、`#t=12,18` 媒体选取、`at`/`speed`、样式定位、`overrides` 保留手工修改(README/Spec) | 官方 Studio 原样处理,格式不改 | ✅ 对齐(未改) |
| 2 | **页面契约**:`window.film.frame(t)` + `duration/ready/width/height`;唯一规则「同一 t 同一画面」(README/SPEC) | 官方运行时要价原样 | ✅ 对齐(未改) |
| 3 | **look 检查**(总览/单帧/区间、乱序重绘、页面错误/字体/缺失音频/截断文字) | 智能体在影片目录执行 CLI(ACP 子进程 cwd=影片) | ✅ 可用 |
| 4 | **Studio 编辑**:时间线修剪/切分、元素移动缩放旋转、文字/颜色/样式、字幕、画面内元素覆盖(README Studio 段) | 官方编辑器页内(原生视图) | ✅ 对齐(未改) |
| 5 | **带名版本 + 回退**(Studio 保存版本,git) | 官方 Studio 自带;数据在影片目录 | ✅ 对齐(未改) |
| 6 | **导出**:MP4/GIF/声音/分轨/字幕/静帧/幻灯片/透明背景(.webm/.mov)、FCP/Premiere/Resolve XML | 官方 Studio 导出面 | ✅ 对齐(未改) |
| 7 | **媒体面板(项目素材)** | Studio 左侧媒体面板(panel 不挂 assets) | ✅ 本轮修复 |
| 8 | **桌面聊天窗口**(Studio 旁的对话窗,接 Claude Code/Codex 等智能体;也可自带智能体 + 自己 key)(desktop README) | 官方聊天 UI(shell 页内)+ DSH ACP 智能体(模型走服务端) | ✅ 第三行形态 |
| 9 | **媒体生成 `openfilm get`**:配音/音乐/音效/转写字幕/图片/视频,provider 用自己的 key(README/get) | Studio 内建功能 → provider = TinTin 服务端(`openfilmCompat` 默认开,/v1 兼容);人的真 key 让位 | ✅ 服务端默认 |
| 10 | **命令**:`openfilm`(手册)/`open`/`look`/`render`(--4k/--blur/--alpha)/`get`/`doctor` | 智能体经 ACP 在影片目录执行(CLI 随包),TinTin 不改 CLI | ✅ 可用 |
| 11 | **技能**:`npx skills add openfilm/openfilm`,智能体按技能手册做片 | 随包原生技能(`resources/skills/openfilm`)+ 服务端技能合并;智能体 home 同步 | ✅ 本轮补齐 |
| 12 | **服务商设置**(Studio 设置→服务商,自己的 key) | 服务端默认注入;人的 key 自动让位 | ✅ |
| 13 | **SPEC 协议 0.1**(播放器/渲染器/编辑器实现方) | 我们只消费官方实现,不改协议 | ✅ 对齐(未改) |
| 14 | **在线素材库**(TinTin 自定义,上游无) | shell 页内抽屉 `/material/*` 代理 + 下载落项目 | ✅ 本轮重建 |
| 15 | **角色智能体**(TinTin 自定义,上游无) | ACP 预设名册(部署配置) | 🔶 实现中 |

口径:**第 1/2/4/5/6/13 项是官方原生能力,TinTin 只负责把它跑起来、不改造**;第 3/7/8/9/10/11/12/14 项是集成点(已对齐或已修复);第 15 项是唯一未完成项。任何偏离此表的视频剪辑功能,以本表的"状态"为准。

## 2. 集成形态裁决(第三行)

| 方案 | 结论 |
|---|---|
| 自绘聊天列(过渡版) | **退役**(2026-10-23) |
| 只嵌编辑器 | 不采用 |
| **第三行:Studio 官方聊天 UI + DSH ACP 智能体** | **采用** |

铁律落点:过渡版能力**一律以官方机制重建**(删过渡版 ≠ 删功能,2026-10-24 用户裁决);重建映射见 §12 与验收表。

## 3. 总体架构

```
主窗口(TinTin 客户端页)
  └─ 视频剪辑视图(client-ui mountOpenFilm)
       ├─ 原生视图(WebContentsView, 伺服 Studio 服务页 /open?key=…)
       │    └─ shell 页(官方两树编译): Studio 编辑器 + 官方聊天列
       │         ├─ window.openfilmHost   ← shell 页 bridge.ts(唯一宿主)
       │         ├─ window.openfilmDesktop ← shell 页 bridge.ts(聊天桥)
       │         └─ window.openfilmNative  ← studio-preload(系统面 IPC)
       └─ 加载遮罩 / 失败重试(底部日志条已删,见 §16.8)
       └─ 加载遮罩 / 失败重试
主进程(dsh-plugin-desktop-tintin)
  ├─ FilmAgentManager(每影片一个 dsh --profile acp 子进程)
  ├─ filmChat(.film/chat.json + .film/logs/*.jsonl)
  ├─ Studio 服务生命周期(start/attach/reconcile/teardown)
  └─ 统一日志 diagnosticLog(主进程/studio-renderer/宿主)
服务端(TinTin server 192.168.111.31:8000):/llm(模型路由)、/v1(asr/tts 兼容)、/material/*、/skills
```

## 4. 页内桥面三契约

| 契约 | 归属 | 内容 |
|---|---|---|
| `window.openfilmHost`(StudioHost) | **shell 页 bridge.ts 唯一设置者**(preload 不再暴露迷你 host — 双宿主劫持选中上报的实障) | panel(不含 assets/setAssetsOpen)、agents、asks、folders、settings、developer、update、onSelection/onRefer/onHover/onCommand |
| `window.openfilmDesktop`(AppBridge) | shell 页 bridge.ts | agents/localAgents/chat/skills/asks/projectFiles/withPicture/highlightInStudio/draftRefsInStudio/assetsOpen/setAssetsOpen/onRefer/onSelection… |
| `window.openfilmNative` | studio-preload(contextBridge) | agents 注册表、localAgents(ACP 会话协议)、chat(持久化)、skills(清单/正文)、library(在线素材代理)、tintinFilmDir、capture/pickFolder/revealPath/prefs |

**关键判定(官方源码实证)**:Studio 的左侧媒体面板是否让位,由 `host.ts useHostPanel` 的 **`panel.setAssetsOpen` 是否存在**决定;我们不挂该成员 → 项目素材保留在 Studio 左侧面板,聊天列素材按钮改开在线素材抽屉。

## 5. 影片视图(client-ui)


**加载架构(2026-10-24 用户裁决)**: 舞台上的加载遮罩(note)在原生视图**隐藏**期间显示; 原生视图是独立表面(页面里的遮罩盖不住它), 因此在「页面桥就绪 + 页面已画出过一帧(主进程双 rAF 屏障)」两项都满足后才显示; 遮罩在显示视图之后才撤, 消除遮罩撤了但首帧未画的黑屏窗口期。
> 入口位置(2026-10-24 用户裁决, 终稿): **素材 / 技能 / 角色 三个入口全部在右侧聊天列的 composer 工具条内**(官方按钮同款样式, 注入式挂载); 无任何左侧/浮动入口。在线素材抽屉由素材按钮开合; 抽屉下移 40px 让开顶部栏。抽屉下移 40px: 顶部栏(上传/语言/更多等窗口 chrome 按钮)已有内容, 抽屉头部让开它, 避免 × 与 chrome 按钮重叠。


- **重绘推进(2026-10-24 报障, 二修)**: 1px 微调不足以触发合成器; 改为在页面加载完成与接管确认后**把子视图摘挂一次**(removeChildView/addChildView, 等价于用户切换视图/还原窗口) + 16px 边界往返; 三个时机: showStudio 后 / did-finish-load 后 / has-shell 命中后 200ms;

- **show 门旗(2026-10-28 报障根修, 方案 2)**: 挂载期 `syncBounds` 先于 `open()` 发出的 show 被主进程**静默忽略却照答 ok**(视图未创建), 客户端把 bounds 记入去重缓存 → open 之后同 bounds 的 show 全被吞、**视图永不挂载**; 未挂载页不跑 rAF, 双 rAF 就绪探针永挂, 启动卡「正在启动视频剪辑工作台…」直到窗口 resize 击穿去重(实机: 仅最大化/还原能救活)。修复 = `syncBounds` 加 `nativeOpened` 门旗(对齐浏览器视图的 opened 模式), `open()` 返回后放行并立即补发一次真实 show(先挂载、后轮询);

- 原生视图覆盖舞台;250ms 快轮询 `has-shell`(openfilmDesktop + #of-chat 双判定),命中即接管;
- **视图边界 = 舞台矩形, 不向上扩张**(2026-10-24 报障的机制): 曾经的 TOP_FILL=40 让原生视图侵入窗口 chrome 条, 抽屉头部压在标题栏拖拽区边界 → 双击触发窗口最大化、× 点击落到 chrome; 现在视图从舞台顶开始(2026-11-07 用户裁决: 底部日志条退役, 视图铺满舞台全高);
- **陈旧判定只在确认旧页时触发**(2026-10-24 报障修复):探测诊断须连续 3 次「readyState=complete 且无桌面桥」才请求清理 run.json;页面加载慢时**绝不重启**(否则会起第二个服务、视图闪切到别的界面);未命中兜底恢复过渡版;
- 顶部填充 40px(原生视图上移, 铺满舞台); 底部 22px 日志条已删(2026-11-07 §16.8);
- 未命中兜底:恢复过渡版聊天列 + 状态行;陈旧服务清理后由 `startStudio` 全新拉起。

## 6. 影片智能体(ACP)

- `dsh --profile acp --patch <channelHome>/tintin/film-agent.patch.yml`,每影片一个子进程;
- 补丁定义 provider(tintin-server, OpenAI 兼容)+ 模型(deepseek-v4-flash/pro),密钥占位 `sk-tintin-local`;
- 能力:steering(通知式)、cancel、setConfigOption、permission/elicitation 转发为官方审批卡/提问卡;
- 启动句柄用 **deferred**(禁止 bare `Promise.reject`:会触发 failLoud 退出主程序 — 2026-10-24 实障);
- 会话持久化:`session/resume`,失败回落新建;`FilmAgentManager.dispose()` 随 app 退出/崩溃路径执行。

## 7. 会话持久化

- `<影片>/.film/chat.json`(原子整写:{sessions,last,turns:[{turn,items}]});
- `<影片>/.film/logs/<turnId>.jsonl`(prompt/done/事件逐行);
- IPC 面 `desktop:chat:*`(load/sessions/turn/log/unsaved/ref-image/attachment/paths/snapshot/changes/undo/reveal);
- 轮次回执缓存:重载后恢复“运行中”会话,ack 后清理;
- 轮次撤销(0.3 官方语义,2026-11-07 用户裁决方案 1):`film-turn-changes.ts` 1:1 移植官方
  file-changes.mjs+chat-ipc 轮次生命周期——开工快照(文本按扩展名整读、其余文件 hard link 进
  `.film/cache/turn-files/<turnId>`、film.html 整读到 32MB),结算有变更回 `undoable:true`,
  `desktop:chat:undo` 回滚(新增进系统回收站、改动/删除写回、放不回的如实列 `missed`),
  开工中/可撤销各至多 8 份,淘汰与更换启动即放开遗留链。聊天侧(undone 标记/上一轮提示)
  由 vendored 0.3 聊天自带,零改动。
- 模型请求明细(0.3 的 calls 页签,2026-11-07 用户裁决方案 1):`film-model-calls.ts` 从 DSH
  子进程自己的会话日志重建(官方 agent-records.mjs 对各家 agent 的同款做法)——日志在
  `<agent home>/sessions/<projectSessionKey(cwd)>/session-<id>/session.v*.jsonl.zstd`,多帧
  zstd(Node 流式在帧边界停,按帧头格式逐帧 `zstdDecompressSync`);重放 system/user/
  assistant/tool/header 事件,每个带 usage 的 assistant/message 出一次请求(startedAt 落在
  prompt..done 时间窗才收),compactCalls 去重语义 1:1;轮次落定后 ~800ms 整写
  `<fileOf(turnId)>.model.jsonl`(64MB 上限+cut 行,同内容哈希跳过保读侧增量稳定),
  `film-chat.log` 按官方 readLog 融合读(偏移增量+ino 文件身份+callsCut)。usage 映射
  input=max(0,inputTokens-cacheRead)/cacheRead/cacheWrite/output/reasoning。**顺带修**:
  轮次 id 含冒号(local:xxx),此前日志/ref 图文件名未净化写成 NTFS ADS 流(`.film/logs/local`
  0 字节幽灵,unsaved 扫描恒空)——全面 fileOf 净化(冒号→-),prompt 行补 meta.turnId 供
  unsavedTurns 反解真 id,unsaved 恢复机制在 Windows 首次真正可用。

## 8. 媒体 provider(服务端为默认)

> **TinTin 服务端=一等内置 provider(2026-11-09 用户裁决: 不再借 OpenAI 兼容外皮)**:`providers/tintin.mjs`(源在 dsh-tintin-bundle/lib/openfilm/providers/,fetch-openfilm-runtime 每次 fetch 重拷+重挂 index.mjs OWN——npm install 会重置 openfilm 包)。连接判据=`TINTIN_SERVER_URL`(studio-runtime 从 server.url 注入,ready() 以此判,无密钥)。卡面模型=服务端真名:配音 IndexTTS(/indextts/tts,/voice/samples 选音色)、转写 Whisper(/whisper/transcribe 带词级时间戳)、音乐 MusicGen BGM(MCP create_music 同步直出)、音效 SFX(/audio/gen/sfx——**2026-11-09 服务端 500 KeyError path 待修**,REST/MCP 同源)、抠图 Matting(/matting→PNG 本体)、图片/视频 ComfyGen(MCP create_image/create_video 异步任务轮询)、图片搜索 /material/stock_search。verbs 接线由 providers-seed mergeTinTinProvider 完成(补未设置+把假 OpenAI 时代的 use 种子迁到 tintin——keys.openai 存在时不动人的真选择);OPENFILM_OPENAI_URL/OPENAI_API_KEY 注入同步退役。CDP 实测:卡面已连接+全模型名+假 GPT 名消失。

- `server.openfilmCompat` **默认开,仅显式 `false` 关闭**(2026-10-24 用户裁决:服务端的服务商 = 视频剪辑默认服务商;门控在 channel-table `compatUrl` 与 bundle `createOpenfilmSync` 两处同口径);隔离 Studio home 种 `use.asr/tts=openai` 并注入 `OPENFILM_OPENAI_URL` + 占位 key;人的真 openai key 存在时自动让位;
- 实证(2026-10-24):影片智能体补丁 `<channelHome>/tintin/film-agent.patch.yml` = provider `tintin-server`(openai-completions, `<server>/llm`)+ 模型 deepseek-v4-flash/pro,`provider`/`model` 默认路由已实测落盘;
- 服务端 `/v1/audio/transcriptions` 对齐(asr form 字段 + verbose_json words);`/v1/audio/speech` wav 对齐;
- 模型路由:对话不消耗 DeepSeek 官方 API(ACP 补丁走 tintin-server)。

## 9. 技能(原生 + 服务端,交互需求规范)

技能要求以本节为准:**服务端技能与本地技能全部集成**,两个表面都要完整呈现。

### 9.1 数据

- 名单:`openfilm:native:skills-list` = 随包分发的原生技能(`resources/skills/openfilm`)+ 服务端 `/skills`(实测**顶层 `skills`**,字段 id/name/description/instruction;2026-10-24 实测服务端共 7 个);每项带 `source: 'native' | 'server'` 供分组;
- **Studio 官方技能目录**(/api/skills): 项目的+个人的+官方的(视频复刻等) —— 在 Studio 页内 fetch(自带鉴权), 与本地/服务端清单合并;
- 正文:`openfilm:native:skills-texts` = 本地 SKILL.md + 服务端 `instruction` 补齐 → 技能引用的上下文注入带全文;
- 原生技能随包:`scripts/prepare-skills.mjs` 复制 → extraResources `skills/`;影片智能体启动时同步进 `film-agent-home/skills/openfilm/`;
- 安装:`openfilm:skills:install`(服务端技能 → 写 `film-agent-home/skills/<name>/SKILL.md`,智能体即可用)。

### 9.2 交互表面

| 表面 | 要求 | 状态 |
|---|---|---|
| `@` 技能组(官方聊天) | 列出**全部**原生 + 服务端技能,可插入消息(正文注入带全文) | ✅(2026-10-24 在 chat 源树扩展 @ 菜单第三组;官方 `/` 菜单的技能组同源保留) |
| (旧)技能抽屉 | **已退役**(2026-10-24): 官方技能对话框 + `@` 技能组 + `/` 斜杠菜单三处已完整覆盖原生+服务端技能; 接口 `skills:install` 保留 | — |
| 官方「Skill 示例」画廊 | 官方示例(如视频复刻/长视频转短视频等),与技能列表是两个数据源,不混用 | 官方行为 |

> 口径:官方示例画廊 ≠ 技能清单。判断“技能是否齐全”以 `@` 技能组 / `/` 斜杠菜单 / 官方技能对话框为准(原生 1 + 服务端 7 = 8 个); 原技能抽屉已退役(见上表)。

## 10. 在线素材库(交互需求规范)

在线素材库是 TinTin 在官方聊天之上的自定义能力(上游无此概念),**交互要求以本节为准**。

### 10.1 入口

| 入口 | 行为 |
|---|---|
| 0.3 库面板素材侧栏的「在线素材」(「收藏」下面,2026-11-07 用户裁决) | 经页级桥 `window.tintinOnlineLibrary.mount(container)` 把在线素材 UI 嵌入面板内容区(切回导入/收藏/其它分类即卸载);旧浮层抽屉与 composer 注入按钮退役(`registerAssetsDrawer`/`requestLibraryDrawer` 随之退役,锚点改为 `tintinOnlineLibrary`) |

### 10.2 交互

| 交互 | 规格 | 状态 |
|---|---|---|
| 类型切换 | 视频 / 图片 / 音频三个 tab,服务端 `media_type` 过滤,切 tab 重置分页 | ✅ |
| 搜索 | 300ms 防抖,服务端 `search`,与 tab 组合 | ✅ |
| 分页 | 24 条/页;滚动到底(距底 ≤120px)自动续一页,首屏不满屏自动续填;「加载更多」按钮保留为兜底,无更多时隐藏(2026-11-09 用户要求无限滚动) | ✅ |
| 缩略图 | 视频/图片行显示 `/material/thumbnail`;音频无缩略图用 ♪ | ✅ |
| 空态/错误 | 空结果与加载失败显式文案(不静默) | ✅ |
| 预览 | 点击名称/缩略图 → 模态预览(视频/音频播放器、图片大图),关闭返回 | ✅ |
| 音频试听 | 行内 ▶/■ 同键切换,单实例(起播停他行),自然结束复位;卸载即停止 | ✅ |
| 下载到项目 | 行按钮:落 `<影片>/assets/download/` → 库面板「导入」可见 → 拖时间线 / `@` 引用 | ✅ |
| 下载到电脑 | 右键菜单:落系统下载目录(`app.getPath('downloads')`) | ✅ |
| 下载进度 | 列表底部不定长进度条 + 「正在下载到项目…」状态;完成后显示落盘路径/失败原因 | ✅ |
| 离开 | 切侧栏其它项(导入/收藏/其它分类)即卸载;浮层时代的遮罩/×/Esc/页脚关闭随嵌入模式退役 | ✅ |
| 拖拽出面板 | 不提供(以「下载」按钮替代,避免跨视图拖拽的层级问题) | 不适用 |

### 10.3 数据与 IPC

- 列表:`openfilm:library:list`(主进程代理 `GET /material/list?page&size&media_type&search`,实测返回**顶层 `items`**,无 CORS);响应附带 `serverUrl` 供缩略图/预览 URL 拼接(`/material/thumbnail|serve?material_id=`);
- 下载:`openfilm:library:download { project, materialId, filename, target: 'project'|'downloads' }`(project→影片 assets/download;downloads→系统下载目录),返回 `{ok, rel|path}`;**项目路径缺失时主进程自行从 `openfilm-studio/studio.json` 的最近项目解析**(2026-10-24 报障:页面侧 openfilm:currentProject 偶发为空导致下载无反应);每次下载的结果(成功文件路径/失败原因)写统一日志(事件 `library-download`),行按钮有「下载中…」状态;
- 素材引用闭环:下载到项目 → 左侧面板 → 时间线 / `@` 引用(官方交互);左侧面板的刷新由 Studio 自身的列表拉取决定(外部写入的文件需面板刷新或重开影片才出现)。

## 11.1 选择产品(2026-10-24 用户要求: 仿视频流程移植)

| 交互 | 规格 |
|---|---|
| 入口 | composer 底部行「📦 产品」按钮(角色选择器旁) |
| 面板 | 搜索(品类/品牌/型号)+ 产品列表(名称/品类/货号), 点选即注入; **面板形态(2026-11-09 用户裁决)=素材式嵌入会话区**: 打开时占聊天列的会话区域(列左缘/列宽/列顶, 底部留 128px 给 composer), 不浮在 Studio 画布上; 列不在时回屏幕左侧兜底 |
| 注入 | 产品资料结构化文本(品牌·型号·品类·货号 + 性能参数 + 核心卖点逐条)写进官方 composer 输入框。**0.3 注入法(2026-11-09 CDP 实验矩阵)**: 合成 paste 被 0.3 Lexical 无视; 页面侧合成 beforeinput 可用但**第一个必被丢弃**(selection 未同步), 解法=零宽字符(U+200B)热身丢弃 + 逐行 insertText / 行间 insertParagraph —— 全文(含首行)可靠落地, pre-wrap 保排版 |
| 数据 | 主进程代理 GET /api/product-library/search?q&limit 与 /items/{id}(实测顶层 items/item) |
| @ 引用(2026-11-09 用户裁决「做」): 输入 @ 检索产品(「产品」组, 五语言组名), 点选/回车插入 product pill(图标 Package); 发送时 pill(服务端 id)经桥 products.texts 取 productContextOf 同源上下文块追加进消息。vendored 补丁面: prompt-text(kind/prefix/activatedProductIds)+PromptPill 图标+app-bridge products 可选面+App.tsx(状态/菜单组/pill/发送追加)+index.ts 导出+i18n 五语言 mention.groupProducts |
| 技能库弹窗背景(2026-11-09 报障「技能库窗口半透明」): 恢复的 SkillsDialog/SkillsLibrary 用 `var(--app-content-bg)`, 该变量在 0.3 树只有使用无定义(0.2.7 时代由官方桌面宿主 CSS 提供, 壳页没有)→面板透明可见底下视频; 修=回退 `var(--app-content-bg,var(--bg-panel))`, CDP 实测 `rgb(24,24,24)` 不透明(弹窗体+粘性头部两处) |
| 侧栏收起双修(2026-11-09 报障「收起后图标后残字+空隙过一会才消失」): 宿主收起=class/宽度过渡，childList 观察不到且 React 重渲染孤儿化 RO——CDP 采样实证收起后 2.5s 零触发(标题 0/6 隐藏、stage 钉过渡中间值 119 露 63px 空隙)。修=四路幂等触发(class/style 属性观察+width 过渡结束+800ms 值守卫+RO 根替换重挂 watchRail)，实测 173ms 内 6/6 标题隐藏+stage 紧贴 rail 零空隙 |
| 自定义服务说明结构化列表(2026-11-09 用户裁决「更美观的列表显示」):CustomServices.tsx 的 note 渲染从 whitespace-pre-line 整块改为 ServiceNote 结构化行——`name: spec` 行=一行一条(名称左/等宽 spec 右/BROKEN 行名称走 --warn 警色), 散文行留段首; note 文本本身不动(智能体仍整读)。CDP 实测:行渲染+假 blob 消失+sfx 警色 rgb(240,176,60) |


## 11. 角色智能体名册(2026-10-24 实现; **2026-10-25 退役**, 见下; **2026-10-30 以「TinTin智能体」形态部分恢复**)

> **退役(2026-10-25 用户裁决)**: 角色是**服务端定义的智能体资产**, 客户端不使用服务端定义的智能体 —— 移除 composer 的角色选择器、本地预设装配与 `system-prompt` 人设补丁; 智能体以 acp bundle 默认人设运行, 专业分工由服务端能力(MCP 工具)承载。`film-agent.patch.yml` 单文件(模型路由+MCP 会话声明)。

> **部分恢复(2026-10-30 用户裁决, 当日两改: 先「视频生成」后定稿「TinTin智能体」)**: 官方 agent 菜单名册(ModelPopover, 非注入式角色选择器)新增 `tintin-agent`「**TinTin智能体**」行并**置首** —— 名册首个 ready 行即默认, 默认角色=TinTin智能体; deepseek(编导)行保留可手选。与 10-25 退役的区别: 角色归**桌面端所有**(非服务端智能体资产), 证据类=用户裁决。实现:
> - `film-tintin-agent.patch.yml`(按角色分文件): 模型路由同编导 —— 底层仍 deepseek-v4-flash, 但**显示名=「TinTin智能体」**, 选择器按钮与模型行因此显示角色名; 叠 `system-prompt` personaPrefix 人设: **调度服务端子智能体** —— 视频生成(create_video)/图片生成(create_image, t2i+cover)/音乐生成(create_music)/音频生成(create_audio kind=sfx)/口播生成(create_audio kind=tts, sample_id 音色)/数字人(create_digital_human, image+lipsync), 异步经 task_status_unified 轮询, 产物 curl 下载进项目 `assets/tintin/`(vid-/img-/bgm-/sfx-/vo- 命名)并在回复里报告路径; 生成无关请求引导切编导;
> - `FilmAgentManager` 按 `角色:项目` 分键会话, 项目记最近角色; 角色切换=人设不同=重建会话; home 分目录(`film-agent-home`/`film-tintin-agent-home`); `probe` 按角色起临时会话取选项;
> - 聊天端: `tintin-resources/src/agent-definitions.mjs` 登记 `tintin-agent`(持久化选择合法); 选择器持久键升 `openfilm.local-agents.v3`(一次性重置旧默认, 用户可再选并记住); `optionLabel`/`agentModelSummary`/`rowChoices` 拍平 ACP 会话上报的 **provider 分组嵌套**模型选项(修根因: 显示名在嵌套层, 此前永远落空 → 按钮显示裸模型 id `deepseek-v4-flash`); `tintin-agent` 图标=lucide Bot, Studio 设置页未知 id 走字母方块兜底(原生已有);
> - 服务端工具箱实证(2026-10-30 /mcp tools/list, **现为 7 工具**): create_video(comfygen t2v, 1~10s, 1080p 单卡独占)/create_image(t2i+cover)/create_music(MusicGen 同步)/create_audio(sfx|tts 同步)/create_digital_human(image|lipsync, base64)/task_status_unified/server_health; 影片会话经 mcpServers 声明已挂(2026-10-25 起)。

> **观察期禁用(2026-11-01 用户裁决)**: TinTin智能体定位定稿=**服务端编排智能体**(编排在服务端, 客户端只做会话持续与渲染); 服务端该功能处于观察期 —— 名册行加 `disabled`(「服务端智能体观察期,暂不可用」, 菜单置灰不可点), **deepseek 行置首=默认**(退回客户端 dsh 智能体形态)。代码分支全部保留(`film-acp.ts` 人设/补丁/home 分键不动), 恢复=去掉 `disabled` 一行。禁用语义落在共享 chat 层(`RosterAgent.disabled`; `currentAgent` 跳过禁用行; `ensureOptions` 探测排除禁用行, 堵住开菜单即拉起禁用会话的旁路; `load()` 把存量 picked=tintin-agent 回落 deepseek)。封面同批同款。全链路总览见 [tintin-agent-pipeline.md](tintin-agent-pipeline.md)。

- 角色 = TinTin 角色预设(`dsh-tintin-bundle/presets/`:tintin-assistant 总助手、tintin-director 编导、tintin-producer 制作、tintin-qc 质检、tintin-librarian 素材库),与主应用同源(每角色的 `preset.yml` 元数据 + `agent.cordis.yml` 组合,persona 前缀即角色人设);
- 影片智能体按角色生成**分角色补丁**(`<channelHome>/tintin/film-agent-<role>.patch.yml`):模型路由 + **persona 前缀替换**(读取角色预设的 persona 块,原样进补丁,与主应用文本一致);无角色时用默认补丁;
- 选择器:shell 页 composer 工具条内的「角色」下拉(官方同款样式, 注入式挂载)(`tintin-role.ts`,持久化 `tintin.role`)→ `window.__tintinRole` → studio-preload 的 `localAgents.start` 随 meta 送达 → 主进程 `begin(project, { tintinRole })`;(选择器位于聊天列 composer 正上方, 2026-10-24 用户裁决)
- 角色变化 = 人设不同 → `ensure` 重建会话(旧子进程 stop,新角色补丁拉起);
- 上游依据:`packages/acp/acp/src/index.ts` 明示 ACP 不组预设、部署方经配置加入(本实现以部署补丁承载,不改子模块);role 切换的 UI = TinTin 自有选择器(官方 composer 的 configOptions 仍为模型选择,不变)。

## 12. 移植文件清单(锚点)

### 12.1 过渡版功能 → 官方形态映射(验收口径)

| 过渡版功能 | 官方形态实现 | 移植点 |
|---|---|---|
| 自绘聊天列(会话/审批/提问/工具卡) | 官方 chat 源树编译进 shell 页(mountChat),经 `window.openfilmDesktop` 桥通信 | `openfilm-shell/main.tsx`、chat 源树(官方 pin) |
| 宿主契约桥面 | 官方 `apps/desktop/shell/bridge.ts` 逐字移植;**单宿主**(preload 不暴露迷你 host) | `openfilm-shell/bridge.ts`、`studio-preload.ts` |
| 选中/时间/引用注入 | Studio ProjectView → `host.onSelection/onRefer` → 官方聊天 @ 菜单与 pill | `bridge.ts`(官方 ProjectView) |
| 项目素材位 | Studio 左侧媒体面板(panel 不挂 assets/setAssetsOpen) | `bridge.ts` panel |
| 在线素材库 | shell 页内抽屉(主进程代理 `/material/*`);下载落 `assets/download` | `tintin-library.ts`、main-hook `openfilm:library:*` |
| 技能(原生+服务端合并) | `app.skills` 名单合并 + 正文注入(`/skills` 的 instruction) | main-hook `openfilm:native:skills-*` |
| 原生技能随包分发 | `resources/skills/openfilm` → 影片智能体 home 同步 | `scripts/prepare-skills.mjs`、`film-acp.ts` |
| 影片历史持久化 | `.film/chat.json` + `.film/logs/*.jsonl` | `film-chat.ts`、`desktop:chat:*` |
| 角色(编导/制作) | ACP 预设名册(部署配置,不改子模块) | `film-agent.patch.yml`(进行中) |

### 12.2 文件清单

| 层 | 文件 |
|---|---|
| shell 页构建 | `dsh-tintin-bundle/openfilm-shell/{main.tsx,bridge.ts,tintin-library.ts,boot.ts,index.html,shell.css,vite.config.ts,build.mjs}` + vendor 两树(`tintin-resources/openfilm-shell-src/{openfilm,chat,shared}`,官方 pin) |
| 通道主进程 | `dsh-plugin-desktop-tintin/src/tintin/{film-acp.ts,film-chat.ts,studio-preload.ts,main-hook.ts}` |
| 契约 | `dsh-plugin-desktop-tintin/src/openfilm-view-contract.ts`(三通道镜像) |
| 客户端视图 | `dsh-tintin-client-ui/client.js`(mountOpenFilm + 抽屉/日志条/接管) |
| 宿主桥插件 | `dsh-tintin-bundle/lib/openfilm/*`(studio-runtime 对账、providers-seed、libs-sync) |
| 官方运行时 | `dsh-plugin-desktop-tintin/tintin-resources/openfilm`(0.2.7,editor dist 由 shell 构建覆盖;**覆盖后自验 shell 标记**[build.mjs 2026-10-26],`verify-tintin-resources.mjs` 同步内容闸门——防 fetch:openfilm/热调把官方原版 dist 静默带进包) |

## 13. 生命周期与自愈

- **接管**:快轮询 → 命中接管;未命中清陈旧 run.json → `startStudio` 全新拉起(附着前**指纹对账**:editor dist 摘要 + 版本);
- **净场**:`will-quit` + `process 'exit'`(failLoud 崩溃路径)同步收场;开机对账按可执行路径甄别清理 openfilm node 孤儿(不碰其它 node);
- **轮次自愈(2026-10-26)**:film-acp 看门狗 —— prompt/工具调用 **5 分钟无任何语义事件**即判定挂死:失败回执 + 终结智能体(会话已持久,下次 start 以 resume 续上);等待用户审批/提问期间挂起计时(等人是合法状态);智能体进程退出 → 在途轮次立即错误收尾;**回执按轮重置**(trackTurn 清上一轮 done/events,条目按项目复用)。背景:ACP 长请求无超时,实测轮次在第 13 步的模型/工具调用上无限等待(16:32 包,12 步后冻结,「已发送、无下文」)。
- **事件直发本体(2026-10-26)**:`local-event` 通道载荷必须是 LocalAgentEvent 本体(`{key,kind,…}`)—— 曾发 `{project,event}` 包装壳,页面读 `event.kind` 恒 undefined,**所有 sessionUpdate 被静默丢弃**(实锤:项目 `.film/chat.json` 20 个轮次 items 全空、「没有进度与结果」;轮次状态只能靠 prompt IPC 的 Promise 翻转)。bridge.ts 对 localAgents 是原样透传,不拆包。
- **dsh 固化全模式(2026-10-26)**:目录构建收尾统一用已验证构建覆盖打包副本(`package-dir.mjs` → resources/dsh-cli-lib → win-unpacked)—— 原覆盖只挂在 local 收尾,full/unpack 曾直发未固化副本(§16 挂死缺陷)。
- **观测**:页面启动错误浮层(含行号)、底部日志条、统一 `diagnosticLog`(`%APPDATA%\TinTin\logs\dsh-*.log` + host 分册)。

## 14. 服务端契约(实测摘要)

| 端点 | 形状 |
|---|---|
| `/material/list?page&size&media_type&search` | `{items:[{id,filename,size,media_type,…}]}`(**顶层 items**) |
| `/material/serve?material_id=` | 二进制流 |
| `/material/thumbnail?material_id=` | 图片 |
| `/skills` | `{ok:true,skills:[{id,name,description,instruction}]}`(**顶层 skills**) |
| `/v1/audio/transcriptions` | multipart(file/model/language/response_format=verbose_json)→ words[]+duration |
| `/v1/audio/speech` | `{model,input,voice,response_format=wav}` → wav |
| `/llm/models`、`/llm/chat/completions` | OpenAI 兼容 |

## 15. 验收与门禁

- 逐条状态:[验收追踪表](tintin-openfilm-alignment-acceptance.md);
- 锚点:`check:tintin`(scripts/tintin-anchors.json)登记本文与承重代码锚点;变体门禁、typecheck、film-acp 单测同链;
- **文档同步门禁**(2026-10-24 用户裁决):视频剪辑运行时范围(openfilm-shell/、tintin/src/tintin/、client-ui/client.js)有改动而本文与验收表均未触碰 → `check:tintin` 失败(应急豁免 `TINTIN_DOC_SYNC=off`);构建产物(dist.stock/、package-lock.json、node_modules/)不计;
- 运行时行为改动:**先出包自测该项,通过才提交**;任何失败路径必须可观测(页面浮层/日志条/统一日志)。

## 16. 调用链全解(编排决策与执行的完整时序, 每阶段标注实现者)

### 16.1 参与者清单(谁实现了什么)

| 参与者 | 实现位置 | 职责 |
|---|---|---|
| 消息入口(官方聊天 UI) | `chat/src`(官方聊天, TinTin 编译树) | 收集文本/`@`引用/产品/附件, 发起轮次 |
| 智能体进程(编排执行器) | `dsh --profile acp`(film-agent-home), 由 `main-hook` 拉起 | 组装上下文、调模型、执行工具、循环直至完成 |
| 编排大模型(决策者) | TinTin 服务端 `/llm`(deepseek-v4-flash/pro) | 每轮推理: 输出"调哪个工具+参数"或最终回复; 从不直接发网络请求 |
| MCP client | harness 的 McpClient 插件(智能体进程内) | 维护与 MCP server 的连接; 上报工具清单; 执行 MCP 工具调用 |
| 本地 MCP 桥(规划 §16.4) | TinTin bundle 随包进程(stdio MCP server) | 拉 `/agent/registry` → 39 能力映射为 MCP 工具; 按注册表 api 字段执行 HTTP |
| 本地工具面 | harness 工具插件(bash/fs/web…)+ openfilm CLI + 媒体工具链 | 本地执行: 文件读写、影片渲染、媒体处理 |
| 服务端能力层 | TinTin 服务端(`/v1`、`/material`、`/tasks/*`、`/agent/registry`) | 提供媒体生成/素材/换物等能力端点(确定性代码调用) |
| 轮次留档(TurnLog) | 聊天日志面 + 会话存储(官方 ACP 会话系统) | 每轮的模型请求/响应/工具调用记录(取证入口) |

### 16.2 一轮会话的完整时序(六阶段)

**阶段 0 — 会话建立**(实现: `main-hook` film-acp + `studio-preload` localAgents + 官方聊天会话流程):
`main-hook` 写角色补丁(`film-agent-<role>.patch.yml`: `llm` 行=模型路由, `acp` 行=provider/model, `system-prompt` 行=角色人设)并拉起 `dsh --profile acp`; 会话 id 走 ACP resume 续聊。

**阶段 1 — 消息组装**(实现: 官方 PromptEditor + 我们的 library/products 桥 + 官方会话流程):
`@`引用展开为文件路径清单; 产品注入为结构化资料文本(粘贴事件进 Lexical); 附件入消息。产物 = 一条带上下文的消息。

**阶段 2 — 上下文与工具清单组装**(实现: acp bundle 的智能体循环):
系统提示词(personaPrefix=角色人设) + 技能手册 + 会话历史 + **工具清单**(本地工具 + MCP 桥映射的服务端能力[接线后])。工具清单 = 模型的能力视野 —— 不在清单里的能力模型永远无法编排。

**阶段 3 — 模型推理**(实现: `dsh-llm` 插件 → openai-completions → `POST {server}/llm/chat/completions`):
返回两种之一: `tool_calls`(决策: 调哪个工具+参数)或纯文本回复(结束)。**推理发生在服务端** —— 这就是"模型走服务端"的落点。

**阶段 4 — 工具执行**(实现: 智能体进程的执行器):
- MCP 工具: McpClient → stdio → 本地桥 → HTTP → 服务端能力端点(桥按注册表 api 字段确定性调用);
- 本地工具: harness 工具插件 + openfilm CLI + 媒体工具链直接执行(渲染/文件/换物流水线)。

**阶段 5 — 结果回填与循环**(实现: acp bundle 智能体循环):
工具结果以 `role:tool` 回填消息流 → 回到阶段 3 再推理。**N 次工具调用 = N+1 次模型推理**(编排的成本载体, flash/pro 档位差异的来源)。循环直至模型给出纯文本回复。

**阶段 6 — 轮次收尾与留档**(实现: 官方聊天轮次收尾 + TurnLog + 统一日志):
回复渲染给用户; TurnLog 记录本轮的模型请求/响应/工具调用(取证入口); 会话由官方 ACP 会话系统持久化(重进视频剪辑可续)。

### 16.3 分层职责总结(维护边界)

| 层 | 维护方 | 内容 |
|---|---|---|
| 客户端 TinTin | 本仓库 | `main-hook`(进程/补丁)、`studio-preload`(原生面)、MCP 桥、聊天编译树组合 |
| 服务端 | 服务端团队 | `/llm` 推理、`/v1` 媒体、`/material` 素材、`/tasks/*` 能力任务、`/agent/registry` 注册表 |
| 官方上游 | pinned harness | 智能体循环、工具插件、聊天 UI、ACP 协议(只组合, 不修改) |

### 16.4 本地 MCP 桥(2026-10-25 实现, 桥本体已完成并实测)

**桥本体**(`tintin-resources/mcp/registry-bridge.mjs`, stdio MCP server)——已实现并独立实测通过:

- 启动拉取 `/agent/registry`(实测 v1.1, 39 能力), 60s 刷新;
- `tools/list`: 每能力映射为 MCP 工具(name=id, description=名称+描述, inputSchema 由 input_schema 推导, 带 `?` 字段可省);
- `tools/call`: 按注册表 `method+path` 执行(POST=JSON body, GET=query), 长任务超时 300s, 结果以 text content 返回;
- 独立实测: initialize ✓ → tools/list(39 工具) ✓ → tools/call(material_list 实调 HTTP 200 返回真实数据) ✓。

**接线(待实施)——两条候选机制, 勘误后的准确结论**:

1. ~~profile 级 acp 行加 mcpServers~~: acp Config 无此字段(index.ts:75-90, 仅 provider/model/sessionListPageSize/stream), 不可行;
2. ~~profile 级 McpClient 行~~: 工具注册在挂载作用域的 ctx.tools(mcp-client index.ts:150), acp 特意挂 agent 作用域 —— 根级挂载是否可达 agent 工具面未经验证, 风险未消;
3. **官方正路: ACP `session/new` 的 `mcpServers` 参数**(acp/src/index.ts:213; stdio 需绝对路径 command, mcp.ts:45) —— 由会话发起方(runner 层)传入; 官方聊天已有每智能体 MCP 设置面(i18n `mcpHidden` 即此), 下一步: 在 dsh 影片智能体的设置中声明本地桥(node + `<resources>/openfilm/mcp/registry-bridge.mjs` + 服务端 URL 参数)。

**验证标准(与用户对齐)**: 智能体轮次的 TurnLog 出现 39 能力工具; 会话中触发一个服务端能力 → 服务端任务库出现对应任务(用户的服务端日志取证法)。

**接线完成(2026-10-25)**: 服务端 MCP server 已上线(streamable-http, `tintin-agent-server` v1.1, 40 工具, 客户端四项实测通过)——本地桥退场(单一事实源回归服务端)。客户端接线: `film-acp` 在 `session/new`/`resume` 参数声明 `mcpServers: [{name: "tintin-server", type: "http", url: "<server>/mcp"}]`(官方 ACP 语义, acp 插件翻译为 DSH MCP client)。验证标准不变: TurnLog 出现注册表工具 + 服务端任务库出现智能体触发的任务。

**可观测性(2026-10-25 补)**: 影片智能体子进程的 stderr 实时进管理器日志, 管理器日志全部落统一日志管道(source=film-acp) —— 失败轮次不再无记录。

**"Internal error/仍在处理"的最终定位(2026-10-25 原始 ACP 探针对照实验)**: 

- 同为 0.2.1-rc.2, **工作区构建的 dsh(apps/cli/lib/bin.js) 4 秒完成完整轮次**(模型经 /llm 回复 ✓), **打包副本的 dsh(resources/app/node_modules/@deepseek-ai/dsh) 在 session/prompt 后、发出任何模型请求之前挂死**(本地捕获服务器零请求; 有/无 MCP 声明、空/真实项目目录均复现) —— 缺陷在**打包副本的 dsh 构建**, 与补丁/MCP/服务端无关;
- 服务端侧已排除: /llm(流式+非流式+任意 key)✓、/mcp(握手+40 工具+健康调用)✓、补丁文件内容与落点 ✓;
- 修复方向(待实施): 影片智能体的 dsh 换用已验证可用的工作区构建(随包分发或路径解析), 或升级 dshmarket 至无此缺陷的版本;
- 附带发现: 影片智能体子进程在失败轮次后**不退出**(僵尸累积, 各占 ~130MB); `.codebuddy\logs` 是本机 CodeBuddy CLI 的日志目录(与本项目无关, 勿混读)。
- **终极根因(2026-10-25 日志实证)**: 打包版 dsh(dshmarket 构建)的模型解析栈是 **CodeBuddy 产品体系** —— AgentModelResolver 从 `https://copilot.tencent.com/v3/config` 拉云端模型目录(34 模型), **无视补丁里的 llm-pi-ai providers**; MCP 声明同样未生效(子进程内 `allServers=[]`)。其配置面 = `C:\Users\Administrator\.codebuddy\models.json`(日志明示 userConfigPath)与 home 的 `llm-pi-ai:` settings 段。
- **修复方向(待实施)**: 将 tintin-server provider 与 deepseek 模型写入 dshmarket 构建读取的配置面(models.json / llm-pi-ai settings 段), 使打包版 dsh 的模型与能力经服务端; 或升级 dshmarket 至与补丁语义一致的版本。验证标准不变: 子进程日志出现 tintin-server 路由 + 服务端 /llm 命中。
- **pi-ai 版本排除(2026-10-25 隔离探针)**: 打包树 pi-ai 降至 1.1.0(与工作区一致)仍复现挂起 —— pi-ai 版本不是根因; 最终定位: **打包副本 dsh 的 session/prompt 在发出任何模型请求前挂起**(原始 ACP 探针 + 捕获服务器零请求, 隔离 home 下稳定复现), 而工作区构建 4 秒完成同流程。**修复: 影片智能体的 dsh 改用工作区构建(apps/cli/lib), 打包时随包分发**; 附带补齐失败子进程回收。
- **实施清单(2026-10-25 定稿, 下会话第一项)**: ①把已验证的工作区 dsh 构建提交为 `tintin-resources/dsh-cli/lib/`(源: deepseek-harness/apps/cli/lib, 实测 4 秒完整轮次); ②TinTin 打包脚本在 app 树组装后用该副本覆盖 `resources/app/node_modules/@deepseek-ai/dsh/lib`(其依赖即 app 树自带的 @deepseek-ai/*, 解析无虞); ③film-acp 不改(解析逻辑不变); ④验证: 原始 ACP 探针对新建包跑 initialize→session/new(含 mcpServers)→prompt, 4 秒内回复即闭环; ⑤回归: e2e(TINTIN_E2E=1)+ 打包标记检查。
- **A/B/C 对照结果(2026-10-26 可靠仪器=官方 SDK e2e)**: 工作区 dsh ✓ 4s、打包版 dsh ✓ 3.4s、真实条件(真实 cwd/home/打包版 dsh) ✓ 3.9s —— **智能体链路全部功能正常**; 手写原始探针为坏仪器(任何配置从未成功), 其结论全部作废。剩余疑点仅在聊天 UI 层到管理器的路径(用户会话卡在 UI 层)。诊断覆盖: TINTIN_DSH_BIN 可指定被测 dsh。

## 16.5 封面会话复用(2026-10-28, 需求文档 docs/cover-generation-requirements.md §十一)

openfilm-shell 构建新增**第二入口** `cover-chat.html`(vite rollupOptions.input 双入口): 官方聊天组件(App.tsx 树)不带 Studio 单独成页, 伺服于 bundle 路由 `/tintin/cover/chat`, 由封面编辑器(dsh-tintin-cover-plugin)右栏 iframe 承载(KeepAlive)。构建产物随既有 overlay 进入 vendored openfilm 包 editor dist(打包链 prepare:openfilm-shell 不变)。

- 页面桥 `cover-chat-bridge.ts`: 实现 `window.openfilmDesktop` 的聊天子集(agents 名册单行 deepseek / localAgents 会话协议 / chat 记录 / skills / hello), 后端是 bundle `/tintin/cover/api/acp/*` 路由族(cover-acp-bridge.js: dsh --profile acp 子进程, 与 FilmAgentManager 同构; 权限/表单提问路由给聊天卡; SSE 事件流带 Last-Event-ID 重放);
- 编辑器 ↔ 会话: postMessage 推实时上下文(tintin-cover:context, 模板+图层取值), prompt 注入 `<cover_context>`; 图层 @ 引用 = App.tsx mentionProviders 新增图层组(app-bridge 新可选 `coverLayers()`, 影片场景恒 undefined 不受影响), pill 走 StudioRef layer 形状序列化;
- 图层状态对流: `cover.props.json`(cover 工作目录), 编辑器 600ms 防抖写(origin=editor)/2s 轮询读(origin=agent 才套用), agent 经 fs 工具改字即画布刷新;
- 信任: 浏览器请求走 isTrustedRequest(loopback+Origin); agent 子进程凭会话令牌头 `x-tintin-cover-agent`(令牌只进 agent 环境)调用编辑器 API(生图/导出);
- chat.css 作用域根 `.of-chat` 由 cover-chat.html 两块宿主(#root/#of-chat-layer)承担, 主题恒深色。

**双入口回退(2026-10-28 用户裁决:源码共享,构建隔离)**: 惰性 Proxy 等修复虽让双入口构建双页探针全绿, 但构建层耦合这一类问题(chunk 重排/产物互相覆盖/依赖漂移)只有物理隔离能根除, 且封面专属页面桥按铁律应住封面插件自己的包。终态: 影片 shell 恢复**单入口**(官方架构, Studio+聊天同页, 从此不碰); 封面会话页迁往 `dsh-tintin-cover-plugin/chat-shell/`(独立 npm 工位, 同 chat 源树别名/scoped css 复刻, vite `base:'/tintin/cover/chat/'`), 产物经 stage.mjs 进 extraResources, 由 bundle 路由 `/tintin/cover/chat` 伺服。本节其余修复(lazy app-bridge/图层 provider 展开/coverLayers 兜底)为源码级, 两构建共用仍有效。

**双入口回归与修复(2026-10-28 无头浏览器实证, 存档)**: 分块后聊天树成为两入口的共享 chunk, `app-bridge.ts` 的 `export const app = window.openfilmDesktop` 在**模块求值时捕获**, 而共享 chunk 先于 shell bridge(在主 chunk 体内)执行 → `app` 恒 undefined → **影片会话框消失**(mountChat 崩)。修复: `app` 改惰性 Proxy(每次属性访问读 window, 函数绑定 this)——官方 preload 先行场景同样成立。同批修复: App.tsx 图层 provider 需展开进 providers 数组(整组数组会成为无 `items` 的 provider, 渲染即崩); App.tsx `coverLayers` 调用兜 `?? []`(影片桥无此方法)。验证: Playwright(headless shell) 同 dist 双页探针——影片页会话栏/输入框/starters 全挂载零 pageerror, 封面页 @ 菜单出「图层」组(编辑器 postMessage 实时图层), 编辑器图层行 @ 按钮 → 聊天输入框引用 pill。

**加载卡死排障(2026-10-28 下午, 用户实报会话列空转)**: 修复版构建后页面零错误(统一日志 studio-renderer 管道全天仅 13:42 旧构建的 `app undefined` 两条), 会话列停在 Loader——排障发现 **`window.tintinFilmDir` 从未有任何赋值点**(bridge.ts/tintin-library.ts 只读不写, preload 只暴露在 openfilmNative 下) → bridge 的 follow() 永远提前返回, 项目解析只剩 Studio 事件流一条路。修复: studio-preload `contextBridge.exposeInMainWorld('tintinFilmDir', …)` 直挂同名键, follow() 按目录匹配 Studio 项目复活(独立于 Studio 内部事件的第二条项目解析路)。has-shell 探测同步加深(chatChildren/chatTextHead/helloProject/bootError, 日志条直接可见), shell 就绪但聊天列空(加载卡死)沿变化打 `chat-column-stuck` warn 进统一日志。

## 16.6 技能弹窗服务端技能的详情入口与删除(2026-10-31, 用户报障「详情按钮为什么没有, 还有删除按钮」)

SkillsLibrary(Studio 示例弹窗)的服务端 tab 此前形态: 卡片**整卡可点**进 ServerDetail 详情页(1031 批), 已安装行只读无出口——用户预期是显式按钮。本批三处补齐:

- **显式详情按钮**: 服务端卡片(已安装态)与「已安装」视图的服务端行都加「详情」按钮, 与整卡点击同一条 `setServerOpened` 通路(入口冗余, 不改既有交互);
- **删除按钮**: 已安装态卡片/行/详情页加「删除」, 走新 IPC 通道 `openfilm:skills:remove`(main-hook: 只删 `film-agent-home/skills/<净化名>` 安装副本, 与 install 同款字符净化防穿越, 不触服务端注册表; 删后广播 `openfilm:skills-changed` 供聊天清单自动刷新); UI 侧 ConfirmDialog 二次确认(独立文案: 只删本机副本、新会话不再携带、可重装), 删后该技能在服务端 tab 回到未安装态(可再安装);
- **i18n**: `serverRemove/serverRemoveTitle/serverRemoveHint` 五语言(zh-CN/en/ja/ko/es)。

设计语义(相对 1030 批注释的变更): 服务端技能的「卸载」不再视为纯服务端事务——本机安装副本的生命周期归弹窗管(装/删对称), 服务端注册表的增删仍不在此弹窗范围。

## 16.7 浏览器域：达人库移除(2026-11-04, 用户裁决「删除达人库」)

浏览器页(`build/tintin-browser.html`)功能扩展行的「达人库」入口按用户裁决整体移除:

- **UI**: 功能扩展行删 `creators` 项; `#view-creators` 视图(达人库 tab + 新增达人 + 页内素材采集副视图)整段删除; `#view-collect` 的「到达人库发起采集」跳转按钮随迁删除(目标视图不存在);
- **页面脚本**: 达人库逻辑(crSwitch/crLoad/crRenderCreators/crAdd/采集进度订阅)删除; 素材采集清单保留为独立查看面——`clLoad/clRender` 瘦身为只读 `creators:getCollected`(不再引用已删的 crTab 双列表); 仅服务于达人采集进度的 `alLogLine` 一并删除(零调用方);
- **preload**(`browser-page-preload.ts`): 只保留 `creatorsGetCollected`(素材采集清单唯一数据源), `creators:*` 其余四通道与 `onCreatorsProgress` 暴露点删除; 壳侧 `creators-store.ts` 与五通道 IPC 原样保留(锚点不要求动, `appendCollected` 现无 UI 写入方——清单成为既有记录的存档视图);
- 验证: 页面脚本 `node --check` + jsdom 装载冒烟(无桥启动零异常、功能扩展行五项、素材采集切换与视图元素齐全) + `check:tintin` 绿。

## 16.8 浏览器域：使用性限制清除批(2026-11-04, 用户裁决「限制删除；登录态与下载链路保留；平台退化为正常收藏」)

限制盘点(同日审计)分层 A-E 共 11 项, 本批清除使用面四项, **下载扩展/登录态/下载链路机制一件未动**(分区 jar/cookie 导出/嗅探/B站与抖音下载助手/media-downloader 全保留):

- **地址栏直达(A1)**: `tintin-browser-page:action` 的 `go`/`home` 不再要求「先有活跃平台视图」——无视图时自动落分区承载输入; 原「尚未打开任何平台页面」静默拒载(且页面丢弃返回结果)退役;
- **域名路由分区(B5)**: 输入网址按 `detectPlatformFromUrl` 路由——已知平台落自己分区(登录态进导出链读的 cookie jar), 其余落 web 分区; 原行为=永远留在当前分区, 跨站登录态断;
- **种子页只首载(B6, 收藏语义)**: `navigateTo(platform, targetUrl?)` + `seededPlatforms` —— 平台行=收藏语义「切到该站现场」, 首次激活才载种子页, 再次点击保留现场不重载; 原行为=每次点击强制回种子页;
- **弹窗就地打开(B3)**: `setWindowOpenHandler` 的 http(s) 新页/弹窗改为在当前分区视图就地打开(弹窗式 OAuth 登录态因此落进本分区, cookie 导出链可达), 非 http 协议拒绝; 原 SRC C7「外链一律交系统浏览器」红线按本裁决退役;
- **搜索兜底(B4, 页面)**: 地址栏非网址输入(无点分域名形态)不再硬拼 `https://`(无效主机白屏), 按关键词走百度搜索; 域名/IP/localhost 自动补协议;
- **web 起始页(A2)**: pinterest.com(国内不可达, 首开必白屏)→ baidu.com;
- 实现位置: browser-service.ts(activatePlatformView 提取 + navigateTo 签名扩展 + action 分派重排 + window-open 重写)/platform-meta.ts(种子)/tintin-browser.html(normalizeAddress); 千行红线付账: 抽取脚本三件套(extractorScriptDir/extractionError/buildExtractorScript)提取 `extract-script.ts`, browser-service 980 行; 保留项: 登录徽标/分区隔离/全部下载面; 未清除: 代理支持(需先有代理来源设置面)、密码保存(Electron 分区无此机制)、「服务端」死端按钮(E10, 待产品裁决)。

**收尾批(同日)**: E10「服务端」死端按钮按其标题语义落地 —— 壳侧新增 `resolveServerUrl` 注入(main-hook 用通道 home `tintin/config.json` 的 `server.url` 供值, dsh-tintin-browser 不依赖通道目录约定), `server` 动作改为 navigateTo('web', 服务端地址), 未配置返回人话错误; 页面新增 `#toast` 提示条, `nav()` 统一出口把全部动作的 `ok:false`/异常上屏(消灭本批根因同类的「静默失败」类), `serverBtn` 改走 nav。

## 16.9 浏览器域：网页收藏与每日素材移除(2026-11-04, 用户裁决「每日素材，素材收藏 删除」)

功能扩展行(红框两项)整删, 行剩 3 项(自动上架/素材采集/扩展管理):

- **UI**: `#view-favorites`(网页收藏)与 `#view-dailyassets`(每日素材, 含日期/类型/搜索/排序筛选与「采集今日热点」按钮)两视图 + EXT_ITEMS 两项 + 页面脚本(fv 三件/da 全家含绑定与启动拉取)删除; `.da-*` 卡片 CSS 随删(`.da-btn` 保留——历史「刷新」/扩展「安装」行内按钮仍在用, 注释改小按钮语义);
- **preload**: `getDailyAssets/openDailyAsset/captureHotspots/onHotspotProgress` 与收藏三通道(`mediaStorageGetFavorites/AddFavorite/RemoveFavorite`)暴露点删除; **保留** `revealDailyAsset`(历史视图「定位」在用)与 `mediaStorageGetDownloads/GetSniffed`(历史视图数据源); `mediaStorageClearHistory` 本就无调用方, 未动(非本批后果);
- **壳层**: `browser:getDailyAssets/openDailyAsset/captureHotspots` 三个 handler 删除(唯一消费方=被删视图); 扫描逻辑 `daily-assets-logic.ts` 与热点采集 `hotspot-capture.ts` **原样保留**(纯函数+单测在册; 热点采集经 loopback 门面对 agent 的通路不受影响); media-storage 工厂不动(锚点+下载/嗅探记录仍被历史消费);
- 边界澄清: 媒体包 `global.d.ts` 的浏览器桥段是 **SRC 源项目 `window.tintinBrowser` 契约的只读参考类型**(媒体包零调用), 与现行 `dshDesktopBrowser` 面无关, 不随本批改;
- 后果备注: 「采集今日热点」的 UI 入口随视图消失, agent 侧 loopback `captureHotspots` 仍在; 验证: 页面语法+jsdom 冒烟(功能扩展 3 项/两视图元素不存在/历史与扩展视图切换完好)+tintin-browser 87 用例+check:tintin+包 build 全绿。

## 16.10 浏览器域：App 深链吞掉(2026-11-04, 用户报障「获取打开此'bytedance'链接的应用」弹窗, 裁决「按推荐处理」)

现象=集成浏览器里点 B站页面(广告位)的 `bytedance://` 深链, Windows 弹「获取打开此链接的应用」。根因两层: ①Electron 壳对外部协议**无询问直接转交系统**(`shell.openExternal`), 没有 Chrome 的三道前置防线(用户手势校验/沙盒 iframe 静默拦截/自家确认气泡)——系统查无处理程序即弹; ②B3 批「弹窗就地打开」后, 广告落地页在我们的分区视图里触发深链, 弹窗从系统浏览器转移到产品内。实现:

- **名单**: `PLATFORM_DEEP_LINK_SCHEMES`(platform-meta, 15 项: bytedance/snssdk1128/snssdk1233/snssdk13/douyin/douyinlite/toutiao/ixigua/bilibili/biliintl/xhsdiscover/kuaishou/kwai/ksnebula/weixin) + 纯函数 `isDeepLinkScheme`(大小写不敏感);
- **主帧拦截**: `ensureBrowserView` 的 `will-navigate` 命中名单 → `preventDefault`(页面停在原地) + 打点 `deep link blocked (main frame)`;
- **子帧/兜底**: `registerDeepLinkSwallow` 给 9 个平台分区 session 注册空响应协议处理器(204 + 打点 `deep link swallowed`)——协议处理器存在后 Chromium 不再走外部协议链路, iframe 深链页内消化主页面无损; 注册失败打点;
- **名单外协议不拦**(mailto/tel/淘宝 tbopen 等维持系统行为, 与裁决范围一致, 名单可扩); 登录态/下载链路不受影响(纯导航层拦截);
- 验证: platform-meta 新增两组单例(名单覆盖/大小写与无关协议), tintin-browser 13 文件用例全绿, check:tintin + 包 build 绿。

## 16.11 浏览器域：媒体嗅探三处缺陷修复(2026-11-04, 用户报障「抖音播放嗅探不到视频下载地址」, 裁决「实施」)

嗅探链路(壳侧 webRequest 采集→分区缓冲→页面轮询)自 Phase 3 移植(50124521d8)起**从未端到端工作过**, 三处缺陷:

- **A 壳侧(致命)**: `createMediaSniffer()` 创建语句在 attach 循环之后约 200 行, `mediaSniffer?.attach` 可选链在 null 上静默吞掉 → webRequest 监听从未注册; 循环一次性门(cookieWatchInstalled)使它永远补不上 → **修复=创建上移到挂接之前**(本地 `sniffer` 常量挂接, 免可选链)。
- **B 页面侧**: 平台按钮构建循环里混入缩进异常的 `sniffWatch(p.id)`(合并残留), 在**构建时**逐个执行 → `sniffPlatform` 恒锁平台列表最后一个(即梦AI), 面板每 2s 轮询的永远是即梦的空缓冲 → **修复=移进 onclick**, 点谁嗅探谁。
- **C 挂接面缺口**: attach 循环骑在 `PLATFORM_COOKIE_DOMAINS`(6 下载平台)上, **web/即梦分区从未挂嗅探**——网页浏览器分区的媒体永远嗅不到 → **修复=独立循环覆盖 `PLATFORM_IDS` 全部 9 分区**。
- **顺带接线(裁决内)**: SRC 详情页白名单门——`attach` 增加可选 `pageUrl` 供应方(壳侧供该平台当前页 URL), 页面不在详情页模式白名单内不收; 防 feed 页预加载相邻视频刷屏(SRC 2026-09-02 用户反馈事故, platform-meta 白名单表移植了但从未接线); 无供应方时兼容旧调用面不门控。
- 千行红线付账: `registerDeepLinkSwallow` 提取 `deep-link-guard.ts`(browser-service 988 行时点回撤)。
- 验证: sniffer 新增门控用例(feed 不收/详情收/web 分区口径/旧面兼容), tintin-browser 13 文件用例全绿, check:tintin + 包 build 绿; URL 规则本身对抖音覆盖(`.douyinvod.com`/`video/tos`/`.mp4`/`.m3u8`), 非规则问题。

## 16.12 浏览器域：下载引擎 cookie 分区名修复(2026-11-04, 下载链路审计发现, 裁决「修复」)

`startMedia` 用 `persist:tintin-${platformId}` 现拼分区名, 而 bilibili/xiaohongshu 的真实分区是**别名** `persist:tintin-bili`/`persist:tintin-xhs`(platform-meta)——拼出**不存在的分区**, `sessionFromPartition` 拿到空 jar: yt-dlp 路线的临时 Netscape 与流式路线的 Cookie 头**全部匿名**, B站高画质流(扩展助手双流合并那链)/小红书登录态流下载失败降级。修复: 新增 `partitionForPlatform`(media-downloader, 导出供单测)——`PLATFORM_DEFS[platformId]?.partition ?? 'persist:tintin-' + platformId`(未知名表平台回落原拼接, 缺省保持 `persist:tintin-browser`); startMedia 改走该映射。验证: 新增纯函数映射用例 + 本地 http server 端到端用例(platformId=bilibili 实测请求分区=persist:tintin-bili、请求头带 Cookie=SESSDATA 与 Referer), tintin-browser 13 文件用例全绿, check:tintin + 包 build 绿。抖音/快手/视频号/YouTube/web 直名分区原拼接本就对, 行为不变。

## 16.13 影片/封面会话图片输入声明修复(2026-11-04,1104 事故总根因,用户立项「感知闭环」批)

**总根因实锤**:封面会话带图 QA 的一切怪象(「读取中」无结果/智能体没见过图/像素扫描死循环)的协议层根因=`llm-pi-ai` 的模型行**缺省 `input` 为纯文本**——会话不广播 inline image prompts,用户附图在 ACP 协议层即被拒(`Invalid params: inline image prompts were not advertised`),智能体从未见过用户图,「查看这张图片」全是无图瞎猜。修复=影片(film-acp.ts `filmAgentPatchText`)+封面(cover-acp-bridge.js `writePatch`)模型行统一声明 `input: [text, image]`(服务端 /llm 已 caption-then-main 部署生效,A/B/C 探针三绿,声明即真)。联动解锁:①harness 原生 read-image 工具(模型声明 image 输入后自动可用,1104 探针实证智能体用它看图);②MCP 工具图片块结果可回传(mcp-cover-tools 的 render_preview/read_image 依赖此闸)。端到端探针(.tmp-cover-probe-image2.mjs):带图 prompt 被接受,智能体读图后输出计划先行文本(「计划:①…②用 matting 抠图,把鼠标主体…」),多步工具连跑健康。双文档同步=本文+cover-generation-requirements.md §十四。

## 16.14 浏览器域：抖音解析支持口令(2026-11-04, 用户报障「解析下载并没有执行」, 裁决选 1)

根因=粘贴的是抖音**口令**(`7.97 Z@j.Cu 09/09 UYz:/ 标题`, App 分享→复制口令), 不含 `v.douyin.com` 域名, 解析层(SRC 1:1)按设计拒绝——拒绝文案原只有按钮下方 11px 小红字(右栏窄不可见=「没反应」错觉)。实施(超出 SRC 1:1 的扩展, 依据=本条报障):

- **纯函数**(douyin-parse-logic): `extractDouyinPasscode`——日期锚定(`MM/DD 码:/`)优先、词边界泛匹配退路(lookbehind 排除 https:/ 等 URL 成分), URL 文本不误抓; `buildDouyinShortUrl` 码拼 `https://v.douyin.com/<码>/`;
- **IPC**(media-downloader douyinParse): 302 探测抽 `probeVideoIdFromRedirect` 复用; 分支序=直贴视频页 URL → 短链 302 → **口令码拼短链 302**(无链接时; 失败不在此死路, 喂构造短链落 API 兜底再试); 全败文案改「未找到有效的抖音分享链接或口令」;
- **页面**: placeholder/说明改「分享链接或口令」; 解析失败/下载发起失败 toast 上屏(不再只有小红字);
- 验证: 纯函数 3 用例(日期锚定含实报乱码形态/泛匹配与不误抓/短链拼装与非法码) + IPC 端到端 2 用例(stub fetch: 口令→短链 302→videoPageUrl; 302 失败回落 API 且喂 `v.douyin.com%2FUYz`), 页面语法 + tintin-browser 全量 + check:tintin + 包 build 绿。

## 16.15 浏览器域：yt-dlp 下载目标修复 + 解析/下载分离(2026-11-05, 用户报障「解析没有结果」, 附 `Unsupported URL: https://www.douyin.com/` 截图)

- **引擎目标 bug(老缺陷, 本批截图实证)**: `startMedia` yt-dlp 路线 `urlToDownload = referer || url` 把两条链的参数语义混用 —— 解析链 url=视频页 / referer=站点首页(`https://www.douyin.com/`), 结果 yt-dlp 拿到**首页**报 Unsupported URL(302 解析本身成功, videoPageUrl 被顶掉)。修复: 导出 `resolveYtdlpTargetUrl`——url 本身是合法视频页就取 url, 否则回落 `referer || url`; 嗅探链(url=媒体直链/referer=视频页)保持 SRC 口径不变。三用例回归(解析链/嗅探链/双缺回落)。
- **解析/下载分离(用户裁决)**: 右栏抖音助手改两段式 —— 「解析」按钮只出结果(标题卡+「下载视频」按钮), 点下载才走 `downloadMediaStart`; 重解析自动撤旧卡。文件: tintin-browser.html(dyParseSec 结构 + dyParse/dyDownloadBtn 两函数)。
- 验证: tintin-browser 13 文件用例全绿, check:tintin + 包 build + 页面语法绿。

## 16.16 浏览器域：抖音下载 cookie 双口径 + 标题命名(2026-11-05, 用户报障「下载失败+文件名抖音视频」, 附 `Fresh cookies are needed` 截图)

两项: ①**cookie 导出双口径并取去重** —— 原只走 `cookies.get({ domain })` 域名过滤, 部分 Electron 形态下漏收(分区已登录仍空 jar) → yt-dlp 报 `Fresh cookies (not necessarily logged in) are needed`; 改 **URL 口径(与流式路线同源, 实测可用)优先 + 域名口径补漏**, name|domain|path 去重, 并打点导出条数(`yt-dlp cookies exported: N cookies (平台)`) —— 再失败可直接从统一日志看到 jar 是否为空; ②**标题命名** —— 解析链返回结构原无 desc(只有 API 兜底带), 页面落到「抖音视频」占位; 新增 `extractDouyinCaption`(码段之后/首个链接之前的描述段, 样板话剥离, 无码段不提取), douyinParse 成功返回随文本带回 `desc`, 页面结果卡标题与文件名都改用真标题(如 `操盘百亿的「地产神童」罗兆辉....mp4`)。验证: 纯函数 2 用例(实报样本/样板话与纯链接 null) + IPC 用例断言 desc 回带, tintin-browser 全量 + check:tintin + 包 build 绿。

## 16.17 底部日志条退役 + 会话历史栏删除(2026-11-07, 用户裁决)

- **底部日志条退役**:`dsh-tintin-client-ui/client.js` 的 `tintin-of-logbar`(「官方聊天已接管 ✓ | 诊断 JSON」常驻条,2026-10-24 用户要求加)按用户裁决删除 —— 条本身、4s 轮询(`hasShellChat` 刷文案)、CSS 规则全撤;原生视图底部让出的 22px 收回,**视图铺满舞台全高**(顶部 40px chrome 补偿保留)。诊断走 console 与统一日志(`%APPDATA%TinTinlogsdsh-*.log`),不再占界面。
- **会话历史栏删除**:0.3 聊天列顶部的 ConversationSessionBar(会话切换条)按用户裁决不渲染(chat App.tsx 死分支保留 JSX,升级重放清单项);会话本身照常持久/轮转,对话区从顶铺到输入框。恢复=去掉 `{false ? … : null}` 一处。
- 同批:客户端视图接管检测(`has-shell` 探针)保留在主进程,门禁/排障不受日志条删除影响。
- **提交时序补记(2026-11-07 晚)**:本节文档先随 45638a01d0 单独入库,配套的 client.js 运行时改动仍留工作树待提交——doc-sync 门禁按「工作树 vs HEAD」比对,期间报「运行时改了文档没改」为时序性假红;待 client.js 与本节同批提交后即闭合。
- **时序补记续(2026-11-08 夜)**:运行时改动仍未提交,打包门禁(build-202611082210)同型假红再现——本条即工作树内的文档配对触点;**闭环=client.js 与本节同批提交**,在那之前每次打包都会重演此红。

## 16.17 浏览器域：抖音下载改走嗅探捕获 + yt-dlp 二进制刷新(2026-11-07, 用户报障「下载失败+文件名抖音视频」续)

**上游实锤(本机四组对照实验)**: 当期 yt-dlp(2026.10.26, 源码已读)抖音抽取器**不会算 a_bogus 签名** —— `tiktok.py DouyinIE._real_extract` 裸发 `aweme/detail`(query 只有 aweme_id), 源码 `TODO: Run verification challenge code to generate signature cookies` 明写缺口; 当期抖音服务端对该裸请求必 403 → 抽取器把 403 误报成「Fresh cookies are needed」。对照实验: ①新二进制匿名 → 同错; ②新二进制+全量登录 jar(交接文件 66 条含 ttwid/s_v_web_id/sessionid, 11 分钟新鲜) → 同错; ③+Deno 2.9.8(JS runtimes 由 none→deno) → 同错; ④+Chrome UA → 同错。**cookie/版本/运行时三要素全部排除, 缺口在上游签名实现**。第三方解析 API(dy.xs25.cn)也已失联(curl 连接失败)。同期修了引擎两处: ①yt-dlp 下载目标被 referer(站点首页)顶掉(解析链语义混用, B 站等仍受益此修); ②cookie 导出双口径(当时以为 jar 空)。

**本批实施(下载改走自家已验证链路)**: 解析链下载不再走 yt-dlp —— 「解析」出视频后点「下载视频」= **打开视频页(page.action go, 域名路由进抖音分区) → 嗅探捕获新出现的播放地址(基线差分轮询, 25s 超时) → sniffDownload 流式下载(分区 cookie+referer, 1012 验证过的那套)**; `browser:sniffDownload` 增加可选 `filename`(解析链按视频标题命名, 面板直下保持 URL 尾段名); 超时文案指引「点播放后重试捕获/媒体嗅探面板直下」。

**yt-dlp 二进制与拉取脚本**: fetch-tintin-binaries.mjs 重写 —— yt-dlp 改为**每次打包下载最新 release**(PE 头校验+--version 探针; GitHub 不可达回落旧拷贝并大声告警, 不阻塞打包), ffmpeg/ffprobe 维持旧拷贝; 本机实拉 2026.08.19→**2026.10.26** 成功(curl 直连可用, node fetch 曾超时=间歇阻断)。**二进制刷新对抖音无效但对 B站 m3u8 嗅探/YouTube videoplayback 等 yt-dlp 路线仍是必要升级**。
- 验证: 页面语法 + tintin-browser 全量 + check:tintin + 包 build 绿; 端到端待用户实机(依赖分区播放行为)。

## 16.18 浏览器域：切换机制修复 + 视图底色随主题 + 主题切换(2026-11-08, 用户报障「抖音切 YouTube 无法跳转/网址为空/声音还在/空白界面白底」, 三项裁决)

**切换机制双 bug(11-08 批自查认账)**: ①`activatePlatformView` 会立刻翻转 `currentPlatform`, 而 `navigateTo` 的「同平台重击保持现场」判定写在翻转之后 → 恒真 → **跨平台导航永不发生**, 点击 YouTube 只是切到一个 about:blank 分区视图(白屏+网址栏空); ②种子页加载失败(YouTube 需代理)也标记已播种 → 白屏永久化。修复: 判定前置(`keepState = currentPlatform === platform || (fxg && 视图已存在)`), `seededPlatforms` 整个移除 —— 跨平台点击**必导航**到该站首页, 同平台重击保持现场, fxg 重入保持现场(首入仍载种子)。声音静音(11-08 前批)已在该构建。

**视图底色随主题**: 平台分区视图与内嵌 UI 视图底色原硬编码(#ffffff/#141416) —— 暗色应用里未加载视图白底刺眼; 改 `nativeTheme.shouldUseDarkColors` 动态取值 + `updated` 事件同步全部存活视图。

**主题切换(用户要求新功能)**: 浏览器工具栏新增 ◐ 按钮, auto(跟随系统)/light/dark 三态循环, `localStorage tintin-browser-theme` 记忆; CSS: 暗色媒体查询改 `html:not([data-theme='light'])` 门控 + `html[data-theme]` 显式覆盖 + color-scheme。注意: 切换的是**浏览器壳**(工具栏/面板/各视图), 平台分区里的第三方网页内容仍由各站点自身主题决定。
- 验证: 页面语法 + tintin-browser 全量 + 包 build 绿; check:tintin 红点均属并行会话在途 openfilm-shell 重构(逐次查证归属, 与本批零交集)。

## 16.19 浏览器域：「服务端」标签整体移除(2026-11-08, 用户裁决「浏览器里的服务器这个标签删除」)

11-04 收尾批补活的「服务端」按钮按本裁决整体退役, 整链清除: 页面按钮(bmbar 右侧+onclick)/壳侧 `server` 动作分支/`resolveServerUrl` 注入链(browser-service options+main-hook 传值)/`serverUrlResolver` 模块量。背景沿革: 该按钮原为 SRC「系外浏览器提示位」死端(只回错误文案不上屏) → 11-04 补活(打开配置的服务端地址) → 本批用户裁决移除。验证: 全链零残留(仅存一行墓碑注释)+页面语法+tintin-browser 全量+包 build 绿。

## 16.20 浏览器域：侧栏收起态标题裁字修复(2026-11-08, 用户报障「插件行图标只显示一个字」, 问「从哪个版本开始」)

**自 `v0.2.2-rc.1-20261109-1021` 包始**(上一包 `v0.2.1-rc.1-20261104-1603` 正常)。两包之间宿主演示层(deepseek web)0.2.1-rc.1→0.2.2-rc.1 跟线 + openfilm-shell 0.2.7 升级落地 → 侧栏行 DOM 变形。坏的不是图标(注入的 16×16 线稿 svg 一直在)——坏的是 2026-10-19 的**收起态标题隐藏**：其「第一个叶子 span」启发式 + 侧栏类名宽度查询是按 0.2.1 行 DOM 写的，0.2.2 行 DOM 变形后失配 → 标题没隐藏，窄栏裁成首字(素/运/媒/封/视/浏)。`client.js` 该逻辑自 10-19 后从未改过(git -S 实证)——不是改坏的，是宿主演示层升级震坏的。修复(免疫演示层漂移)：注入标题时打 `data-tintin-title` 标记，隐藏按标记查(不再按 DOM 形状猜)；宽度优先读克隆行自身宿主容器实测值，旧侧栏选择器降为兜底。与并行会话在途 client.js 改动(动画白名单/openDir)不同区域无碰撞。验证: node --check + tintin-browser 全量 + check:tintin + 包 build 绿。

## 16.21 浏览器域：设置入口+页内查找+右键菜单+缩放+快捷键(2026-11-08, 第一批 P0 五项, 裁决「先做第一批」)

界面审计(同日)结论: 无设置面的根因=移植定位是「平台收藏+登录态采集+嗅探下载工具」从未有过设置面; 与 Chrome 差距按 P0/P1/P2 分级列全(多标签/浏览历史/用户书签在第二批)。本批实施第一批:

- **设置入口(#1)**: 功能扩展行新增「设置」⚙; 新文件 `settings-store.ts`(settings.json 存储 + 平台分区 setProxy 应用 + clearStorageData 白名单清除 + 下载目录) —— 设置项: 主页按钮目标(空=平台首页, home 动作优先读)/地址栏搜索引擎(百度/必应/谷歌, normalizeAddress 接线)/代理(system/direct/manual+规则, 保存即生效, 取代 11-08 的纯 system 循环)/清除浏览数据(全部或单平台, Cookie 清除=退出登录带 confirm)/下载目录展示与打开;
- **页内查找(#5)**: `browser:findInPage/stopFind` + found-in-page 回推(ordinal/total); 页面浮条(↑/↓/×, Enter 下一处 Shift+Enter 上一处, Esc 关); Ctrl+F 开;
- **右键菜单(#6)**: 新文件 `context-menu.ts`(导航/链接三操作/图片复制另存/编辑剪切复制粘贴/缩放三档);
- **缩放(#7)**: Ctrl+=/-/0 步进 ±0.5, 百分比 toast 上屏(右键菜单同走 zoomStep);
- **快捷键(#8)**: 平台视图内 Ctrl+F/L/H/=/-/0/F5/Ctrl+R 由壳 before-input-event 转发 `tintin-browser-page:ui`(find-open/focus-addr/open-section/toast); 页面壳层同键直处理(查找/地址栏/历史视图), F5=刷新;
- 验证: 页面语法+jsdom 冒烟(设置页 14 元素/扩展行含设置/查找条默认隐藏+Ctrl+F 打开)+tintin-browser 全量+包 build(严格 tsc 抓到 ClearStorageDataOptions storages 可选属性与 popup exactOptionalPropertyTypes 两处, 已收窄)绿。
- 遗留对照: findBar 默认 display 由 style 属性首帧为空(jsdom 无初始解析)——实际浏览器有 style="display:none" 内联, 冒烟断言改读元素存在+Ctrl+F 开关行为, 非缺陷。

## 16.22 共享聊天源码第二消费方(封面会话页)契约清偿(2026-11-09, 用户报障「新建封面项目右侧会话空白」)

- **根因**:0.3.0 升级(§16.9)给共享桥契约 `AppBridge` 加了必选成员 `starterSkills`(空会话技能卡), 影片桥补了实现而**封面桥(chat-shell/cover-chat-bridge.ts)漏配**——封面载荷编译新共享源码后, 新项目=空会话挂 `ProjectStarters` 时 `app.starterSkills()` 同步抛 `not a function` → React 整树卸载=右栏白屏; 老项目走 `LiveConversation` 分支不挂该组件故无感。错误日志当日 11:41 三条实证。升级重放清单当时只盖了影片桥=第二个消费方不在名单。
- **修复(方案 1+3, 用户确认)**:①封面桥补 `starterSkills: async () => []`(与影片侧同款空实现);②封面桥对象按共享 `AppBridge` 类型标注(`typeof import(app-bridge)['app']` + `Record<string, unknown>` 放行封面扩展成员)——上游契约再变, 缺方法即刻类型报错;③运行期双保险: 新增 `test/cover-chat-bridge-contract.test.ts` 结构门禁(jsdom 导入桥对象 ⇄ 解析 AppBridge 源码逐必选成员比对 + `starterSkills` 回归断言 + **staging 载荷含 starterSkills 调用链断言**防旧载荷带病上机);④流程: 本节即升级重放清单补项——**今后 OpenFilm shell 升级必须同步重建封面 chat-shell 载荷(node scripts/stage.mjs)并跑封面契约门禁**。
- **契约对齐连带(类型层, 零行为变化)**:桥对象上类型后既有实现的 12 处类型松散显形, 已逐处收窄(helloMeta/libraryPage 的 catch 显式返回类型/`tintin-agent` 行 `as RosterAgent`(disabled 为封面扩展键)/agentStates `install: ''`(契约必选 string)/disconnect·describePaths·skills.list·texts 显式 Promise 断言/previewFolder `as const` 字面量); tsconfig 补 `paths` 映射 `openfilm/studio-ui/*`→vendor 的 `openfilm/studio/ui/src/*`(host.ts 仅依赖 React, 解析安全)。
- **边界(架构事实)**:chat-shell 不进包 tsconfig include——include 会经 cover-chat-main→mount→App.tsx 把共享聊天树全量源码拉进编译(83 个上游类型债), 门禁面收缩为「桥文件经测试 import 链被 follow」。共享树本身仍无 tsc 覆盖(影片侧同样无 tsconfig), 上游债不归本仓清偿。
- 验证: 封面 103 用例(含新契约 3 条)绿 + 包级 typecheck 恢复既有基线 37 红(全为 test 文件历史漂移, 本批净增 0) + root typecheck 0 红 + check:tintin 全绿 + staging 载荷重建(cover-chat-B9TxgjXe)逐字节新鲜。

## 16.22 浏览器域：多标签页+浏览历史+用户书签(2026-11-08 第二批三项, 裁决「第二批开始」)

- **多标签(#2, 架构项)**: 纯逻辑 `tab-model.ts`(建/关/激活/更新/平台查找, 上限 12, 关闭后继=右邻优先左邻兜底, 5 用例) + 引擎 `tab-engine.ts`(标签 view 创建=同平台共享分区/登录态隔离不变, 深链拦截/右键/快捷键/查找/历史与平台单视图同语义; 三 IPC tabOpen/tabClose/tabActivate, 池状态依赖注入回写宿主)。页面: 地址栏下 tab 栏(活跃态/×关/＋新=当前平台), 状态推送含 tabs+activeTabId。平台行单视图语义原样保留(标签池空走 browserViews 兜底);
- **浏览历史(#3)**: `history-bookmark.ts` —— 分区 did-navigate 记录(同 URL 去重置顶, 全局 500/每平台 100 双环形上限), history.json 持久化; 「历史」视图改三段口径(访问 50+下载 30+嗅探 30, 打开按钮回跳); **地址栏建议**: 输入 ≥2 字符模糊匹配最近 8 条, ↑↓ 选择 Enter 跳转;
- **用户书签(#4)**: 地址栏星标(☆/★, bookmarkToggle 翻转), bookmarks.json 持久化, 上限 200。(注: 11-04 删的「网页收藏」视图是嗅探媒体收藏口径, 与本批网页书签不同物, 未恢复);
- **千行付账**: browser-service 1109→968 行 —— tab 引擎提取 `tab-engine.ts`(161 行, 依赖注入回写池状态) + 页面下载栏镜像提取 `page-downloads.ts`(锚点 browser:bili-ext-dl 随迁并登记注释);
- 验证: tab-model 5 新用例(14 文件 107 用例全绿)+包 build(严格 tsc)+check:tintin(锚点迁移后 83 锚点一致)+页面语法绿。多标签端到端(切标签边界/关闭后继/标题回推)待重打包实机验收。

## 16.23 浏览器域：视图底色改 web 层主题判定(2026-11-08, 用户报障「白底还在, 不是说跟客户端主题吗」)

11-08 前批的 `themedBackground` 读 `nativeTheme.shouldUseDarkColors` —— 其语义=「系统深浅 + themeSource 覆盖」, 而应用的深色是 **web 层刷的 `body[data-ds-dark-theme]`**(theme-presenter, 不经过 nativeTheme): 应用内主题偏好=「跟随系统」且 Windows 本身为浅色时, 界面深色(误导)而 nativeTheme 报浅色 → 视图白底。这正是媒体三视图 1018 报障「三视图深色与原生不统一」的同一判定洞(hostTheme.ts 头注的教训, 此处又踩一遍)。修复: `themedBackground` 改 **web 层真值判定** —— 主进程从宿主窗口 `executeJavaScript` 探测 `body[data-ds-dark-theme]`/`html[data-ds-theme-source]`(hostTheme 同链), 注册时+宿主 dom-ready/did-navigate(含页内)探针持续刷新, 变化即同步全部存活视图; `nativeTheme` 降为探测不可达时的兜底。教训入册: **凡视觉主题跟随, 一律读 web 层挂载点, 不读 nativeTheme**(1003 二次触犯)。行数: browser-service 1000 压线内。验证: 14 文件 107 用例+包 build+check:tintin 绿。

## 16.24 浏览器域：登录徽标误报修复 + 标签导航地址栏补线(2026-11-08, 用户报障「只有抖音登录了但都显示已登录」+「跳 YouTube 地址栏空」)

- **登录徽标误报(用户实锤: 小红书弹登录框行上亮「已登录」)**: 判据原=「分区里该平台域 cookie 数>0」——任何访问都会落匿名功能 cookie(ttwid/设备指纹等, 11-07 取证匿名 jar 即 62 条), YouTube/小红书全程未登录也亮。修复: platform-meta 新增 `LOGIN_COOKIE_NAMES`(各平台会话级 cookie: douyin=sessionid 族/bilibili=SESSDATA/kuaishou=web_st 族/xiaohongshu=web_session/youtube=SID 族/weixin)+纯函数 `hasLoginCookie`, `browser:loginStatus` 改会话 cookie 判定(counts 值语义=1/0, 页面 n>0 判定不变); 2 新用例(会话判登录/匿名 jar 不误报/未知平台不登录);
- **标签导航地址栏空**: 标签路径回推了 tab 栏但**漏推 `tintin-browser-page:state`**(地址栏/导航按钮数据源, 平台单视图有 pushPageState、标签五处焦点/导航点全漏)——跳几次后有了=某次平台行路径补推。修复: tab-engine 五点(tabs did-navigate/page-title-updated/tabOpen/tabActivate/tabClose 焦点迁移)接 `deps.pushState`(宿主 pushPageState 注入);
- 验证: 14 文件 109 用例+包 build+check:tintin 绿。

## 16.25 浏览器域：地址栏「发起即显示」正常浏览器语义修复(2026-11-08, 用户报障「点 YouTube 地址栏还是空, 等加载才有」, 质问「加载逻辑是不是把正常浏览器改了」)

是——地址栏显示时机接错了信号：只依赖 did-navigate（导航**确认后**）推地址栏，did-start-loading 只推平台单视图、标签路径没有；YouTube 慢/不可达时 did-navigate 迟迟不来 → 地址栏一直空（commit 前 `getURL()` 返回 ''，页面还因焦点保护保留旧值）。修复=正常浏览器三段语义:

- **发起即显示**: 新增 `pendingNavUrl` 意图池——平台行 navigateTo/标签 seed/弹窗就地打开三处 loadURL **之前**登记目标 URL 并立即 pushPageState; pushPageState 加载中且主框架 URL 未定时用意图 URL 占位;
- **转圈**: 标签视图补 did-start-loading/did-stop-loading 推送（原只有平台单视图有）;
- **真实接管**: did-navigate（commit 确认）清意图、标签 URL 元数据更新; did-navigate-in-page 补标签 URL 同步（did-commit 事件在当前 Electron 类型面不存在, 已验证改用）;
- 验证: 14 文件 109 用例+包 build 绿。点击 YouTube 瞬间: 地址栏= https://www.youtube.com/ + 转圈; 不可达时保持占位+终态回真实值（空/错误页）。

## 16.26 浏览器域：抖音配对下载修复(2026-11-08, 用户报障「解析后点下载只下音频无进度, 嗅探列表点视频那条才对, 每点一次列表多两条」

三问同根: **嗅探器修复后第一次正常工作暴露了「抓第一条流」的缺陷** —— 抖音播放器同时发视频流+音频流两组 douyinvod 请求(嗅探列表成对出现=问题3), 解析链捕获差分里 `break` 在第一条 → 抖音音频流先到 → 只下音频且秒完成(无进度=小文件直下 1-2s 完成即撤行, 问题1); 用户在列表手点 badge=「视频」的那条=确实点中了视频流(问题2, 与按钮同引擎、唯一差别是选没选对流)。修复:

- **配对捕获**(页面 dyStartSniffDownload): 差分里选 badge=视频 的首条为主流, 同批音频流作 `audioUrl` 一并交引擎; 视频流先到而音频未现时多等一拍(6s 内);
- **audioUrl 直通**(壳层 sniffDownload): 可选 audioUrl 透传 startMedia → 引擎既有**双流下载+FFmpeg 合并**路线(B站扩展链同款), 进度=双流聚合(视频 x% · 音频 y%);
- 嗅探面板逐条「下载」保持单流语义不变(高级用户可单下音频/视频); 行数: browser-service 1000 压线内。验证: 14 文件 109 用例+包 build+check:tintin 绿; 端到端待重打包实机(标题命名+双流合并+聚合进度)。

## 16.27 浏览器域：下载入口收敛+后台标签捕获+嗅探误判修复(2026-11-08, 用户三问「media.mp4 谁下的/两个下载按钮/捕获中反复从头播放退全屏」+ B站嗅探刷屏)

三问同源互咬: **media.mp4=Chromium 原生 will-download 接管**（douyinvod 无尾段文件名→占位名；来源=捕获流程把当前视图导航到视频页，部分媒体响应触发原生下载）——同时这个导航让**正在看的页面被切走、配对窗口跨导航边界混乱、多轮 go 反复重载**（=反复从头播放+退出全屏, 问题 3）; 面板逐条「下载」与解析卡「下载视频」双入口并存（问题 2）。**B站嗅探刷屏**: isMediaUrl 的 SRC 照搬规则是无边界 `includes('.ts'/'.m4s')`——B站埋点 `data.bilibili.com/log/web` 的 query 恰含这些子串, 每次上报被抓成「音频」刷屏。修复:

- **后台标签捕获**: dyStartSniffDownload 改 `tabOpen({platform:'douyin'})` 开后台标签承载视频页, 当前页面/全屏/播放**零打扰**; 捕获成功或 25s 超时都关后台标签（media.mp4 随原生接管源消失而绝迹）;
- **下载入口收敛(用户裁决「一个视频不要有两个下载按钮」+「全删面板下载按钮」)**: 媒体嗅探面板与 B站助手推送区改**纯诊断展示**（名称+类型徽标）, 下载入口唯一=解析卡「下载视频」; sniffBusy/biliBusy 孤儿清理;
- **isMediaUrl 边界修复**: 扩展名必须出现在**路径段**（/ 后 ? 前）, 替代无边界 includes; 新增埋点/日志主机黑名单（/log//data.bilibili.com/report）; 2 新用例(埋点不误报/路径段边界), 14 文件 **111 用例**全绿;
- 验证: 页面语法+包 build+check:tintin 绿; 行数 browser-service 1000 内。端到端待重打包实机。

## 16.27 封面工具面:仿封面生成+拆解提字(2026-11-09, 服务端能力批核实后接线, 用户裁决「开工」)

- **服务端能力核实(先于实施, 探针全实测)**:comfygen 健康(v4.30, 1020 的 422 已消);`/generate/cover` 参考图三选一(script_id/images/material_ids)+文案至少其一(title/prompt/selling_points), `images` 收**服务端路径**(base64 会被当路径报「产品图不存在」);本机参考图上传端点=`POST /api/storyboard/scripts/product-upload`(multipart files 数组→返回服务端路径数组, 实测 645KB 全链 completed);**新增 `/material/ocr`**:逐行文本+`box` 像素坐标+`box_rel` 相对比例+置信度(带字图实测两行全中)。
- **工具接线**(cover-tools-mcp.js, 三工具→五):①`imitate_cover`(仿封面生成): 参考图 resolve→product-upload 上传→/generate/cover 接单→/tasks/unified 轮询(3s 间隔/420s 上限)→产物下载→PNG 魔数校验→落盘双写(项目目录+素材三写位, imitate-<ts>.png);产物=无分层整图, 返回 note 指引组装路径(看图→matting 抠元素→写 props→render_preview)。②`ocr_image`(拆解提字): /material/ocr 透传 text/lines(含位置框)+note 指引按 box_rel×模板宽高换算文字层位置。**服务端地址/路径安全复用 matting 同款**(getServerUrl+resolveImagePath 越界守卫, 冒烟实证项目目录外路径被正确拒绝)。
- **SKILL.md 同批**:通道表三→五工具;新增「仿封面与版式拆解」节(工具用法+典型流: ocr 拆版式→imitate 生底图→matting 抠主体→组装 props→render_preview);生图节守规补 imitate_cover 例外(内置上传通路, 不再要求先传素材库——1106 缺口由服务端更新打通)。
- 验证: 工具用例 7/7(mock 全链: 上传 multipart+生成载荷契约断言/无文案本地拒绝/编排失败错误原文上返/OCR lines 结构);真服务端端到端冒烟 40 秒全通(产物 704x1248 视觉成立+PNG 魔数+双写落盘);封面 105 用例全绿;typecheck 净增 0;载荷已 stage(逐字节新鲜)。doc-sync 现红三文件(browser-page-preload/main-hook/client-ui)为并行浏览器域批在途, 归属其批次。

## 16.28 doc-sync 时序补记:浏览器域文档先行提交、运行时在途(2026-11-10 打包门禁假红清偿)

- **形态**(1107 同款):§16.21(设置入口/页内查找/标签/历史书签桥)、§16.23-16.26(浏览器域各批)的**文档已随批次提交入库**(port.md 工作树干净), 而对应运行时三文件仍**在途未提交**——`browser-page-preload.ts`(+22 行: 设置 get/set/clearData/openDownloadsDir+页内查找 findInPage/标签 tabOpen 族+历史/书签桥, 内容与 §16.21/16.23 逐条对应)、`main-hook.ts`(-2 行: resolveServerUrl 移除,「服务端」标签退役 §16.19)、`client-ui/client.js`(日志条退役 §16.17+原生视图铺满)。doc-sync 的工作树比对(runtime M + docs 不在 changed)→ 假红挡 builder。
- **清偿**:本节即工作树触碰(port.md 重新出现于 changed), 比对通过;**闭环=浏览器域运行时三文件与文档同批提交**(归属浏览器域会话批次)。

## 16.29 升级 OpenFilm 0.3.0→0.3.1(2026-11-10, 用户指令「集成的视频剪辑已经升级到 0.3.1」)

- **上游**:检出版 `a85a80a9742981f0f77f61df88a2780984f8f3fb`(`v0.3.1^{commit}`;直接 `rev-parse v0.3.1` 得注释标签对象会炸本地克隆检出——升级必查真实提交);234 文件改动, 交集面 111 文件, 其中 8 个补丁文件被上游动过需重放。runtime npm 包 0.3.1(fetch-openfilm-runtime 2b 步自动重挂 tintin provider 到 providers/index.mjs)。
- **fetch-openfilm-shell**:FILES 增 `apps/desktop/src/openfilm-models.mjs`(0.3.1 新跨树导入, chat/state/local-agent-store.ts 引 `../../../src/openfilm-models.mjs`, 缺它构建即炸)。
- **补丁重放**(上游未动=直接恢复: BrandLogo×2、CustomServices 结构化备注、prompt-text/PromptPill 产品族;上游动过=在新 0.3.1 上重放: agent-definitions.mjs(openfilm/antigravity 新行+tintin-agent)、host.ts show-skills、ProjectView 命令分支+SkillsDialog 渲染、LibraryDrawer 在线素材(TDZ 安全: 效果链挪到 `cat` 声明后)、SkillsPane 服务端组、chat App.tsx 产品@引用、app-bridge products 接口、chat i18n ×5 groupProducts、studio i18n ×5 gallery 34 键重合并)。
- **坑×3**:①SkillsDialog 剥掉 `t('skills.button')`(0.3.1 studio i18n 无该键, 字面量「技能库」);②0.3.1 上游改 SkillsPane 图标导入(Server/Trash2→RefreshCw), 重放的服务端组复用 Server/Trash2 → **CDP 实机抓到 `Server is not defined` 白屏**(技能类目点开即 ReferenceError), 导入行补回三图标——静态门禁不查 lucide 图标存在性, 运行时冒烟是唯一关卡;③i18n 重合并脚本从 HEAD 摘值自带尾逗号再补逗号=双逗号, 全量 sed 清偿。
- **验证**:bundle 204/204;check:tintin 全绿(83 锚点);CDP 实机四件:studio 0.3.1 启动零渲染错;设置→服务 TinTin 服务端卡=7 模型实名(IndexTTS/Whisper/MusicGen BGM/SFX/Matting 抠图/ComfyGen 图片/ComfyGen 视频/Stock Images)+无假 GPT 名+服务地址上屏;素材抽屉→技能=服务端组+发现+已安装全渲染零错;新 dist 携 groupProducts(产品@引用)。
- **重放清单机锚化(2026-11-10 用户指令「锚定已实现的修改,防升级丢失」)**:vendor 树补丁重放清单从散文铁律升为 `scripts/tintin-anchors.json` 的 39 条 grep 锚(83→122 锚/45→75 文档)——openfilm-shell-src 15 个补丁文件(BrandLogo×2/SkillsDialog 技能库/SkillsLibrary/CustomServices ServiceNote/prompt-text+Pill 产品族/host.ts+ProjectView show-skills/LibraryDrawer tintinOnlineLibrary/SkillsPane useServerSkills+**图标导入行 `RefreshCw, Server, Star, Trash2`**(0.3.1 Server is not defined 事故定锚)/chat App 产品发送+状态/app-bridge products/chat i18n ×5 groupProducts/studio i18n ×5 serverRemoveHint+tintinOnline)+agent-definitions(tintin-agent/openfilm/antigravity 三行)+bundle 侧(TinTin provider TINTIN_SERVER_URL/mergeTinTinProvider/studio-runtime 注入/fetch-runtime 2b 步/fetch-shell openfilm-models.mjs)。此后每次 `fetch-openfilm-shell` 清树后漏放或放错的补丁,**verify-tintin-gate 直接红**;锚的是 tracked 源文件(vendored runtime gitignore 树不锚,避免干净克隆即红)。

## 17. 立项:素材自动粗剪 + 剪辑辅助(2026-11-04 用户立项,未开工)

> 依据:«字节跳动 Agent 实践手册»§4.3.1 创作辅助四段形态(创意方案→素材推荐→拍摄建议→**剪辑建议**)对照——前三段我们已有且更深,第四段(有人看节奏/转场/字幕落点并给建议)完全空白;用户裁决立项补齐,并追加「根据素材自动粗剪」。源参考:[agent-practice-manual.md](agent-practice-manual.md) §4.3.1/§5.2/§8.2.3;开发标准条款:[tintin-agent-dev-standards.md](tintin-agent-dev-standards.md) T1/T2/T4/T7。**本文只立项不定实现;动代码前先过 §17.4 的验收判据与 §17.2 的 spike 门。**

### 17.1 现状盘点(为什么是缺口)

现有影片智能体是**「生成编排」型**:拆解→脚本→分镜→`create_*` 服务端生成→交付(§16 时序);素材侧已有素材抽屉(§10 在线素材+下载落项目+@引用)、项目制素材区、口播逐词时间戳(ASR provider,`mode=raw`)、剪映草稿导出链(dsh-tintin-bundle `lib/jianying/`,轨道/花字/字体/模板)。**成片进入时间线/草稿之后,智能体不再参与**——没有节奏审视、没有转场/字幕落点建议、没有「把一堆素材自动拼成一条可精剪的粗剪」的能力。用户拿到素材仍需手工完成最耗时的粗剪。

### 17.2 立项 A:根据素材自动粗剪

- **定义**:输入=项目素材(视频片段若干 + 可选口播音频/文案脚本 + 时长目标)→ 输出=一条**可继续精剪的粗剪**(素材选段、掐头去尾、按口播/脚本对齐排序、基础转场、字幕轨挂旁白)。粗剪=建议产物,不自动定稿——人审确认后才算交付(交互纪律:不自作主张)。
- **两条落地路径(spike 定夺)**:
  - **A1 剪映草稿直出**:复用既有剪映导出链,粗剪=自动生成剪映草稿工程(素材已在项目目录)。优点:链路本地已验证、不依赖壳能力;缺点:精剪离开 OpenFilm 画布。
  - **A2 OpenFilm 时间线直写**:经壳桥把粗剪时间线写进 Studio。优点:产品体验闭环;缺点:依赖官方 0.2.7 壳是否暴露时间线写面/工程文件形态——**HARD-GATE:先测壳,测不出即 A1**。
- **粗剪算法骨架(混合决策,标准 T1)**:①素材分析:黑帧/静音/过曝/抖动检测=**规则活**,本地或服务端跑,不进大模型;语义排序/选段=大模型活,走影片会话编排(旗舰模型)。②主轴对齐:有口播→按逐词时间戳排画面(ASR provider 已有);无口播→按脚本分镜+素材语义排序。③选段掐尾:每段取有效区间,默认掐首尾 0.3-0.5s。④装配:基础硬切/叠化,字幕轨挂旁白。⑤人审位:粗剪结果进确认卡,用户点头才落时间线/草稿。
- **分期**:M1 spike(双路径可行性+A2 壳能力探测,产出契约文档=T10)→ M2 口播驱动粗剪(最窄价值闭环:口播+素材→粗剪)→ M3 脚本/分镜驱动+转场/字幕轨 → M4 与仿爆款六步向导的分镜确认步打通(是否打通待裁决)。

### 17.3 立项 B:剪辑辅助回路(手册第四段落地)

- **定义**:智能体读取当前时间线/草稿状态 → 输出结构化「剪辑体检」建议卡:**节奏**(镜长分布/超长镜)、**转场缺口**(硬切连打)、**字幕覆盖缺口**(有声无字幕段)、**静音/黑场段**。只说不动手——不改时间线,用户按建议自行调整(「一键采纳」留后续期,待裁决)。
- **依赖**:与立项 A 共享同一「时间线读取面」(A1 路径读剪映草稿 JSON / A2 路径读 Studio 工程)——两立项共用 M1 spike。
- **形态**:影片会话内用户说「帮我看看这条片子」或工具卡入口 → agent 拉时间线数据 → 建议卡上屏;分析以规则统计为主(镜长/覆盖率是算术),语义判断(这条镜该不该留)才进模型。

### 17.4 验收判据(T7 口径,先立判据再写码)

- **粗剪**:给定 5 段素材+1 条口播(逐词时间戳),产出粗剪工程:口画对齐误差≤0.5s、无黑帧/静音残留段、字幕轨全覆盖口播句;同输入重复生成结果确定性(同素材同脚本=同粗剪)。
- **剪辑辅助**:含 3 类典型问题(超长镜≥5s×2、连续硬切无转场、口播句无字幕)的样片,建议卡全部命中;无问题样片零误报。
- **门禁**:实现文件过千行红线先解耦;SKILL/桥改动过会话冒烟用例(标准 T7)。

### 17.5 待裁决点

1. A1/A2 路径(M1 spike 后定,倾向 A1 先行);
2. 素材语义分析放服务端(GPU,与 comfygen 同机争抢——需排队策略)还是本地(纯规则先行,语义后补);
3. 粗剪是否接入仿爆款六步向导(分镜确认步复用);
4. 剪辑辅助的「一键采纳」是否做(涉及写时间线,交互风险高)。

## 18. 已知缺口/非目标

- 角色名册(§11)实现中;上游 feature:custom 服务作内建 provider、子树归组(远期);
- Studio 顶栏多窗口/tabs 桩(单视图壳);应用内更新走 TinTin 自身通道;
- 转写请求明细(calls)暂空(仅 ACP 事件日志);
- 剪辑辅助/自动粗剪(§17 立项)在 M1 spike 前不排产——本节所列缺口的立项化解。
