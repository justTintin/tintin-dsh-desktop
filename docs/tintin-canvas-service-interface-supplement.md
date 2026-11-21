# 画布的功能服务接口补充（TinTin 服务端实现指导）

> 2026-11-21 客户端规格提案 v2 · 交付服务端（.31 主服务端，192.168.111.31:8000）实现。
> 范围：画布（OpenFilm Studio）全部功能面 → TinTin 服务端通道的**缺口补充规格**；已通能力一并实录，
> 作为契约基线与回归参照。取代并扩展 `tintin-comfygen-image-i2i-api.md`（已删，图片部分并入 §3）。
> 证据等级：**实测**——服务端 `/mcp` tools/list 逐工具实探（2026-11-21）、`/llm` 多模态消息实探（2026-11-21）、
> 客户端画布链路源码（openfilm-shell `lib/canvas.ts`/`canvas-presets.ts`/`components/canvas/*`）、
> 客户端 TinTin provider 源码（`dsh-tintin-bundle/lib/openfilm/providers/tintin.mjs`）。
> 本文是画布功能与服务端对接的唯一契约；服务端按本文 schema 与语义实现，客户端按同一 schema 接线，
> 两侧不得各自发挥字段名。

## 0. 契约基准：以标准 OpenAI 接口为参照系

每个能力章节给出**标准 OpenAI 接口**（端点、参数、语义）作为实现指导，再映射到服务端 MCP/REST
形态。原则：

- **语义与形状以 OpenAI 标准为权威**；服务端底层引擎（ComfyUI 工作流等）自由，对外契约不得偏离。
- MCP 工具层沿用现有**单工具多 mode** 架构（create_image/create_video 内扩 mode 与参数），不新增工具名。
- 异步任务统一走统一任务表（§2.2）；同步类端点（matting/tts）保持现状。
- 所有图/视频/音频二进制先经 `upload_file` 或 multipart 上传，服务端**不接触客户端本地路径**。

## 1. 现状矩阵：画布功能 → 服务通道 → 状态

| 画布功能（UI 出处） | 客户端通道 | 服务端通道 | 现状 | 本文档 |
| --- | --- | --- | --- | --- |
| 抠图（工具栏） | verb=cutout | REST `/matting` multipart | ✅ 通 | §6.5 |
| 打光（工具栏 light 9 预设+灯光球） | verb=image + `args.ref` | MCP `create_image` **mode=t2i**（ref 被弃） | ❌ **i2i 缺口** | §3.2 |
| 编辑 ▾（skin/cinematic/restore/colorize/realistic/background） | 同上（单图+mask/markup） | 同上 | ❌ 同上 | §3.2 |
| 创作 ▾（story/role/scene/product/design 全部预设；带图=fromPicture 组） | 同上（1..N 图） | 同上 | ❌ 同上 | §3.2 |
| 做成视频（做成视频/动态海报/首帧生成视频/首尾帧视频/运镜特效） | verb=video + `args['first-frame']`/`args['last-frame']`/`args['input-reference']` | MCP `create_video` **无任何图入参** | ❌ **i2v 缺口** | §4.2 |
| 视频「生成方式」：首帧 / 首尾帧 / 参考（三选一） | 同上三种传参形状 | 同上 | ❌ 同上 | §4.2 |
| AI 助手 ▾（电影镜头设计/提示词反推/来点灵感/编辑文字） | openfilm agent → `/llm/chat/completions` | REST `/llm/chat/completions`（OpenAI 兼容） | ✅ 形状通（多模态实探 200；实图效果列验收） | §5 |
| 配音（IndexTTS） | verb=tts | REST `/indextts/tts` + `/voice/samples` | ✅ 通 | §6.1 |
| 音乐生成（MusicGen BGM） | verb=music | MCP `create_music` {style:auto, duration} | ⚠️ **描述词无通道**（服务端无 prompt 参数+客户端未传） | §6.3 |
| 音效生成（SFX） | verb=sfx | REST `/audio/gen/sfx` | ⚠️ 2026-11-09 服务端 500 KeyError 'path' 待修 | §6.4 |
| 语音转写（Whisper） | verb=asr | REST `/whisper/transcribe` fmt=json mode=raw | ✅ 通（word 级时间戳，字幕/卡拉 OK 依赖） | §6.2 |
| 图片生成（ComfyGen 图片） | verb=image | MCP `create_image` mode=t2i | ✅ t2i 通；i2i 缺 | §3 |
| 图片搜索（Stock Images） | verb=image-search | REST `/material/stock_search` kind=image | ✅ 通（orientation 未透传，小改） | §7.1 |
| 视频生成（ComfyGen 视频） | verb=video | MCP `create_video` | ✅ t2v 通；i2v 缺 | §4 |
| 视频搜索（Stock Videos） | verb=video-search | REST `/material/stock_search` kind=video | ✅ 通（orientation 同上） | §7.2 |
| 网页搜索（设置页「选择模型」未绑） | 无绑点 | 无对应通道 | ❌ **未接入** | §7.3 |
| 任务轮询（全异步能力共用） | GET `/tasks/unified/<id>` | 统一任务表 | ✅ 通 | §2.2 |
| 文件上传（cover 流已用） | `upload_file`（MCP） | file_b64 ≤8 张 | ✅ 通，i2i/i2v 复用 | §2.1 |

