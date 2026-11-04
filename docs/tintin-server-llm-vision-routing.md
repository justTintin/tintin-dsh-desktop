# /llm 带图请求视觉路由策略变更（服务端会话移交规格）

> 建立日期:2026-11-03。提出方:TinTin 桌面客户端会话(本仓库);实施方:.31 服务端会话。
> 服务端代码:`/home/freya/Project/TinTin_AI_Agent_Server/server/`(git branch `server`,1103 时点 `0100e35d-dirty`)。
> 本文档只定义行为契约与验收标准,不约束实现文件名;改动后由客户端会话按 §5 探针远程验收。

## 1. 背景与现状证据(2026-11-03 实测)

封面制作会话里用户带图发消息(「根据此图片生成封面,需要先抠图,再加标题」),智能体回合卡死:

- **现状行为**:`POST /llm/chat/completions` 请求含 `image_url` 部件时,**整个请求被改道**给本地视觉模型
  (默认 `qwen3-vl:8b` @ Ollama `127.0.0.1:11435`,8.8B Q4_K_M),主模型(deepseek-v4-flash)不参与该次调用。
  实测响应:`{"model":"qwen3-vl:8b","provider":"ollama","provider_name":"Ollama 视觉",...}`。
- **坑①能力不匹配**:8B 模型执行封面技能的多步编排(看图→抠图→编辑器端点调用)能力差一个量级,回合质量不可用。
- **坑②思考型空回**:qwen3-vl 是思考型模型,reasoning 不进 `content`。实测 `max_tokens=60` 时 60 token 全部
  消耗在 thinking,返回 `"content":""`(`finish_reason":"stop"`)——客户端收到空气,界面表现为永远「读取中」无结果。
- **坑③慢**:大上下文(图约 1665 token + 技能文档 + 工具表)思考分钟级;GPU 争抢时 4 token 探测也要 23s。
- 附带:视觉调用超时上限实测 300s(挂满 5 分钟才 504「Ollama 请求超时」);`server_health` 的
  `vision_model.consecutive_failures` 计数器接不住这条路径(此轮卡死期间恒为 0)。

## 2. 目标行为(caption-then-main)

带图请求一律改两段式,**主模型永远编排**:

1. **caption 段**:对请求中的每张图片,调用视觉模型生成一段简短中文图述(≤200 字)。
2. **主段**:把图述以文本形式注入原消息(替换图片部件),发给请求指定的主模型(如 deepseek-v4-flash)照常推理;
   响应的 `model`/`provider` 字段必须回填**主模型**身份,不再出现 `provider:"ollama"`。

### 裁决分支(服务端会话先测一步再定实现)

- **若 DeepSeek 上游原生接受 `image_url` 部件**(deepseek-v4 若已支持视觉):更简策略=**直通不路由**,
  图片原样透传主模型,caption 段整个省掉。请先直测上游;两条路径二选一,验收标准相同(§5)。

## 3. 实现要点

- **caption 缓存**:agent 回合会对同一历史反复发起模型调用;图述必须按图片内容缓存
  (data URL 取 payload 字节 sha256;http(s) URL 直接用 URL),进程内 LRU(建议 128 条),避免每回合重打。
- **caption 调用约束**:关闭思考(ollama `think:false` 或 qwen3 `/no_think` 前缀,以实际生效者为准);
  超时上限 **30s**(替换现状 300s);失败/超时**降级不失败**——以固定占位文本
  `[图片描述不可用]` 注入主段,回合继续(绝不再出现 300s 挂死)。
- **占位文本也要缓存**(短 TTL 即可),避免 Ollama 挂死期间每回合都重试 30s。
- **空内容守卫**:caption 结果 `content` 为空但 reasoning 非空时,视为失败走降级(坑②防线);计数器
  `vision_model.consecutive_failures` 必须接住 caption 段失败(现状盲区)。
- **流式**:主段照常 SSE 流式返回,客户端契约零变化。
- **上游重试退避(2026-11-04 借鉴标准 T4/手册 §10.1.1)**:`/llm` 透传层对上游 503/429
  (DeepSeek「Service is too busy」类)自动重试 2 次、指数退避(1s/4s),重试仍失败才向
  客户端回错——1103 实证:无重试时一次上游瞬时过载即整 turn 失败。
- **纯文本请求零变化**:不含图片部件的请求路径不得有任何行为差异(回归红线)。
- 多图请求:逐图图述、按序拼接注入同一消息。

## 4. 不变量

- `/mcp`、`/v1` OpenAI 兼容面、其余 REST 面不受影响;`GET /llm/vision/models` 与 `PUT /llm/vision/model` 语义不变。
- 客户端(桌面端封面/影片/总助手会话)**零改动**——本变更是服务端内部路由策略,对外契约不变。

## 5. 验收清单(部署后由客户端会话从 192.168.111.26 直探 .31:8000)

| # | 探针 | 通过标准 |
|---|------|----------|
| A | 带图非流式(model=deepseek-v4-flash,真实 PNG) | http 200;`model=deepseek-v4-flash`、`provider=deepseek`;`content` 非空且内容与图片相符(图述生效) |
| B | 带图流式(同上,stream=true) | SSE 正常出内容 chunk;chunk 内 model 字段为主模型;无 300s 挂死 |
| C | 纯文本小请求(model=deepseek-v4-flash) | 行为与变更前一致(回归) |
| D | 视觉通道不可用时带图请求 | ≤30s 内降级继续,消息含 `[图片描述不可用]`,回合不挂死(人工/模拟验收) |
| E | 同图二次请求 | 命中缓存,第二次 caption 段零额外延迟(服务端日志验证) |

## 6. 参考

- 现状探针与证据原始输出见客户端会话记录(2026-11-03);本机复测脚本模板:
  `D:\Project\tintin-dsh-desktop\.tmp-llm-vision-route-verify.mjs`(A/B/C 自动化)。
- 相关记忆口径:带图消息视觉改道三坑、server_health vision 计数器盲区(客户端会话 memory:tintin-server-topology 1103)。
