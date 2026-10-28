# 封面生成方案需求文档

状态:**需求评审中(PoC 已验证,产品化未启动)** · 创建:2026-10-26 · 追加:§九 封面编辑器(2026-10-26) · 负责人:TinTin 桌面端
证据依据(铁律 12):① 用户裁决(2026-10-26 确认技术路线并要求成文)② PoC 实测(`D:\Project\cover-demo` 三模板全链路渲染成功)③ 第三方契约(Remotion 4.0.539 源码可用许可,见 §7)

---

## 一、背景与问题

TinTin 桌面端的内容链路(自动上架、达人采集、OpenFilm 出片、视频剪辑)都缺少**封面图**生产环节:

1. 封面目前依赖人工在外部工具制作,无批量能力、无品牌一致性;
2. 自动上架发布的作品需要逐个配图,断链;
3. OpenFilm 出片后无封面配套(平台上传封面为必填项)。

同时明确了一个关键认知(**铁律 12 ②,本仓已实测**):AI 生图(ComfyUI/服务端模型)与代码渲染(Remotion/Satori)解决的是**两半不同的工作**——

| 层 | 职责 | 弱项 |
|---|---|---|
| AI 生图层 | 底图氛围:光影、场景、质感 | 中文文字必崩、不可复现、批量一致性差 |
| 代码排版层 | 文字、版式、品牌元素、参数化批量 | 画不出真实画面感 |

因此本方案采用**混合管线**:**AI 出底图(可选)→ 代码层排文字与品牌元素 → 成图**。判断标准:封面文字越多,代码层越主导;纯氛围图才由 AI 主导。

## 二、目标 / 非目标

**目标**
1. G1:封面由**模板 + 参数(props)**生成,换文案/换图零代码改动;
2. G2:支持三种封面形态——节目向(深色)、商品向(浅色)、视频缩略图向(点击钩子),1280×720 起步,可扩展竖版;
3. G3:纯本地出图,不依赖云服务;单张毫秒~秒级,支持批量参数化;
4. G4:AI 底图作为**可选**输入层,复用 TinTin 既有出图通道(服务端模型/即梦),不新增 GPU 依赖;
5. G5:能力以 host 侧工具形态接入 TinTin(agent 可调用),产物落**客户端默认工作目录 `cover/` 子目录**(2026-10-26 裁决)可被各内容链路消费。
6. G6:**封面编辑器**(2026-10-26 需求追加)——类视频剪辑三栏界面:左侧图层面板、中央画布实时预览、右侧会话面板;底图由 ComfyUI/服务端模型生成、文字由代码层渲染,用户经会话驱动图层增删改与出图(详见 §九)。

**非目标**
- 不做可视化拖拽编辑器(fabric.js 路线,需求出现再立项);
- 不做 Remotion 云端渲染(Lambda/CloudRun);
- 不做 AI 直接生成含文字的成图(文字永远走代码层)。

## 三、总体架构(2026-10-27 终态裁决修订:四大组件分工)

> **终态分工(① 用户裁决 2026-10-27)**:
> 1. **生图 = 服务端驱动 ComfyGen**(ComfyUI 生成服务)——调用链固定:**编辑器/会话 → TinTin 服务端 → 服务端驱动 ComfyGen → 产物回传**;客户端/编辑器不直连 ComfyUI。底图/产品图/氛围图统一走此链路;
> 2. **PhotoCraft = 精修**——PS 式原生编辑器,图层/蒙版/文字工具人工与 agent 精修;
> 3. **对话框 = 驱动中枢**——驱动生图、操作 PhotoCraft、选择图层/生成文字内容;
> 4. **Remotion = 适配文字排版**——保留,模板渲染文字排版与成图。
>
> 即梦通道降为备用(代码保留,UI 下线)。