## 2. 通用横切契约（所有新增能力共用）

### 2.1 文件进服务端：`upload_file`（现状实录，直接复用）

```jsonc
{ "file_b64": "单张 base64 或 JSON 数组（≤8 张）", "filename": "原始文件名（单张，可选）", "filenames": "多张逗号分隔（可选）" }
```

i2i 的参考图/蒙版/标注、i2v 的首帧/尾帧/参考图，一律先 `upload_file` 换服务端路径再引用。
蒙版/标注 PNG 上传时 filename 扩展名参与校验——必须保留 `.png`。

### 2.2 异步任务生命周期（与 t2i/create_video 现状一致）

1. `tools/call <tool> <args>` → 返回 text 块 = **JSON 对象（含 `task_id`，必须位于 text 开头）+ 尾部说明文字**
   （画布 annotated 契约；客户端 `parseAnnotatedJson` 提取首个平衡 JSON）。
2. 轮询 `GET /tasks/unified/<task_id>`（或 MCP `task_status_unified`）：`status=completed` →
   `result.output_url` 产物地址（相对路径按服务端 base 拼接）；`failed/error` → `error` 给原因。
3. 任务进统一任务表（`/tasks?limit=N` 可见），全能力共用时间线。

### 2.3 错误契约

- 失败一律 `result.isError=true` + text 说明（客户端已按此消费并透传）；校验类错误同步返回不落任务。
- **禁止 HTTP 200 内嵌 `{error}` 的假成功**（2026-11-19 宿主桥同类事故定案）。
- 服务端对未实现的可选参数**接受并忽略**，不得因新增字段报错（向前兼容义务）。

### 2.4 保留语义总则（keep 约束）

画布编辑类预设的英文 prompt（openfilm-shell `canvas-presets.ts` 30+ 条）全部按
「keep every person, face, pose, object, the framing… / change only X」措辞写死在客户端——
**这些措辞是契约的一部分**：服务端引擎必须让「只改所述项、其余保持」真实生效，不得要求客户端改写
prompt。这是 i2i/i2v 编辑类与纯生成类的本质区别。

## 3. 图片：`create_image`

### 3.1 t2i（现状实录，保持不变）

```jsonc
{ "mode": "t2i（缺省）", "prompt": "1..2000 字", "aspect": "9:16（缺省）/16:9/1:1/4:3", "seed": "可选整数" }
```

**OpenAI 参照**：`POST /v1/images/generations`（gpt-image-1）——`prompt`↔`prompt`、`size`（像素）
↔`aspect`（比例字符串，服务端按比例出图）、`quality`/`background`/`output_format` 服务端暂无对应
（透明图走抠图链），参数级差异允许，语义级（prompt→单图产物）一致。

### 3.2 i2i 新增（图生图/编辑）——承载打光/编辑/创作全部带图操作

**OpenAI 参照**：`POST /v1/images/edits`（gpt-image-1，multipart）——

