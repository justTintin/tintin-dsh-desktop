# 封面制作优化：图层组模型与画布交互精修

状态：**优化方向文档**（2026-10-31 用户裁决与诊断汇总，待排期实施；本文不描述已实现行为，引用处均标注"现状/目标"）。
参照系：PhotoCraft（ArtCraft，`D:\Project\photocraft`，纯 Rust 的 Photoshop 复刻）——我们封面编辑器在 PhotoCraft 模式下镜像其画布，其图层/交互实现是本领域最权威的参照。

### 0. 参照系定案与编辑态架构（2026-11-10/11 用户裁决）

1. **参照 = 行为规格,代码不可复制**:PhotoCraft 是 100% Rust 桌面程序(egui/wgpu,仓库零 package.json)——画布=自研合成器直接画像素,面板=每帧 immediate-mode 绘制,没有任何一行可拷进 React 工程的代码。能"复制"的只有行为规格(交互纪律/面板结构/视觉语言),本文件全部 PhotoCraft 引用均为 file.rs:line 级行为证据。
2. **编辑态弃 Remotion Player(2026-11-10 用户裁决「操作上匹配 photocraft 可以不使用 remotion」)**:预览/编辑画布不再经 `<Player>`,改为**自持画布**——同一份模板组件直接渲染(编辑器 bundle 内 'remotion' 经 esbuild alias 解析到 `remotion-shim.tsx`:AbsoluteFill/Img/staticFile/useRemotionEnvironment 四导出),几何/命中/选择框/手柄全归编辑器;**导出仍走 renderStill 同一模板,质量不变**(双路径同组件,单测+冒烟双向把关)。附带收益:client.js 514KB→164KB(Player 运行时出包),`[data-cover-layer]{pointer-events:auto!important}` 补丁随 Player 壳一起退役。
3. **范围 = 文字/图片图层的基本操作**(2026-11-10 用户裁决):对齐 PhotoCraft 的选择框/手柄/拖动/吸附/图层区面板;非目标=像素级描边(蚂蚁线/从像素 trace 选区,需自建合成器)、Photoshop 高级语义(蒙版/智能对象/调整层)。
4. **文字画布缩放语义定案(2026-11-11)**:画布角柄=**几何缩放**(`styles.gscale` 折入 layerStyle 变换链,不改字号不重排,对照 PS Free Transform);字号仍由编辑卡 scale 管——两个语义分离,与 PhotoCraft「Character 面板字号 vs 变换缩放」同构。

---

## 一、图层组模型

### 1.1 现状与问题

现状：图层面板是**扁平两层**——固定图层（environment/product/title/subtitle/brand/footer/grid/features/badge/subTag 等模板槽位）+ 自由图层（`props.customLayers` 的 `img-xxx`）。三个已暴露的问题：

1. **归属缺失**：产品图的衍生物（抠图结果、候选图）作为散装自由图层堆在画布顶部，读感是"复制了一堆"（2026-10-30 实例：同一张 matting 图 3-7 个副本散落画布）。
2. **概念混淆**：面板行名（产品图/主标题…）读作"图层"，但它们实际是**模板槽位**——固定框架、固定渲染方式，与自由图层不是同一类东西。
3. **类型无守卫**：任何素材都能拖进画布成为自由图层，与槽位语义无关。

### 1.2 目标模型（2026-10-31 用户裁决）

- **固定名称 = 图层组名**。品牌条(装饰)、栏目标标(装饰)、产品图、副标题、主标题(钩子)、环境图……这些固定名字是**图层组**，不是图层。
- **组内只能放对应类型的图层**（图片组收图片、文字组收文字、装饰组只有内置图形）。
- **一个组里可以有多个图层**。
- **每个组下面默认一个图层**（= 模板内置渲染；产品图组已有雏形：当前值；「恢复默认」已于 2026-11-01 按用户裁决删除）。
- **素材可以不放进组**（自由图层，独立于所有组存在）。

已落地的前置（2026-10-31）：产品槽位图可拖动（四模板 `<img>` 补 `draggable={false}`）；同图拖入画布=平移产品槽位而非新增副本（`dropAsLayer` 守卫）；抠图结果=素材（cover SKILL.md 不再默认写 `props.image`/`props.bgImage`）。

### 1.3 组内语义（已裁决：叠放共存）

| 方案 | 语义 | 对照 |
|---|---|---|
| **叠放共存（2026-10-31 用户裁决，采用）** | 组内所有图层按 z 序全部渲染，各自可有独立几何 | **PhotoCraft/Photoshop 正统**：组内 children 全渲染（`Group{children}`，`crates/doc/src/lib.rs:317`），无"同组只显示一个"概念 |
| 候选切换（未采用） | 组内可放多图，同一时刻只显示一个，可切换/恢复默认 | 贴合固定框槽位；如需换图走「恢复默认+重新设图」 |

按叠放语义，阶段 2 的组数据=每组 children 有序列表（成员全渲染，组头 z 即组序）；图片组放多张时相互遮挡由用户自行管理（隐藏/删除多余层）；「恢复默认」（还原模板内置层）已于 2026-11-01 按用户裁决删除。

### 1.4 PhotoCraft 对照

实现要点（供借鉴）：

- **文档=一棵自由图层树**：`Document.root: LayerGroup`；组就是"内容为 children 的图层"（`LayerContent::Group`），递归嵌套（上限 `MAX_GROUP_DEPTH=100`）。
- **面板=树摊平**：`LayersModel { rows: Vec<LayerRow{ id, name, kind, depth, … }> }`（architecture.md §4.5）——数据是树、呈现是带 depth 缩进的行。
- **成员=包含关系**：组员身份由"是不是该组的 children"表达（`layer.groupLayers`/`layer.moveTo` 命令挪树），不是标签。
- **一切变更=Op**：AddLayer/MoveLayer/translate 等，历史按事务存。
- **组内多图层=叠放**（全部子层按 z 序渲染，`plan()` 摊平成 PushGroup/PopGroup/DrawTiles）。

无对应物（属我们自己的模板契约扩展，与 PhotoCraft 模型不冲突）：**固定组名**（PhotoCraft 组皆临时）、**每组默认图层**（PhotoCraft 组建出来是空的）、**类型收口**（PhotoCraft 组不挑类型）。

### 1.5 分阶段落地

**阶段 1（面板组视角，数据不动）**

- 图层面板改组视角：固定名渲染为组头，组下挂默认图层行；自由图层列在"未分组"区（或按来源归组）。
- 组类型守卫：图片组只收图片、文字组只收文字（拖入校验 + 智能体写 props 校验）。
- props 结构零改动（固定槽位照旧、customLayers 照旧），模板零改动，cover SKILL.md 词汇微调（"产品图组""未分组素材"）。

**阶段 2（数据模型，真组）**

- props 增加组结构：每组一个**有序 children 列表**（照 PhotoCraft 的包含关系，成员=z 序）+ 图片组的激活项（若 1.3 选候选切换）。
- 模板按组渲染（激活图层/组内叠放），`layerOrder` 保留为全局 z 序或改为"组序+组内序"。
- 影响面：props 契约（ACP 对流、编辑器轮询）、四模板渲染、cover SKILL.md 词汇、编辑器面板与拖拽。**PhotoCraft 镜像模式无需改动**（图层与编辑发生在 PhotoCraft 原生窗口，其自身是完整 PSD 树）。

---

## 二、预览区画布交互精修（参照 PhotoCraft）

### 2.1 现状问题与根因

用户反馈：**操作太粗、容易跳动，每个图层拖动都有问题**。根因四条（均在 `dsh-tintin-cover-plugin/src/editor/App.tsx`）：

1. **自由图层拖动丢失指针捕获**：`onPointerDown` 的 `img-` 分支提前 return（:209-215），`setPointerCapture` 只在固定图层分支执行（:227）——快速拖动指针一出画布宿主，`pointermove` 停发，图层"僵住-跳回"。
2. **拖动=整棵模板重渲染**：每个 `pointermove` 直接写 zustand（`setCustomLayer`/`setLayerStyle`，:254-256）→ React 重渲染 → **Remotion Player 重建整棵模板树**（全部图层、文字重排、遮罩滤镜重算）。指针事件可达 120Hz，渲染掉帧后视觉"传送"——这是"跳动"的主根因。
3. **无拖动死区**：pointerdown 即启动拖动，点击时的 1-2px 手抖也会移动图层（"选中"与"拖动"无区分）。
4. **精度辅助缺失**：无 ΔX/ΔY 读数、无方向键微调、无拖动轮廓框；吸附阈值 `T=8` 是画布 px（:242），缩放变化时手感漂移。

### 2.2 PhotoCraft 的画布拖动机制（`crates/ui-egui/src/canvas/move_ui.rs`）

- **偏移=纯函数**：`drag_offset()` = 当前指针点 − 按下点，**取整到整文档像素**（`round().clamp(±1e7)`）——不逐事件累加，无漂移。
- **预览-提交分离**：拖动中**不改文档**——`MovePreview` 以预览键（BASE+n）渲染移动中的图层（`display_doc`），松手才提交一次 `layer.translate`（`finish()`，且校验"画布正显示该偏移"才提交，dx=dy=0 视为点击不动作）。这是流畅的根本：拖动全程零文档突变。
- **最小重绘**：`damage()` 只重绘"旧位置∪新位置"矩形，不重组全文档。
- **ΔX/ΔY 读数**：指针旁实时显示本次拖动的整像素偏移（`offset_readout`，#5727，同 Photoshop）。
- **方向键微调**：ArrowLeft/Right/Up/Down nudge 图层（Shift=大步长），合为一个历史步骤（nudge bundle）。
- **光标/轮廓反馈**：可拖→箭头光标，拖动中空心得箭头 + 图层轮廓（canvas.rs:1404-1410、1562）。

### 2.3 改造方案

| 优先级 | 改造 | 对应根因 | PhotoCraft 依据 |
|---|---|---|---|
| P0 | 两个拖动分支都 `setPointerCapture`（捕获到画布宿主），补 `pointercancel` 处理 | 根因 1 | — |
| P0 | **拖动中只做视觉预览**：对被拖 DOM 元素直接施加 CSS transform（ translate 增量），**不写 props、不触发 Remotion 重渲染**；pointerup 一次性提交真实 props | 根因 2 | MovePreview 预览-提交分离 |
| P0 | 拖动死区：按下后位移 <3 屏幕px 视为点击（只选中），超过才进入拖动；dx=dy=0 的提交跳过 | 根因 3 | finish() 的 0,0 早退 |
| P1 | ΔX/ΔY 实时读数（指针旁或编辑面板），提交值=预览值 | 根因 4 | offset_readout |
| P1 | 方向键微调：1 画布px/步，Shift=10px；有吸附时落在吸附点 | 根因 4 | Arrow-Key nudge |
| P1 | 拖动中显示图层包围盒轮廓（现有选中描边加强为随动轮廓） | 根因 4 | 移动轮廓（#1428） |
| P2 | 吸附阈值改屏幕像素（`T = 8/scale`），缩放恒定手感；吸附时展示参考线（已有） | 根因 4 | — |
| P2 | 提交时才取整到整画布 px，拖动中保持浮点 | — | drag_offset 取整口径 |

### 2.4 实现路线（2026-10-31 用户问询：能否整体按 PhotoCraft 的方式实现预览区与图层区）

**结论：能，走"交互层 PhotoCraft 化、保留 Remotion 作合成器"的路线（路线 B）；不推荐替换渲染器（路线 A）。**

