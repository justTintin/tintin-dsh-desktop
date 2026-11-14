# DSH TinTin Media Bundle（媒体工具）— 领域规则（AGENTS.md）

本文件是**媒体工具域的开发侧契约**。批次事实以代码与本目录测试为准；跨域规则见根 [AGENTS.md](../AGENTS.md) 与 [docs/tintin-iron-rules.md](../docs/tintin-iron-rules.md)。

## 1. 架构定位（先分清，防误改）

- **本包没有本地会话智能体**：TTS/语音克隆/素材检索/下载等全部**服务端 API 直连**——不要给本包加本地 ACP 智能体/skill 注入（与封面/影片的 spawn dsh 架构是两种形态）
- 形态=cordis 插件工具页：`index.js` 挂载 + `src/`（Vue 工具页：素材库/文案混剪/数字人/LiveClip 等）→ `dist/client.js` **单文件产物**

## 2. 改动与热同步

- 改 `src/` → 构建 → `dist/client.js` **单文件热同步**安装版即可生效（无需重打包；页面级改动刷新即见）
- 已知坑：工具 pane 是滚动层（页面自 `height:100%` 钉底才成立）；步骤弹窗内方案撤销=左栏内实现（弹窗级撤销已废）

## 3. 门禁与测试

- `yarn workspace dsh-tintin-media-bundle test`（vitest，基线 199 用例全绿——8 红历史已清偿）
- verify-tintin-gate 行门禁（≤1000 行，超限按域拆不加基线）；`check:tintin` 覆盖锚点一致性

## 4. 铁律

1. 服务端 API 契约变更=OpenAPI 实测（**路径名+查询参数两层扫**）；长任务（TTS/合成）按引擎统一自动重试口径（500/503 恢复轮询）
2. 与创作/运营共享的组件=TButton 式**字节副本**先例（shared 是纯 JS 叶子，不塞 Vue）
3. 并行会话同仓：Edit 前重读；管道吃 exit code，读日志判真伪