| OpenAI images/edits | 服务端 mode=i2i | 说明 |
| --- | --- | --- |
| `prompt` | `prompt`（1..2000 字） | 改什么+保什么 |
| `image[]`（≤16 张，第 1 张=被编辑图） | `images`（≤8 张服务端路径，第 1 张=底图） | productSwap 双图/blend 多图靠序 |
| `mask`（PNG 同尺寸，透明区=重绘区） | `mask`（服务端路径 PNG） | 语义原样对齐 |
| —（OpenAI 无标注层） | `markup`（服务端路径 PNG，画在底图上的标注） | 服务端增强，与 mask 互斥 |
| `input_fidelity`（high=保人脸/结构） | `strength`（0..1，缺省 0.5；低=高保真） | 旋钮方向相反：strength 低≈fidelity high |
| `size`（像素） | `aspect`（可缺省=跟底图比例） | 显式传入=重构图输出（multiSize 语义） |
| `quality`（low/medium/high） | —（接受并忽略） | |
| `n`（张数） | 固定 1（画布单图节点） | |

**inputSchema 增补**（合入现有 create_image schema）：

```jsonc
"mode":     "t2i（缺省）| cover | matting | i2i（新增）",
"images":   "i2i 必填。参考图 1..8 张（复用 cover 的 images 参数名与解析：服务端路径 JSON 数组或逗号分隔；本地图先 upload_file）。第 1 张=底图（被编辑对象），第 2..N 张=辅助参考（替换来源/风格/合成素材）",
"strength": "可选 0..1 重绘强度（缺省 0.5）：打光/保真编辑类建议 ≤0.4；引擎无此旋钮时接受并忽略",
"mask":     "可选，服务端路径 PNG，与底图同尺寸。透明区域=重绘区域，不透明区域=保持原样。与 markup 互斥",
"markup":   "可选，服务端路径 PNG，画在底图上的标注（箭头/圈选/文字），表示改哪里。与 mask 互斥"
```

**语义规则（服务端校验清单）**：

1. `mode=i2i` 时 `images`、`prompt` 必填；`images` ≤ 8。
2. `mask`/`markup` 互斥；任一出现必须伴随 `images` 且作用于第 1 张底图。
3. `mask` 与底图尺寸不一致时服务端缩放对齐（或明确报错说明期望尺寸）。
4. `aspect` 缺省=输出与底图同比例；显式传入按传入比例输出。
5. `strength` 越界钳制 [0,1]，不硬报错。
6. **keep 约束生效**（§2.4）：输出保持底图结构/主体身份/构图，只改 prompt 所述项。

**生命周期**：与 t2i 相同（§2.2，async task_id → unified 轮询 → output_url）。

**画布操作 → 参数映射（实现自测用例）**：

| 画布操作 | images | mask/markup | prompt 来源 | strength 建议 |
| --- | --- | --- | --- | --- |
| 打光 9 预设 + 灯光球自定义 | 1 张 | 无 | light 预设词/light.tsx 灯光词 | ≤0.4 |
| 编辑 ▾ 6 预设 | 1 张 | redraw 有则 mask | edit 预设词 | ≤0.4 |
| 创作 ▾ fromPicture 组（next4/later3/background/outfit/realistic…） | 1 张 | 无 | 预设词+节点词 | 0.5 |
| tool 组 productSwap | 2 张（底图+产品图） | 无 | 预设词（写明第 1/第 2 张角色） | 0.5 |
| tool 组 blend | 2..N 张 | 无 | 预设词 | 0.6 |
| multiSize / panoramaFrom | 1 张 | 无 | 预设词 | 0.5（重构图） |
| 画布 redraw（蒙版重绘） | 1 张 | mask | 节点词 | 0.5 |
| 画布 markup 标注改图 | 1 张 | markup | 节点词 | 0.5 |
| 自由接线图生图 | 1..N 张 | 无 | 节点词 | 0.5 |

**验收**：

1. **保真**：lightGolden 预设 prompt + 机箱实拍图 → 输出必须是同机箱同构图变光（2026-11-21 t2i 现状
   反例=双人像无关图，已留档）。
2. **身份**：人像底图打光/换装，人脸与底图一致（服务端已有 ArcFace 0.65 面可复用作内部度量；不设硬门——主体可能是产品）。
3. **mask 精确**：透明区外像素与底图一致（像素级抽查 ≥95%）。
4. **aspect**：显式 4:3 输出 4:3；缺省=底图比例。
5. **生命周期**：task_id 可轮询、终态齐全、`/tasks` 可见、错误走 isError。

