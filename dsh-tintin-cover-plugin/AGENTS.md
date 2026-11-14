# DSH TinTin Cover Plugin — 领域规则（AGENTS.md）

本文件是**封面制作域的开发侧契约**：任何编码智能体在本目录及其衍生载荷（staging、win-unpacked、安装版）内工作前必须先读。它不替代运行时指令面（见 §1），只回答「这套能力长什么样、接线在哪、改动的铁律是什么」。批次台账在 [docs/cover-editor-optimization.md](../docs/cover-editor-optimization.md)（§7 起），每批必追加。

## 1. 运行时指令面 vs 开发面（先分清，不要改错层）

| 面 | 文件 | 注入机制 | 读者 |
|---|---|---|---|
| **会话智能体契约** | `skills/cover/SKILL.md` | `lib/cover-acp-bridge.js` `ensureCoverSkill()` **每次会话启动**拷入 agent home 并拼动态附录（服务端地址/令牌/MCP 纪律/工作目录） | 封面会话里的智能体 |
| **MCP 工具挂载** | `lib/cover-tools-mcp.js`（本地工具端点）+ `writePatch`（dsh-mcp-client 补丁行挂载 + mcp-tintin-server） | ACP 会话创建时挂载 | 同上 |
| **开发契约（本文件）** | `AGENTS.md` | 编码智能体进入本目录时发现 | 改这个包的编码智能体 |

**改 SKILL.md = 改会话行为**（重启会话生效）；改本文件 = 改开发纪律（立即生效）。两者都不是 MCP/skill 的注册机制——注册在 bridge 与 tools-mcp 的代码里，本文件只如实记录其位置。

## 2. 能力面全景（三面一体，同引擎同数据）

| 面 | 入口 | 说明 |
|---|---|---|
| **编辑器**（web） | `dist/editor`（esbuild 预构建；源 `src/editor/`） | 自持画布（非 Remotion Player）+ 图层面板 + 属性卡 + 模板管理弹窗 |
| **会话智能体**（ACP） | `lib/cover-acp-bridge.js`（spawn dsh `--profile acp --patch`） | deepseek 角色；会话=项目 cwd；方案 3 池化（挂起不杀） |
| **本地 HTTP API** | `lib/cover-plugin-route.js`（主）+ `cover-acp-routes.js`（会话族）+ `cover-photocraft-routes.js`（PhotoCraft 族）+ `cover-tools-mcp.js`（MCP） | 全部经 `registeringWebServer` 注册，前缀 `/tintin/cover/api/`；编辑器另有 `/tintin/ipc/cover/` 长前缀别名（宿主最长前缀胜） |

### 路由族速查（真源=各 lib 文件，勿在本表复制细节）

- `/tintin/cover/api/acp/*`：会话生命周期（start/prompt/steer/cancel/running/ack）+ 事件流（events SSE）+ 聊天存取（chat-*）+ 技能（skills*）+ 素材/文件（files/asset*/library*/describe-paths）+ 产品（products*）+ **模板（templates）**
- `/tintin/cover/api/pc/*`（`cover-photocraft-routes.js`）：PhotoCraft 域——launch（未装返回结构化 notInstalled）/config+save-config（安装目录持久化 `<DSH_HOME>/tintin/config.json` `photocraft.dir`）/tpl-list、tpl-preview（**PNG 字节直出**）、tpl-delete/psd-import/inspect、screenshot、execute、export
- `/tintin/cover/api/*` 其余：项目（projects/delete-asset）、上传（upload/upload-image/chat-attachment/chat-ref-image）、生成（background/gen-product→服务端）、matting、server-config+MCP 发现、reveal、fonts、导出中心（export-dir/export-encode/export-write，2026-11-14：三格式编码+缓存落盘）
- `/tintin/cover/api/tools-mcp`：本地工具 MCP（streamable-http）

### 本地 MCP 工具（`mcp__cover-tools__*`，会话智能体唯一看图/落盘通道）

`read_image`（看图，压缩阶梯：长边≤2000、≤2.5MB，超限返回文字提示不附图）· `matting`（抠图，健康链 isnet-general-use→u2net→isnet-anime，产物=透明 PNG 落素材区）· `render_preview`（渲染回看=完成判据；自动清旧 `preview-*.png`）· `imitate_cover` + `imitate_cover_wait`（仿封面两步：提交立即返 task_id→轮询到终态落盘，settled:false 可续等，累计 30min→stale:true 停手指令）· `ocr_image`（拆提字）· `text_remove`（去字）

### 服务端依赖（真源=服务端 OpenAPI；盘点必含查询参数端点）

`/templates?type=cover` + POST/PUT/DELETE `/templates`（封面模板 CRUD，TemplateIn=JSON params 版式）· `/templates/preview`（**PNG 字节流**）· `/generate/cover` + `/tasks/unified/{id}` + `/tasks/batch_cancel`（仿封面编排）· `/api/storyboard/scripts/product-upload`（参考图/底图上传）· `/matting` · `/material/ocr` · `/image/text-remove` · `/v1/models`（标准模型唯一来源）