```
┌─ 生图层:服务端驱动 ComfyGen(ComfyUI)────────┐
│ 调用链:编辑器/会话 → TinTin 服务端 → ComfyGen  │
│ prompt → 底图/产品图(无文字)→ 产物回传        │
└──────────────┬──────────────────────────┘
               ↓ bgImage prop / doc_place
┌─ 排版层:Remotion renderStill ──────────────┐
│ 模板组件(横竖 4 族):文字排版/钩子/卖点/角标 │
│ ← 对话框(LLM 生成文字内容 + 图层操作指令)   │
└──────────────┬──────────────────────────┘
               ↓ 导出 PNG + provenance 侧车
┌─ 精修层:PhotoCraft(可选)─────────────────┐
│ PS 式原生窗口:图层/蒙版/文字工具人工精修    │
│ 控制通道(--control)+ CLI + MCP 桥          │
└──────────────┬──────────────────────────┘
               ↓
   工作区 <默认工作目录>/cover/ → 平台上传 / OpenFilm 配套 / agent 消费
```

**组件间关系**:对话框(LLM)是驱动中枢——文字内容由 LLM 直接生成(set_text),画面由 comfygen 生成(generate_environment/product),精修由 PhotoCraft 承担(原生窗口);Remotion 负责把这三者合成为最终封面。

## 四、已验证 PoC(2026-10-26 实测记录)

位置:`D:\Project\cover-demo`(独立 demo,未入仓)。技术栈:`remotion@4.0.539 + @remotion/cli`,Node 22,npm。

| 项 | 结果 |
|---|---|
| 深色节目封面(`Cover`) | ✅ 渐变底+网格+徽标+大标题,680KB PNG |
| 浅色商品封面(`ProductCover`,白底商品图) | ✅ 白卡片承托商品图,props 全参数化 |
| 视频缩略图(`VideoCover`) | ✅ 钩子大字+聚光圆盘+径向羽化(白底图融进深色底的关键手法) |
| AI 底图输入(`bgImage` prop) | 组件已留口子,未接真实出图(待接入 TinTin 出图通道) |
| 单张耗时 | 渲染秒级;首次运行需下载 headless Chromium |

PoC 踩坑记录(接入时规避):
- npm 新 install-scripts 策略会拦 esbuild postinstall,需 `npm install-scripts approve esbuild`;
- JSX 必须在 `.tsx`,`index.ts` 只留 `registerRoot`;
- 白底商品图上深色背景:必须用「聚光圆盘 + `maskImage: radial-gradient` 羽化」,硬贴会出白方块。

## 五、产品化接入需求(工作包)

> **2026-10-27 15:09 用户裁决(编辑器重构方向,①类证据)**:
> 1. **界面参考视频剪辑**:三栏中对标 OpenFilm Studio——必须有**会话框**(真实对话,不是占位说明);
> 2. **图层概念对标 PS**:每个图层可在**会话中被引用与操作**(「把主标题改成XX」「产品图换掉」);
> 3. **图层分类学固定**:环境图 / 产品图 / 主标题 / 副标题(装饰层另计);选中图层即可操作——文字层:字体/位置/大小;产品图:可经会话**图生图**;
> 4. **设置 = 横竖屏切换**(同一模板族横竖两个变体,切换保留内容)。
> 落地批次:A) 图层分类学+横竖屏+字体(本轮) B) 会话框(自含对话回路:server LLM + 图层工具协议,不依赖 harness 会话嵌入选型)+ 图生图(下轮)。