**客户端配套接线（服务端落地后执行）**：`MODELS.image[0].spec` 加 `refs: 4, mask: true, markup: true` →
image verb 消费 `args.ref`/`args.mask`/`args.markup` 逐张 `upload_file` → `generate('create_image',
{ mode:'i2i', prompt, aspect, images, strength?, mask?, markup? })`（轮询循环复用）；无 ref 时保持 t2i。
过渡期（服务端未上线）：provider 收到 ref 报明确错误，不静默 t2i 出无关图。

## 4. 视频：`create_video`

### 4.1 t2v（现状实录，保持不变）

```jsonc
{ "prompt": "画面+运镜描述 1..2000 字", "duration": "秒 1~10（缺省≈5）", "aspect": "9:16（缺省）/16:9/1:1", "resolution": "720p/1080p（缺省 1080p）", "seed": "可选整数" }
```

### 4.2 i2v 新增（图生视频）——承载「做成视频」菜单与「生成方式」三选一

画布图片节点「做成视频」四个入口与视频节点「生成方式」三选一（UI 逐字）：

| 画布功能（UI 逐字） | 语义 | 服务端参数 |
| --- | --- | --- |
| 做成视频「用这张图生成视频」 | 图生视频 | `image`（首帧）或 `reference_images`（参考） |
| 动态海报「让海报动起来，做成一段视频」 | 海报微动 | `image`（首帧）+ 低运动幅度 prompt |
| 首帧生成视频「以这张图为第一帧，写下要发生什么」 | 首帧驱动 | `image`（首帧） |
| 首尾帧视频「再选一张作为最后一帧」 | 首尾插值 | `image` + `last_image` |
| 运镜特效「从运镜特效库挑一种镜头运动」 | 镜头运动 | `image`（首帧）+ 运镜 prompt（moves 预设词） |
| 生成方式=首帧「1 张图片开头」 | 同首帧 | `image` |
| 生成方式=首尾帧「2 张图片开头和结尾」 | 同首尾 | `image` + `last_image` |
| 生成方式=参考「多图参照」 | 主体/风格参照 | `reference_images`（≤4） |

**业界参照**（OpenAI 无 GA 图生视频首尾帧语义，组合引用）：

| 业界标准参数 | 服务端 mode 参数 | 来源契约 |
| --- | --- | --- |
| OpenAI Sora `POST /v1/videos` 的 `input_reference` | `reference_images` | Sora Video API（multipart 参考图，引导主体/风格） |
| Kling `image_url` / `tail_image_url` | `image` / `last_image` | Kling Image-to-Video（首帧/尾帧插值） |
| Google Veo `image` / `lastFrame` | 同上备份语义 | Veo API |
| Sora `seconds`/`size` ↔ 轮询 `GET /v1/videos/{id}` job 状态 | `duration`/`resolution` ↔ §2.2 unified 轮询 | 生命周期对齐 |

**inputSchema 增补**（合入现有 create_video schema，全部可选、与 t2v 向后兼容）：

```jsonc
"image":            "可选，服务端路径（upload_file 而来）。首帧：视频从该图起始，保持其构图/主体/风格",
"last_image":       "可选，服务端路径。尾帧：视频结尾到达该图；必须与 image 同传（单独 last 无语义，校验报错）",
"reference_images": "可选，服务端路径 JSON 数组或逗号分隔 ≤4 张。参考模式：以图中主体/风格生成视频，构图可自由"
```

**语义规则**：

1. `image`/`last_image`/`reference_images` 与 t2v 现有参数互不排斥；三图参数两两可组合的只有
   `image`+`last_image`，`reference_images` 单用（校验：与 `image` 同传时报错说明）。
2. 首帧模式的输出首帧须与输入图**结构一致**（keep 约束 §2.4 同样适用于视频首帧）。
3. 尾帧模式为**插值生成**：起点=首帧、终点=尾帧，中间自然过渡。
4. `duration`/`aspect`/`resolution`/`seed` 语义不变；输出比例与首帧图不一致时按 `aspect` 输出并重构图。
5. 生命周期与 t2v 相同（§2.2）。

**验收**：