| | 路线 A：自建合成器（真 PhotoCraft 式） | 路线 B：Remotion 照旧，交互层照抄 PhotoCraft 纪律（推荐） |
|---|---|---|
| 做法 | 模板从 React 组件改为**图层场景图数据**，自写合成器（canvas/WebGL 绘制图片/文字/遮罩/变换），导出同源 | 渲染仍是 Remotion；预览区加**交互覆盖层**（预览-提交分离、捕获、死区、读数、轮廓、nudge），图层区改 **LayersModel 式快照视图模型**（树摊平带 depth 的行，单向数据流） |
| 流畅度 | 满帧（damage 重绘） | 满帧（拖动零重渲染 + rAF 合帧；重渲只在提交时刻发生一次） |
| 视觉风险 | **高**：文字排版/遮罩/产品框样式需与现有四模板逐像素对齐，导出契约重验 | 零（渲染器不动，导出逐像素不变） |
| 工程量 | 周-月级（等于自研一个小型合成器；PhotoCraft 为此写了整个 Rust 基座） | 天级（P0 三条 + 面板视图模型重构） |
| 智能体契约 | props→场景图转换层，契约重写 | 契约不动（props 仍是唯一对流点） |

路线 B 的落地形态（与 §2.3 的 P0/P1/P2 是同一批事）：

- **预览区**：Player 之上加交互覆盖层；拖动 = 捕获 + 死区 + CSS transform 预览 + 松手一次提交；Δ读数/轮廓/参考线都画在覆盖层，不进 Remotion 树。风险与对策：拖动期间智能体的 props 轮询写入会冲掉内联 transform——拖动中挂起外部 apply、结束后按当前 props 重放一次。
- **图层区**：props store → 不可变快照 → `LayersRow[]`（id/name/kind/depth/visible/thumb）→ 面板渲染行；选中/显隐等操作一律以"命令"形式进 store（单向流），面板不再各自订阅原始 props；缩略图（图片层=图片、文字层=样式预览）为 P2。
- 图层组模型（§一）直接落在快照树里：组=树节点，面板=摊平行，与 PhotoCraft 的 LayersModel 同构。

路线 A 仅在以下前提出现时重启评估：模板数量多到动态组合、或需要逐像素级自由排版（超出模板槽位范式）。

### 2.5 图层区编辑面板：文字设置与图片修改（2026-10-31 用户问询）

现状（`panels.tsx`）：文字层=textarea+TextStyleEditor（字体白名单下拉/大小滑条+数字框/位置 X/Y 数字框/「微调」dx、dy 滑条/预设色板）；装饰层=单行 input；自定义图片层=宽度/不透明/旋转三条滑条；产品/底图=恢复默认+底图 AI 生成（「恢复默认」2026-11-01 按用户裁决删除）。

问题：

1. **同一病根**：每个 input/slider 事件直接写 props → Remotion 整树重渲染。滑块拖动是 60Hz+ 的连续事件流——调滑块时预览同样"跳动"，比画布拖动更密。
2. **控件冗余**：「微调」dx/dy 滑条与「位置」X/Y 数字框是同一对值的重复控件。
3. **能力缺口**：产品图无面板内替换入口（2026-10-29 删除上传/AI 重绘后，换产品图只能通过会话让智能体写 props）；自定义层无"换图保几何"；抠图与图层编辑无衔接；文字颜色只有预设色板。

改进（与画布同一条路线 B 纪律：**面板控件=命令，预览-提交分离**）：

| 优先级 | 改造 | 说明 |
|---|---|---|
| P0 ✅已实施(2026-10-31) | 滑条预览-提交分离：`input`（拖动中）= CSS 直写预览（宽度/不透明/旋转/字号/位置全部适用），`change`（松手）= 一次 props 提交 | 与画布拖动共用同一管线，滑块全程零重渲染 |
| P0 ✅已实施(2026-10-31) | 文本防抖提交：textarea/input 输入中只写本地态，停顿 250ms 或失焦才写 props | 击键风暴合并为单次渲染 |
| P0 ✅已实施(2026-10-31) | 去重：删除「微调」dx/dy 滑条（与位置 X/Y 重复）；位置=X/Y 数字输入+画布拖动+方向键 | |
| P1 ✅已实施(2026-10-31) | 数字输入补齐：自定义层 宽度/不透明/旋转 全部配数字框（照 TextStyleEditor「大小」的滑条+数字模式），支持精确值 | |
| P1 ✅已实施(2026-10-31) | 图片「替换」：自定义层加「从素材替换」（保留 x/y/宽/旋转，换图不跑位）；产品图组加「用选中素材设为产品图」（组头拖入+编辑卡按钮双入口） | PhotoCraft 智能对象 replace contents 的对应物 |
| P1 ✅已实施(2026-10-31) | 图片「抠图」直达：自定义层与产品图编辑卡加「抠图去背景」（宿主路由 /tintin/cover/api/matting 同源代理服务端 /matting；结果=素材入区，不自动上图） | 与「抠图结果=素材」裁决衔接 |
| P2 ✅已实施(2026-10-31；自由取色由并行批次先行落地) | 钩子行管理（逐行增删按钮）；文字自由取色已在 | |
| 选中图片图层基本操作 ✅已实施(2026-11-01 用户裁决「对齐 PhotoCraft」) | 属性卡（`src/editor/image-props.tsx`，自由图层与产品图槽位共用）：混合模式（17 种=PhotoCraft 27 种里 CSS 可等价渲染的子集）+不透明度+🔒锁定位置；W🔗H/X/Y/角度数字框；水平/垂直翻转（画布方向镜像）与 90°/180° 旋转；排列（置顶/上移/下移/置底）；复制图层/删除图层 | 图层面板头 `layers.rs:143-230`（模式/不透明度/锁定）、属性面板 Transform `layer_props_ui.rs:153-189`、Layer›Arrange `menu_catalog.rs:408-413`、编辑›变换翻转/旋转预设 `extra_cmds.rs:815-833`、复制图层 `cmd.rs:463-507` |
| 配套 ✅同批 | 快捷键窗口级（图层面板点选后也生效）：Ctrl+J 复制、Delete 删层、Ctrl+[ ] 上下移一层、Ctrl+Shift+[ ] 置底/顶、方向键微调（锁定拒绝）；产品图槽位补画布缩放手柄（中心锚，改 `styles.product.sx/sy`）；Alt+拖动=整层复制（含高/翻转/锁定外全部属性）；锁定层：拖动/微调/手柄/对齐/属性卡几何全部拒绝，面板行 🔒 可点解锁 | Ctrl+J `edit_cmds.rs:1049`、Delete `layers.rs:371-410`、排列快捷键 `menu_catalog.rs:408-413`、nudge 1px/Shift10px `move_mods.rs:193-218`、锁定拒绝变换 `transform_tool.rs:148-150` |

注：「恢复默认」按钮（把图层图设回模板示例图）于 2026-11-01 按用户裁决删除——它不属于 PhotoCraft 的图层操作词汇（PhotoCraft 无 layer 级 reset；`Revert`=整个文档回存档），且示例图对真实项目无用。

验收：属性卡对自由图层改 W/H/X/Y/角度/不透明度/混合后画布与导出一致；翻转后的图与原图绕画布中线镜像；锁定后画布拖动与数字框均拒绝；Ctrl+J 副本落在原图层之上且紧贴；快捷键在焦点位于图层面板时可用。

验收：滑块全程拖动 Remotion 零重渲染（Profiler）；松手值=预览值；替换图片几何不变；抠图产物只进素材区不自动上图。

### 三、验收清单

- 图层组（阶段 1）：面板呈现组头+默认图层+未分组区；图片组拖入非图片被拒（「恢复默认」已于 2026-11-01 按用户裁决删除，不再验收）。
- 画布容错（2026-11-01 用户裁决）：①产品图/环境图/自由图层的图片未设置时该层留空，路径非法或文件缺失时只有该层显示黄色虚线警示框，其余图层照常（`templates/CoverImg.tsx`；导出时仍按原样报错，不静默导出缺图封面）；②模板异常导致画布崩溃时显示原因与「重新加载画布」，修改内容后自动恢复（`src/editor/canvas-player.tsx`）；③换装新包后自由图层的图仍能显示（读取 props 时服务端连同自由图层一并收图，`ensureCoverAssets`）。
- 画布交互：①按住快速拖出画布再拖回，图层持续跟手不僵不跳；②拖动全程 Remotion 树零重渲染（React Profiler 验证）；③单击（含手抖）不产生位移；④Δ读数与最终落点一致；⑤方向键 1px 步进可见可重复。
- 回归：PhotoCraft 模式镜像不受影响；导出 PNG 与编辑器预览逐像素一致；智能体 props 对流（2 秒轮询）不受组视角影响。

---

## 四、远期需求（2026-10-31 用户裁决：放下个版本，本轮不实施）

**即梦智能体化**——即梦从「生图引擎选项」升级为**智能体形态的生成来源**：

- 封面制作：即梦作为封面图片的生成来源（智能体）；
- 视频剪辑：即梦作为视频素材的生成来源（智能体）。

配套的结构工作已完成（2026-10-31）：即梦客户端与策略（dreamina.js / dreamina-logic.js）随迁 `dsh-tintin-shared`（产品中立命名），封面与影片引共享包、互不依赖——下版本做智能体化时直接在 shared 之上包智能体壳即可。「封面去即梦化」裁决为**不做**（双引擎保留现状）。

---

## 五、预览区对照 PhotoCraft 的剩余优化清单(2026-11-01 盘点;2026-11-10 执行状态复核)

**P0 ✅已实施(2026-11-01)**: 缩放回归修复(fitScale 实测适配,zoom=1 恒为适合窗口)+缩放锚点=光标(Ctrl+滚轮前后光标下文档点不动)。

**P1 ✅全部已实施**(2026-11-01 起陆续,2026-11-10 复核确认;此前清单未标注,本批补记):
1. ✅ 画布内缩放手柄: 图片层四角(2026-11-01)+**文字层四角(2026-11-10 `text-scale.ts`,拖角改字号=基准×scale,预览写 DOM 提交写 styles.scale)**;旋转手柄仍仅图片层(文字旋转见下方新方向);
2. ✅ 层间智能吸附: 拖动激活时实测其它图层的边/中心为吸附候选(candsX/candsY),吸附滞回 12px 防边界抖动;
3. ✅ Alt+拖复制: onPointerDown altKey → duplicateCustomLayer(副本不带锁,紧贴原层之上);
4. ✅ 重做+常用快捷键: `canvas-keys.ts` 窗口级(Ctrl+Shift+Z/Ctrl+Y 重做、Ctrl+0 适合、Ctrl+±、方向键微调 Shift=10px、Ctrl+J、Delete、Ctrl+[ ] 排列);
5. ✅ 旋转角度读数: onRotateMove 沿用 Δ读数浮层(°)。

**P2(可选,均未实施)**:
6. 悬停高亮(pointer 悬停时预亮将命中的图层);
7. Alt+点击循环选层(重叠层切换);
8. 高倍缩放像素化渲染(image-rendering: pixelated,>200% 时实像素观感);
9. 空格按住隐藏全部辅助线/轮廓(纯净预览)。

**远期**: 画布内文字就地编辑(双击进入);标尺(rulers);多选与成组变换。

### 5.1 2026-11-10 报障批(用户「放大拖动文字时右边的值没变」,对齐 PhotoCraft #128 live-drag;已实施未打包)