> **实施终态(2026-10-27,全天五轮交付)**:除下列三项外全部落地并随包分发——
> **已完成**:WP-1 引擎(含 outDir 联动参数)· WP-2 四模板(3 横 1 竖 1080×1440)· WP-3 AI 底图(服务端文生图→双写 public→bgImage)· WP-5 批量队列(逐张/失败隔离/进度)· WP-6 编辑器全功能面(文字内容/字号/颜色/X-Y 位移/画布点选拖拽/图片上传/AI 底图/撤销/导出+开箱)· WP-7 会话面(cover_templates/cover_generate/cover_background 三工具 + 复制指令跳工作台桥)· provenance 全链(素材台账+导出侧车)· 打包链(vendored+Chromium 随包+extraResources)+ staging 一键脚本 + 基线登记(client.js 1165/index.js 1015)。
> **WP-4 完成 2/3**:✅ OpenFilm 出片自动配套封面(film_render 钩子,与 mp4 同目录同基名)、✅ agent 会话配图;⏳ 自动上架批量配图待裁决集成点(上架子系统为 1:1 移植件,铁律 1 只搬不写)。
> **未立项**:编辑器内嵌完整会话 UI(依赖 harness 会话前端嵌入机制,建议独立工作包)、图层 z 序拖拽(待模板 z 序数据驱动化)、Remotion 商用许可法务结论。
> 门禁:81 anchors / 43 documents / 13 baselines;bundle 223 测试 + 插件 16 测试全绿。本地打包 `package:tintin:dir:local`(AA+市场双锚定)。以下为原始需求条文。

1. **WP-1 封面工具 host 化**:移植 cover-demo 为 `dsh-tintin-browser`/bundle 侧「封面生成」能力(参照 ytdlp 门形态):输入 `{template, props, bgImage?}` → 输出 PNG 落 **`<客户端默认工作目录>/cover/`**(2026-10-26 裁决;目录口径 = 既有 `TINTIN_WORKSPACE_DIR`/`~/Documents/tintin-workspace`,与下载/素材同源);headless Chromium 随包(已裁决),打包核验纳入 check 链。
2. **WP-2 模板库**:三模板入库 + 竖版(1080×1440)扩展;模板注册表统一维护(锚点防误删,铁律 15)。
3. **WP-3 AI 底图接线**:调用 TinTin 服务端出图(或即梦分区)生成无文字氛围底图,经 `bgImage` 进入管线;底图生成提示词模板化。
4. **WP-4 消费端串联**:
   - 自动上架:作品上架前按模板批量出封面(数据驱动:标题/卖点来自作品表);
   - OpenFilm:出片完成回调触发封面生成(同源风格可选);
   - agent 工具:暴露 `generate_cover` 面,会话内直接出图。
5. **WP-5 批量与队列**:props 表 → 批量渲染(数量级:一次 ≤ 数百张,本地串行即可,无需分布式)。

## 六、技术选型对账(结论存档)

| 路线 | 判定 |
|---|---|
| **Remotion renderStill(本方案)** | ✅ 主选:文字精确、参数化、确定性强;与 OpenFilm「影片=网页」同架构,未来片头/封面可同源 |
| Satori + resvg-js | 备选:更轻(无浏览器),但 CSS 子集受限;若 WP-1 体积不可接受时降级采用 |
| 现有浏览器域截图 | 保留:零依赖兜底,适合简单 HTML 模板 |
| ComfyUI / 服务端模型 | ✅ 仅作底图层;不承载文字 |
| 纯 AI 生图含文字 | ❌ 否决:中文字形不可靠(实测共识) |

## 七、依赖与风险

| 项 | 说明 | 处置 |
|---|---|---|
| Remotion 许可 | 源码可用(source-available):个人/小团队免费,公司达规模需商业授权 | **已裁决(2026-10-26):不阻塞**,按 Remotion 推进,法务并行核验;若最终结论不可用 → 降级 Satori(Apache-2.0,模板重写成本低,§9.8 已预留) |
| 打包体积 | @remotion/renderer + headless Chromium ~150MB | **已裁决(2026-10-26):随包分发**(离线可用;WP-1 打包核验纳入 check 链) |
| 中文渲染 | 无头 Chromium 缺中文字体时出豆腐块 | 模板内置字体文件(google-fonts 方案)随包 |
| 确定性复现 | props+模板版本即输出指纹 | 模板入 git,props 落盘存档,可复现 |
| AI 底图版权 | 生成图的训练数据与商用权利随模型而异(FLUX schnell=Apache-2.0 较稳;部分模型禁商用) | 底图通道白名单化(仅接许可明确的模型/通道);发布向封面记录底图来源 provenance |
| 平台规范 | 各平台封面尺寸/审核规则不同(B站 16:9、抖音 9:16、公众号 2.35:1 等) | 模板按平台预设尺寸+安全区(标题避开角标遮挡区);规范表随模板库维护 |

