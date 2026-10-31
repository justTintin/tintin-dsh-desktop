# 封面生成方案需求文档

状态:**需求评审中(PoC 已验证) · 产品化:编辑器/会话/在线素材已实现(2026-10-29,见 §12 实现对账;待重打包实测)** · 创建:2026-10-26 · 追加:§九 封面编辑器(2026-10-26) · §十一 ACP 会话(2026-10-27) · §十二 实现对账(2026-10-29) · 负责人:TinTin 桌面端
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

**文件**: `dsh-tintin-bundle/lib/cover-acp-bridge.js`(**2026-10-28 实装**;原 TS 稿废弃删除——桥与路由同在 bundle webServer 进程,无需经过插件主进程 IPC)

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

**状态**:✅ 完成(2026-10-28)。单会话 `dsh --profile acp`,服务端 MCP+技能注入+权限/表单提问路由给聊天卡;事件环 2000 条供 SSE 重放。

> **构建形态终裁(2026-10-28 用户裁决:源码共享,构建隔离)**:同款会话框 = 相同界面 + 相同架构
> (ACP 会话 + preload 桥 + mount),对接不同业务(CoverAppBridge/CoverAgentManager 接封面图层、
> comfygen、PhotoCraft)。双入口实验(封面聊天塞进视频剪辑 shell 的 vite 构建)已回退——rollup
> 共享 chunk 重排影片页模块时序,导致视频剪辑自己的会话框挂载崩溃。终态:封面会话页由
> **封面插件自己的 `chat-shell` 构建**(独立 npm 工位,照 openfilm-shell 先例),产物
> `chat-shell/dist` 经 stage.mjs 进 extraResources,bundle 路由 `/tintin/cover/chat` 伺服
> (vite base 必须为完整前缀 `/tintin/cover/chat/`,否则资源 404)。视频剪辑的构建不再碰。

#### CA-2: IPC 通道注册

**文件**: `dsh-tintin-bundle/lib/cover-acp-routes.js`(新建,2026-10-28 实装)

在 channel main 进程注册 CoverAgentManager 并暴露 IPC/webServer 通道:

```
/tintin/cover/api/acp/start|prompt|steer|cancel|close|set-option|permission|question|running|ack
GET  /tintin/cover/api/acp/events    → SSE(Last-Event-ID 断线重放)
GET  /tintin/cover/api/acp/chat-record|skills|files|props  → 聊天记录/技能/图层文件/props 对流
POST /tintin/cover/api/acp/chat-sessions|chat-turn|chat-attachment|chat-ref-image|describe-paths|skills-texts|props
```

**状态**:✅ 完成(2026-10-28)。信任双轨:浏览器=loopback+Origin;agent 子进程=会话令牌头 `x-tintin-cover-agent`。

#### CA-3: 编辑器 ChatPanel 对接 ACP

**文件**: `dsh-tintin-cover-plugin/src/editor/App.tsx` + `dsh-tintin-bundle/openfilm-shell/cover-chat-{bridge,main}.ts`(2026-10-28 实装)