- ✅ **live 值通道**(`ui.ts` liveLayer+useSyncExternalStore): 画布拖动/缩放中 DOM 预览-提交分离照旧,但实时值广播给编辑卡——**拖动中 X/Y、缩放中字号实时跟随**(对照 move_ui.rs #128 拖动时实时显示);不经 store,撤销栈零负担;
- ✅ **字号滑条 live 显示**: 受控 value 原锚 store 值=拖动中 React 拉回(值冻结+滑块回弹)——改拖动中显示 live、松手/失焦提交;
- ✅ **文字层画布缩放手柄**(同上 P1.1);
- ⚠️ 关联修复: 滑条预览分支的手感对照 PhotoCraft 悬停/拖动读数(编辑卡输入框 shift=10px 步进与 PhotoCraft 一致)。

### 5.2 剩余优化方向(2026-11-10 盘点;**同日 T1-T3 批已实施完毕,勾账如下**)

**T1(文字操作补齐,用户主诉域)✅已实施**(`79f0689813` 2026-11-10,文字 rotate 基座随批提交):
1. ✅ **文字层旋转手柄**: `text-scale.ts` useRotateHandles 扩展文字层(4° 吸附 ±90/±180,读数同源);`templates/text-style.ts` 增加 `rotate` 字段并折入 layerStyle 的 translate 变换;
2. ✅ **缩放手柄字号读数**: 文字四角柄拖动中画布旁「N px」读数(T1.2,Δ读数同源);
3. ✅ **双击就地编辑**(T1.3): 双击文字层画布内 textarea 就地编辑(`inline-edit.tsx`+`CoverInlineEditor.tsx`),250ms 防抖提交;

**T2(对齐/吸附增强)✅已实施**:
4. ✅ **等距分布吸附**(T2.4): 拖动中相邻吸附目标的中间点入候选,分布提示线同源;
5. ✅ **吸附开关记忆**(T2.5,`1e1240c8f5`): 「拖动对齐参考线」「画布网格」localStorage 持久化(`store.ts` guides/canvasGrid);

**T3(纯预览体验)✅已实施**(`canvas-aux.ts` 提取付账): 悬停预亮(T3.6,ref 直写零重渲染)/Alt+点击循环选层(T3.7)/高倍缩放像素化(zoom>2 image-rendering)/空格纯净预览(T3.9)。

**实施备注**: 勾账时 `templates/text-style.ts` rotate 与重构建 `client.js` 尚在工作树,随下一提交入库。

---

## 六、编辑态自持画布与图层区 PhotoCraft 化(2026-11-11 批,用户裁决「按你的方案开工,要实现更好的操作」)

### 6.1 已实施(全部随本批提交)

**WP-A 编辑态架构(§0-2 定案落地)**:

| 件 | 内容 | 证据 |
|---|---|---|
| `src/editor/remotion-shim.tsx` | 编辑器 bundle 内顶替 'remotion'(AbsoluteFill 对齐上游默认样式/Img=纯 img/staticFile 语义对齐+逐段编码/useRemotionEnvironment 预览恒预览分支) | 模板源码零改动;导出路径仍用真 remotion |
| `scripts/build-editor-bundle.mjs` | esbuild `alias: { remotion → shim }` | client.js 514KB→164KB |
| `src/editor/render-surface.tsx` | RenderSurface=模板组件直接渲染(scale 外层等比)+错误边界契约移植 CanvasPlayer(出错快照/内容变化自动重挂/手动重载) | 替代已删除的 canvas-player.tsx |
| `src/editor/edit-canvas.tsx` | CanvasPanel 整体迁出 App.tsx(App 993→351 行,千行付账)并接自持画布 | 顺手修:旧 App 级 Ctrl+滚轮监听与 useCanvasZoom 双重挂载(每次滚轮 1.21 倍);拖动结束恢复选择框显示(旧版外部直写 display:none 后 React 不重置) |
| `src/editor/bundle-entry.tsx` / `editor.html` | pointer-events 补丁退役(Player 壳专属语义) | |

**WP-A3 旋转感知选择框(对照 transform_controls.rs)**:

- `src/editor/sel-geom.ts` 纯几何:布局盒 ⊕ transform 2D 矩阵分解 → 旋转矩形 {cx,cy,w,h,deg};角点按视觉方位标注(nw=min(x+y) 等,翻转无关);旋转柄=视觉上边外侧法线抬升;45° 桶近似方位光标(CSS 光标不可连续旋转)。单测 10 例。
- 选择框/手柄随层旋转,手柄=屏幕等尺寸 7×7 白底 accent 描边方块(PhotoCraft 规格);参考线 PhotoCraft magenta。
- 缩放分档:未旋转自由层=对角锚(原 cornerResize);**旋转自由层=视觉中心锚**(image-ops.centerResize,新单测);产品槽位=中心锚 sx/sy(原语义);**边柄=单维缩放**(edgeResize,仅未旋转自由层,n/s 需显式高,新单测)。

**WP-A4 文字几何缩放**:

- `templates/text-style.ts` 增 `gscale`(0.3..3)折入 layerStyle 变换链 translate→rotate→scale;`text-scale.ts` useTextScaleHandles 重写=对角锚距离比驱动 gscale,读数「N %」,live 值=基准×scale×gscale(编辑卡字号/就地编辑 px 同口径)。

**WP-B 图层区 PhotoCraft 化(`src/editor/layers-panel.tsx`,自 panels.tsx 迁出;对照 layers.rs/layer_row.rs)**:

- 行=眼睛+**缩略图**(照片行小图/文字行文案样本/图形行◇)+名字(**双击就地重命名**,显示名存 `store.layerNames`,会话内存态,不进 props 契约不进导出,项目切换/回读清空)+锁+拖柄;拖动调层级/素材拖入成层/组投放=原行为。
- 头行=**混合模式(17 种)+不透明度**,作用于选中图片图层(文字层无 opacity 通道,禁用并提示);不透明度拖动=预览写 el.style.opacity 松手提交。
- **右键菜单**=重命名/隐藏/锁定/排列四向/复制/删除(菜单皮肤上收 ui.ensureMenuStyle 与素材面板共用);**页脚垃圾桶**=拖自由图层到此删除。

### 6.2 验证记录(2026-11-11)

- 单测:封面插件 124 用例全绿(新增 sel-geom 10 + centerResize/edgeResize 4 + gscale 3);src typecheck 0 红(工作树总红 42→37,既有漂移只减不增)。
- 导出侧冒烟:`stage.mjs --smoke` 真渲染 ✓(remotion-bundle 预构建随批重出,gscale 进导出)。**顺手修既有夹具缺陷**:smoke props 漏 `subtitle` 而空文案校验必拒(非本批引入,首跑即红)。
- 渲染面实机(独立页+浏览器自动化,渲染面验证纪律):自持画布渲染 ✓/点选出现选择框+4 角柄+旋转柄 ✓/拖动 80px 精确提交+选择框恢复 ✓/文字角柄拖动=框 143×33→198×46 等比 1.38 且**字号保持 34px** ✓/右键菜单项与行语义 ✓/双击重命名提交生效 ✓/图层区缩略图与混合-不透明度头行 ✓。
- 门禁:`check:tintin` 5 pass/0 fail;verify-cover-payload 新鲜度首跑拦下 staging 未刷新(守卫按设计工作),stage 后复绿。

### 6.3 剩余方向勾账(2026-11-11 续批 R1-R4,用户裁决「开始」;全部随批提交)

1. ✅ **头行混合/不透明度扩展到文字层**: `templates/text-style.ts` TextStyleOverride 增 `opacity`(0..1 夹取)/`blend`(BLEND_MODES 白名单,normal=undefined),layerStyle 恒输出 opacity/mixBlendMode(spread 消费的 4 模板自动生效;VideoCover×2 title 与 ProductCover×2 features 显式节点补 opacity/mixBlendMode 透传——6 模板全部消费);面板 selIsImage→selHasLook(图片/文字层启用,装饰层仍禁用)。单测+4。
2. ✅ **旋转层边柄**: edgeResize 替换为 `rotatedEdgeResize`(指针位移在视觉边轴向的分量驱动,对侧视觉边为锚,x/y 补偿含 sin/cos 交叉分量;deg=0 严格退化为轴对齐行为;翻转不改盒几何故公式与 flip 无关),边柄不再限制未旋转;n/s 仍需显式高。单测重写 4 例(含 90° 顶缘锚定不变量)。
3. ✅ **文字缩略图 canvas 真字体渲染**: TextThumb 2 倍分辨率 canvas 2D(字号/字重/斜体/字体族/颜色/投影/描边/不透明度与画布同源,fit 自适应缩放,逐行居中);getContext 失败(jsdom/无 2D)回退字样 span——渲染面/单测双形态可用。
4. ✅ **layerNames 按项目持久化**: 面板接管读写(localStorage `tintin.cover.layerNames.v1` = { 项目名 → { 图层id → 显示名 } },项目切换即换档,名称变更即落盘);agent-sync 的 props 回读不再重置 layerNames(上一批的重置逻辑回退——持久化后面板是唯一属主)。

### 6.4 剩余方向(2026-11-11 续批 R5-R8,用户裁决「6.4 继续实现」;全部随批提交)

1. ✅ **合成像素级缩略图**: 图片行(自由层/产品/环境)缩略图走与画布同源的 lookTransform/lookOpacity/lookBlend/imgDropShadow(旋转/翻转/不透明度/混合/投影真实呈现,不再是原始素材小图);文字行 canvas 真字体渲染(上一批 R3)。
2. ✅ **角柄内容角附着+旋转层精确锚定**: rotCorners 从视觉方位标注改为**内容角附着**(nw 恒=C−(w/2)u−(h/2)v,随层旋转走)——视觉方位标注在 ±90° 整倍数出现 x+y 平局,手柄会在相邻角间跳(实测复现后根治);`rotatedCornerResize` 以对侧**内容角**精确锚定替换旋转层中心锚近似(拖拽比同 cornerResize 口径,deg=0 逐值一致;翻转不改盒几何故与 flip 无关);sel-geom r2 归一化 -0。单测重写(90° 锚定不变量)。
3. ✅ **layerNames 进 cover.props.json 契约**: 服务端 POST /acp/props 收可选 layerNames(形状守卫:字符串映射≤100 条)随记录落盘,GET 原样返回;客户端四点接线(项目回读/轮询回流/推送 body/409 退回套用,sanitizeLayerNames 消毒);面板 localStorage 属主退役(R4),契约成为唯一属主——名字跨会话/跨机随项目走。服务端记录用例+1。
4. ✅ **多选与组变换+标尺**: Shift+点击加选(选择集=主选∪多选,toggle 对全集运算);拖动=全部选中层同一 delta 整体移(吸附按主选算,相对关系不破坏);对齐工具条多选=组内对齐(参照=选区包围盒,对照 PS Align Selection Edges);方向键=全部选中层微调;Delete=删除全部选中自由层;多选时联合 AABB 包围盒(无手柄,v1 变换=移动/对齐/微调/删除)。**标尺**: 顶/左两条画布 px 刻度(密度随缩放分档 25/50/100),刻度层随滚动/缩放 ref 直写平移对齐,指针十字标跟随,v1 不含拖出参考线。**实现期修复的三处实测 bug**:①拖动命中已选层不得清多选(alreadyIn 守卫)②moveIds 漏主选(点 multi 成员时主选不在集合→补全选择集)③host.setPointerCapture 可抛 NotFoundError(合成指针/指针已释放)→try/catch 守卫(对齐既有 release 侧惯例)。

**验证记录(2026-11-11)**: 133 用例全绿;typecheck 37 精确基线零新增;导出侧渲染冒烟 ✓;门禁+载荷新鲜 ✓。**浏览器端到端(独立页+真/合成指针)**: 多选 Shift 加选→联合框(513×276 无旋转)+手柄隐藏→整体拖动 dProduct=60/dSubtitle=60 精确同移;R6 内容角语义+90° 锚定由单测锚定;标尺刻度/十字标 DOM 与截图核验;R5 缩略图行渲染文案样本。**测试环境坑(非产品 bug)**: IAB 隐藏页 setTimeout 节流(250ms 防抖观察不到→用 focus+blur 走 flush);合成 PointerEvent 的 pointerId 无活动指针会令未守卫的 setPointerCapture 抛错(已修复为产品加固)。

### 6.5 剩余方向(2026-11-11 续批 R9,用户裁决「继续完成剩余的」;除注明外全部随批提交)

1. ✅ **多选撤销粒度**: store 批量动作 applyLayerGeometry(多层 x/y·dx/dy 一次 set)/removeCustomLayers(批量删+清 z 序/选择)——整体移/组对齐/组微调/组删全部单条撤销(此前逐层 set=N 条)。撤销栈长度单测。
2. ✅ **标尺拖出参考线**: store userGuides({h,v} 画布 px,会话内存)+add/move/remove 三动作;标尺可点(拖出建线/抓现有线移动/拖回标尺或画布外删除,4 屏幕px 抓取阈值);青色线渲染于内容层(与 magenta 吸附线区分);**拖动吸附候选并入用户参考线**(对照 PS 参考线吸附)。逻辑提取 use-user-guides.ts;标尺刻度提取 canvas-rulers.tsx(两笔提取付账,edit-canvas 984 行)。
3. ✅ **多选手柄变换(组缩放)**: groupScaleEntries 纯函数(选区中心不动点:自定义层几何缩放/文字层 dx·dy+gscale×f 夹 0.3..3/产品槽位 sx·sy×f 夹 SCALE界);store applyGroupScale 一次 set;多选联合框四角白底柄(单选柄让位);预览=自定义层 DOM 几何精确(与提交同一数学)、固定层位置平移精确+尺寸缩放提交生效。逻辑提取 use-group-scale.ts。单测 4 例。**实测修复**: releasePointerCapture 对合成/已释放指针抛 NotFoundError 且抛在还原/提交之前→try/catch 守卫(与 setPointerCapture 守卫对称)。
4. ✅ **agent 显示名指层**: 会话上下文推送(<cover_context> 图层清单)label=显示名优先(layerNames 契约)——用户改名后 @ 菜单/agent 词汇同步;cover SKILL 图层协议新增第 4 条(显示名→id 映射规则,保留字段勿删),顺带理顺既有重复编号(4 个"5")。
5. ⏸ **成组持久化**(显式 Group 数据模型): 涉及新数据模型与组语义用户裁决(与既有"图层组=模板槽位"概念叠加),未实施——现有多选+组变换覆盖临时成组操作。
6. ⏸ **翻转体感校准**: 几何已正确(翻转不改盒几何,内容角锚定公式与 flip 无关),把手-内容对应感属实机体感项,等用户实测反馈。

### 6.5′ 图层面板元素一比一(2026-11-11 续批 R10,用户裁决「按钮/图标一比一复制 PhotoCraft」)

**图标管线实证**: PhotoCraft 图标=Lucide 24 栅格 SVG(assets/icons/*.svg),加载时 stroke 2→1.75、currentColor 按用途着色(icon_data.rs/icons.rs)——本批把 SVG 路径**逐字拷贝**进 layer-icons.tsx(eye/lock/folder/type/trash/square-plus/chevron-down),非重绘近似。

- 行规格(layer_row*.rs): 32px 行高;眼列 30px 全高(可见=eye 15px icon 色,**隐藏=空白**,Photoshop 同款;Alt+点击=只显示此层 :407-411);行左 1px 竖分隔+行底 1px 横分隔;选中=#525252(theme row_selected 暗档);名 12px 隐藏→faint;右缘=混合模式标签 10.5px(≠正常时)+lock 12px(仅锁定,点击解锁);**整行拖拽,⠿ 手柄退役**(layer_row.rs:203-214);表情图标(👁🚫🖼📷◇🔒⠿)全退役。
- 组=实心展开三角(layer_tree_ui.rs:65-71,展开朝下/折叠朝右)+每层缩进 14px+**组可折叠**(折叠隐藏默认行与成员行)。
- 缩略芯片 24px(layer_row.rs:617-677): 图片=棋盘格 5px 单元+信箱图+外描边 1px #141414;文字=#DEDEDE 芯片+type 20px #282828(pro 形态);组/空=field 底 radius 6+folder 18。文字行真字体 canvas 缩略图(TextThumb)按 1:1 退役。
- 投放指示(layer_drag.rs:180-188): 行上/下缘=2px accent 横线;拖入组=组内描边 radius 3(替代旧 inset 阴影 hack)。
- 页脚(layers.rs:402-528): 1px 分隔+30px 条右对齐 26×26 按钮(glyph 14): trash=删选中自由层/行拖到=删,square-plus=复制选中自由层/行拖到=复制;link/mask/fx/adjustment/folder 按钮无对应业务语义,不做死按钮。
- 头行(layers.rs:149-184+fields.rs): blend 下拉=field #242424/border #4A4A4A/radius 3/chevron 14 区(appearance:none+绝对定位图标);不透明度=80px 数值字段(24px 高,mono 数字+% 后缀+▾ 区),点击开 160px 弹出滑条(:323)。
- Pro-dark 调色板(theme.rs:225-334 暗档)常量 PC.*:field #242424/border #4A4A4A/selected #525252/separator #1E1E1E/text #DEDEDE/dim #B2B2B2/faint #808080/icon #C8C8C8/accent #378EF0(仅面板内)。
- 浏览器截图核验: 眼列/三角/芯片/选中态/头行字段/页脚按钮全按规格呈现(见验证截图)。

### 6.5″ 图层更名(2026-11-11 用户裁决)

「产品图」→**「主体图」**(图层可能是人也可能是产品)。图层 **id 仍为 `product`**(会话词汇/props 键/styles.product/工具通道全锚 id,不动);registry.ts 4 模板 label + 编辑卡串(「设为主体图」等)+ cover SKILL 词汇(第 6/7 条与典型流,注明更名与 id 不变)随批;cover_context/面板行/校验报错自动跟随(均由 label 派生)。

### 6.5‴ 文字层属性面板一比一(2026-11-11 续批 R11,用户裁决截图指认「字符操作 1比1复制」)

对照 properties.rs + layer_props_ui.rs + type_panels_ui.rs(截图对照):编辑卡 TextStyleEditor 退役,新 **text-properties.tsx** 四段面板:
- **变换**: 宽[px](文本框宽,可改=换行约束,H 随内容只读,W-H 链接钮禁用态)/X[px]/Y[px](画布绝对位,改=平移 dx/dy;测量=compRectRef 共享单例,canvas-geom 导出+edit-canvas compositionRect 回写);字段 24px field/border/圆角 3+px 后缀(mono)。
- **对齐与分布**: 六向对齐图标(相对画布,与画布工具条同数学,面板本地实现)+水平/垂直分布段钮(需 ≥3 选中,面板单选语义=禁用态);图标 Lucide align-edge-*/distribute-* 路径逐字。
- **字符**: 字体/样式下拉(既有组件重排);字号 pt(基准×scale,**画布拖角 live 跟随**)/行距 pt/字距 px/基线偏移 px/水平缩放 %/垂直缩放 %(各字段留空=还原模板默认);颜色=单色块+取色(色板退役);大小写四钮(Aa/TT/tt/Tt=text-transform)。
- **段落**: 左/居中/右/两端对齐(text-align,继承到逐行子节点)。
- **图层样式尾段**: 投影/描边(既有功能收编,PhotoCraft 语义=fx 面板另开,此处保守收编)。

**新能力(TextStyleOverride 字段+layerStyle 输出)**: width(文本框宽,VideoCover×2 title 硬编码宽接 override)/lineHeight/letterSpacing(**6 模板硬编码 1.12-1.2 与 ±1 全接 override,缺省=原值**)/hscale·vscale(25..400%,折入 transform 两轴 scale,与 gscale 相乘)/baseline(±200px,折入 translate dy)/caseTransform(text-transform)/align(text-align)。消毒全夹取;translate 链=translate(dx,dy+baseline)→rotate→scale(g·h,g·v)。
- 基线不落 position/top(与模板 absolute 冲突),折 translate——实测选定。
- 既有 toEqual 断言兼容: toEqual 忽略 undefined 键,零改动。

### 6.5⁗ 现场报障修复(2026-11-11 续批 R12,用户截图指认两案)

1. **主体图默认白球**: VideoCoverPortrait 主体图槽位自带白色聚光渐变盘(#f8fafc→透明 72%)+青色虚线圆环(产品照聚光装饰),**无图时也渲染**=默认白球。修=盘/环门控在 image 有值时才渲染(空槽=透明,PhotoCraft 语义:空层无像素)。
2. **选择框偏外+样式**: ①框如实绘制槽位边界——槽位本身 left:50% 而 620 宽溢出画布右缘 80px(用户所见「偏到外面」);框位置实测与槽位边界逐像素一致(frameMatchesSlot=true,误差<3px,无测量 bug)。②样式=青色 accent 非 PhotoCraft 蓝——选择框 chrome 全量换 **SEL_COLOR #378EF0**(transform_controls.rs accent;常驻框/多选框/拖动轮廓/旋转柄连杆+柄/角边柄/组柄 8 处),白色方块柄保留。
- 现场验证(竖屏+空主体图选中): 白球 0/框色 rgb(55,142,240)/框==槽位边界 ✓。

**6.5⁗ 补充(同批二次修复)**:用户再报「选中文字后框仍偏」——真凶坐实=**选择框坐标双重计入**:measureSel 存的 compLeft/compTop 是视口坐标,而框/手柄渲染在 playerWrap 内(top/left 相对 playerWrap),应用顶栏+设置条+画布居中边距被双重计入(+129 画布px=88 屏幕px÷缩放,与用户 44% 缩放场景吻合;横纵同源)。修=measureSel 存 **playerWrap 相对坐标**(comp − playerWrap rect)。此前「框==槽位逐像素」验证两侧同误差故盲区——对照验证必须有一侧独立基准。同批:选择框 chrome 换 PhotoCraft 蓝(SEL_COLOR #378EF0,8 处)+白球门控。

### 6.5⁵ 画布选择框 chrome 整体拆除+面板切层抖动修复(2026-11-11 续批 R13,用户裁决)

用户报障(截图):「切换不同图层时,还会出现图层布局抖动,会出现跟着显示青色边框,如果你这个青色的边框无法正常处理,就不要此功能。」——选择框 chrome 经三轮修复(样式换蓝→偏移双重计入修复→用户实测仍见旧位残影/连杆横穿画布)仍不稳,执行裁决:

1. **chrome 整体拆除**(edit-canvas 重写 998→604 行): 移除常驻选择框/多选联合框/组缩放角柄/角柄/边柄/旋转柄+连杆/悬停虚线框/拖动轮廓(共 10 类画布覆盖物)。保留交互面: 点选/Shift 多选/拖动+智能吸附/Alt 循环选层/Alt 复制/对齐工具条/快捷键/就地编辑/拖放建层/智能吸附参考线(magenta)/用户参考线/标尺/网格/纯净预览。尺寸/位置/缩放编辑走属性面板数值字段(R11 变换段+ImageLayerEditor)。
2. **旋转数字入口补位**: 旋转柄拆除后文字层旋转只剩数值通道——TextProperties 变换段补「角」字段(styles.rotate,±180°,与 text-style.ts 钳位同口径)。
3. **面板切层抖动根因+修复**: 编辑卡高度随图层类型/内容变化(TextProperties vs ImageLayerEditor vs 多行文本)→挤压上方行区(flex 1)=切层整列跳动。修=编辑卡容器**定高 300px 内滚动**(layers-panel),行区几何恒定。
4. **compRectRef 保活**: 原 measureSel 每渲染顺带刷新属性面板测量基准;拆除后改由独立 layout effect 调 compositionRect() 保活(TextProperties W/H/X/Y 数据源不受影响)。
5. **留档不删**: sel-geom/image-ops resize 族/text-scale/use-group-scale/canvas-aux.updateHover 几何数学保留(当前无引用),待整套选择系统重设计后复用。
- 验证: 140 用例/typecheck 37 基线/三件构建/check:tintin 全绿;无头实机探针(切层 3 次): SEL 蓝 border/fill 元素=0、首尾行 Y 恒定(111/333)、编辑卡+对齐工具条正常、页面错误=0。

### 6.5⁶ 编辑卡去重(2026-11-11 续批 R14,用户裁决)

用户截图点破:「图层里的一些操作(红框:上移/下移/置底/复制图层/删除图层/仅显示此图层导出)已经可以通过操作图层来做,还多此一举」——这些操作图层面板全有(行拖拽排序=排列;右键菜单=排列四向+复制+删除;页脚 trash/square-plus=删除/复制;Alt+点击眼睛=仅显示此层),编辑卡重复即多此一举:

1. **ImageLayerProps 删除三块**: 排列段(置顶/上移一层/下移一层/置底)、复制/删除行、仅显示此图层导出行;连带删除 exportThisLayer/exportMsg/arrangeBtn 与 arrangeLayer/duplicateCustomLayer/removeCustomLayer 订阅(图片属性卡只留 混合/不透明度/锁定/投影/变换 W🔗H·X·Y·角度/翻转/旋转 90°·180°)。
2. **过时提示行同步**: 「拖右下角柄改大小·拖上方圆点旋转」随 chrome 拆除已不存在 → 改「尺寸/旋转用上方 W/H/角度字段」。
- 验证: 140 用例+37 基线+两构建+check:tintin+无头探针(选中主体图:排列/复制/删除/单层导出按钮=0,变换与翻转/旋转在,零 pageerror)。

### 6.5⁷ 画布浮动对齐条删除+对齐入口收进属性卡(2026-11-11 续批 R15,用户裁决)

用户截图圈出画布顶部六向对齐浮动条问「这个是做什么,有什么用,没有用就删除」——功能=选中层相对画布六向对齐(⇤⇔⇥⇧⇕⇩);判断=功能有价值但**形态是画布覆盖物且与文字属性面板「对齐与分布」重复**(PhotoCraft 对齐落点也在属性面板,不在画布),按裁决删除浮动条、能力收进面板:

1. **浮动条删除**(edit-canvas): 六向按钮块+`alignLayer/alignGroup` 组对齐数学+`locked` 一并移除;画布只剩模板/标尺/参考线/网格。
2. **对齐入口统一**(align-row.tsx 新建): `AlignButtons`(六向,图标逐字复用 layer-icons)+`IconBtn` 自 text-properties 提取共用;TextProperties 改用它(六向块 6 行→1 行),ImageLayerProps 新增「对齐」行(仅几何目标;与旧数学同一口径=视觉盒对画布,文字走 dx/dy、图片走 x/y 或槽位 dx/dy)。
- 验证: 140 用例+37 基线+两构建+check:tintin;无头探针:选中前页面对齐按钮=0、选中主体图后每向恰 1(卡片套)、水平居中 X 610→320 生效、文字面板「对齐与分布」在、零 pageerror。

### 6.5⁸ 图层区高度可调+默认一半(2026-11-11 续批 R16,用户裁决)

用户截图:「图层占的布局太多,红框里的分割线要做成可调的,图层区域默认占整个高度的一半。」落地:

1. **分割线可拖**(layers-panel): 行区+页脚=图层块,与编辑卡块按 `splitRatio` 分高(flex `ratio 1 0` / `1-ratio 1 0`),两块的边界=7px 命中区 + 1px 视觉线(`ns-resize`),拖动实时改比例(夹 0.2..0.85);用户拖过后挂载校准不再覆盖。
2. **默认一半**: 挂载时按「整个面板高度的一半」校准(测量 root/body 高度得 ratio,图层块+其标题/混合头行=面板 50%)。
3. **防抖动保持**: 两块都是比例定高,切层时编辑卡内容变化只滚动不挤压行区(取代 R13 的固定 300px 方案,用户可自行调)。
- 验证: 140 用例+37 基线+两构建+check:tintin;无头探针:默认图层区(含头行)=面板 49.5%,真实鼠标上拖 80px → 图层块 266→187 / 编辑块 324→403,零 pageerror。

### 6.5⁹ 对齐与分布一比一 + 对齐失效根因 + 全属性审计(2026-11-11 续批 R17,用户裁决)

用户两图对比(图1=PhotoCraft 属性面板,图2=封面制作)：「和 PhotoCraft 对齐不一样,要求一比一复制;另外对齐时并没有起作用。检查还有没有别的操作设置时没有起作用的问题。」

1. **对齐失效根因(实锤)**: 对齐其实一直在改画布(transform 已变),但面板 X/Y 数字永不刷新——`measure` memo 在提交前测量,`force()` 重渲时 deps 未含计数器 → 命中旧缓存,永远慢一拍(点第一下数字不动,点第二下才显示第一下的结果)。修=measureTick 计入 memo deps(提交后重测一次)+ 对齐/X/Y 提交改「点击时现场 measureNow()」,不再吃快照。
2. **对齐与分布 1:1 PhotoCraft**(规格源=`layer_props_ui.rs:144-181/273-311`,主题 tokens `theme.rs:225-244` ProMedium): 图标=参考线(stroke 1.2)+两根不等长实心条(10/6 与 3 宽),六种 kind 几何逐项换算;按钮 24×24、间距 2、第三枚后 8px;hover #626262;enabled #E2E2E2 / disabled #A0A0A0;分布=两个纯文本按钮(水平/垂直,field #454545/border #686868/文字 #EEEEEE),≥3 选中才可用。**分布动作实装**(此前恒禁用=死钮): 首尾钉住、中间层等距,文字层写 dx/dy、自由图片写 x/y;图层面板行支持 Shift+点加选(分布可达)。对齐动作支持多选(选区内每层各自对画布,恢复 R15 退役的组对齐能力,入口=面板)。
3. **全属性审计**(无头探针逐项操作+读真实落点,20 项): 通过=字号/行距/字距/颜色/大小写/段落/投影/描边/混合/基线/横缩放/竖缩放/角度/文本框宽、主体图 W/X/居中/翻转、眼睛隐藏、水平等距分布(3 选中)、文本层不透明度(1→0.85)。**审计抓出另一真缺口并修复**: 两个视频模板(VideoCover/VideoCoverPortrait)的标题内层是显式字段清单,`letterSpacing/textTransform/textAlign` 从未消费(字距/大小写/段落对齐设了不生效)——已补接线(其余四模板走 `...style` spread 全通)。
- 验证: 140 用例+37 基线+三件构建+check:tintin+staging 新鲜;探针:对齐后 X/Y 同帧更新(左对齐 56→0、底对齐 Y→688),审计 19/20 通过(余 1=默认项目无主体图,img 不存在系夹具限制;模板侧 `imgDropShadow` 接线已核对)。

### 6.5¹⁰ 内联编辑 1:1 原字体 + Ctrl 缩放 + 活动画布取层(2026-11-11 续批 R18,用户三条裁决)

用户:「整个字体的编辑有问题,没有在原来的字体上编辑,要 1:1 还原 PhotoCraft」「按住 Ctrl 时要像 PhotoCraft 变换框一样扩大缩小」「对齐只对齐了横屏——有两个画布」。

1. **内联编辑=原字体原样式原位**: 旧覆盖层自带深色底/边框/居中/`fontFamily:inherit`/硬编码行高与字号,所见非所得。重写=进入编辑时现场测量画布文字节点的 computed style(fontFamily/fontSize/fontWeight/fontStyle/lineHeight/letterSpacing/color/textAlign/textTransform)注入 textarea,透明背景/零内边距/零边框,盒子取文字节点屏幕盒。**坐标系坑(实测 dy 147px)**: 编辑器元素渲染在 content 层而盒坐标取了 playerWrap 相对——改 contentRef 相对(同 R12 选择框双重计入同类病)。
2. **Ctrl+拖动=等比缩放**(PhotoCraft `edit.freeTransform` 语义,Ctrl+滚轮仍是画布缩放): 拖动中以 CSS `scale` 独立属性预览(与模板 transform 相乘,中心锚),松手提交——文字=gscale(0.3..3,几何缩放不改字号)、自由图片=width/height(围中心扩缩并补偿 x/y)、主体槽位=sx/sy(模板中心锚);带百分比读数;Ctrl 悬停图层=缩放光标。选择框/手柄维持 R13 裁决不回归。
3. **活动画布取层**: 全部取层查询收敛到 `data-tintin-cover-canvas` 标记根内(`layerEl`),页面里出现第二棵画布树(旧模板残留/双挂载)时不再命中错误的画布——修「对齐只对齐了横屏」类问题(实测:文档序在前注入伪 title 节点,对齐仍命中活动画布真节点,伪节点不动)。
- 验证: 140 用例+37 基线+两构建+check:tintin+staging 新鲜;无头探针:内联 fontFamily/fontSize/weight/color 与画布节点逐项 same、背景透明、位置偏移 0/0、输入即时回写画布;Ctrl+拖动 transform 1→3 提交;伪画布场景对齐命中真节点。

### 6.5¹¹ 文字层宽高链接(分辨率绑定)恢复(2026-11-11 续批 R19,用户截图指认)

用户:「你的文字图层下面的分辨率绑定怎么没有了」——图1 PhotoCraft 变换段 W/H 之间有链接钮(默认链接,`layer_props_ui.rs:209 unwrap_or(true)`;链接时改 W 按 bh/bw 比例改 H,`:16-38 transform_params`)。我们的文字面板曾把链接渲染成灰色禁用图标(理由:文字层 H 随内容)。

1. **链接钮实装**: 20px 宽按钮(PhotoCraft LINK_W)、默认链接;链接态=field 底 + accent 图标,解除态=透明 + link-2-off 图标(layer-icons 补 Lucide 路径)。
2. **链接语义(文字层)**: 链接态改宽/改高=整体等比缩放(styles.gscale 0.3..3,几何缩放不改字号——与 Ctrl+拖动/旧角柄同一语义);解除链接后改宽=换行约束(styles.width),高保持随内容自动;高字段由只读改为可编辑(链接态等比缩放文本)。
3. **顺手修真 bug**: NumField 缺 `box-sizing:border-box`,`width:100%` + 右内边距 24px 溢出 32px,正好盖住右侧链接钮——Playwright 命中=输入框,真机点击同样落空(content-box 缺省坑)。
- 验证: 140 用例+37 基线+两构建+门禁;探针:链接态改宽 242→121(高 62→31,字号 96 不变,transform scale 0.5)、解除后改宽 121→36(高随内容 62→127)、链接钮命中=自身、零 pageerror。

### 6.5¹² Ctrl+拖动等比缩放扩到全部图片层(2026-11-11 续批 R20,用户裁决)

用户:「Ctrl+拖动=等比缩放,这个功能在图片也需要有」。原有分支已覆盖自由图片/主体槽位,本轮补齐并修真问题:

1. **环境底图也进图片缩放**: 环境层=背景也是图层(PhotoCraft 语义)——Cover/CoverPortrait 的 bgImage 节点补 `data-cover-layer="environment"` 标记(此前无标记=画布点不到、Ctrl 缩放无从命中);`backdropStyle` 消费 `styles.environment.sx/sy`(等比缩放)与 `dx/dy`(拖动取景);装饰性环境层(Video/Product 族的渐变)无底图时 Ctrl 分支直接放过。
2. **Ctrl 命中穿透装饰覆盖层**: Cover 模板的网格/AbsoluteFill 未带图层标记会挡住底图命中——Ctrl+拖动改为 elementsFromPoint 全栈取第一个带标记图层(普通点击不启用,空白点选取消语义不变)。
3. **修真 bug(调试页图片必崩)**: `vite.config.ts` 从未 alias `remotion` → dist/editor 调试页跑真 remotion,`Img` 在无 Composition 上下文抛「No video config found」,任何图片层都把整块画布打成错误态(夹具实证;应用内 client.js 有 esbuild alias 不受影响)。补 alias 与 client.js 同口径=调试页与应用一致。
- 验证: 140 用例+37 基线+三构建+check:tintin+staging 新鲜;夹具端到端(真 PNG):视频模板主体图 276→2760、自由图片 129→847、cover 模板环境底图 552×311→5520×3105(提交 transform scale(10,10)),预览期 `style.scale` 生效,零页面错误。

### 6.5¹³ @ 菜单素材组只列当前项目素材(2026-11-11 续批 R21,用户截图指认)

用户:「这个在引用的素材,为什么这么多,不是应该只有本项目的素材吗」——@ 菜单「素材」组混入了插件 `public/` 自带的演示素材(a.png/b.png/drag-photo.png/lib-m1-*.png 等 76B 占位图),因为 `/acp/files` 路由=项目目录 + public/ 回退,而编辑器素材面板有 `!path.startsWith('public/')` 过滤、chat 桥的 `projectFiles` 没有。

1. **修法**: `chat-shell/cover-chat-bridge.ts` 的 `projectFiles` 加同口径过滤(剔除 `public/` 前缀),@ 菜单=只列当前项目 cover 目录素材。
2. 路由层不动:agent/工具面仍可见 public/(模板素材词汇在 SKILL 里有约定),仅 @ 菜单收口。
- 验证: 真路由+新 chat 构建夹具(项目目录 2 图 + 插件 public/):`projectFiles()` total=2、hasPublic=false;@ 菜单打开后素材组恰为 2 个项目文件、无 a.png 族,零 pageerror;check:tintin+staging 新鲜全绿。

### 6.5¹⁴ 面板四裁决(不透明度标签/图片卡去块/删除接续/标题单行)(2026-11-11 续批 R22,用户截图四条)

1. **头行「不透明度：」标签**: 值字段前补标签(占前面下拉框的伸缩位,值字段 80px 宽度不变)。
2. **图片卡去块**: 编辑卡内 混合模式/不透明度滑条/锁定位置/投影 整块删除——混合+不透明度在图层面板头行、锁定位置在图层右键菜单,重复摆放=多此一举(投影随裁决一并移除;ImageLayerProps 只留 变换/对齐/翻转/旋转 + 从素材替换/抠图去背景)。
3. **删除后选中接续**: 删掉的层若为选中层,自动改选面板(上→下)里它下面一行;删到底部时选剩下的最后一行;批量删=删块下方一行;顺带清多选残影。node 侧固化 4 条 store 回归用例(中删/底删/批量/未选中层删除保持选择)。
4. **卡片标题单行省略**: `headStyle` 加 nowrap+ellipsis(长文件名不再换行),悬停 title 显示全名。
- 验证: 144 用例(新增 4)+37 基线+两构建+check:tintin+staging 新鲜;探针:头行标签在且值宽 80、图片卡无 混合/不透明度/锁定/投影 而 变换/对齐/翻转在、长名单行高 15px(nowrap/ellipsis)、GUI 删中间层选中自动落到下一行(素材B→素材A),零 pageerror。

### 6.5¹⁵ 文字编辑=图层自身排版内编辑(2026-11-11 续批 R23/R24,用户两次裁决)

用户截图:进入编辑后画布出现**两层字**(模板原字 + 覆盖层字)。第一次修法(R23)=覆盖层 textarea 透明化 + 编辑期间隐藏原图层;用户随后明确裁决:**照 PhotoCraft 在图层自身的排版里编辑(无独立覆盖层)**。R24 按此重做:

1. **contenteditable 落在模板文字图层自身**(`type_tool/editing.rs` 的 React 等价):双击文字层 → 该图层元素 `contenteditable="true"`、浏览器原生光标在真字形之间移动——字距/斜切/行高/末行跳色全部是模板真样式,物理上不存在第二层字,也没有覆盖框。非文字子节点(装饰条)编辑期间临时隐藏。
2. **输入期间不写 props**(避免 React 重渲打断光标);**失焦=提交**(数组层按 innerText 分块分行、trimStart+丢空行;单行层整体提交,Enter 直接提交);**Esc=还原进编辑前的 DOM**(innerHTML 快照)。
3. 编辑期间原生事件 stopPropagation 阻断画布宿主(否则 pointerdown 触发选择/拖动、dblclick 二次进入);光标落末尾(不整段选中)。
4. R23 的覆盖层实现与其隐藏样式表随之整体退役(CoverInlineEditor.tsx 删除),避免两套机制并存。
- 验证: 144 用例+37 基线+两构建+check:tintin+staging 新鲜;探针:双击后图层 contenteditable=true 且聚焦、覆盖 textarea=0、输入后 DOM 文本原位变化、点空白失焦提交(contenteditable 移除且新文本保留)、Esc 还原本次输入;编辑态截图=真字形(第一行白/末行青,模板原样式),零 pageerror。

### 6.5¹⁶ 标题黄条拆层 + 参考线可删(2026-11-11 续批 R25,用户两项裁决)

1. **标题黄条=独立装饰图层 `titleRule`**: 视频缩略图横/竖两模板把标题块内写死的黄色装饰条(`#facc15→#f97316`,300×14,rotate -2deg)拆为顶层独立图层,进 layerDefs(`标题装饰条(装饰)`),图层面板可开关、默认保留,走 layerOrder z 序。默认纵位=原块内流式排版换算(标题块 top+前各行行盒+末行缩小行盒+原 marginTop),`styles.title.scale` 覆盖字号时同步跟随;旧项目快照不含该 id=按 effectiveOrder 兜底置顶渲染,不改存档。
2. **参考线可删四通道**(兑现标尺「拖回标尺/画布外删除」工具提示): 线由 1px `pointer-events:none` 纯视觉条改 7px 透明命中带——①拖回标尺/拖出画布=删除;②双击=删除;③原位松手=点选(选中线加粗 2px),Delete/Backspace 删线;④标尺拖出建线不变。移线实现改「抓线=直写 DOM 隐藏真实线 → 落位 moveUserGuide 单条撤销」,原「抓起即删旧+落位加新」双撤销消除;moveUserGuide 增原位守卫(不产生空撤销)与同位合并(对照 PS),removeUserGuide 同步清选中态;pointercancel=还原被抓线(props 零写入)。
- 验证: 145 用例+typecheck(仅既有 test 漂移红,本批文件零红)+editor/engine/bundle 三构建+stage+check:tintin(140 锚/行数基线/载荷逐字节新鲜)全绿。

### 6.5¹⁷ 默认竖屏 + 横竖切换比例迁移(2026-11-12 用户两项裁决:方案1 比例映射 + 方案B 初始/新建都竖屏)

切换前审计(不适配面):`setOrientation` 只保留内容——customLayers x/y/width、styles dx/dy/sx/sy、用户参考线/选中参考线全按旧画布 px 原样带过去(横屏右下角图层落到竖屏中上);新建项目无模板记录=继承上一个项目的模板。

1. **默认竖屏(方案B)**:编辑器初始模板=video-portrait(store 初始值);新建封面项目由 `/projects/create` 落初始 props 记录(engine 新导出 `defaultCoverPropsRecord`:video-portrait+固定层全隐藏,与「空白项目画布什么也没有」裁决同观感),不再继承上一个项目的模板;记录写失败不阻断建项目(编辑器按空白项目兜底)。
2. **切换=比例迁移(方案1)**:`setOrientation` 对一切位置类状态按「自己的轴」映射——x/dx/width/sx 按 wr(新宽/旧宽),y/dy/height/sy 按 hr;参考线按轴映射+越界夹取+撞线(<0.5)合并;选中参考线随映射。一次 set=单条撤销。**中途修正**:最初宽高用 `min(wr,hr)` 等比因子想保「不变形」,新增回归矩阵抓出往返不互逆(宽 360→304→152)→改各轴自洽映射,往返精确互逆(漂移≤1px 取整界)。
3. **文档域语义**:`setTemplate`(换模板/项目)=换文档,参考线/选中参考线/多选作废(参考线是画布脚手架,随文档);`setOrientation`(同文档)参考线保留(迁移)。
- 保证机制(两模式效果一样的机制面):①一切几何消费方只认 `tpl.width/height` 唯一来源(拖动/吸附/对齐/标尺/缩放/建线已如此,新操作禁止硬编码模板尺寸);②本迁移函数是位置类状态跨模式的唯一入口,新增位置类状态必须挂进来;③双模式回归矩阵固化(`test/orientation-parity.test.ts`:默认竖屏/迁移落位/往返漂移≤2px/撞线合并/夹取兜底/文档域/建线夹取两模板一致)。
- 验证: 153 用例(新增 8)+typecheck(仅既有 lib js 漂移红)+三构建+stage+check:tintin 全绿。

### 6.6 剩余方向(待裁决排期)

- 标尺参考线持久化(现会话内存;进 cover.props.json 需契约扩展)。
- 成组持久化(显式 Group 数据模型)——需组语义裁决(嵌套?跨类型?)。
- layerNames 进 cover.props.json 的 agent 侧词汇(智能体按显示名指层,现仅编辑器消费)。
- 多选撤销粒度(整体移当前逐层入栈,一次拖动=多条撤销记录)。
- 选择系统重设计(待裁决): 属性面板数字通道已全覆盖(W/H/X/Y/角度/缩放);画布框选/手柄如需回归,先做独立测量基准的整套验证方案再动工。

## 七、封面参考与素材创作链路优化(2026-11-12 批,用户裁决「按推荐做优化,缩略图做」;对标 claude-code-main 参考实现)

背景:双面盘点(我方封面插件现状 vs Claude Code 参考源码机制)后用户裁定按推荐序执行——长任务两步化、图片压缩阶梯、聊天图片链路三修、错误面、画布多文件、@ 菜单近期+缩略图、删素材清三写位。分节记执行批。

### 7.1 仿封面两步拆分(方案 1b;长任务黑箱根修)

`imitate_cover` 原单次同步调用最长 420s 零进度零取消、超时即丢任务(错误文案自认「可能在服务端继续执行」无附身通道)。按裁决拆提交与等待:

- **`imitate_cover`=提交步**(cover-tools-mcp.js):参考图上传→`/generate/cover` 接单→**立即返回 `taskId`(phase=submitted)**,不轮询不下载;
- **`imitate_cover_wait`=等待/落盘步**:`task_id` →统一任务轮询(3s 间隔,单次默认 420s/上限 540s<dsh-mcp-client 600s 超时)→completed 即下载产物双写(素材三写位+项目目录)并回显 face_similarity 全套字段;**未到终态返回 `settled:false`(可重复调用续等=重附身,任务不丢失)**;failed/cancelled 错误原文上返;`cancel:true` 走 `POST /tasks/batch_cancel {task_ids}` 显式取消(creation 域同款契约)。轮询间隔经 deps 注入(测试 5ms/生产 3s)。
- **护栏接线**(cover-acp-bridge.js):`imitate_cover` 进异步任务看门狗登记表(30 分钟预算);`imitate_cover_wait` 列为轮询类不占回合护栏计数(与 task_status_unified 同款);`extractAsyncTaskIds` 兼容 camelCase `taskId`(本地工具回显键形)。
- **取消贯通**:聊天停止键(cancel 路由)→`bridge.cancel({cancelTasks:true})`→对本会话登记的未结算任务发 batch_cancel 并标记结算;**护栏自动中止(bumpGuard)不杀任务**(可能已付费在跑),只停回合。
- SKILL.md 同批:能力通道表与仿封面节改两步口径(提交→立即 wait;settled:false 续等;cancel 语义)。
- 测试:tintin-cover-tools-mcp.test.ts 重写为两步契约(提交不打轮询/settled:false 续等/completed 双写回显/failed 原文/cancel 走 batch_cancel/非法 task_id 拒绝),11 用例全绿。

### 7.2 read_image 进模型前压缩阶梯(方案 3;对标 claude-code imageResizer)

原 `read_image` 8MB 全量 base64 直进模型(大参考图=上下文爆炸+慢)。新增 `lib/cover-image-resize.js`:

- 常量口径照搬参考实现:原图 ≤3.75MB(=base64 5MB API 上限×3/4)且长边 ≤2000px 直通;超限等比缩到长边 2000,JPEG 走质量阶梯 80→60→40→20,PNG 保格式降采样 1500→1200(nativeImage 无调色板 PNG、透明转 JPEG 会黑底,不冒进);终产仍超 8MB 抛人话错误。
- 解码器=Electron `nativeImage` 惰性接入(宿主插件跑在桌面主进程);拿不到(单测 node/异常宿主)一律 **fail-open 返回 null=原字节直通**,零新依赖零回归;WebP 不支持解码→直通。
- 缩放发生时文本块附坐标换算元信息(`[Image: 原始 WxH, 已缩放至 wxh, 像素坐标 ×f 换算]`,claude-code createImageMetadataText 同思路)——仿封面 OCR 拆版式按所见图报 box 不失真。
- 聊天侧(用户拖入/粘贴图)经查**上游 shell 已自带**同款阶梯(ref-pictures.ts `attachedPicture`:2000px/4MB JPEG q0.85),无需另做。
- 测试:cover-image-resize.test.ts 7 用例(fail-open/直通/超分缩放/质量阶梯/硬上限/空图/元信息),全绿。

### 7.3 聊天图片链路三修 + 错误面(方案 2/4;素材创作批)

- **附件名放宽对齐 ASSET_NAME_RE**(cover-acp-routes.js chat-attachment):旧英数正则拒中文附件名——只拒穿越/Windows 非法字符/控制符,中文/空格/emoji 收下;
- **大小上限补齐**:chat-attachment 15MB、chat-ref-image 8MB,超限回 **413 人话**(旧:attachment 无上限,upload-image 超限静默 `req.destroy()`=客户端只见裸网络错误);readBodyBytes 超限排空(硬顶 64MB)保证 fetch 能读到响应;素材条 importFiles 增客户端预检(超限不上传);
- **chat-ref-image 扩展名跟真实格式**(魔数判 png/webp/jpg),不再恒写 `.jpg`;
- **拖入文件真实路径**(chat-shell cover-chat-bridge.ts `pathForFile`):原恒空串=全部走字节通道;现逐层走链(本窗→父窗→祖父窗)找 `__DSH_HOST_PATHS__.pathFor`/`dshDesktopFilePath.forFile`(影片侧 client-ui 同契约),任何异常回空串=回退字节通道零回归;
- **URL 导入项目落盘失败不再静默**:upload-url 回 `warning` 字段,素材条 flashNotice 如实呈现「已导入 x——项目目录落盘失败(素材位已有):原因」;
- **画布多文件拖入**(edit-canvas.tsx,方案 5):原只收第一张——现逐张上传建层(第 2+ 张 +24px/张 错位堆放防叠死,上限 12 张);
- 测试:tintin-cover-acp.test.ts 增 3 用例(中文名收下+413+穿越拒;引用图魔数扩展名+413),18 用例全绿;chat-shell vite 构建通过。

### 7.4 @ 菜单近期置顶+缩略图(方案 6;用户裁决「缩略图做」)

- **近期置顶**:files 路由每个条目附 `mtime`,图片组内按 mtime 新→旧排(空查询时 @ 菜单同分保持提供方顺序→近期素材自然置顶;素材条同源受益);非图片组维持路径序。
- **缩略图**(vendor 三文件,锚点登记 143):`mention-menu.ts` MentionItem 增可选 `thumbUrl`;`MentionMenuPlugin.tsx` 行首有缩略图时 `<img object-cover>` 盖在图标上,加载失败 `onError` 移除=图标回退,死链零视觉回归;`App.tsx` asset provider 透传 host 给的 `thumbUrl`(提供方中性——影片侧不传即无感)。封面桥 projectFiles 对图片条目拼同源 `/tintin/cover/api/acp/asset?name=...` 缩略地址。
- **删素材清三写位**(方案 7,cover-plugin-route.js delete-asset):原只删项目目录副本;现扫其余项目 cover.props.json(引用面=ensureCoverAssets 同语义 image/bgImage/customLayers[].image),**无他项目引用才清三写位**,有引用保留并回 `keptInAssets+referencedBy`(public/ 跨项目共享口径,原注释约束保留),素材条删除菜单如实提示;当前项目自身引用不拦(用户明确删,渲染如实报缺)。
- 测试:tintin-cover-acp.test.ts 增删素材两用例(无引用=三写位同清/他项目引用=保留+回执),20 用例全绿;check:tintin 143 锚点/86 文档全绿+载荷新鲜。

### 7.5 任务僵死双通道止损(2026-11-12 晚批;1112 当天实机复测事故;深夜任务史勘误后定稿)

同日实机复测(14:46-15:11 人物档仿封面轮)暴露的残余缺口。**深夜服务端 `/tasks` 全史勘误定案**:下午实际提交**三次**(14:47:11/14:50:40/14:54:36,单任务分钟级即 failed `partial_failed failed_shots=['cover']`),`imitate_cover_wait` 每轮都在失败后几十秒内抛错(重提时刻与失败时刻精确咬合),模型按「最多重试 2 次」预算停手转做背景+抠像(均成功)——**终态识别无罪,initial「服务端 30+ 分钟不落终态」叙述有误(看门狗是纯计时器,不观测服务端)**。真残余=①模型三次失败后**全程零文字转述**(14:46 首句后 25 分钟无一字,违反 SKILL 反循环守规,模型行为)②15:02-15:11 高频空转无产物。当晚客户端仍落双通道止损(对真僵死与模型失语兜底):

- **智能体通道**(cover-tools-mcp.js):`imitate_cover_wait` 加跨续等累计记账(`waitClock`,单次 timeoutS 全额计入);**累计 ≥30 分钟**(与桥侧看门狗 ASYNC_TASK_BUDGET_MINUTES 同预算)后 `settled:false` 升级为 **`stale:true`+停手指令**(如实转述/不再续等/可 cancel:true)——notice 只到用户聊天面,这是智能体唯一可见的止损信号。终态(completed/failed/cancelled/cancel)清账。
- **用户通道**(共享 shell):桥侧看门狗本就 emit `{kind:'task-stale',taskId,tool,ageMinutes}`(11-02 起),但渲染端无人消费。`openfilm-shell-src/chat`:`LocalAgentEvent` 联合类型加变体(desktop-bridge.ts);`listen()` 接住→`turn.notice('agent.taskStale', 动态文案)`(local-agent-run.ts;notice() 签名扩展可选 text,复用 notice-with-text 现成渲染分支);五语言 locale 增 `agent.taskStale`(zh/en/ja/ko/es,{tool}/{taskId}/{minutes} 插值,沿用 modelGone 的 `.replace` 函数惯用法)。
- 当日事实勘误:failed/cancelled 终态分支与 error 原文回显 7.1 已实现且 13:11 已同步 win-unpacked(14:44 重启后生效),本次循环非终态处理缺失。另:上午 product 档两败(11:24/11:26)=服务端「LLM 输出含非 ASCII(全英文铁律)」误伤中文标题,服务端侧;person 档 `partial_failed` worker 内层根因仍待服务端日志。
- 验证:package:dir 全编译链绿(stage.mjs+verify-cover-payload+tsc+vite+win-unpacked 重建);win-unpacked 载荷核验(tools 含 IMITATE_WAIT_STALE_TOTAL_MS/新 bundle DjVumVFK 含 taskStale/bridge 3 处 emit);修复期间 verify-hot-fresh 正确拦截「源码比产物新」(es.ts+并行会话 main-hook.ts),按指引改走全编译链。

### 7.6 在线素材抽屉只留滚动加载(2026-11-12 晚;用户指图裁决「加载更多和关闭也删除,向下滚动就是加载更多」)

- 底部「加载更多」「关闭」两按钮删除(cover-chat-bridge.ts):加载通道只留 7.1 已有的 scroll 近底触发(距底 60px,loading/done 双闸);关闭只留头部 ✕(close2 是它的第二份监听,一并拆);头部状态文案改「滚动加载更多」。载荷核验:新 bundle CKL9fLjv 无 tintin-lib-more/close2/按钮文本,门禁 verify-hot-fresh+verify-cover-payload 绿。

### 7.7 横竖切换图片层变形根修:迁移语义按图层种类分派(2026-11-12 晚;用户指截图问「横屏为什么变形/两套设计对不对」)

- **根因(用户项目 props 实证)**:bg-glasses.png 竖版图(素材缩略图可证)在画布上的盒子=1268×949 且**带显式 height**;`setOrientation` 把 width×wr、height×hr **各自独立映射**,横↔竖互换 wr≈0.56/hr≈1.78,盒子长宽比被翻转≈3 倍——带显式 height 的自定义层(1111 宽高解链写入)渲染按盒子强制拉伸=变形。环境槽位底图是 `objectFit:'cover'`(裁切不变形)不受影响。
- **架构裁决(答复「两套设计对不对」)**:双模板本身正确——装饰渐变/文字版式/字号两画幅本应不同,几何迁移(x/y/参考线/dx/dy/sx/sy)已有 8 用例往返校验;错在迁移把图片层当纯几何,无视图片自然纵横比与「铺满画布」意图——这才是「所有操作只支持一种画幅」的来源。
- **修=setOrientation 按图层种类分派语义**(store.ts):①`group:'environment'` 层=背景意图,统一比例 `s=max(wr,hr)` 迁移(盒子纵横比不变=永不变形)+显式高随 s+画布居中(cover 语义);②其余自定义图片层:宽按 wr,**显式 height 丢弃重新链接纵横比**(height 渲染随图片自然比例,1111 解链比例在切换时让位于不变形);文字/参考线/sx/sy 轴映射维持原样。
- 测试:orientation-parity.test.ts 随新语义更新(普通层 height 往返不再保持=断言 undefined;新增背景组统一比例+居中+纵横比不变断言),8 用例绿;插件全量 177 用例绿。

### 7.10 层序换位的存量项目迁移(2026-11-13;用户持旧序截图问「不是让你改了吗」)

acedd29fb4 的五族模板换位只对**新建**项目生效——既有项目存档里的显式 `layerOrder`(面板拖拽/智能体重写都会写入)仍持久保持旧相对序,设计上不自动迁移(避免覆盖用户手动 z 序)。1112-110521 项目实拍:`[environment, product, titleRule, title, subtitle, subTag, brand]`=副标题压在主标题上。裁决普适化:

- **语义迁移**(registry.ts `normalizeTitleOrder`):凡存档层序里 `title` 排在 `subtitle` 之前,消费时统一交换(两图层互不重叠=acedd29fb4 裁决,z 翻转零视觉风险;自定义图层 id 夹中间不影响)。**两个消费口同口径**:编辑器 `effectiveOrder`(面板/画布/拖拽基准)与引擎 `renderCover`(导出/回看渲染)——编辑器侧不改盘上数据但行为即正,首次图层操作写回时落盘自愈。
- 测试:layer-order-migration.test.ts 5 用例(旧序交换/已正序不动/缺 id 透传/自定义 id 夹中间/装载集成),插件全量 182 用例绿。
- 当日数据与载荷处置:110521 项目 props 已换序落盘(编辑器 2s 轮询即翻转);**安装版(AppData/Local/Programs/TinTin)同步两处**=dist 整目录换新(引擎渲染归一+面板 z)+`.remotion` 浏览器缓存补拷(7.9 同款缺口——热同步只拷代码不拷缓存,装版渲染不重启即恢复:子进程每次 spawn 现读缓存);win-unpacked 重打含两修复。
- 教训:面板层序这类「换默认值」的改动,存档里写过显式值的存量项目永远看不到——改默认必须配「消费口归一」或明确声明不迁移的补偿操作(拖一次)。

### 7.11 完成性门禁上移到 afterPack:安装包产物同保证(2026-11-13;用户裁决「打包应含全部功能并正确装到不同设备/为什么安装包会丢失修改」)

7.9 的修复只补了 `--dir` 一条产链——**NSIS 安装包(package-nsis-local.mjs)是独立打包流**(自己直接跑 electron-builder `--win nsis`,只复用了版本戳),补拷步不在其中;已发布的 Setup 装到任何机器都缺渲染浏览器。且热同步只拷代码不拷数据资产,每次升级覆盖已装实例——「丢失修改」是结构性的:三个载荷产出方只有一处有门禁。

- **修=完成性门禁上移到 electron-builder afterPack 钩子**(NSIS 压缩前、目录装配后,`--dir`/`--win nsis` 两流共用):新 `scripts/payload-complete.cjs`(补拷 staging 生产 node_modules 整树+双校验 exe/renderer,缺=抛错打包失败;stagingPlugins/distPlugins 可注入供测试)+`scripts/after-pack.cjs` 钩子壳;package-dir.mjs 与 package-nsis-local.mjs 都下发 `--config.afterPack`。原 package-dir.mjs 内联补拷块删除(避免双实现漂移)。
- 门禁测试:package-dir.spec.ts 增 4 用例(缺缓存拒/缺 renderer 拒/整树拷贝双验/已完整跳拷),argv 断言随 afterPack 参数更新;4 门禁用例全绿(套内 2 红=10-21 起 `ELECTRON_BUILDER_COMPRESSION_LEVEL` 环境键的既有漂移,非本批引入)。
- **重构事故清偿**:CJS 重构时拷贝/校验基准丢了 `node_modules` 段(拷到插件目录而非嵌套树)——新门禁单测第一次运行即拦下,修后绿。
- **发布侧欠账**:已发布 release(1112-22:17)先于全部修复,装到新机器渲染必挂——需要用带钩子的 NSIS 流重打并重新发布(发布是外向动作,等用户裁决)。
- 教训:完整性保证必须挂在「所有产链共用的那一环」(afterPack 是 electron-builder 的公共装配点),补在单条产链=对其它产链的静默豁免;排查深度敏感的工具(maxdepth)与「门禁跳过清单」是缺口高发区。

### 7.12 选择产品面板滚动翻页(2026-11-13;用户指截图「只有一页,滚动不翻页」)

- 根因:选择产品面板(cover-chat-products.ts)单次 `GET /acp/products?limit=50` 后无任何翻页通道——`load()` 全量 replaceChildren,滚动无监听。服务端 `/api/product-library/search` 契约只有 `q`+`limit`(openapi 实证,`offset` 参数不存在且被忽略——两组实测同头)。
- 修=**累计 limit 增量拉取**(不改服务端契约):每次请求 `limit=已载数+50`,只追加尾部新条目(`slice(loadedCount)`);返回数 < 请求数=到底(`exhausted`);loading/exhausted 双闸防重入;头部状态=「N 条 · 滚动加载更多」/到底即「N 条 · 已到底」;搜索输入重置计数与列表。与 7.6 在线素材抽屉的滚动口径一致(距底 60px)。
- 载荷:chat-shell 新 bundle(双载荷 win-unpacked+安装版已同步,状态词 grep 双 2 命中)。重启/刷新会话页生效。

### 7.13 横竖切换按钮换位(2026-11-13;用户指截图「竖屏在左,横屏在右」)

- 预览区顶条的 OrientationToggle(App.tsx)顺序改为 竖屏→横屏(默认激活项置左);双载荷已重打(win-unpacked+安装版 dist/editor 同步),bundle 内顺序串 grep 双确认。

### 7.14 集成 PhotoCraft 升级 0.16.0→0.22.0(2026-11-13;用户报「打开 PhotoCraft 提示版本低」)

- 定位:提示来自 PhotoCraft 应用自身的更新检查(集成代码无版本检查);vendored(通道包 tintin-resources/photocraft)与用户便携版(D:\localprogram)同为 **0.16.0(b1794c6e0, 2026-10-25)**,上游 storytold/photocraft 最新 **v0.22.0(5000240c6, 2026-11-09)**。
- 升级路径:官方 release 资产 `photocraft-0.22.0-windows-x64-portable.zip`(135MB)。直连 github.com 下载被限(56 重置/KB 级龟速),改走 gh-proxy 镜像搬运字节,**sha256 钉死官方 digest**(d6e13cd7…,经 api.github.com release API 的资产 digest 字段直连获取——镜像只当运输,哈希可信)。
- 三处落位:①vendored(tintin-resources/photocraft,git-ignore 的本地数据)整目录替换 187MB→274MB(新增 LXGW/南奈木/Noto CJK 等字体);②安装版 `resources/photocraft/`(extraResources 根级)替换——替换前优雅 taskkill 运行中的 photocraft(pid 75880,刚开无工作);③win-unpacked 重打。
- lib/photocraft.js 同批(1113 晚用户裁决「photocraft 是集成到客户端的,与 localprogram 无关」——初版加的版本扫描回退一并废除):**定位链删除 D:\localprogram 便携版回退**(开发机残留,装到别的机器=死路径;且打包态旧链三条候选全落空,装版其实一直在侥幸命中 dev 机的便携版)。新定位链:①env `TINTIN_PHOTOCRAFT_DIR` ②env `TINTIN_RESOURCES_DIR`/photocraft ③**打包态集成位** `<安装>/resources/photocraft`(extraResources 落点,从插件包根上溯三级定位,cwd 无关——打包态模拟实测从裸 cwd 解析出集成副本) ④开发态 `<cwd>/dsh-plugin-desktop-tintin/tintin-resources/photocraft`。②修 `readFileSync` 未导入(connectControl 里 try/catch 吞 ReferenceError→控制通道恒报「令牌非法」的潜伏 bug);③删遗留字符串版 dirname 助手(与 node:path 导入撞名)。
- 解析链语义:env 覆盖 > 集成位(vendored 随包) > 开发态仓内 vendored;dev 解析=仓内 vendored,打包模拟=装版集成位,双态实测。重启封面编辑器/PhotoCraft 后生效。

### 7.8 保人方案三修:渲染子进程化 + 白盘形态自适应 + 环境图吃真图(2026-11-12 晚三;用户四问「选保人方案为什么卡死/白背景和人混在一起/生成图为什么在项目文件夹/人物为什么用 product」)

- **卡死根因(取证链)**:会话 zstd 解包还原保人 turn 全时间线——imitate_cover 人物档三连败(人脸相似度 0.482/0.389 低于 0.65 门)→模型转方案 B(复用旧抠图+旧背景写 props)→render_preview 三连挂:每次 ~304s 报 `Error: fetch failed`(undici 300s headers 超时形状)→模型无限重试=「仍在处理」卡死观感。深挖排除:同一 engine.mjs 裸 node 2.16s/裸 Electron 1.5s 渲完(排除引擎);运行包两份 engine 副本都带 90s 竞速超时;**挂起期间主进程事件循环存活**(initialize/tools/list 3-6ms 即答)且**无 chrome-headless-shell 进程**(排除 spawnSync 阻塞/渲染内部挂);外部复现 tools/call render_preview=304451ms HeadersTimeoutError。定案=**主进程内 `import('@remotion/renderer')`(引擎 90s 竞速 armed 之前的懒加载)在应用进程里永挂**,竞速从未 armed。修=**render_preview 改独立 node 子进程跑引擎既有 CLI**(dist/engine.mjs templateId @propsFile fileName 输出 JSON;ELECTRON_RUN_AS_NODE=1+process.execPath;异步 spawn 不阻塞循环;180s 超时 taskkill /T /F 杀树;@文件=纯 props 对象,wrapper 形态会报「hookLines 不能为空」实测)。取证教训:debug.log 的 puppeteer profile chromium 条目(photocraft spawnSync 所写)时间戳滞后,是红鲱鱼不可当时间线。
- **白卡根因+修**:抠图 PNG 本身干净(alpha 84.5% 透明)——白盘=video 族主体图(product)层自带**产品聚光装饰**(白辉光盘+径向渐隐遮罩+虚线圈+-8° 倾斜,只为不透明产品照设计)。修=新 templates/image-alpha.ts `useImageHasAlpha`(64px canvas 采样,透明像素>2%=抠图形态;按文件名缓存;Remotion 渲染中 delayRender 挂首帧至探针回值,编辑器画布普通异步态)——抠图免全装饰只留投影,产品照原样;editor 的 remotion shim(src/editor/remotion-shim.tsx)补 getRemotionEnvironment/delayRender/continueRender 三导出(编辑态空操作)。
- **环境图静默丢弃真 bug+修**:video 族 layerDefs 有环境图层(面板显示文件名=假象)但组件只画内置渐变,`props.environment` 从未被消费——生成的背景落盘后永远不上画。修=两模板 environment 分支:设了→CoverImg 渲染真图(objectFit cover);未设→保留内置渐变;defaultProps 补 `environment:''`。连带修 engine public 同步清单(wanted 只认 bgImage/image/customLayers,漏 environment→渲染 404 EncodingError;11-10 同类修第二例)。
- **「人物用 product」话术**:props 写法本身正确(7.4/11-11 裁决:产品图更名主体图,图层 id 保留 product);气点=模型对用户说内部 id。修=SKILL.md 图层组节加「对用户永远说主体图/环境图,严禁写内部 id product」+生成节加保人方案组装条(环境图=props.environment/主体图=props.image)。
- 验证:engine CLI @props 形态实测 ok;修复后同一项目渲染=白盘消失+生成背景成底层+人物干净(实拍);tsc 本批文件零错(39 条既有漂移不变);check:tintin 全绿(150 锚+载荷新鲜);载荷 7 处同步 1755 win-unpacked(mount lib/engine.mjs×2/resources dist×3+skills×2)重启生效。

### 7.9 渲染子进程仍超时的真根因:载荷丢浏览器缓存(2026-11-12 晚四;用户报「7.8 修完 render_preview 还是 180s 超时,三轮+一轮」)

7.8 的子进程化方向对但**载荷里没有它需要的东西**——实测证据链:staging(tintin-resources/cover-plugin)的 `node_modules/.remotion/chrome-headless-shell/win64/.../chrome-headless-shell.exe` 存在,win-unpacked 载荷**同路径缺失**(stage.mjs 保留缓存,但 electron-builder 收集 node_modules 时丢弃了插件嵌套 node_modules 里的 .remotion)。于是载荷内 `resolveBundledBrowser()` 返回 null → **静默回退 `ensureBrowser()` 联网下载 150MB** → 本机网络下挂起 → 180s 杀树,错误只说「可重试」零死因;agent 按 skill 反复重试=三轮+一轮全灭的完整闭环。dev 树裸 Electron 1.5s 能渲(缓存就在旁边)从外面看不出载荷缺货。

- **修 1(package-dir.mjs)**:electron-builder 成功后补拷 staging 的**生产 node_modules 整树**进载荷插件嵌套 node_modules(1112 初版只窄拷 `.remotion`,1113 用户裁决「node_modules 每次打包都要打进去」升级为整树),拷完双校验(exe+@remotion/renderer)——staging 缺缓存或缺渲染库**宁可打包失败**,不静默产出渲染必挂的包。整树依据:staging 生产档 324MB 里 .remotion 占 283MB,整树仅 +41MB;stage.mjs 的 npm install --omit=dev 生产树本就是为自包含载荷而建,electron-builder 的收集语义(每个包提升到 app 根级、留空壳嵌套 node_modules)让这一直断链——整树入载荷同时消灭「插件解析依赖 yarn 提升结果」的不确定性,未来任何非包数据(模型/缓存)自动随包。
- **修 2(cover-tools-mcp.js)**:渲染子进程 stderr 截尾(4KB)进超时/退出错误——死因全在 stderr,旧版故意丢弃导致挂 180s 只剩一句「可重试」。
- **修 3(engine.ts)**:缓存缺失回退 ensureBrowser 前向 stderr 告警一行(经修 2 直达超时错误,智能体可转述)。
- 教训:门禁 verify-cover-payload 第 31 行显式跳过 node_modules/.remotion(staging↔工作区比对口径,本身正确)→「载荷缺货」从未有任何人检查;find 排查深度(-maxdepth 4/5)会把 6-8 层深的 exe 误判为缺失,结论前必须用精确路径 `test -f` 复核(本批即被 maxdepth 假阴性骗过一次)。
- 验证:插件全量 177 用例绿;package:dir 全链重建(含补拷步)EXIT=0;载荷 exe 精确路径核验;doc 本节同批。