## 八、开放问题(待裁决)

1. ~~封面工具归属~~ **已裁决(2026-10-26)**:封面制作作为**插件**交付(独立插件包 + profile 组合 + 侧边栏独立菜单,见 §9.2);WP-1 的 host 侧生成引擎仍随 bundle 走,插件经工具面调用。
2. Remotion 许可若不通过 → 降级 Satori 路线,模板需重写(JSX→Satori 语法近似,成本低);
3. 竖版优先级(抖音/小红书向)与首发行模板数量;
4. 底图生成是否允许用户自定义提示词(涉内容安全策略)。

## 九、封面编辑器(会话式图层编辑;2026-10-26 需求追加)

### 9.1 定位与用户流程

类视频剪辑软件的三栏界面,把 §一 的混合管线**可视化**为图层操作:

```
用户(右栏会话):「生成一张赛博朋克底图,鼠标放右边,标题写 0.2ms 光轴」
   ↓ agent 解析意图,依次调工具
generate_background(赛博朋克) → add_image_layer(mouse.jpg) → set_text(title, 0.2ms 光轴)
   ↓
中央画布实时刷新(@remotion/player),左侧图层树同步高亮
   ↓ 用户微调(左栏拖层序/改字/右栏继续对话)
「导出」→ renderStill → <默认工作目录>/cover/xxx.png
```

### 9.2 入口与三栏布局

**入口与形态(2026-10-26 用户裁决)**:封面编辑器作为**插件**交付(与通道内其它能力同形态,经 profile 组合进入产品),侧边栏新增**独立菜单「封面制作」**,位置在「视频剪辑」**上方**(技能管理与视频剪辑之间);原运营工具内的封面相关设置**暂时保留**,待编辑器 MVP 稳定后再裁决去留。作为插件的约束:业务代码只进插件自己的包,不进通道 `src/`;会话工具面经既有桥/内部工具机制暴露(§9.4),不新增特权。

三栏布局:

| 栏 | 内容 | 交互 |
|---|---|---|
| **左栏·图层面板** | 图层树(自上而下=视觉从顶到底),每层:可见性 👁 / 锁定 / 选中高亮 / 拖拽排序 | 选中层 → 中央画布框选对应元素;双击文字层就地改字 |
| **中央·画布** | 封面实时预览(`@remotion/player` 嵌入,props 驱动,**非**每次重渲染) | 缩放(50%/100%/适应);点选元素联动左栏 |
| **右栏·会话面板** | 嵌入 TinTin 会话(复用主窗会话基建),带封面编辑器 skill/工具集 | 自然语言驱动:出底图/改文案/换风格/导出;每条 agent 动作以图层操作卡片回显(可撤销) |

### 9.3 图层模型(与渲染层的映射)

| 图层类型 | 渲染来源(代码层) | 可调属性 | z 序约定 |
|---|---|---|---|
| 底图层(0..n) | `<Img bgImage>` + 遮罩/混合 | 来源提示词、seed、透明度、羽化半径、黑白滤镜 | 最底 |
| 产品图图层(0..1) | `<Img>` + 聚光圆盘/羽化 | 图片、缩放、旋转、位置、光圈半径 | 中 |
| 文字图层(1..n) | 模板文字节点(钩子行/副题/角标) | 文本、字号/字重/颜色/描边、位置、倾斜 | 顶层 |
| 图形/品牌图层(0..n) | 徽标、强调条、网格纹理、圆环 | 显隐、颜色、位置 | 任意 |