1. 首帧模式：输入机箱图 + 「镜头缓慢推近」prompt → 输出视频首帧≈输入图（结构一致），运动为运镜而非无关场景漂移。
2. 首尾帧模式：机箱图 A→B，输出首尾帧分别≈A/B。
3. 参考模式：参考图主体在输出中出现。
4. 任务表/错误契约同 §2。

**客户端配套接线（服务端落地后执行）**：`MODELS.video[0].spec` 加 `frames: true`（或 `frames:'first'`）
与 `refs: 4` → video verb 消费 `args['first-frame']`/`args['last-frame']`/`args['input-reference']` →
逐张 `upload_file` → `generate('create_video', { prompt, duration, aspect, image?, last_image?, reference_images? })`。

### 4.3 视频续写/重绘（clip→video：clipEdit/clipExtend/clipMotion/clipRestyle/clipRecast/clipLipsync）

**二期非目标**（服务端暂无 video-to-video 入口）。画布「参考」模式下与接线片段相关的操作当前由
`args.video` 传入，provider 侧同样弃用——服务端具备 v2v（如 Kling video_url 续写语义）后另立规格。
数字人说话（clipLipsync 语义）服务端已有 `create_digital_human` kind=lipsync（§8），媒体面已用。

## 5. AI 助手（LLM 能力）

**现状**：`/llm/chat/completions` OpenAI 兼容；多模态消息形状实测通过（2026-11-21 `image_url`
content part HTTP 200）。

**OpenAI 参照**：`POST /v1/chat/completions`（gpt-4o 级视觉）——`messages[]`（content = string |
`[{type:text},{type:image_url,image_url:{url}}]`）、`max_tokens`、`temperature`、可选
`response_format:{type:"json_object"}`、流式可选（客户端当前非流式）。

**画布四功能 → 输入/输出形状（提示词在壳侧 openfilm agent，服务端只需保证端点契约与模型能力）**：

| 功能 | 输入 | 输出 | 依赖能力 |
| --- | --- | --- | --- |
| 电影镜头设计 | 项目上下文（文本） | 六镜头分镜表（结构化文本/JSON） | 长上下文 + 结构化输出 |
| 提示词反推 | **图片**（画布节点图） | 提示词文本 | **视觉理解（真实看图）** |
| 来点灵感 | 当前描述词 | 四个续展方向（列表） | 文本生成 |
| 编辑文字 | 图片+指令（调整图中文字/改称呼） | 改写结果 | 视觉+文本（或走 §3.2 i2i 出图） |

**服务端要求**：

1. 保持 OpenAI Chat Completions 契约（含多模态消息、`response_format`）；不因新增字段报错。
2. **视觉真实性验收**：给真实照片（非 1x1 探针）+「描述图中主体」→ 返回内容须与图相符（当前仅形状级验证）。
3. 上下文长度：分镜表任务带项目上下文，建议 ≥32k tokens。
4. `/llm` 分账口径不变（server-proxy 既有）。

## 6. 音频能力（已通，实录 + 两处小修）

### 6.1 配音 TTS（IndexTTS）

- 客户端：`POST /indextts/tts` `{ text, resp:'json', sample_id }` → `{ audio_url, sample_rate }`；
  音色样本 `GET /voice/samples` → `{ items:[{id,name,text}] }`。
- **OpenAI 参照**：`POST /v1/audio/speech` `{ model, input, voice, response_format }`——语义一致，
  字段名不要求对齐（IndexTTS 专有参数 sample_id 保留）。

### 6.2 语音转写 ASR（Whisper）

- 客户端：multipart `POST /whisper/transcribe` `{ file, fmt:'json', mode:'raw' }` →
  `{ segments:[{ text, words:[{word,start,end}] }] }`。
- **OpenAI 参照**：`POST /v1/audio/transcriptions` multipart `{ file, model, response_format:'verbose_json',
  timestamp_granularities[]:'word' }`——**word 级时间戳已对齐**（字幕/卡拉 OK \k 依赖，不可降级）。

### 6.3 音乐（MusicGen BGM）——缺口：描述词无通道

- 现状 schema：`{ style: "流行|电子|古风|纯音乐|摇滚|嘻哈|爵士|氛围|auto", mood: "欢快|大气|悲伤|温馨|紧张|平静", duration: "秒 3~30" }`；
  客户端固定传 `style:'auto'`，画布「根据描述生成配乐」的描述词**两端都没有通道**。