## 3. 数据与状态

- **`cover.props.json` 是唯一对流点**：编辑器 2s 轮询套用；智能体读写走它；`layerOrder`=全图层 z 序（底→顶）、`styles.<id>`=文字/槽位外观、`customLayers`=自由图片层、`hiddenLayers`/`layerNames` 保留勿删
- 项目目录=素材条数据源（`preview-*.png` 是回看瞬态，render_preview 自动清旧；导出成品是资产）
- 素材三写位：插件 `public/` + `dist/editor` + `dist/remotion-bundle/public`（写经 `cover-asset.js`）
- 横竖切换（`setOrientation`）迁移语义**按图层种类分派**——文字/装饰=轴映射；自定义图片层=宽迁移+丢显式 height 重链纵横比；环境组=统一缩放 s=max(wr,hr)+画布居中；槽位 sx/sy=统一缩放 u=√(sx·sy)。**新增图层种类必须先入此清单再写迁移**（parity 测试=`test/orientation-parity.test.ts`）

## 4. 打包与载荷（三产链一门禁）

- **产链**：`package:dir`（--dir 全编）与 `package-nsis-local.mjs`（--win nsis）**共用 afterPack 钩子**（`scripts/after-pack.cjs`→`payload-complete.cjs`：补拷 staging 生产 node_modules 整树进载荷插件嵌套 node_modules，双校验 chrome-headless-shell exe+`@remotion/renderer`，缺=**打包失败**）
- **staging**（`../dsh-plugin-desktop-tintin/tintin-resources/cover-plugin`）：stage.mjs 构建 dist 三件套+chat-shell+npm --omit=dev 生产树（保留 `.remotion` 缓存）；`verify-cover-payload` 门禁=staging↔工作区代码逐字节比对（**明确跳过 node_modules/.remotion——载荷完整性由 afterPack 守**）
- **热同步路径**（只拷代码不拷数据资产）：编辑器=`dist/editor`、会话页=`chat-shell/dist`、引擎=`dist/engine.mjs`、lib=`lib/`；**同步前先 `ls` 真身**（安装版真身=`AppData/Local/Programs/TinTin`，非 win-unpacked）
- **PhotoCraft 不随包集成**（1113 裁决，安装包体积）：使用时检测→未装引导（官网+Releases+目录配置）→`config.json photocraft.dir`；PSD 上传转换链=cli convert 优先→**内置纯 JS 兜底**（ag-psd 合成位图+`lib/psd-png.js`），零 PhotoCraft 硬依赖
- 依赖新增：进 staging 生产树才进包（yarn 加依赖后必跑 stage）

## 5. 门禁与测试

- 插件测试：`npx vitest run`（当前 183 用例；改契约必配套改测试）
- 行门禁：单文件 ≤1000 行——**超限按领域边界拆分，不加基线**（基线=永久行数债）
- 锚点门禁：`verify-tintin-gate`（150 锚/86 文档；改共享 shell 与 vendor 相关文件必跑 `check:tintin`）
- 全链验收：`package:dir` EXIT=0 + `verify-cover-payload` 绿 + 载荷核验（**精确路径 `test -f`，find maxdepth 会漏深层文件**）

## 6. 铁律清单（每条都有事故背书，台账见 optimization.md §7.x）

1. **props 键迁移必须 grep 旧键名清点全部消费方**（面板/引擎/路由三类都漏过：environment 键三连漏）
2. **几何/层序迁移按图层种类枚举全集**，不是哪类报修哪类（三类=三次返工的教训）
3. **改默认值对写过显式值的存量数据不可见**——要么消费口归一（normalizeTitleOrder 模式），要么明示补偿操作
4. **OpenAPI 能力盘点=路径名+查询参数两层**（`/templates?type=cover` 曾被路径扫描漏掉）
5. **外部工具依赖必须配纯内置兜底**（PSD 转换教训：可选依赖变硬依赖=功能对未装机用户死亡）
6. **并行会话同仓**：Edit 前重读文件；git 管道吃 exit code，命令内嵌 `EXIT=$?` 并读日志判真伪；esbuild 中文转义 \uXXXX，grep 中文用 ASCII 锚
7. **会话智能体纪律**（SKILL.md 同款）：失败/超限如实转述不静默重试；反循环（同工具同意图 3 次无进展=停手汇报）
8. **完成态提交**：每批=代码+测试+载荷重建+双载荷核验+doc 台账，五件齐才算完

## 7. 相关文件

- 会话智能体契约：[skills/cover/SKILL.md](skills/cover/SKILL.md)（会话行为真源）
- 批次台账：[docs/cover-editor-optimization.md](../docs/cover-editor-optimization.md)（§7 起逐批）
- 移植铁律：[docs/tintin-iron-rules.md](../docs/tintin-iron-rules.md)
- 宿主桥/会话：`lib/cover-acp-bridge.js`；引擎：`src/engine.ts`→`dist/engine.mjs`；模板：`templates/*.tsx`；注册表：`src/registry.ts`