实现要点:编辑器的「图层」不是自由画布对象,而是**模板组件的 props 树投影**——图层树=结构化 props,agent/面板改的都是同一份 props 状态,画布是它的实时投影。保证「会话改的」与「面板改的」永远一致,导出即可复现(props 快照随图落盘)。

### 9.4 会话协议(agent 工具面,右侧面板可用的最小集)

| 工具 | 作用 | 落到管线 |
|---|---|---|
| `generate_background(prompt, style?)` | AI 底图:调 ComfyUI/服务端模型出无文字氛围图 | 新建/替换底图层 |
| `set_text(layerId, text)` / `set_style(layerId, style)` | 改文字与样式 | 改 props |
| `add_image_layer(file)` / `set_image_props(...)` | 换产品图/调羽化旋转 | 改 props |
| `toggle_layer` / `reorder_layer` | 显隐与层序 | 改 props |
| `set_template(id)` | 切换模板(深色/浅色/缩略图/竖版) | 换组件,props 做兼容映射 |
| `export_cover(filename?)` | `renderStill` 出 PNG 落工作区 | 终态 |

会话面板本质 = TinTin 既有会话嵌入 + 上述工具的 MCP/内部工具暴露(复用 G5 的 agent 面);**不新建对话系统**。

### 9.5 实时预览与导出的分工

- 预览:`@remotion/player`(纯浏览器组件,props 变化即时反映,零渲染等待)——OpenFilm Studio 已验证同模式可行;
- 导出:`renderStill()`(Node 侧,帧精确 PNG),导出前自动以当前 props 快照渲染;
- 二者共享同一组件代码——这正是 §一「同源」价值的编辑器形态。

### 9.6 新增工作包

- **WP-6 编辑器插件 MVP**:新建封面制作插件包 `dsh-tintin-cover-plugin`(独立 workspace,不进通道 `src/`;命名 2026-10-26 已裁决)+ 侧边栏「封面制作」菜单(视频剪辑上方,经 profile 组合注册)+ 三栏壳(参照 OpenFilm Studio 内嵌形态)+ 三模板的图层化改造(§9.3 props 投影)+ player 预览 + 图层树交互 + export;
- **WP-7 会话接线**:右侧会话嵌入 + §9.4 工具面暴露 + 动作卡片回显/撤销;
- **WP-8 底图生成接入**:ComfyUI(本机)或服务端模型/即梦通道二选一起步,`generate_background` 落地(依赖 WP-3)。

### 9.7 开放问题(编辑器追加)

1. 会话面板嵌 TinTin 会话还是轻量对话窗(仅封面语境)?(建议:复用会话,上下文可注入当前 props 快照)
2. 图层粒度:文字层是否细到"每一行钩子"?(建议:是,与模板节点一一对应)
3. 撤销栈范围:仅会话动作,还是面板手动操作也入栈?(建议:统一 props 快照栈,一律可撤销)
4. ComfyUI 依赖形态:要求用户自装(检测端口)还是随包分发?(建议:检测式,缺失时降级服务端模型/即梦)
5. 用户自定义模板:是否开放用户自建/导入模板(涉及模板沙箱与脚本安全)?(建议:MVP 不开放,模板随插件版本迭代;需求出现再立项)

### 9.8 编辑器开源选型对账(2026-10-26)

**核心结论:不存在可直接使用的"会话式图层编辑器"开源整件;且不采用传统位图编辑器内核**——本编辑器画布是活的 React(@remotion/player),图层必须是 props 投影,像素画布内核与架构冲突。

**采用组合(全 MIT,零许可风险)**:

| 积木 | 许可 | 用途 |
|---|---|---|
| `@remotion/player` | (随 Remotion 许可,见 §七) | 中央画布实时预览 |
| `moveable` + `selecto`(daybrush) | MIT | 图层拖拽/缩放/旋转控制柄 + 框选,罩在 Player 上层的绝对定位图层元素上 |
| `dnd-kit` | MIT | 左栏图层树拖拽排序 |
| `zustand` + `zundo` | MIT | 共享 props 状态 + 撤销栈(快照式) |
| TinTin 会话基建 | 自有 | 右栏会话,仅暴露 §9.4 工具面,不新建对话系统 |

