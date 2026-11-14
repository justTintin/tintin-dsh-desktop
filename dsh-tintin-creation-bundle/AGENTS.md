# DSH TinTin Creation Bundle（素材创作）— 领域规则（AGENTS.md）

本文件是**创作域的开发侧契约**。批次事实以代码与本目录测试为准；跨域规则见根 [AGENTS.md](../AGENTS.md) 与 [docs/tintin-iron-rules.md](../docs/tintin-iron-rules.md)。

## 1. 架构定位（先分清，防误改）

- **本包没有本地会话智能体**：创作会话=前端直连**服务端 `/llm`**（llmChat），生成走服务端业务 API——不要给本包加本地 ACP 智能体/skill 注入（与封面/影片的 spawn dsh 架构是两种形态）
- 形态=cordis 插件工具页：`index.js` 挂载 + `src/`（Vue）→ `dist/client.js` **单文件产物**
- 会话历史在客户端 localStorage（`creationHistoryLogic`，50 条上限）——唯一读写入口即服务端升级缝

## 2. 改动与热同步

- 改 `src/` → 构建 → `dist/client.js` **单文件热同步**安装版即可生效（无需重打包）
- 创作文件池预览、生成链（comfygen/服务端）契约变更须同步 `types/apiPaths.ts`

## 3. 门禁与测试

- `yarn workspace dsh-tintin-creation-bundle test`（vitest）
- verify-tintin-gate 行门禁（≤1000 行，超限按域拆不加基线）；`check:tintin` 覆盖锚点一致性

## 4. 铁律

1. 服务端 API 契约变更=OpenAPI 实测（**路径名+查询参数两层扫**），不凭记忆
2. 与媒体/运营共享的组件=TButton 式**字节副本**先例（shared 是纯 JS 叶子，不塞 Vue）
3. 并行会话同仓：Edit 前重读；管道吃 exit code，读日志判真伪
