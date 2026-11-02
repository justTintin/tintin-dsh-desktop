# 封面制作通道迁移：脱离自有 HTTP 面，对齐媒体包形态（方案 B）

状态：**实施中（2026-11-02 用户裁决「方案 B」；B1/B2 已实施并热同步，B3 待续）**。本文是迁移方案与分阶段验收，非已实现描述。
背景：封面编辑器自 10-28 立项起采用「插件自伺服页面 + 自有约 40 条 REST 路由」通道（0dd1bc8b3a，参照 OpenFilm iframe 先例），未遵守需求文档 §9.2 自己的约束「会话工具面经既有桥/内部工具机制暴露，不新增特权」。2026-11-02 用户裁决：对齐媒体包形态——编辑器成为挂进主窗口的页内模块，会话改为 client-ui 注入，逐步退出自有 HTTP 面。

---

## 一、目标形态（终态）

| 面 | 现状 | 终态 |
|---|---|---|
| 编辑器 UI | `/tintin/cover/editor` 伺服页，iframe 嵌入 | 页内模块：vite lib IIFE（React/Remotion 内联，同媒体包 Vue 内联先例），client 入口经 `__ModuleLoader__` 注册视图提供方，mount 挂 React root |
| 编辑器业务调用 | fetch `/tintin/cover/api/*`（约 20 处） | 通用桥频道 `/tintin/ipc/cover:<name>`（`window.tintin.cover.*`），与 `openfilm:*`/`server:*` 同模式 |
| 会话页 | `/tintin/cover/chat` iframe（chat-shell 构建，Lexical 官方聊天） | client-ui 注入（视频剪辑会话框模式），聊天壳页面与 `/acp/*` 页面路由退役 |
| 智能体（dsh 子进程） | fs 写 cover.props.json + 自有令牌的 HTTP | fs 协议不动；其用到的编辑器 API 路由保留（仅 agent 令牌可写） |
| 静态素材 | `/tintin/cover/editor|assets` 三写位伺服 | 保留 GET 静态伺服（画布图片/缩略图 URL 依赖） |
| 令牌门禁 | 全站读写都过门禁 | 收缩为：页面静态伺服 + agent 路由；编辑器业务写不再依赖 |

非目标：不动 Remotion 渲染引擎（renderStill/export 仍是 host 侧 bundle）；不动 ACP 桥的进程管理；不动项目制/素材目录布局。

## 二、分阶段实施

### B1 编辑器页内化（✅已实施 2026-11-02：构建=scripts/build-editor-bundle.mjs，esbuild CJS 外部化 react/react-dom + factory(require) 包装 → 包根 client.js 493KB；chrome 解除 iframe 特例；jsdom 装载冒烟 test/cover-editor-bundle.test.ts）
- 新构建：`dsh-tintin-cover-plugin` 增 editor bundle（vite lib IIFE，React/Remotion/zustand 全内联；媒体包 dist/client.js=2.3MB 先例，编辑器约 1.5MB）。
- client 入口改造：视图提供方 mount 改为挂 React root（KeepAlive=缓存已挂 DOM，切走 display:none，语义不变）；聊天 iframe 暂保留在挂载树内（B3 再迁）。
- 页面级适配：`window.parent` 引用改本 window（保存桥/桌面桥更简单）；100vh 假设改挂载容器高；画布窗口级快捷键确认不与宿主 UI 泄漏（现有 typing 守卫+blocked 回调保留）。
- 侧栏 chrome 解除 cover 的 iframe 特例（dsh-tintin-bundle/client.js:249 一带）。
- 验收：jsdom 装载冒烟（Loader 桩+模块注册+视图 mount）+ 真机：三栏/画布/素材/导出/会话 iframe 全功能；素材条 3 秒轮询与项目切换照旧。

### B2 传输换桥（✅已实施 2026-11-02：host=lib/cover-plugin-route.js 收集器+「/tintin/ipc/cover:」前缀路由（宿主最长前缀胜，重写 url 转发原处理器，门禁语义不变）；编辑器 39 个调用点换频道；HTTP 面收缩留待 B3 后清理）
- host：`/tintin/ipc/cover:<name>` 频道族注册（进程内直调现有 lib 处理函数，不经 HTTP）。
- 编辑器：传输包装 `coverApi(name, payload)`＝桥可用走桥、不可用回退 fetch（开发态 serve.mjs 兼容）；约 20 个调用点替换。
- HTTP 面收缩：编辑器业务路由退役；保留 GET 静态/缩略图 + agent 令牌路由。
- 验收：断网模拟（HTTP 关闭）下编辑器全功能；既有回归（素材导入 5 步、字体 5 步、画布容错）全绿。

### B3 会话 client-ui 注入（对齐视频剪辑会话框）
- 按 film 的 client-ui 注入模式移植封面会话：@图层引用（postMessage 上下文改注入参数）、隐藏技能组/时刻组、📦 选择产品、上下文推送。
- 退役：chat-shell 页面、`/acp/*` 页面路由族、会话 iframe。
- 验收：会话全链（INIT/prompt/@引用/产品注入/技能）与视频剪辑同规格 E2E。

## 三、不变量（每阶段门禁）

1. 编辑器功能零回退：画布拖动/手柄/快捷键、图层属性卡、素材导入与右键、导出（另存为桥）、字体全量、PhotoCraft 镜像、项目制。
2. 智能体链路不动：cover.props.json fs 协议、2 秒轮询回流、SKILL.md 词汇、/acp 会话进程管理。
3. 每阶段独立可发布：任一阶段落地后应用可日常使用，不存在半迁移不可用态（B1/B2 各自热同步即可验证）。
4. 静态门禁：check:tintin / verify-cover-payload / verify-layout 随构建形态同步更新。
5. 千行红线与解耦纪律照旧；新构建产物进 verify-cover-payload 新鲜度校验。

## 四、风险与既知坑

- **Loader 装载契约**：client 入口必须经 `__ModuleLoader__.load` 自注册，否则 web boot 失败 1 插件→恢复模式（2026-10-30 实机教训）；IIFE 不 auto-load css（媒体包同坑先例，样式内联或手动注入）。
- **localStorage 同源不变**：页内模块仍在 43120 源下，收藏/最近字体无需迁移。
- **快捷键与宿主共存**：画布窗口级键盘需在宿主聚焦宿主 UI 时让行（现有 typing 守卫+blocked 回调，真机回归覆盖）。
- **B3 体量另计**：film 会话注入本身是一次大移植，封面会话的定制（图层上下文/产品注入/技能隐藏）逐项对表。
- 回滚路径：B1/B2 均保留旧 iframe/HTTP 代码路径于 git 历史，出问题按阶段回退热同步。