**评估后不采用**(存档防复议):

| 项目 | 不采用原因 |
|---|---|
| fabric.js / Konva | 位图画布内核,图层=像素对象,与 props 投影架构冲突(等于重写渲染层) |
| Polotno | 功能最接近(React 图层编辑器),但 SDK **商业收费**,仅作参考架构 |
| tldraw | 体验好但 source-available(生产需授权/去水印),矢量 shape 模型映射不到 Remotion props |
| GrapesJS | 图层/样式面板齐全但网页构建器血统,渲染模型冲突,过重 |

**可借鉴的 OSS 参考**:tldraw「make-real」示例(对话→改画布交互范式);Remotion 官方仓库 `agent-plugin`/`skills`(官方 agent 出片的工具面设计)。

**同类开源对账(2026-10-26 补充:端到端同款不存在,按局部借鉴)**:

| 项目 | 许可 | 相似度 | 差异与借鉴点 |
|---|---|---|---|
| Onlook | MIT | ⭐⭐⭐⭐ | 「设计师的 Cursor」:AI 会话+可视化图层树+直接改 React 工程——交互范式与本编辑器同构(它改 React 组件,我们改 Remotion props);面向 App UI 而非定尺寸画布。**借鉴:会话动作→图层高亮→可撤销的范式** |
| Craft.js | MIT | ⭐⭐⭐ | React 页面编辑器**框架**(图层树/拖拽/可编辑节点/画布现成),渲染模型=React 组件,与 props 投影天然兼容。**借鉴:若节点模型可低成本映射 props 树,左栏+画布骨架直接采用** |
| Penpot | MPL | ⭐⭐ | 完整开源设计工具,图层体系教科书级,可自建+插件 API;但孤岛架构(自有文件格式/画布引擎),接不进 Remotion props。**否决:与同源目标背道而驰** |
| MoneyPrinterTurbo(本地 D:\Project) | MIT | ⭐⭐ | AI 短视频流水线(文案→素材→合成);**借鉴:文案驱动批量产出的范式,用于 WP-4/WP-5 批量封面** |
| OpenCreator(本地 D:\Project,opencreator-agent) | 待查 | ⭐⭐ | AI 创作代理 monorepo;**待翻其工具面设计**,与右栏会话工具暴露直接相关 |
| Polotno | 商业 | ⭐⭐⭐ | 功能最接近但 SDK 收费,仅参考架构(见上表) |

结论:赛太新,成熟产品(Canva/Kittl/稿定)全闭源;**维持 §9.8 积木组合自建**,从 Onlook 抄交互范式、评估 Craft.js 骨架、翻本地 OpenCreator 工具面。

WP-6 工作量重心据此修正:不在 UI 积木(全是组装),而在**三模板 props 图层化改造 + 会话工具面接线**。

## 十、验收基线(各 WP 出口判据)

| WP | 验收判据 |
|---|---|
| WP-1 | 一条命令完成 `{template, props, bgImage?}` → PNG 落 `<工作目录>/cover/`;离线可跑(底图除外);打包核验含 Chromium |
| WP-2 | 三横版+一竖版模板 props 全参数化;模板注册表带锚点门禁(铁律 15) |
| WP-3 | `bgImage` 从 TinTin 出图通道端到端跑通;底图来源 provenance 落盘 |
| WP-4 | 自动上架作品 → 封面批量生成;OpenFilm 出片回调触发;agent 会话内 `generate_cover` 可用 |
| WP-5 | props 表批量 ≥100 张串行渲染无失败无内存泄漏;失败单张隔离重试 |
| WP-6 | 三栏编辑器:图层树/画布双向联动、会话改字与面板改字状态一致、导出 PNG 与预览一致、props 快照可复现 |
| WP-7 | §9.4 七工具全接通;每条动作有卡片回显与撤销 |
| WP-8 | 底图生成二通道(ComfyUI 检测/服务端模型)按 §9.7-4 裁决落地,缺失降级可用 |