右栏整体换成 **OpenFilm 官方聊天组件**(shell 构建第二入口 `cover-chat.html`,伺服 `/tintin/cover/chat`,编辑器 iframe 承载):页面桥实现 `window.openfilmDesktop` 的聊天子集,后端即上述 acp/* 路由族。自造 JSON 协议(cover-chat.js)随批删除。

```
用户输入 → POST /api/acp/prompt → ACP agent 处理
  ← 语义事件流(agent 工具调用/文本更新)
  ← 动作卡片回显(set_text / generate_environment / export 等)
```

与自造 JSON 协议的区别:agent 是真正的 DSH Harness 智能体——有自己的工具回路(fs 改 cover.props.json / curl 编辑器 API 生图导出 / 服务端 MCP),而非按固定协议回复。图层状态双向同步:编辑器 600ms 防抖写 props(origin=editor),2s 轮询读(origin=agent 才套用)。

**状态**:✅ 完成(2026-10-28,待重打包实测)。

#### CA-4: @ 图层引用

**文件**: 编辑器输入区 + ACP 系统提示

在 ACP 系统提示中注入当前模板的图层清单(id/label/类型/当前值),使 agent 能理解 `@产品图` `@主标题` 等引用。编辑器输入 `@` 时弹出图层列表自动补全。

**状态**:✅ 完成(2026-10-28):@ 引用=聊天输入区 @ 菜单新增「图层」组(vendored chat 树最小改动:app-bridge 可选 `coverLayers()` + App.tsx mentionProviders 图层组,影片场景不受影响),pill 走 StudioRef layer 形状随 `<studio_references>`/`<cover_context>` 供给 agent;编辑器图层行有「@」按钮直插引用。

#### CA-5: / 封面技能

**文件**: `dsh-tintin-cover-plugin/skills/cover/SKILL.md`

定义封面制作技能(SKILL.md),内容包括:
- 可用操作清单(comfygen 生图/PhotoCraft 命令/图层属性修改)
- 模板族与图层约定
- 导出流程

技能经 `ensureCoverSkill()` 注入 agent home(文末动态附录:服务端地址/编辑器 API 基址/会话令牌),聊天 / 命令菜单与 Skills 按钮同源(`/acp/skills` 读插件 skills/ 目录)。

**状态**:✅ 完成(2026-10-28)。

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

### 11.6 实施存根(2026-10-28 P1-P3 收口)

- ✅ CA-1 桥 = bundle `lib/cover-acp-bridge.js`(原 `dsh-plugin-desktop-tintin/src/tintin/cover-acp.ts` 废弃删除)
- ✅ CA-2 路由族 = bundle `lib/cover-acp-routes.js`(35 条封面路由全注册;TDZ 回归有 vitest 固化)
- ✅ CA-3 官方聊天 = shell 双入口 `cover-chat.html`(bundle `openfilm-shell/`)+ 编辑器 iframe
- ✅ CA-4 @ 图层引用 = vendored chat 树两处最小改动(app-bridge.ts/App.tsx)
- ✅ CA-5 技能 = `dsh-tintin-cover-plugin/skills/cover/SKILL.md`
- ⏳ CA-6 PhotoCraft 深度桥接 = 远期不变;comfygen 生图当前走编辑器 API(令牌旁路)
- 附带修复:上一提交 `cover-plugin-route.js` 的 pcRoute TDZ(运行时全炸)已修并有回归测试;素材写入统一三写(源/编辑器预览/导出根,`lib/cover-asset.js`)

---

## 十二、实现对账(2026-10-29:逐条需求 ⇋ 实现)

> 对照 §五/§九/§十一 与本轮(2026-10-28/29)实现。**实证方式**:无头浏览器 E2E(双页菜单转储/注入文本截获/拖动坐标断言/抽屉交互)+ 真实 dsh 会话实验 + 插件 20 测试 + 门禁 84 锚点。

### 12.1 已实现(逐条 ⇋ 实现)

| 需求 | 实现 | 实证 |
|---|---|---|
| §9.2/9.3 三栏 + 图层=props 投影 | 三栏编辑器 + 图层树/画布双向联动(点选/拖拽/↑↓ z 序) | E2E:图层树行序=layerOrder、拖动 x/y 持久化断言 |
| §9.3 图层 z 序可调(用户 10-28 追加) | `props.layerOrder`(固定层+自定义层同一张序表,模板顶层块 zIndex)+ 图层行 ↑↓ | E2E:↑ 按钮写回 layerOrder、命中栈 IMG 序=layerOrder |
| §9.3+ 用户 10-28:拖入图片=新图层 | `props.customLayers`(x/y/width/opacity)+ CustomLayerOverlay(六模板)+ 素材面板拖入/「＋作为新图层」 | E2E:建层(asset-sync 三写)→画布渲染 |
| §9.4 会话工具面(原自造 JSON 协议) | **ACP 会话替代**(CA-1..CA-5):`dsh --profile acp` + 服务端 MCP + cover SKILL.md + fs 改 cover.props.json + 令牌旁路 curl 编辑器 API | 真 dsh 实验:INIT/SESSION OK、prompt 到达模型;黄金 E2E:注入文本=引用编号+SKILL.md 全文 |
| §11.2 @ 图层引用 | @ 菜单「图层」组(编辑器 postMessage 实时取值)→ pill → `[n: 名]` + `<studio_references>` layer 行(含 propsKey/取值) | E2E:菜单项+发送文本截获 |
| §11.2 / 封面技能 | / 菜单 Skills 组(cover 技能,SKILL.md 全文附加);技能清单路由 `/acp/skills`(staging skills 同步+内置兜底) | E2E:/ 菜单弹出 cover;安装版根因=staging 漏同步 skills/(已修) |
| 用户 10-29:封面 @ 无技能组、无时刻组 | 桥 `hideSkillsInMentions`/`timelineDisabled` 直读(window 直读,不经 app 代理——代理读曾致主线程死循环) | E2E:封面 @=图层+素材、无 Skills 无时刻;影片 @ 不受影响 |
| 用户 10-29:在线素材像视频剪辑(列表布局/搜索/分页/下载,下载与引用分开) | 抽屉列表版:行=缩略图+名称+「下载到素材」;行/按钮点击=只领养进素材库(三写+台账);搜索框(server search)+分页(24/页,滚动触底+加载更多按钮) | E2E:页 1=24、滚动=30、搜索=5、下载落盘、抽屉保持、composer 无污染 |
| §9.7-2 文字样式(用户 10-29:PhotoCraft 式,真字体) | 文字层=DOM 真字体(非位图);面板=字体/大小(**px 绝对**,基准字号×倍率换算)/位置(X·Y 数值+滑条)/颜色(色板+取色器);registry LayerDef.fontSize 基准登记 | E2E 截图:面板六行齐;契约测试按新夹取(0.3..3/±1200)更新 |
| 用户 10-29:对齐/参考线/预览开关 | 画布选中图层→对齐工具条(六向相对画布)+拖动吸附参考线(青色);中栏「预览显示」开关(参考线/网格;编辑器视觉辅助不进导出) | E2E:对齐后图层中心=画布正中;开关在设置区 |
| §九 导出 | ExportModal(横竖屏勾选)+ props 快照侧车 + provenance 台账 |既有 |
| WP-4 OpenFilm 配套 | film_render 钩子(film-tools)|既有 |
| 用户 10-29:封面会话底部加视频剪辑同款「选择产品」(按钮/弹窗/资料注入) | 三件套移植:①bundle 路由 `GET /acp/products?q&limit` + `/acp/products-detail?id` 代理服务端 `/api/product-library/*`(与 film 的 openfilm:products 主进程代理同源同形状);②封面页外挂 `cover-chat-products.ts`(1:1 移植影片 tintin-products.ts:📦 按钮挂官方 composer 工具条 + 面板(搜索/列表/状态)+ 点选拉详情 →【产品】品牌·型号·品类·货号+性能参数+卖点等结构化文本经 Lexical 粘贴注入输入框),数据改走同源路由(封面页无 openfilmNative);③构建标记 2026-10-29-d | E2E(新构建+真路由+真实服务端):📦 挂载 1、面板开、50 真实产品、点选注入 `【产品】华为（HUAWEI）· HUAWEI Mate 80 …性能参数：…`;零 pageerror |
| 用户 10-29:编辑器布局两改(①中栏去「图层/素材」页签,素材常驻上半区+图层下半区同屏;②「设置」块移到预览区顶部横条) | ①中栏 = AssetsPanel(42% 高,内部滚动)+ LayersPanel(剩余,内部滚动),面板根加 flex 填充;②新增 `CanvasSettingsStrip` 顶条(横竖屏切换+拖动对齐参考线+画布网格+模板快出提示,同行排布)包住 CanvasPanel;移除 midTab 状态与页签/设置 JSX | typecheck 0 错、插件 20 测试全过、vite 构建新 hash `editor-Bj_R5nKe.js`、staging+win-unpacked 已同步(重启生效) |

### 12.2 未实现/待办

| 项 | 状态 | 依 据 |
|---|---|---|
| WP-4 自动上架批量配图 | ⏳ 待裁决集成点(上架子系统 1:1 移植,铁律 1 只搬不写) | §五 WP-4 |
| CA-6 PhotoCraft 深度桥接(MCP 500+ 命令) | ⏳ 远期;控制通道基本命令(launch/inspect/screenshot/execute/export)已接 | §11.3 CA-6 |
| Remotion 商用许可法务结论 | ⏳ 开放(源码可用许可,个人/小团队免费) | §7 |
| 用户自定义模板 | ⏳ MVP 不开放(模板沙箱安全) | §9.7-5 |
| 重打包后实测 | ⏳ 全部修复已在仓库/staging,待重打包安装验证 | 本节 |
| 封面 @ 技能组隐藏的实现机制 | ✅ 已解(window 直读桥标志);首轮经 app 代理读曾致菜单挂死——**@ 菜单 providers 表达式禁走 app 代理读新标志** | §12.1 |

### 12.3 端到端连接核查(2026-10-29:会话框消息 ⇋ 服务端 MCP/LLM)

> **实证方式**:真实服务端(`http://192.168.111.31:8000`,本地渠道配置 `server.url`)HTTP 探针 + 仓库封面桥真起 dsh 会话发消息(探针脚本 `.tmp-cover-acp-probe.mjs` 可复用)。

| 环节 | 结论 | 证据 |
|---|---|---|
| 会话链(聊天 iframe → 页面桥 → `/tintin/cover/api/acp/*` → `cover-acp-bridge.js` → `dsh --profile acp`) | ✅ 与 film 参照实现同构(MCP 声明/模型路由补丁/占位键/session 参数逐项一致;`sessionInfo.mcp:false` 两侧同为占位旗标) | 代码对照 `cover-acp-bridge.js` ⇋ `film-acp.ts`(mcpServers 同形状同地址) |
| 服务端 MCP(`${server}/mcp`,session/new 声明 `tintin-server`) | ✅ 端点活:initialize 握手 200(`tintin-agent-server` v1.1),tools/list **42 工具在册**,封面强相关 `generate_image`/`generate_cover`/`product_image_generate`/`product_three_view`/`comfyui_workflow`/`task_status_unified` 全在;免鉴权 | curl initialize/tools/list 实测(2026-10-29) |
| session/new 接受 MCP 声明 | ✅ 真实 dsh 会话建立成功(sessionId 签发) | 探针 startSession ok |
| 模型路由(`${server}/llm`,deepseek-v4-flash/-pro) | ❌ **当前断**:服务端 /llm 转发上游 DeepSeek 时 401——**服务端自己的上游 API key(尾号 548b)无效**;流式表现为 200+`text/event-stream` 空 SSE(0 字节)→agent 报 `Stream ended without finish_reason`。**视频剪辑会话同命中**(同一调用形状),属服务端侧故障(换上游键),非移植缺陷 | 非 stream 401 原文 `Authentication Fails … ****548b is invalid`;stream body 0 字节;桥内探针 prompt 19s 失败同错误 |
| 客户端密钥 | 两无嫌:客户端恒用占位键 `sk-tintin-local`(film/cover 一致);`/llm/chat/completions` 实测不校验客户端 Bearer(无鉴权头同结果) | curl 对照 |

**结论**:移植对账成立,服务端 **MCP 连接前提全部成立**(端点活/工具在册/会话接受声明);当前消息整轮失败卡在**服务端 /llm 上游 DeepSeek 键失效**——服务端侧换键后自然恢复,客户端零改动。

### 12.4 修复实录(本轮回归根因,防复发)

| 症状 | 根因 | 修复 |
|---|---|---|
| `/` 菜单只有 cover 一个技能(2026-10-29 用户实报:技能管理已装的生成图/封面/视频族技能全部缺席) | 封面技能清单只读**插件自带** `skills/` 目录;技能管理装位(`<渠道主目录>/skills`,rank400)与 agent home 均未接入 | 三处打通:①`/acp/skills` 合并插件目录+用户级装位(source=project/user,重名插件自带优先);②`/acp/skills-texts` 双目录解析;③`startSession` 把用户级技能整目录复制进 `cover-agent-home/skills/`(智能体可实际调用;每次启动刷新)。实证:清单 8 条(cover+openfilm+tintin-cover-gen+tintin-image-gen+tintin-music-gen+tintin-text-to-video+tintin-video-replicate+tintin-video-role-swap)、skills-texts 解析 978B、fixture 技能注入后 agent home=cover+tintin-image-gen |
| 发起请求红字 `controller is not defined`(2026-10-29 晚,重启后必现) | 并行会话 13:58 给 agent stdout 加协议行过滤(防 dsh 横幅被 SDK 当 undefined 通知)时**混淆两套流 API**:①web `TransformStream.transform` 只有 `(chunk, controller)` 两个参数、完成=同步返回,没有 done 回调(`done` 是 node:stream `stream.Transform` 的签名)→裸引用 `controller` 与 `done()` 均炸,首个协议行即抛=**每次会话启动必死**;②过滤流夹在 TextDecoderStream/TextEncoderStream 之间,入出皆字符串,`enqueue(TextEncoder().encode(...))` 塞字节会被二次编码成垃圾 | `transform(chunk, controller)` 同步返回 + enqueue 字符串;过滤器单测(横幅丢弃/协议行原样/跨 chunk 缓冲)+真桥探针(startSession OK、prompt 到达模型)双验证;已热同步安装 node_modules,**重启即生效** |
| 输入 @ 菜单整个不出现/恒空(2026-10-29,隐藏技能组后) | **@ 菜单引导死锁**:`MentionMenuPlugin.triggerFn` 在 providers 拼不出任何选项时抑制菜单(line 96)→不打开→`onOpen` 不触发→`loadMentionFiles`(图层+素材唯一加载点)永不执行。影片页靠常驻**时刻组**引导;封面页删时刻组后靠**技能组**引导——隐藏技能组后 providers 初始为零=死锁。E2E 复刻实证:菜单空、`/acp/files` 请求零次、直调桥正常(files=17/layers=3) | ChatPane 挂载即 `loadMentionFiles()`(数据先于首开就位;onOpen 保留做每次刷新);构建标记 `2026-10-29-c (mention bootstrap)`;E2E 终验 @=图层+素材(19 项)无技能无时刻,staging+win-unpacked 已同步 |
| 发消息无处理 + 红字 Unknown ACP notification method 'undefined' | 桥通知注册键抄错:`methods.agent.session.update` 不存在(SDK 树里通知挂 `client.session.update`)→ startSession 注册即抛 | 键改为 client.session.update;真 dsh+假 /llm 实验复现+修复实证;**用户实例聊天记录里该红字=10-28 18:47 失败轮次回放(record.json 诚实保留),今日新轮已实证会话可建** |
| (承上)修复后仍报错 | 用户实例进程未重启,bundle 冷(启动时加载);页面/抽屉热(按请求读盘)——混合态 | 整应用重启即愈;探针监别法:page fetch 日志 |
| 自定义层拖动永不持久 | setCustomLayer 合并顺序:{...l, ...patch, x: round(l.x)} 把 patch 后 x/y 又用旧值盖回 | x/y 取 patch 后值再取整 |
| 自定义层图片 404、命中打穿 | 编辑器 staticFile 产出根绝对路径 /name(root 无人伺服);agent 自下载图只落 cover 目录 | 编辑器入口设 `window.remotion_staticBase='/tintin/cover/editor'`;agent 回流先 await asset-sync 再套用 |
| 安装版 / 菜单空 | staging 漏同步 skills/(stage.mjs 从未拷贝) | stage.mjs 同步 skills/;路由兜底内置 cover 技能条目 |

附:PoC 产物 `D:\Project\cover-demo\out\{cover,mouse-cover,video-cover}.png`;渲染命令样例见 `cover-demo/README`(待补)。

## 十三、会话与面板修订(2026-10-30 用户裁决)

1. **默认智能体=TinTin智能体**:封面会话对外身份统一「TinTin智能体」——补丁首个模型的显示名即角色名(选择器按钮/模型行显示角色名而非裸模型 id,同影片侧做法;路由与其余模型行不动);名册/状态显示名同步去空格。composer 的 🖼/🤖 模式切换按钮(mode toggle button)保留为「直连生图」可选开关,但**默认态改为 TinTin智能体 Agent 会话**(同日早先「默认图片生成」的裁决被本条推翻)。
2. **素材/图层标题栏字体对齐项目 tab**:fontSize 11→11.5、色 #8b8b88→#e8e8e6(图层标题并去字距),与顶部 tab 项目名同字体观感。
3. **装饰层文案可编辑**:品牌条/栏目角标/角标等 graphic 层,凡其 props 键取值为字符串(brand/subTag/badge),图层面板选中即出现单行文案编辑器(改字即改画布);纯装饰无 prop 的层(网格纹理等)仍只有 隐藏/层级 两项。
4. **切项目素材即刷新(方案 1)**:素材横带挂项目纪元 key(`<AssetsPanel key={projectEpoch} />`),切换/新建/改名项目即重挂重拉——此前仅靠 3 秒轮询,切完最慢 3 秒才出新项目素材;轮询保留为兜底。
5. **选择器图标=TinTin智能体(机器人标)**:封面名册/状态 id 从 `deepseek` 切到 `tintin-agent`(聊天壳已登记,ChatAgentIcon 映射 lucide Bot)——按钮呈「🤖 TinTin智能体」,不再出现 deepseek 鲸鱼标;会话协议与 id 无关,驱动不变。
6. **封面会话 MCP 挂载同步修复(2026-10-30)**:rc.2 的 acp 路径无视 session/new 的 mcpServers 参数(实证零连接)——cover 补丁同样补 `- insert:` 的 dsh-mcp-client 行(进程级挂载, 工具名 mcp__tintin-server__*), session 参数留空数组(schema 必需)。
7. **素材条「打开目录」图标放大(2026-10-30)**:📁 按钮 13px/22px → 18px/30×30 居中(与 40px 头行匹配),色提亮。
8. **导入按钮图标改上传(2026-10-30)**:素材条「导入」按钮 ⎘ → feather upload SVG(托盘+上箭头, 12px currentColor);空态占位与提示文案同步去 ⎘。
9. **模式切换按钮删除(2026-10-30)**:composer「直连生图/Agent」切换钮(产品图标左侧机器人)整组移除 —— 会话固定走 TinTin智能体,prompt 直连旁路(直出底图)随该按钮一并删除;生成需求统一由智能体经服务端工具箱处理。
10. **直连旁路服务端实现同步删除(2026-10-30)**:`/bg-apply`、`/ref-save` 路由下线(唯一消费方=已删旁路);`/generate-background` 保留(编辑器 AI 生成底图),`/generate-product` 保留(智能体技能的产品图重绘);顺带修正 tintin-cover-acp.test 的既有断言漂移(自动重启错误文案,前缀匹配)。
11. **握手退出竞速(2026-10-31)**:统一日志实证封面 agent 子进程在 10:43-11:01 反复秒退(18+ 条 exit、wasReady=false、stderr 空、原生码被脱敏)——崩溃窗口内发送,轮次在已置空的连接上抛 TypeError。加固=initialize/session.resume/session.new 三个握手请求与 exitWaiter 竞速,进程死亡立刻报明确错误而非永挂;窗口已自愈(同命令+真实 cwd/home/补丁复现全存活,符合新包安装后 AV 拦截窗口前科)。
12. **素材条行高固定(2026-10-31)**:切项目抖动根因=行高内容驱动(空态幽灵格 128 / 有内容格 ≈148 来回跳)。修=行容器定高 150(三态同高),幽灵格随齐 148,提示文案只在确认加载完成且确为空时出现(加载中不闪文案)。
13. **顶栏按钮序(2026-10-31)**:编辑器右上按钮组改为 设置(⚙) → PhotoCraft → 导出。
14. **素材条接受网页图拖入(2026-10-31)**:原守卫只认 File 载荷,从浏览器/网页拖图(载荷只有 text/uri-list)显示禁用光标。修=dragover/drop 同时接受 Files 与 text/uri-list;新增 `/tintin/cover/api/upload-url`(主进程侧拉取免页面 CORS,三写+项目对齐+留痕与 upload-image 同口径),命名 url-<时间戳>.<扩展>。
15. **PhotoCraft 打开空文档修复(2026-10-31)**:根因=pc/launch 只裸启动不装内容。修=编辑器送当前 templateId+props → 主进程先构建图层底稿(.pcraft, buildLayeredDraft;底图解析修为项目目录优先/public 兜底) → GUI 随文档路径启动(实测 GUI 接受文档参数,document.inspect 见全部图层);构建失败如实报错不开空窗。launchApp 增 docPath 参数。
16. **素材右键菜单(2026-10-31)**:与视频剪辑素材右键同款——添加为图层(替换原「移动到」位)/在对话中引用/在文件资源管理器中显示(explorer /select 定位文件)/复制路径(绝对路径)/收藏(按项目 localStorage,置顶+★角标)/删除(仅删项目目录内文件;public/ 三写位跨项目共享不动)。原格子悬停「＋图层/@引用」按钮删除,功能并入菜单。新路由 `/delete-asset`(裸文件名防穿越);reveal 扩展 `file` 参数。收藏排序置顶。
17. **滚动条与光标(2026-10-31)**:编辑器页全域注入会话框同款细滚动条(9px/透明轨道/圆角 thumb,取自 chat.css Thin scrollbars,变量带回退);素材格光标 grab→default(箭头)。
18. **满条拖入修复(2026-10-31)**:格子铺满后光标落点=素材格,接受逻辑只在容器=部分路径被拒。修=拖放接受(dragover/drop)抽为共享处理并同挂到每个素材格(文件/URI 载荷照收,内部素材拖拽照旧忽略,格上 stopPropagation 防双导)。
19. **导入跟激活 tab(2026-10-31)**:素材条列表与导入落盘此前跟随服务端指针项目(active tab 切换后两者可能脱节=导入「成功却不显示」)。修=acp/files 与 upload-image 增加 project 显式参数(素材条传激活 tab 项目名,裸名防穿越),列表/落盘跟 tab 走;上传的项目落盘失败不再静默吞(原三写位成功即假成功)——如实返回错误。