- **参照**（OpenAI 无音乐 API）：Suno / Meta AudioCraft MusicGen 的 `prompt`（自由文本）+`duration`。
- **规格**：`create_music` 增加 **`prompt`（可选自由文本 1..500 字）**，与 `style`/`mood` 可组合
  （prompt 优先，style/mood 作快速档）。客户端接线：music verb 改传 `{ style:'auto', prompt, duration }`。

### 6.4 音效（SFX）

- 客户端：`POST /audio/gen/sfx` `{ prompt, duration }` → `{ url }`。
- **参照**：ElevenLabs Sound Effects `POST /v1/sound-generation` `{ text, duration_seconds }`——已对齐。
- **遗留待修**：2026-11-09 服务端 500 `KeyError 'path'`（REST 与 MCP 同源），修复后画布音效即通。

### 6.5 抠图（Matting）

- 客户端：multipart `POST /matting` `{ file }` → PNG 二进制本体（同步）。
- 服务端 `create_image` mode=matting（file_b64 → 透明 PNG）同源双通道，均保持。

## 7. 搜索能力

### 7.1 图片搜索（已通，小改）

- 客户端：`POST /material/stock_search` `{ query, kind:'image' }` → `{ items:[{url}] }`。
- **参照**：Pexels `GET /v1/search` `{ query, orientation(landscape/portrait/square), size, per_page }`。
- **小改**：服务端接受可选 `orientation` 并透传图源（客户端已按横竖几何挑选，现由客户端兜底过滤）。

### 7.2 视频搜索（已通，小改）

- 客户端：同端点 `kind:'video'` → `{ items:[{url,width,height,duration_sec,author}] }`；`orientation`
  同 §7.1 透传。

### 7.3 网页搜索（未接入）

- 画布设置页「网页搜索」当前无绑定模型（「选择模型」）。
- **参照**：Brave Search API `GET /web/search` `{ q, count, country, search_lang }` →
  `{ web:{ results:[{title,url,description}] } }`。
- **规格提案**：REST `GET/POST /search/web` `{ query, count?≤10 }` → `{ items:[{title,url,snippet}] }`
  （与 stock_search 同风格）。落地后画布绑定即通；接入哪家图源（Brave/Bing/SerpAPI）由服务端自选，
  对外契约不变。

## 8. 数字人（清单外实录）

`create_digital_human` `{ kind:'image'|'lipsync', image_b64?, video_b64?, audio_b64? }`（async）——
媒体面数字人已在用；画布暂不接线（clipLipsync 语义若接走此通道，归 §4.3 二期）。

## 9. 实施顺序与验收总表

| 优先级 | 项 | 章节 | 验收要点 |
| --- | --- | --- | --- |
| P1 | create_image mode=i2i | §3.2 | 机箱图打光保真（对照反例留档）+ mask ≥95% + 生命周期 |
| P1 | create_video image/last_image（首帧+首尾帧） | §4.2 | 首帧结构一致 + 尾帧到达 + unified 任务 |
| P2 | create_video reference_images（参考模式） | §4.2 | 参考主体出现 |
| P2 | create_music prompt 通道 | §6.3 | 描述词影响曲风 |
| P3 | /audio/gen/sfx 500 修复 | §6.4 | 画布音效出声 |
| P3 | /material/stock_search orientation 透传 | §7.1-7.2 | 横竖筛选服务端生效 |
| P3 | /search/web 新通道 | §7.3 | 画布「网页搜索」可绑定 |
| 持续 | /llm 视觉真实性 | §5 | 实图描述与图相符 |

**总验收=画布实机回归清单**（服务端每落地一项，客户端在同车接线后按此点测）：

1. 打光（lightGolden/自定义灯光球）→ 机箱图变光不出无关主体。
2. 编辑 ▾ restore/colorize/background → 原图主体保持、只改所述项。
3. productSwap 双图 → 第 2 张产品替换进第 1 张场景。
4. 画布 redraw 蒙版 → 仅透明区变化。
5. 做成视频/动态海报/运镜特效 → 首帧=原图、运动符合 prompt。
6. 首尾帧视频 → 首尾两帧分别对齐两张输入图。
7. AI 助手 提示词反推 → 反推出的提示词能复现图中主体。
8. 音乐「根据描述生成」→ 描述词改变曲风。