---

## 十一、ACP 会话深度集成(2026-10-27 用户裁决:移植视频剪辑会话框)

> **背景**:编辑器当前的会话框是自造 JSON 协议,与视频剪辑的 OpenFilm Studio 会话(ACP agent + 官方聊天 UI + @ 引用 + / 技能)体验差距巨大。用户多次要求移植视频剪辑的会话框。本节为正式移植方案。

### 11.1 视频剪辑会话系统架构(移植源)

```
openfilm-shell/
  main.tsx                    ← 入口:Studio App + mountChat(chat 列)
  bridge.ts          (23KB)  ← Studio ↔ 聊天 双向桥(选中/引用/高亮/草稿)
  tintin-library.ts  (21KB)  ← TinTin 产品/库集成
tintin-resources/openfilm-shell-src/chat/   ← 聊天源码(79 文件)
  mount.tsx                   ← 挂载:app.hello() → render(<App/>)
  app-bridge.ts               ← window.openfilmDesktop 接口定义(107 行类型)
  App.tsx                     ← 聊天主组件(消息流/输入/工具调用/技能)
  components/                 ← 30+ UI 组件(消息气泡/编辑器/文件变更/日志…)
  lib/                        ← 28 个工具模块(会话存储/模型调用/附件/技能…)
  i18n/                       ← 多语言(zh-CN 在内)
  state/                      ← 本地 agent 状态管理
dsh-plugin-desktop-tintin/src/tintin/film-acp.ts  ← ACP 会话桥(694 行)
  spawn dsh --profile acp(子进程,模型路由到 TinTin 服务端)
  initialize → session/new → session/prompt(ACP 协议生命周期)
  语义事件流(update/permission/question/done)
  看门狗/审批/表单问答/图片素材落盘
```

### 11.2 移植目标

封面编辑器的右栏从自制 ChatPanel 切换为 **OpenFilm Studio 同款会话组件**,通过 ACP agent 会话驱动 comfygen 生图、PhotoCraft 操作、图层编辑。用户在会话框中:

- 直接自然语言对话:「主标题改成 0.2ms」「环境图换赛博朋克」
- `@环境图` `@产品图` `@主标题` 引用图层(agent 知道操作哪个层)
- `/生成底图` `/导出` `/竖屏` 调用封面技能
- agent 可调 comfygen 生图 + PhotoCraft 命令 + 图层属性修改

### 11.3 移植方案(分四个工作包)

#### CA-1: cover-acp.ts(ACP 会话桥)

**文件**: `dsh-plugin-desktop-tintin/src/tintin/cover-acp.ts` **已创建**(2026-10-27)

复用 FilmAgentManager 模式,cwd 指向 cover 工作目录:

```
CoverAgentManager
  ├─ spawn dsh --profile acp --patch cover-agent.patch.yml
  ├─ cwd = <工作目录>/cover/(与导出 PNG 同源)
  ├─ 技能注入:cover/SKILL.md → agent home/skills/
  ├─ initialize(CCLIENT_CAPABILITIES + CLIENT_INFO)
  ├─ session/new(cwd = cover 工作目录)
  └─ prompt(text) → 语义事件流(onEvent 回调)
```

模型路由:与 film 同源(TinTin 服务端 openai-completions),补丁写 `cover-agent.patch.yml`。
权限:`danger-full-access` 全放行(与 film 同裁决)。

**状态**:✅ 核心已创建,需注册到 main-hook.ts 并加 IPC 通道。

#### CA-2: IPC 通道注册

**文件**: `main-hook.ts`(追加)或 `cover-acp-routes.ts`(新建)

在 channel main 进程注册 CoverAgentManager 并暴露 IPC/webServer 通道:

```
POST /tintin/cover/api/acp/start     → manager.start(key, cwd)
POST /tintin/cover/api/acp/prompt    → manager.prompt(key, text) → 语义事件
GET  /tintin/cover/api/acp/events    → SSE/轮询 语义事件流
POST /tintin/cover/api/acp/stop      → manager.stop(key)
```

**状态**:⏳ 待实施。依赖 CA-1。

#### CA-3: 编辑器 ChatPanel 对接 ACP

**文件**: `dsh-tintin-cover-plugin/src/editor/App.tsx`(改 ChatPanel)

ChatPanel 的 send() 切换到 ACP 路由:

```
用户输入 → POST /api/acp/prompt → ACP agent 处理
  ← 语义事件流(agent 工具调用/文本更新)
  ← 动作卡片回显(set_text / generate_environment / export 等)
```

与当前自造 JSON 协议的区别:agent 是真正的 DSH Harness 智能体——有自己的工具回路,可自主决定调 comfygen 生图还是 PhotoCraft 操作,而非按固定协议回复。

**状态**:⏳ 待实施。依赖 CA-2。

#### CA-4: @ 图层引用

**文件**: 编辑器输入区 + ACP 系统提示

在 ACP 系统提示中注入当前模板的图层清单(id/label/类型/当前值),使 agent 能理解 `@产品图` `@主标题` 等引用。编辑器输入 `@` 时弹出图层列表自动补全。

**状态**:⏳ 待实施。依赖 CA-3。

#### CA-5: / 封面技能

**文件**: `dsh-tintin-cover-plugin/skills/cover/SKILL.md`

定义封面制作技能(SKILL.md),内容包括:
- 可用操作清单(comfygen 生图/PhotoCraft 命令/图层属性修改)
- 模板族与图层约定
- 导出流程

技能经 `ensureCoverSkill()` 注入 agent home,agent 自动可调。

**状态**:⏳ 待实施。

#### CA-6: PhotoCraft 控制通道深度集成

**文件**: `cover-acp-bridge.js` 扩展

通过 `photocraft-cli mcp --bridge` 将 PhotoCraft 的 500+ 命令暴露为 agent 的 MCP 工具,agent 可直接驱动 PhotoCraft 进行图层级精修。

**状态**:⏳ 远期;依赖 PhotoCraft 桥接协议稳定性确认。

### 11.4 实施顺序与验收

| 期 | 内容 | 验收判据 |
|---|---|---|
| P1 | CA-1 + CA-2 | ACP 会话可创建;prompt 返回 stopReason |
| P2 | CA-3 + CA-4 | 编辑器会话框可自然语言对话;@ 引用生效 |
| P3 | CA-5 | / 技能可调;comfygen 生成走技能路径 |
| P4 | CA-6 | PhotoCraft 桥接可用 |

### 11.5 风险与依赖

| 风险 | 处置 |
|---|---|
| ACP 子进程在兼容模式下可能受限 | 降级:回退到当前自造 JSON 协议 |
| dsh CLI 版本兼容 | 与 film-acp.ts 同版本,已验证 |
| 编辑器 iframe 与主进程通信延迟 | 事件流用轮询兜底(2s 间隔) |
| 封面技能内容质量 | 需与业务确认操作清单 |

### 11.6 已有基础

- ✅ `cover-acp.ts` 已创建(CA-1 核心)
- ✅ 编辑器 ChatPanel 已有消息流/动作卡片 UI
- ✅ comfygen 生图端点已在(cover-background.js)
- ✅ PhotoCraft CLI 已 vendored 且无头验证通过
- ✅ FilmAgentManager 模式已验证(openfilm 实测可用)

---

附:PoC 产物 `D:\Project\cover-demo\out\{cover,mouse-cover,video-cover}.png`;渲染命令样例见 `cover-demo/README`(待补)。
