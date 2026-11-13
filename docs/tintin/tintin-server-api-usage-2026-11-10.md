# TinTin 服务端接口客户端使用面审计（2026-11-10）

> 数据源：服务端实时 OpenAPI `http://192.168.111.31:8000/openapi.json`（2026-11-10 快照，imitate-milestone-20261014-183-g0ce6089e-dirty）
> 扫描范围：TinTin 客户端全部自有包（bundle / media / ops / creation / cover / browser / client-ui / shared / channel 通道包）+ OpenFilm shell 源码 + `@deepseek-ai` 运行时（dsh-llm / dsh-agent）
> 前版：服务端仪表盘 `API-INVENTORY-2026-09-19`（553 操作，server/tools/api_inventory.py 生成，本文件在其「客户端使用」维度上全面重扫并取代）

## 一、总量结论

| 口径 | 数量 |
|---|---:|
| 服务端操作（method×path） | 605 |
| 客户端已使用（有代码级调用证据） | 154 |
| 客户端间接消费（运行时经响应 URL 取件，无静态字面量） | 2 |
| 客户端未使用（直接+间接都不含） | 449 |
| ─ 其中仅类型/路径常量声明（server-api.ts / apiPaths.ts / *.d.ts），运行时不调用 | 4 |
| ─ 其中仅测试引用 | 4 |
| ─ 其中完全无调用证据 | 441 |
| 09-19 后服务端新增 | 97（已使用 33） |

匹配口径与局限：

1. 证据=客户端源码中的 URL 字面量/模板串（排除 openapi-typescript 生成物 `api-contract.generated.ts`、注释行、`.desktop-build` 构建暂存）；对零命中端点再跑「字面段 run + 边界」全量反查，最后人工复核残留。
2. 「使用」指客户端产品运行时会发起的调用（含宿主桥 lib、打包 dist、vendored 运行时）；路径常量定义但无调用者不算使用。
3. 动态拼接在行级反查+人工复核下有残留可能，未使用名单下线前仍须逐条实机验证（与 09-19 盘点同一纪律）。
4. 仪表盘前端与服务端内部调用不在本审计范围（见 09-19 盘点的对应标签）。

### 间接消费端点（2）

客户端运行时会按服务端响应里给的 URL 取件/播放，源码中没有路径字面量——下线这些接口同样会破坏功能：

| 方法 | 路径 | 消费方式 |
|---|---|---|
| GET | `/montage/split/clip/{task_id}/{filename}` | openfilm 下载工具消费任务结果 download_url（openfilm-tools.js:457），客户端无静态字面量 |
| GET | `/voice/samples/{sid}/audio` | 音频播放/下载消费列表响应的 audio_url 字段（useVoiceCloneStudio.ts:209-241、openfilm-tools.js:194），客户端无静态字面量 |

## 二、客户端未使用接口（按模块，共 449）

图例：🆕=09-19 后服务端新增；「09-19 证据」=前版盘点的服务端侧标签（仪表盘/服务端内部=该接口在服务端生态有其他消费方；客户端文档=仅文档记载）。

### (untagged)（4）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/guide/docs/{name}` | Guide Doc | 无调用证据 |  |
| GET | `/guide/docs/{name}/pdf` | Guide Doc Pdf | 无调用证据 |  |
| GET | `/` | Dashboard | 无调用证据 | 服务端根路径，客户端无调用 |
| GET | `/architecture` | Architecture Diagram | 无调用证据 |  |

### 编排（1）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | 🆕 `/api/orchestrate` | Orchestrate Api | — |  |

### 产品三视图（3）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/three-view/check` | Check Existing | 客户端文档 |  |
| POST | `/three-view/generate` | Generate Three View | 服务端内部+客户端文档 |  |
| GET | `/three-view/result/{task_id}` | Three View Result | 服务端内部+客户端文档 |  |

### 产品图生成（6）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/product-image/generate` | 产品图生成 | 服务端内部 |  |
| POST | `/product-image/batch` | 批量产品图生成 | 无调用证据 |  |
| GET | `/product-image/workflows` | 可用场景工作流列表 | 无调用证据 |  |
| GET | `/product-image/status/{task_id}` | 查询生成进度 | 无调用证据 |  |
| GET | `/product-image/result/{task_id}` | 下载生成结果（首张） | 服务端内部 |  |
| GET | `/product-image/result/{task_id}/{filename}` | 下载指定结果文件 | 服务端内部 |  |

### 产品资料库（31）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/api/product-library/init` | Api Init | 无调用证据 |  |
| GET | `/api/product-library/clients/{machine_id}/items` | List Items | — |  |
| POST | 🆕 `/api/product-library/items/views/assemble-batch` | Assemble Batch Views | — |  |
| POST | 🆕 `/api/product-library/views/backfill-angles` | Backfill View Angles Api | — |  |
| POST | `/api/product-library/upsert` | Batch Upsert | 客户端文档 |  |
| POST | `/api/product-library/clients/{machine_id}/upsert` | Batch Upsert | — | 同上 |
| GET | 🆕 `/api/product-library/import/template` | Import Template | — | 仅测试引用 |
| POST | `/api/product-library/apply-categories` | Apply Categories | 无调用证据 |  |
| POST | `/api/product-library/clients/{machine_id}/apply-categories` | Apply Categories | — | base() 追加面外（useOpsProductLibrary.ts 全量核对） |
| GET | `/api/product-library/categories` | List Categories | 无调用证据 |  |
| GET | `/api/product-library/clients/{machine_id}/categories` | List Categories | — | 同上 |
| GET | `/api/product-library/brands` | List Brands | 无调用证据 |  |
| GET | `/api/product-library/clients/{machine_id}/brands` | List Brands | — | 同上 |
| GET | `/api/product-library/grouped` | Grouped | 客户端文档 | 客户端只用 clients/{machine_id} 作用域（1009 裁决：views/列表走机器作用域） |
| POST | `/api/product-library/sync` | Trigger Sync | 客户端文档 |  |
| GET | `/api/product-library/sync/status` | Sync Status | 客户端文档 |  |
| GET | `/api/product-library/items/{item_id}/prompt` | Item Prompt | 客户端文档 |  |
| GET | `/api/product-library/clients/{machine_id}/items/{item_id}/prompt` | Item Prompt | — | 同上 |
| POST | `/api/product-library/mine` | Trigger Mine | 客户端文档 |  |
| GET | `/api/product-library/mine/status` | Mine Status | 客户端文档 |  |
| GET | `/api/product-library/erp-config` | Get Erp Config | 仪表盘+客户端文档 |  |
| PUT | `/api/product-library/erp-config` | Save Erp Config | 仪表盘+客户端文档 |  |
| GET | `/api/product-library/client/erp-config` | Client Get Erp Config | 无调用证据 |  |
| POST | `/api/product-library/client/erp-test` | Client Erp Test | 无调用证据 |  |
| GET | `/api/product-library/schedule` | Get Schedule | 客户端文档 |  |
| PUT | `/api/product-library/schedule` | Put Schedule | 客户端文档 |  |
| GET | `/api/product-library/stats` | Library Stats | 客户端文档 |  |
| POST | `/api/product-library/items/{item_id}/keywords/generate` | Generate Item Keywords | 客户端文档 | 09-19 曾确认，现客户端无调用（关键词生成未接线） |
| POST | `/api/product-library/clients/{machine_id}/items/{item_id}/keywords/generate` | Generate Item Keywords | — | 同上 |
| POST | `/api/product-library/keywords/generate-batch` | Keywords Generate Batch | 客户端文档 |  |
| GET | `/api/product-library/keywords/generate-batch/status` | Keywords Generate Batch Status | 客户端文档 |  |

### 成片模板（6）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/template/list` | List Templates | 客户端文档 |  |
| POST | `/template/validate` | Validate Template | 客户端文档 |  |
| POST | `/template/import` | Import Template | 客户端文档 |  |
| GET | `/template/export/{template_id}` | Export Template | 客户端文档 |  |
| POST | `/template/generate` | Generate | 客户端文档 |  |
| POST | `/template/match` | Match Slots | 客户端文档 |  |

### 定时任务（5）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/scheduled/tasks/evolution/stats` | Evolution Stats | 服务端内部+客户端文档 |  |
| POST | `/scheduled/tasks/evolution/feedback` | Evolution Feedback | 服务端内部+客户端文档 |  |
| GET | `/scheduled/tasks/queue` | Queue Status | 服务端内部+客户端文档 |  |
| POST | 🆕 `/scheduled/tasks/{task_id}/cancel` | Cancel Task | — |  |
| POST | `/scheduled/tasks/batch_delete` | Batch Delete Tasks | 仪表盘+服务端内部+客户端文档 |  |

### 多平台下载（2）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/material/web_download/platforms` | Web Download Platforms | 服务端内部+客户端文档 |  |
| POST | `/material/web_download/sync` | Web Download Sync | 服务端内部+客户端文档 |  |

### 分镜脚本（7）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | 🆕 `/api/storyboard/scripts/quality-overview` | Quality Overview | — |  |
| POST | 🆕 `/api/storyboard/scripts/{script_id}/shots/{name}/refine` | Refine Shot Spec | — |  |
| POST | 🆕 `/api/storyboard/scripts/extend-video` | Extend Video | — |  |
| POST | 🆕 `/api/storyboard/scripts/{script_id}/bind_sfx` | Bind Sfx | — |  |
| POST | 🆕 `/api/storyboard/scripts/{script_id}/six-view` | Create Six View | — | 六视图生成链已按 1012 裁决退役（改为产品资料库 views 槽位） |
| DELETE | 🆕 `/api/storyboard/scripts/{script_id}/six-view/{view}` | Delete Six View | — | 同上 |
| GET | 🆕 `/api/storyboard/scripts/six-view/result/{task_id}` | Six View Result | — | 同上（file/{view} 双轨 URL 仍在用） |

### 工作流（1）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/workflows/{workflow_id}/run` | Run Workflow | 客户端文档 |  |

### 花字（1）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| DELETE | `/fancy/templates/{template_id}` | Delete Template | 仪表盘+客户端文档 | 客户端只用集合 GET /fancy/templates（voice-ipc.js:636） |

### 即梦任务（6）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/dreamina/tasks` | Submit Task | 服务端内部+客户端文档 |  |
| GET | `/dreamina/tasks` | List Tasks | 服务端内部+客户端文档 |  |
| GET | `/dreamina/status` | Queue Status | 客户端文档 |  |
| POST | `/dreamina/execute` | Execute Next | 客户端文档 |  |
| POST | `/dreamina/tasks/{task_id}/result` | Report Result | 服务端内部+客户端文档 |  |
| POST | `/dreamina/tasks/{task_id}/cancel` | Cancel Task | 服务端内部+客户端文档 |  |

### 剪辑引擎（17）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/editor/drafts` | List Drafts | 客户端文档 |  |
| POST | `/editor/drafts` | Create Draft | 客户端文档 |  |
| GET | `/editor/drafts/{draft_id}` | Get Draft | 客户端文档 |  |
| PUT | `/editor/drafts/{draft_id}` | Save Draft | 客户端文档 |  |
| DELETE | `/editor/drafts/{draft_id}` | Delete Draft | 客户端文档 |  |
| POST | `/editor/drafts/{draft_id}/duplicate` | Duplicate Draft | 客户端文档 |  |
| POST | `/editor/drafts/from-task/{task_id}` | Draft From Task | 客户端文档 |  |
| GET | `/editor/render/{task_id}/result` | Render Result | 服务端内部+客户端文档 |  |
| POST | `/editor/render/{task_id}/cancel` | Cancel Render | 服务端内部+客户端文档 |  |
| POST | `/editor/drafts/{draft_id}/preview` | Submit Preview | 客户端文档 |  |
| POST | `/editor/asset/check` | Asset Check | 客户端文档 |  |
| POST | `/editor/drafts/{draft_id}/auto-caption` | Auto Caption | 客户端文档 |  |
| POST | `/editor/drafts/{draft_id}/cover` | Generate Cover Endpoint | 客户端文档 |  |
| GET | `/editor/drafts/{draft_id}/cover/image` | Get Cover Image | 客户端文档 |  |
| POST | `/editor/cleanup/run` | Run Cleanup Endpoint | 客户端文档 |  |
| GET | `/editor/cleanup/report` | Cleanup Report | 客户端文档 |  |
| POST | `/editor/import/jianying` | Import Jianying | 客户端文档 |  |

### 鉴权（3）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/api/auth/token` | Issue | 无调用证据 |  |
| POST | `/api/auth/revoke` | Revoke | 无调用证据 |  |
| GET | `/api/auth/tokens` | Token List | 无调用证据 |  |

### 接口需求（5）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/interfaces/request` | Submit Interface Request | 客户端文档 |  |
| GET | `/interfaces/requests` | List Requests | 客户端文档 |  |
| GET | `/interfaces/requests/{request_id}` | Get Request | 客户端文档 |  |
| PATCH | `/interfaces/requests/{request_id}` | Update Request Status | 客户端文档 |  |
| DELETE | `/interfaces/requests/{request_id}` | Delete Request | 客户端文档 |  |

### 节点工作流引擎（9）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/workflow/nodes` | List Nodes | 客户端文档 |  |
| GET | `/workflow/nodes/{nid}` | Get Node | 客户端文档 |  |
| PUT | `/workflow/nodes/{nid}` | Update Node | 客户端文档 |  |
| POST | `/workflow/nodes/sync` | Sync Nodes | 客户端文档 |  |
| POST | `/workflow/nodes/{nid}/health` | Node Health | 客户端文档 |  |
| GET | `/workflow/route` | Route Check | 客户端文档 |  |
| POST | `/workflow/execute` | Execute | 服务端内部+客户端文档 |  |
| GET | `/workflow/templates` | List Templates | 客户端文档 |  |
| GET | `/workflow/select` | Select | 客户端文档 |  |

### 模板统一（14）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/templates/category/{category}` | List By Category | 仪表盘+客户端文档 |  |
| POST | `/templates/generate/{category}` | Generate By Category | 仪表盘+客户端文档 |  |
| GET | `/templates/preview/video/{template_id}` | Preview Video | 仪表盘+客户端文档 |  |
| POST | `/templates/preview/ensure/{template_id}` | Preview Ensure | 仪表盘+客户端文档 |  |
| POST | `/templates/validate` | Validate Tpl | 仪表盘+客户端文档 |  |
| POST | `/templates/render` | Render Tpl | 仪表盘+客户端文档 |  |
| POST | `/templates/render/beat` | Render Beat | 仪表盘+客户端文档 |  |
| GET | `/templates/render/result/{task_id}` | Render Result | 仪表盘+客户端文档 |  |
| GET | `/templates/render/download/{task_id}` | Render Download | 仪表盘+客户端文档 |  |
| POST | `/templates/preview` | Preview Tpl | 仪表盘+客户端文档 |  |
| POST | `/templates/analyze-video` | Analyze Video | 仪表盘+客户端文档 |  |
| POST | `/templates/analyze-cover` | Analyze Cover | 仪表盘+客户端文档 |  |
| POST | `/templates/analyze-script` | Analyze Script | 仪表盘+客户端文档 |  |
| POST | `/templates/analyze-beat` | Analyze Beat | 仪表盘+客户端文档 |  |

### 模型调度（8）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/models/status` | Models Status | 仪表盘+客户端文档 |  |
| GET | 🆕 `/models/route-table` | Model Route Table | — |  |
| GET | 🆕 `/models/metrics` | Router Metrics | — |  |
| POST | `/models/ensure/{service_key}` | Ensure Model | 仪表盘+客户端文档 |  |
| POST | `/models/wait/{service_key}` | Wait Model | 客户端文档 |  |
| POST | `/models/unload/{service_key}` | Unload Model | 仪表盘+客户端文档 |  |
| GET | `/models/mode` | Get Mode | 仪表盘 |  |
| PUT | `/models/mode` | Set Mode | 仪表盘 |  |

### 平台审核（13）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/review/rules` | List Rules | 仪表盘 |  |
| POST | `/review/rules` | Add Rule | 仪表盘 |  |
| PUT | `/review/rules/{rule_id}` | Update Rule | 仪表盘 |  |
| DELETE | `/review/rules/{rule_id}` | Delete Rule | 仪表盘 |  |
| POST | `/review/check` | Check Content | 仪表盘+服务端内部+客户端文档 |  |
| GET | `/review/records` | List Records | 仪表盘+客户端文档 |  |
| POST | `/review/submit` | Submit Review | 客户端文档 |  |
| GET | `/review/queue` | Review Queue | 客户端文档 |  |
| POST | `/review/approve` | Approve Item | 客户端文档 |  |
| POST | `/review/reject` | Reject Item | 客户端文档 |  |
| GET | `/review/logs` | Review Logs | 客户端文档 |  |
| GET | `/review/status/{product_type}/{product_id}` | Product Status | 客户端文档 |  |
| GET | `/review/items/{item_id}` | Item Detail | 客户端文档 |  |

### 评审打标（7）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/review/label/videos` | List Videos | 仪表盘+客户端文档 |  |
| GET | `/review/label/stream` | Stream Video | 客户端文档 |  |
| POST | `/review/label/analyze` | Analyze Video | 仪表盘+客户端文档 |  |
| POST | `/review/label/analyze_batch` | Analyze Batch | 仪表盘+客户端文档 |  |
| POST | `/review/label/save` | Save Label | 仪表盘+客户端文档 |  |
| GET | `/review/label/status` | Label Status | 仪表盘+客户端文档 |  |
| GET | `/review/label/export` | Export Labels | 客户端文档 |  |

### 热点新闻（7）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/news/categories` | Get Categories | 无调用证据 |  |
| PUT | `/news/categories` | Put Categories | 无调用证据 |  |
| POST | `/news/collect` | Collect Now | 客户端文档 |  |
| GET | `/news/items` | List Items | 客户端文档 |  |
| POST | `/news/draft` | Make Draft | 客户端文档 |  |
| POST | `/news/push` | Push | 客户端文档 |  |
| GET | `/news/history` | Push History | 客户端文档 |  |

### 任务队列（11）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/tasks/client/bind_wechat` | Client Bind Wechat | 客户端文档 |  |
| DELETE | `/tasks/client/bind_wechat` | Client Unbind Wechat | 客户端文档 |  |
| GET | `/tasks/client/route/{im_session_id}` | Client Route | 客户端文档 |  |
| GET | `/tasks/assigned/{machine_id}` | Assigned Tasks | 客户端文档 |  |
| POST | `/tasks/{task_id}/report` | Report Task | 仪表盘+客户端文档 |  |
| GET | `/tasks/queue/state` | Queue State | 客户端文档 |  |
| POST | `/tasks/queue/pause` | Pause Queue | 客户端文档 |  |
| POST | `/tasks/queue/resume` | Resume Queue | 客户端文档 |  |
| GET | 🆕 `/tasks/store-health` | Store Health | — |  |
| POST | `/tasks/{task_id}/resume` | Resume Task | 仪表盘+客户端文档 |  |
| POST | `/tasks/batch_delete` | Batch Delete Tasks | 仪表盘+客户端文档 |  |

### 声音样本（8）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/voice/samples/{sid}` | Get Sample | 仪表盘+服务端内部+客户端文档 | 仅测试 mock 引用；运行时只用集合 GET /voice/samples |
| PUT | `/voice/samples/{sid}` | Update Sample | 仪表盘+服务端内部+客户端文档 | 同上 |
| DELETE | `/voice/samples/{sid}` | Delete Sample | 仪表盘+服务端内部+客户端文档 | 同上 |
| POST | 🆕 `/voice/samples/{sid}/generate_normalize_rules` | Generate Normalize Rules | — |  |
| GET | 🆕 `/voice/normalize-rules` | List Global Rules | — |  |
| POST | 🆕 `/voice/normalize-rules` | Create Global Rule | — |  |
| PUT | 🆕 `/voice/normalize-rules/{rid}` | Update Global Rule | — |  |
| DELETE | 🆕 `/voice/normalize-rules/{rid}` | Delete Global Rule | — |  |

### 视频配置（4）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/config/luts/{lut_id}/file` | Download Lut File | 仪表盘+客户端文档 | LUT 应用走服务端合成，客户端不取原文件 |
| DELETE | `/config/luts/{lut_id}` | Delete Lut | 仪表盘+客户端文档 | 客户端只用集合 GET /config/luts（final-ipc.js:1306），按 id 管理未接线 |
| POST | `/config/luts/match` | Match Lut Api | 仪表盘+客户端文档 | 未接线 |
| POST | `/config/fonts/scan` | Scan Fonts | 仪表盘+客户端文档 | 未接线 |

### 视频评价（38）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/evaluate/video` | Evaluate Video | 服务端内部+客户端文档 |  |
| POST | `/evaluate/cancel/{task_id}` | Cancel Eval | 客户端文档 |  |
| GET | `/evaluate/result/{task_id}` | Eval Result | 服务端内部+客户端文档 |  |
| GET | `/evaluate/by-task/{task_id}` | Eval By Task | 客户端文档 |  |
| GET | `/evaluate/history` | Eval History | 客户端文档 |  |
| GET | `/evaluate/stats` | Eval Stats | 客户端文档 |  |
| POST | `/evaluate/feedback` | Eval Feedback | 客户端文档 |  |
| POST | `/evaluate/feedback/dimensions` | Feedback Dimensions | 客户端文档 |  |
| GET | `/evaluate/queue` | Eval Queue | 客户端文档 |  |
| GET | `/evaluate/weights` | Current Weights | 客户端文档 |  |
| POST | `/evaluate/retrain` | Retrain Weights | 客户端文档 |  |
| GET | `/evaluate/cases` | List Cases | 客户端文档 |  |
| DELETE | `/evaluate/cases/{case_id}` | Delete Case | 客户端文档 |  |
| POST | `/evaluate/finetune/export` | Finetune Export | 客户端文档 |  |
| POST | `/evaluate/review30` | Review30 | 客户端文档 |  |
| POST | `/evaluate/review30/train` | Review30 Train | 客户端文档 |  |
| POST | `/evaluate/guidance/apply` | Guidance Apply | 客户端文档 |  |
| POST | `/evaluate/script` | Evaluate Script | 服务端内部+客户端文档 |  |
| GET | `/evaluate/script/result/{task_id}` | Script Eval Result | 服务端内部+客户端文档 |  |
| GET | `/evaluate/script/history` | Script Eval History | 服务端内部+客户端文档 |  |
| POST | `/evaluate/script/feedback` | Script Eval Feedback | 服务端内部+客户端文档 |  |
| POST | `/evaluate/guidance/run` | Guidance Run | 服务端内部+客户端文档 |  |
| GET | `/evaluate/guidance/history` | Guidance History | 客户端文档 |  |
| GET | `/evaluate/guidance/{guidance_id}` | Guidance Detail | 服务端内部+客户端文档 |  |
| GET | `/evaluate/overview` | Eval Overview | 客户端文档 |  |
| GET | `/evaluate/pairs` | Eval Pairs | 客户端文档 |  |
| GET | `/evaluate/trace` | Eval Trace | 客户端文档 |  |
| GET | `/evaluate/calibration/golden` | Calib List Golden | 客户端文档 |  |
| POST | `/evaluate/calibration/golden` | Calib Add Golden | 客户端文档 |  |
| DELETE | `/evaluate/calibration/golden/{gid}` | Calib Remove Golden | 客户端文档 |  |
| POST | `/evaluate/calibration/learn` | Calib Learn | 客户端文档 |  |
| GET | `/evaluate/calibration/offsets` | Calib Offsets | 客户端文档 |  |
| GET | `/evaluate/profiles/industry` | List Industry Profiles | 客户端文档 |  |
| POST | `/evaluate/profiles/industry` | Upsert Industry Profile | 客户端文档 |  |
| DELETE | `/evaluate/profiles/industry/{key}` | Delete Industry Profile | 客户端文档 |  |
| GET | `/evaluate/profiles/platform` | List Platform Profiles | 无调用证据 |  |
| POST | `/evaluate/profiles/platform` | Upsert Platform Profile | 无调用证据 |  |
| DELETE | `/evaluate/profiles/platform/{key}` | Delete Platform Profile | 无调用证据 |  |

### 数字人（2）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/digital-human/batch` | Submit Batch | 客户端文档 |  |
| GET | `/digital-human/batch/{batch_id}` | Batch Status | 客户端文档 |  |

### 素材定时任务（2）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/material/cron` | Get Cron | 仪表盘+客户端文档 |  |
| PUT | `/material/cron` | Update Cron | 仪表盘+客户端文档 |  |

### 素材管理（42）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/material/config` | Db Config | 仪表盘+客户端文档 |  |
| PUT | `/material/config` | Update Config | 仪表盘+客户端文档 |  |
| GET | `/material/schema` | Get Schema | 仪表盘+客户端文档 |  |
| GET | `/material/stats` | Stats | 客户端文档 |  |
| GET | `/material/status` | Status | 客户端文档 |  |
| GET | `/material/duplicates` | Material Duplicates | 客户端文档 |  |
| GET | `/material/tags` | List Tags | 客户端文档 |  |
| POST | `/material/tags/add` | Add Tags | 客户端文档 |  |
| POST | `/material/tags/remove` | Remove Tags | 客户端文档 |  |
| POST | `/material/favorite` | Set Favorite | 客户端文档 |  |
| GET | `/material/similar` | Similar Materials | 客户端文档 |  |
| GET | `/material/logs` | Material Logs | 仪表盘+客户端文档 |  |
| GET | `/material/logs_list` | Material Logs List | 客户端文档 |  |
| GET | `/material/score` | Get Score | 服务端内部+客户端文档 |  |
| POST | `/material/score` | Score Material | 服务端内部+客户端文档 |  |
| GET | `/material/detail` | Material Detail | 仪表盘+客户端文档 |  |
| POST | `/material/ab_label` | Ab Label | 仪表盘 |  |
| POST | `/material/delete` | Delete Material | 仪表盘 | 客户端注释明确为前身接口，音频已分流 audio_library 口径（useAudioGen.ts:427） |
| POST | `/material/cleanup_recycle` | Cleanup Recycle | 客户端文档 |  |
| POST | `/material/batch_thumbnail` | Batch Thumbnail | 客户端文档 |  |
| POST | 🆕 `/material/rebuild_thumbnails` | Rebuild Thumbnails | — |  |
| POST | `/material/mark_origin` | Mark Origin | 客户端文档 |  |
| GET | `/material/dirs` | List Dirs | 仪表盘+客户端文档 |  |
| POST | `/material/backfill_dimensions` | Backfill Dimensions | 客户端文档 |  |
| POST | `/material/backfill_brand` | Backfill Brand | 客户端文档 |  |
| POST | `/material/backfill_background` | Backfill Background | 客户端文档 |  |
| POST | `/material/relink` | Relink Directory | 仪表盘+客户端文档 |  |
| POST | `/material/batch_score` | Batch Score | 仪表盘+客户端文档 |  |
| POST | `/material/batch_analyze` | Batch Analyze | 客户端文档 |  |
| POST | `/material/analyze` | Analyze | 仪表盘+服务端内部+客户端文档 |  |
| POST | `/material/score_clip` | Score Clip | 客户端文档 |  |
| POST | `/material/import_plugin` | Import Plugin | 客户端文档 |  |
| GET | `/material/plugin/categories` | Plugin Categories List | 客户端文档 |  |
| POST | `/material/plugin/categories` | Plugin Categories Create | 客户端文档 |  |
| DELETE | `/material/plugin/categories/{cat_id}` | Plugin Categories Delete | 客户端文档 |  |
| POST | `/material/training_label` | Set Training Label | 客户端文档 |  |
| GET | `/material/training_label` | Get Training Label | 客户端文档 |  |
| POST | `/material/training_label/auto` | Auto Training Label | 客户端文档 |  |
| GET | `/material/training_set` | Training Set | 客户端文档 |  |
| POST | `/material/lora/register` | Lora Register | 客户端文档 |  |
| GET | `/material/lora/registry` | Lora Registry List | 客户端文档 |  |
| POST | `/material/lora/training_set_zip` | Training Set Zip | 客户端文档 |  |

### 素材任务（8）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/material/tasks` | List Tasks | 仪表盘+客户端文档 |  |
| GET | `/material/tasks/queue/state` | Queue State | 仪表盘+客户端文档 |  |
| POST | `/material/tasks/queue/pause` | Pause Queue | 仪表盘+客户端文档 |  |
| POST | `/material/tasks/queue/resume` | Resume Queue | 仪表盘+客户端文档 |  |
| POST | `/material/tasks/batch_cancel` | Batch Cancel | 仪表盘+客户端文档 |  |
| POST | `/material/tasks/batch_delete` | Batch Delete | 仪表盘+客户端文档 |  |
| GET | `/material/tasks/{task_id}` | Get Task | 仪表盘+服务端内部+客户端文档 |  |
| DELETE | `/material/tasks/{task_id}` | Cancel Task | 仪表盘+服务端内部+客户端文档 |  |

### 素材自动分割（3）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/material/auto_split/{material_id}` | Split One | 客户端文档 |  |
| POST | `/material/auto_split/run` | Split Batch | 客户端文档 |  |
| GET | `/material/{material_id}/segments` | List Segments | 仪表盘+服务端内部+客户端文档 |  |

### 特效镜头（1）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/montage/effect` | Apply Effect | 服务端内部+客户端文档 |  |

### 推理节点（3）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | 🆕 `/inference/node/status` | Node Status | — |  |
| POST | 🆕 `/inference/node/model/{model_id}/{action}` | Node Model Action | — |  |
| POST | 🆕 `/inference/node/{action}` | Node Action | — |  |

### 推理资源仲裁（1）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | 🆕 `/arbiter/status` | Arbiter Status | — |  |

### 文字模板（6）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/text_templates/keywords/builtin` | Get Builtin Keywords | 仪表盘+客户端文档 |  |
| GET | `/text_templates/templates/{template_id}` | Get Template | 仪表盘+客户端文档 | 客户端只用集合 GET /text_templates/templates，按 id 端点未接线 |
| DELETE | `/text_templates/templates/{template_id}` | Delete Template | 仪表盘+客户端文档 | 同上，未接线 |
| GET | `/text_templates/templates/{template_id}/preview` | Get Template Preview | 仪表盘+客户端文档 | 预览图直接用列表响应的 preview/preview_webm URL（useCopywritingMontageTextFx.ts:475-477） |
| GET | `/text_templates/templates/{template_id}/preview.webm` | Get Template Preview Webm | 仪表盘+客户端文档 | 同上 |
| POST | `/text_templates/templates/{template_id}/assets` | Upgrade Template Assets | 仪表盘+客户端文档 | 仅服务端能力注释（jianying-templates.js:494），客户端未接线 |

### 系统（15）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/system/activate` | Activate | 仪表盘+客户端文档 |  |
| POST | `/system/license/register` | License Register | 仪表盘+客户端文档 | license 面客户端已无调用（server-proxy 仅留 /system/license 基座） |
| GET | `/system/license/status` | License Register Status | 仪表盘+客户端文档 | 同上 |
| GET | `/system/license/clients` | License Clients | 仪表盘+客户端文档 | 同上 |
| PUT | `/system/license/clients/config` | License Clients Config | 仪表盘+客户端文档 | 同上 |
| DELETE | `/system/license/clients/{machine_id}` | License Client Delete | 仪表盘+客户端文档 | 同上 |
| POST | 🆕 `/system/kb/toggle` | Kb Toggle | — |  |
| POST | 🆕 `/system/kb/restart` | Kb Restart | — |  |
| POST | `/material/test_db` | Test Db Connection | 仪表盘 |  |
| POST | `/nas/test` | Nas Test | 仪表盘 |  |
| POST | `/nas/scan` | Nas Scan | 无调用证据 |  |
| POST | `/material/test_local` | Test Local Storage | 仪表盘 |  |
| GET | `/metrics/history` | Metrics History | 客户端文档 |  |
| GET | `/system/dependencies` | System Dependencies | 客户端文档 |  |
| POST | `/system/restart` | System Restart | 仪表盘 |  |

### 系统日志（1）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/api/logs/failure` | Get Failure Log | 仪表盘+客户端文档 |  |

### 音频卡点（6）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/audio/library/{audio_id}/analysis` | Audio Library Analysis History | 仪表盘+客户端文档 | 未接线（在用的是 POST /audio/library/{id}/analyze 触发分析） |
| POST | `/audio/separate` | Audio Separate | 服务端内部+客户端文档 |  |
| POST | `/audio/library/analyze_all` | Audio Library Analyze All | 仪表盘+客户端文档 | 未接线 |
| POST | `/audio/library/seed` | Audio Library Seed | 客户端文档 | 未接线 |
| POST | `/audio/library/import` | Audio Library Import | 客户端文档 | 未接线 |
| GET | `/audio/bgm/style_stats` | Audio Bgm Style Stats | 客户端文档 |  |

### 音效库（3）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/sfx/analyze/{sfx_id}` | Analyze Sfx | 客户端文档 |  |
| POST | `/sfx/analyze_all` | Analyze All Sfx | 客户端文档 |  |
| POST | `/sfx/upload` | Upload Sfx | 客户端文档 |  |

### 运营（7）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/ops/overview` | Ops Overview | 客户端文档 |  |
| GET | `/ops/analytics` | Ops Analytics | 客户端文档 |  |
| POST | `/ops/publish` | Publish Create | 客户端文档 |  |
| GET | `/ops/publish` | Publish List | 客户端文档 |  |
| GET | `/ops/publish/{pid}` | Publish Detail | 客户端文档 |  |
| POST | `/ops/publish/{pid}/status` | Publish Status | 客户端文档 |  |
| GET | `/ops/review-records` | Ops Review Records | 客户端文档 |  |

### 在线素材（2）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/material/stock_config` | Stock Config | 仪表盘 |  |
| PUT | `/material/stock_config` | Stock Config Save | 仪表盘 |  |

### 智能混剪（3）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/montage/result/{task_id}` | Compose Result | 客户端文档 |  |
| GET | `/montage/result/{task_id}/{variant_index}` | Compose Result Variant | 客户端文档 |  |
| POST | `/montage/beat` | Beat Compose | 服务端内部+客户端文档 |  |

### 智能体化（1）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/agent/registry/{capability_id}` | Agent Registry Detail | 仪表盘+服务端内部+客户端文档 |  |

### 智能体记忆（3）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | 🆕 `/agent/memory` | List Memory | — |  |
| POST | 🆕 `/agent/memory` | Put Memory | — |  |
| DELETE | 🆕 `/agent/memory/{memory_id}` | Delete Memory | — |  |

### 字幕样式库（4）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/subtitle_styles/preview.png` | Preview Inline | 仪表盘+客户端文档 | 未接线（按 id 的预览在用，见第三节） |
| GET | `/subtitle_styles/{sid}` | Get Style | 仪表盘+客户端文档 | 客户端只用集合 GET /subtitle_styles（voice-ipc.js:857） |
| PUT | `/subtitle_styles/{sid}` | Update Style | 仪表盘+客户端文档 | 同上 |
| DELETE | `/subtitle_styles/{sid}` | Delete Style | 仪表盘+客户端文档 | 同上 |

### CLIP向量（2）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/clip/encode_image` | Encode Image | 服务端内部+客户端文档 |  |
| POST | `/clip/encode_text` | Encode Text | 服务端内部+客户端文档 |  |

### comfygen 服务接入（10）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | 🆕 `/comfygen/config` | 查看 comfygen 地址配置（服务端唯一对接入口） | — |  |
| PUT | 🆕 `/comfygen/config` | 修改 comfygen 地址（联动 comfyui，同机不同端口） | — |  |
| GET | 🆕 `/comfygen/ping` | 测试 comfygen 候选地址（/api/health，通不通都 200+ok） | — |  |
| GET | 🆕 `/comfygen/health` | comfygen 编排层健康检查（服务接入，只读） | — |  |
| POST | 🆕 `/comfygen/restart` | 重启 comfygen 编排层引擎（代理 POST /api/restart） | — |  |
| GET | 🆕 `/comfygen/busy` | comfygen 忙碌任务检查（GET /api/busy，停/重启前前端预检） | — |  |
| POST | 🆕 `/comfygen/stop` | 停止 comfygen 引擎（代理上游三道闸：token/空闲/防重复；停止后不自动拉起） | — |  |
| POST | 🆕 `/comfygen/start` | 启动 comfygen 引擎（代理 sidecar :8191 POST /api/start——引擎死后唯一启动通道） | — |  |
| GET | 🆕 `/comfygen/gen-tasks` | storyboard_generate 任务列表（仪表盘 AI 生成面板数据源） | — |  |
| GET | 🆕 `/comfygen/enums` | 生成枚举下发（权威=gen_spec，客户端下拉/校验唯一来源） | — | 仅类型层声明 |

### ComfyUI（21）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/comfyui/config` | 查看 ComfyUI 地址配置 | 仪表盘+客户端文档 |  |
| PUT | `/comfyui/config` | 修改 ComfyUI 地址 | 仪表盘+客户端文档 |  |
| GET | `/comfyui/status` | ComfyUI 运行状态 | 仪表盘+客户端文档 |  |
| GET | 🆕 `/comfyui/ping` | 测试地址连通性（可测未保存的地址，仪表盘「测试」按钮用） | — |  |
| GET | `/comfyui/queue` | ComfyUI 任务队列 | 客户端文档 |  |
| GET | `/comfyui/object_info` | ComfyUI 节点信息 | 无调用证据 |  |
| GET | `/comfyui/models` | ComfyUI 模型列表 | 仪表盘+客户端文档 |  |
| POST | `/comfyui/interrupt` | 中断当前任务 | 客户端文档 |  |
| POST | `/comfyui/free` | 释放 ComfyUI 显存 | 客户端文档 |  |
| GET | `/comfyui/history` | 执行历史 | 无调用证据 |  |
| GET | `/comfyui/view` | Comfyui View | 客户端文档 |  |
| POST | `/comfyui/upload/image` | 上传图片到 ComfyUI（用于 img2img） | 客户端文档 |  |
| GET | `/comfyui/workflows` | 列出 ComfyUI 工作流文件 | 仪表盘+客户端文档 |  |
| GET | `/comfyui/workflow` | 读取指定工作流内容 | 仪表盘+客户端文档 |  |
| GET | `/comfyui/workflow-nodes` | 工作流节点结构（输入节点识别） | 仪表盘+客户端文档 |  |
| POST | `/comfyui/manage` | 启动/停止/重启 ComfyUI | 仪表盘+服务端内部+客户端文档 |  |
| GET | `/comfyui/workflow-register` | Comfyui Wf Regs List | 仪表盘 |  |
| POST | `/comfyui/workflow-register` | Comfyui Wf Regs Create | 仪表盘 |  |
| POST | `/comfyui/workflow-register/from-file` | Comfyui Wf Regs Create From File | 仪表盘+客户端文档 |  |
| PUT | `/comfyui/workflow-register/{name}` | Comfyui Wf Regs Update | 仪表盘+客户端文档 |  |
| DELETE | `/comfyui/workflow-register/{name}` | Comfyui Wf Regs Delete | 仪表盘+客户端文档 |  |

### ComfyUI Apps（5）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/apps` | 获取已发布应用列表 | 无调用证据 |  |
| GET | `/apps/{app_id}` | 获取应用详情 | 无调用证据 |  |
| POST | `/apps/{app_id}/run` | 执行应用 | 无调用证据 |  |
| GET | `/apps/{app_id}/status/{prompt_id}` | 查询执行状态 | 无调用证据 |  |
| POST | `/apps/reload` | 重新加载注册表 | 无调用证据 |  |

### LLM大模型（20）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/llm/prompts` | List Prompts | 仪表盘 |  |
| GET | `/llm/models` | List Models | 客户端文档 | 客户端已裁决退役（dsh-tintin-bundle/index.js:953，2026-10-29：模型列表唯一接口=/v1/models） |
| GET | `/llm/vision/models` | List Vision Models | 仪表盘+客户端文档 |  |
| PUT | `/llm/vision/model` | Set Vision Model | 仪表盘+客户端文档 |  |
| GET | `/llm/providers` | List Providers | 仪表盘+客户端文档 |  |
| GET | `/llm/providers/{provider_key}` | Get Provider Config | 仪表盘+客户端文档 |  |
| PUT | `/llm/providers/{provider_key}` | Update Provider Config | 仪表盘+客户端文档 |  |
| DELETE | `/llm/providers/{provider_key}` | Delete Provider Endpoint | 仪表盘+客户端文档 |  |
| POST | `/llm/providers/{provider_key}/toggle` | Toggle Provider Endpoint | 仪表盘+客户端文档 |  |
| POST | `/llm/providers/{provider_key}/fetch-models` | Fetch Models Endpoint | 仪表盘+客户端文档 |  |
| POST | `/llm/providers/{provider_key}/default-model` | Set Default Model Endpoint | 仪表盘+客户端文档 |  |
| GET | `/llm/templates` | Provider Templates | 仪表盘+客户端文档 |  |
| POST | 🆕 `/llm/vision/ask` | Vision Ask | — |  |
| GET | 🆕 `/llm/images/{name}` | Serve Llm Image | — |  |
| GET | `/llm/stats` | Llm Stats | 仪表盘+客户端文档 |  |
| GET | `/llm/records` | Llm Records | 仪表盘+客户端文档 |  |
| POST | 🆕 `/llm/keys/issue` | Llm Key Issue | — |  |
| GET | 🆕 `/llm/access-info` | Llm Access Info | — |  |
| GET | 🆕 `/llm/keys` | Llm Key List | — |  |
| DELETE | 🆕 `/llm/keys/{key_id}` | Llm Key Revoke | — |  |

### MCP（1）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | 🆕 `/.well-known/mcp.json` | Mcp Discovery | — |  |

### MG 动画（11）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/mg/templates` | List Templates | 客户端文档 |  |
| POST | `/mg/templates` | Create Template | 客户端文档 |  |
| GET | `/mg/templates/{template_id}` | Get Template | 客户端文档 |  |
| PUT | `/mg/templates/{template_id}` | Update Template | 客户端文档 |  |
| DELETE | `/mg/templates/{template_id}` | Delete Template | 客户端文档 |  |
| POST | `/mg/preview` | Mg Preview | 客户端文档 |  |
| POST | `/mg/cover` | Mg Cover | 客户端文档 |  |
| POST | `/mg/generate` | Generate Mg | 客户端文档 |  |
| GET | `/mg/status/{task_id}` | Mg Status | 客户端文档 |  |
| GET | `/mg/result/{task_id}` | Mg Result | 客户端文档 |  |
| POST | `/mg/analyze-video` | Analyze Video | 客户端文档 |  |

### Ollama（10）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/ollama/status` | Model Status | 无调用证据 |  |
| POST | `/ollama/chat` | Chat | 服务端内部+客户端文档 |  |
| GET | `/ollama/models` | List Models | 客户端文档 |  |
| POST | `/ollama/pull` | Pull Model | 客户端文档 |  |
| POST | `/ollama/load` | Load Model | 客户端文档 |  |
| POST | `/ollama/unload` | Unload Model | 客户端文档 |  |
| POST | `/ollama/switch-gpu` | Switch Gpu | 无调用证据 |  |
| GET | `/ollama/source` | Get Source | 仪表盘 |  |
| POST | `/ollama/source` | Set Source | 仪表盘 |  |
| GET | 🆕 `/ollama/ping` | Ollama Ping | — |  |

### RunningHub（18）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/runninghub/status` | Rh Status | 仪表盘+客户端文档 |  |
| POST | `/runninghub/workflows` | Rh Workflows | 仪表盘+客户端文档 |  |
| GET | `/runninghub/config` | Rh Config | 仪表盘+客户端文档 |  |
| PUT | `/runninghub/config` | Rh Config Update | 仪表盘+客户端文档 |  |
| POST | `/runninghub/workflow` | Rh Workflow Create | 仪表盘+客户端文档 |  |
| PUT | `/runninghub/workflow/{workflow_id}` | Rh Workflow Update | 仪表盘+客户端文档 |  |
| DELETE | `/runninghub/workflow/{workflow_id}` | Rh Workflow Delete | 仪表盘+客户端文档 |  |
| POST | `/runninghub/workflow/{workflow_id}/json` | Rh Workflow Json | 仪表盘+客户端文档 |  |
| POST | `/runninghub/workflow/{workflow_id}/nodes` | Rh Workflow Nodes | 仪表盘+客户端文档 |  |
| POST | `/runninghub/workflow/from-url` | Rh Workflow Create From Url | 仪表盘+客户端文档 |  |
| POST | `/runninghub/workflow/{workflow_id}/refresh` | Rh Workflow Refresh | 仪表盘+客户端文档 |  |
| POST | `/runninghub/workflow/{workflow_id}/sync-inputs` | Rh Workflow Sync Inputs | 仪表盘+客户端文档 |  |
| POST | `/runninghub/upload` | Rh Upload | 无调用证据 |  |
| POST | `/runninghub/run` | Rh Run | 无调用证据 |  |
| GET | `/runninghub/task/{task_id}` | Rh Task | 无调用证据 |  |
| POST | `/runninghub/comfy/upload` | Rh Comfy Upload | 无调用证据 |  |
| POST | `/runninghub/comfy/submit` | Rh Comfy Submit | 无调用证据 |  |
| GET | `/runninghub/comfy/history/{prompt_id}` | Rh Comfy History | 无调用证据 |  |

### Strata（8）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | 🆕 `/strata/status` | Status | — |  |
| POST | 🆕 `/strata/start` | Start | — |  |
| POST | 🆕 `/strata/stop` | Stop | — |  |
| POST | 🆕 `/strata/profile` | Set Profile | — |  |
| GET | 🆕 `/strata/models` | List Models | — |  |
| GET | 🆕 `/strata/config` | Strata Get Config | — |  |
| PUT | 🆕 `/strata/config` | Strata Set Config | — |  |
| GET | 🆕 `/strata/ping` | Strata Ping | — |  |

### video-replace（7）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | 🆕 `/video-replace/analyze` | Analyze | — |  |
| GET | 🆕 `/video-replace/tasks/{task_id}` | Get Task | — |  |
| POST | 🆕 `/video-replace/tasks/{task_id}/plan` | Submit Plan | — |  |
| GET | 🆕 `/video-replace/tasks/{task_id}/plan` | Get Plan | — |  |
| POST | 🆕 `/video-replace/tasks/{task_id}/cancel` | Cancel | — |  |
| POST | 🆕 `/video-replace/tasks/{task_id}/assemble` | Assemble | — |  |
| GET | 🆕 `/video-replace/tasks` | List Tasks | — |  |

### VSR 去字幕（4）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| POST | `/vsr/detect` | Detect Boxes | 无调用证据 |  |
| POST | `/vsr/analyze` | Analyze Video | 客户端文档 |  |
| GET | `/vsr/result/{task_id}` | Get Result | 服务端内部+客户端文档 |  |
| GET | `/vsr/health` | Health | 无调用证据 |  |

### WeMM向量（2）

| 方法 | 路径 | 说明 | 09-19 证据 | 备注 |
|---|---|---|---|---|
| GET | `/wemm/health` | Health | 客户端文档 |  |
| POST | `/wemm/encode` | Encode | 客户端文档 |  |

## 三、客户端已使用接口（按模块，共 154）

证据列 = 抽样调用点（文件缩写：bundle=dsh-tintin-bundle，media=dsh-tintin-media-bundle，ops=dsh-tintin-ops-bundle，creation=dsh-tintin-creation-bundle，cover=dsh-tintin-cover-plugin，channel=dsh-plugin-desktop-tintin，shared=dsh-tintin-shared，film-src=OpenFilm shell 源码，rt-*=运行时包）；×N 为同类证据计数。

### (untagged)（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/guide` | Api Guide | dsh-tintin-shared/lib: server-proxy.js:127（decl×3） |

### 产品资料库（21）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/api/product-library/items` | List Items | dsh-plugin-desktop-tintin/src: main-hook.ts:489；dsh-plugin-desktop-tintin/src: main-hook.ts:498 |
| POST | `/api/product-library/items` | Create Item | dsh-plugin-desktop-tintin/src: main-hook.ts:489；dsh-plugin-desktop-tintin/src: main-hook.ts:498 |
| POST | `/api/product-library/clients/{machine_id}/items` | Create Item | dsh-tintin-ops-bundle/src: 322 |
| GET | `/api/product-library/items/{item_id}` | Get Item | dsh-tintin-media-bundle/src: ProductSixViewAside.vue:42；dsh-tintin-media-bundle/src: useImitationVideo.ts:484（code×4） |
| PUT | `/api/product-library/items/{item_id}` | Update Item | dsh-tintin-media-bundle/src: ProductSixViewAside.vue:42；dsh-tintin-media-bundle/src: useImitationVideo.ts:484（code×4） |
| DELETE | `/api/product-library/items/{item_id}` | Delete Item | dsh-tintin-media-bundle/src: ProductSixViewAside.vue:42；dsh-tintin-media-bundle/src: useImitationVideo.ts:484（code×4） |
| GET | `/api/product-library/clients/{machine_id}/items/{item_id}` | Get Item | dsh-tintin-ops-bundle/src: 448 |
| PUT | `/api/product-library/clients/{machine_id}/items/{item_id}` | Update Item | dsh-tintin-ops-bundle/src: useOpsProductLibrary.ts:226 |
| DELETE | `/api/product-library/clients/{machine_id}/items/{item_id}` | Delete Item | dsh-tintin-ops-bundle/src: useOpsProductLibrary.ts:250 |
| POST | 🆕 `/api/product-library/items/{item_id}/views/assemble` | Assemble Product Views | dsh-tintin-ops-bundle/src: useOpsProductLibrary.ts:473；dsh-tintin-ops-bundle/test: tintin-ops-product-library-upload.test.ts:119（test×1） |
| GET | 🆕 `/api/product-library/items/{item_id}/views` | Get Product Views | dsh-tintin-media-bundle/src: useImitationVideo.ts:499；dsh-tintin-media-bundle/src: useImitationVideo.ts:514（code×5,test×3） |
| POST | 🆕 `/api/product-library/items/{item_id}/views/{view}/upload` | Upload Product View | dsh-tintin-media-bundle/src: useImitationVideo.ts:499；dsh-tintin-ops-bundle/src: useOpsProductLibrary.ts:544（test×2） |
| DELETE | 🆕 `/api/product-library/items/{item_id}/views/{view}` | Delete Product View | dsh-tintin-media-bundle/src: useImitationVideo.ts:514；dsh-tintin-ops-bundle/src: useOpsProductLibrary.ts:473（code×3,test×1） |
| POST | 🆕 `/api/product-library/import` | Import Products | dsh-tintin-ops-bundle/src: useOpsProductLibrary.ts:602；dsh-tintin-ops-bundle/test: tintin-ops-product-library-upload.test.ts:52（test×2） |
| GET | `/api/product-library/search` | Search | dsh-tintin-media-bundle/src: useWorkbenchPickers.ts:111；dsh-tintin-creation-bundle/src: creationServer.ts:52（code×4） |
| GET | `/api/product-library/clients/{machine_id}/search` | Search | dsh-tintin-media-bundle/src: useWorkbenchPickers.ts:95；dsh-tintin-ops-bundle/src: search`） |
| GET | `/api/product-library/clients/{machine_id}/grouped` | Grouped | dsh-tintin-media-bundle/src: useWorkbenchPickers.ts:66；dsh-tintin-ops-bundle/src: useOpsProductLibrary.ts:131（另 useWorkbenchPickers.ts:66） |
| POST | `/api/product-library/clients/{machine_id}/sync` | Trigger Sync | dsh-tintin-ops-bundle/src: useOpsProductLibrary.ts:272 |
| GET | `/api/product-library/clients/{machine_id}/sync/status` | Sync Status | dsh-tintin-ops-bundle/src: useOpsProductLibrary.ts:285 |
| POST | `/api/product-library/clients/{machine_id}/mine` | Trigger Mine | dsh-tintin-ops-bundle/src: 407 |
| GET | `/api/product-library/clients/{machine_id}/mine/status` | Mine Status | dsh-tintin-ops-bundle/src: 420 |

### 定时任务（5）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/scheduled/tasks` | Create Task | dsh-tintin-media-bundle/src: useImitationMontage.ts:48；dsh-tintin-shared/lib: server-proxy.js:124（decl×3） |
| GET | `/scheduled/tasks` | List Tasks | dsh-tintin-media-bundle/src: useImitationMontage.ts:48；dsh-tintin-shared/lib: server-proxy.js:124（decl×3） |
| GET | `/scheduled/tasks/{task_id}` | Get Task | dsh-tintin-media-bundle/src: context.ts:148；dsh-tintin-media-bundle/src: useCopywritingMontageStep2Concat.ts:554（code×4,decl×3） |
| PUT | `/scheduled/tasks/{task_id}` | Update Task | dsh-tintin-media-bundle/src: context.ts:148；dsh-tintin-media-bundle/src: useCopywritingMontageStep2Concat.ts:554（code×4,decl×3） |
| DELETE | `/scheduled/tasks/{task_id}` | Delete Task | dsh-tintin-media-bundle/src: context.ts:148；dsh-tintin-media-bundle/src: useCopywritingMontageStep2Concat.ts:554（code×4,decl×3） |

### 多平台下载（2）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/material/web_download` | Web Download | dsh-tintin-shared/lib: server-proxy.js:103 |
| GET | `/material/web_download/{task_id}` | Web Download Status | dsh-tintin-shared/lib: server-proxy.js:103；dsh-tintin-bundle/test: tintin-bridge.test.ts:90（test×1） |

### 分镜脚本（17）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/api/storyboard/scripts` | Save Script | dsh-tintin-media-bundle/src: useCopywritingMontageStep3Voice.ts:851；dsh-tintin-media-bundle/src: useCopywritingMontageStep3Voice.ts:960（code×7,decl×5） |
| GET | `/api/storyboard/scripts` | List Scripts | dsh-tintin-media-bundle/src: useCopywritingMontageStep3Voice.ts:851；dsh-tintin-media-bundle/src: useCopywritingMontageStep3Voice.ts:960（code×7,decl×5） |
| GET | `/api/storyboard/scripts/{script_id}` | Get Script | dsh-tintin-media-bundle/src: CopywritingStep2Panel.vue:419；dsh-tintin-media-bundle/src: ImitationFxStep.vue:57（code×6,decl×6） |
| PUT | `/api/storyboard/scripts/{script_id}` | Update Script | dsh-tintin-media-bundle/src: CopywritingStep2Panel.vue:419；dsh-tintin-media-bundle/src: ImitationFxStep.vue:57（code×6,decl×6） |
| DELETE | `/api/storyboard/scripts/{script_id}` | Delete Script | dsh-tintin-media-bundle/src: CopywritingStep2Panel.vue:419；dsh-tintin-media-bundle/src: ImitationFxStep.vue:57（code×6,decl×6） |
| PUT | 🆕 `/api/storyboard/scripts/{script_id}/shots/{name}/frames` | Put Shot Frames | dsh-tintin-media-bundle/src: useImitationVideo.ts:340（upload 形态 PUT）（decl×3） |
| PUT | 🆕 `/api/storyboard/scripts/{script_id}/draft/confirm` | Confirm Storyboard Draft | dsh-tintin-media-bundle/src: useImitationVideo.ts:303（decl×3） |
| POST | 🆕 `/api/storyboard/scripts/{script_id}/distribute-voiceover` | Distribute Voiceover To Shots | dsh-tintin-media-bundle/src: useImitationTts.ts:169（decl×3） |
| POST | 🆕 `/api/storyboard/scripts/{script_id}/rewrite-visuals` | Rewrite Script Visuals | dsh-tintin-media-bundle/src: useImitationTts.ts:190（decl×3） |
| POST | 🆕 `/api/storyboard/scripts/{script_id}/adopt-copy` | Adopt Copy | dsh-tintin-media-bundle/src: useImitationTts.ts:134 |
| GET | 🆕 `/api/storyboard/scripts/{script_id}/storyboard-pack` | Get Storyboard Pack | dsh-tintin-media-bundle/src: useImitationVideo.ts:113（decl×3） |
| GET | 🆕 `/api/storyboard/scripts/{script_id}/storyboard-grid` | Get Storyboard Grid | dsh-tintin-media-bundle/src: imitationVideoLogic.ts:782（decl×3） |
| GET | 🆕 `/api/storyboard/scripts/{script_id}/six-view/file/{view}` | Get Six View File | dsh-tintin-media-bundle/src: imitationVideoLogic.ts:248；dsh-tintin-media-bundle/test: tintin-imitation-video-logic.test.ts:367（test×3） |
| GET | 🆕 `/api/storyboard/scripts/{script_id}/shots/{name}/frames/{which}` | Get Shot Frame | dsh-tintin-media-bundle/src: ImitationVideo.vue:714 |
| POST | 🆕 `/api/storyboard/scripts/product-upload` | Product Upload | dsh-tintin-cover-plugin/lib: cover-tools-mcp.js:94；dsh-tintin-cover-plugin/test: tintin-cover-tools-mcp.test.ts:172（test×1） |
| POST | 🆕 `/api/storyboard/scripts/imitate/upload` | Imitate Upload | dsh-tintin-media-bundle/src: useImitationVideo.ts:154（decl×3） |
| POST | 🆕 `/api/storyboard/scripts/imitate` | Imitate Import | dsh-tintin-media-bundle/src: useImitationVideo.ts:192（API_PATHS.storyboard.imitate）（decl×3） |

### 工作流（2）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/workflows` | List Workflows | dsh-tintin-bundle/client.js: client.js:540；dsh-tintin-bundle/client.js: client.js:551 |
| GET | `/workflows/task/{task_id}` | Task Status | dsh-tintin-bundle/client.js: client.js:553 |

### 花字（2）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/fancy/templates` | List Templates | dsh-tintin-bundle/lib: final-ipc.js:1340；dsh-tintin-bundle/lib: voice-ipc.js:636 |
| POST | `/fancy/templates` | Import Templates | dsh-tintin-bundle/lib: final-ipc.js:1340；dsh-tintin-bundle/lib: voice-ipc.js:636 |

### 剪辑引擎（5）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/editor/render` | Render | dsh-tintin-shared/lib: server-proxy.js:126；dsh-tintin-shared/lib: server-proxy.js:126（decl×3） |
| GET | `/editor/render/{task_id}` | Render Status | dsh-tintin-shared/lib: server-proxy.js:126；dsh-tintin-shared/lib: server-proxy.js:126（decl×3） |
| GET | `/editor/render/{task_id}/package` | Package Task | dsh-tintin-shared/lib: server-proxy.js:126（decl×3） |
| POST | `/editor/export/jianying/{draft_id}` | Export Jianying | dsh-tintin-bundle/lib: final-ipc.js:1634 |
| POST | `/editor/export/jianying/from-task/{task_id}` | Export Jianying From Task | dsh-tintin-bundle/lib: final-ipc.js:1634（动态拼接，人工复核） |

### 剪映预设（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | 🆕 `/jianying_presets/text_v2` | Text V2 Pack | dsh-tintin-bundle/lib: jianying-preset-install.js:131 |

### 节点工作流引擎（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/workflow/plan` | Make Plan | dsh-tintin-bundle/lib: agent-tools.js:98；dsh-tintin-bundle/test: tintin-agent-tools.test.ts:62（test×1） |

### 客户端技能（4）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/skills` | Skill List | dsh-tintin-bundle/lib: plugin.js:209；dsh-tintin-creation-bundle/src: SkillManager.vue:68（code×7） |
| POST | `/skills` | Skill Register | dsh-tintin-bundle/lib: plugin.js:209；dsh-tintin-creation-bundle/src: SkillManager.vue:68（code×7） |
| DELETE | `/skills/{skill_id}` | Skill Unregister | dsh-tintin-shared/lib: server-proxy.js:125；dsh-plugin-desktop-tintin/tintin-resources: skills.test.mjs:286（code×12） |
| GET | 🆕 `/skills/{skill_id}/download` | Skill Download | dsh-tintin-shared/lib: skills-install.js:58 |

### 口播文案（3）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/copywriting/voiceover` | Voiceover | dsh-tintin-bundle/client.js: client.js:475；dsh-tintin-creation-bundle/src: creationServer.ts:167（code×3,test×1,decl×3） |
| GET | 🆕 `/copywriting/platforms` | Platforms | dsh-tintin-creation-bundle/src: creationServer.ts:145；dsh-tintin-media-bundle/test: tintin-copywriting-voiceover-variants.test.ts:17（test×1,decl×3） |
| GET | 🆕 `/copywriting/formulas` | Formulas | dsh-tintin-creation-bundle/src: creationServer.ts:138（decl×1） |

### 模板目录（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/templates/catalog` | Templates Catalog | dsh-tintin-bundle/lib: final-ipc.js:1316 |

### 模板统一（5）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/templates` | List Templates | dsh-tintin-bundle/lib: final-ipc.js:1316；dsh-tintin-cover-plugin/src: App.tsx:10（code×8） |
| POST | `/templates` | Create Tpl | dsh-tintin-bundle/lib: final-ipc.js:1316；dsh-tintin-cover-plugin/src: App.tsx:10（code×8） |
| GET | `/templates/{template_id}` | Get Tpl | dsh-tintin-bundle/lib: final-ipc.js:1316；dsh-plugin-desktop-tintin/tintin-resources: templates.json:79（code×12） |
| PUT | `/templates/{template_id}` | Update Tpl | dsh-tintin-bundle/lib: final-ipc.js:1316；dsh-plugin-desktop-tintin/tintin-resources: templates.json:79（code×12） |
| DELETE | `/templates/{template_id}` | Delete Tpl | dsh-tintin-bundle/lib: final-ipc.js:1316；dsh-plugin-desktop-tintin/tintin-resources: templates.json:79（code×12） |

### 任务队列（5）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/tasks/unified/{task_id}` | Unified Task | dsh-tintin-bundle/client.js: client.js:508；dsh-tintin-bundle/lib: openfilm-tools.js:149（code×4,test×5,decl×3） |
| GET | `/tasks` | List Tasks | dsh-tintin-shared/lib: server-proxy.js:121 |
| POST | `/tasks/batch_cancel` | Batch Cancel Tasks | dsh-tintin-creation-bundle/src: creationServer.ts:105（decl×1） |
| GET | `/tasks/{task_id}` | Get Task | dsh-tintin-bundle/client.js: client.js:507；dsh-tintin-media-bundle/src: useVsrRemoval.ts:209（code×4,test×1,decl×7） |
| DELETE | `/tasks/{task_id}` | Cancel Task | dsh-tintin-bundle/client.js: client.js:507；dsh-tintin-media-bundle/src: useVsrRemoval.ts:209（code×4,test×1,decl×7） |

### 声音样本（2）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/voice/samples` | List Samples | dsh-tintin-bundle/client.js: client.js:477；dsh-tintin-bundle/lib: openfilm-tools.js:194（code×4,test×1,decl×3） |
| POST | `/voice/samples` | Create Sample | dsh-tintin-bundle/client.js: client.js:477；dsh-tintin-bundle/lib: openfilm-tools.js:194（code×4,test×1,decl×3） |

### 视频配置（6）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/config/luts` | List Luts | dsh-tintin-bundle/lib: final-ipc.js:1306 |
| POST | `/config/luts` | Upload Lut | dsh-tintin-bundle/lib: final-ipc.js:1306 |
| GET | `/config/fonts` | List Fonts | dsh-tintin-bundle/lib: jianying-fonts-ipc.js:75；dsh-tintin-bundle/lib: jianying-fonts-ipc.js:126（code×4） |
| GET | `/config/fonts/{font_id}/file` | Download Font File | dsh-tintin-bundle/lib: voice-ipc.js:842 |
| POST | `/config/fonts/upload` | Upload Font | dsh-tintin-bundle/lib: jianying-fonts-ipc.js:101 |
| DELETE | `/config/fonts/{font_id}` | Delete Font | dsh-tintin-bundle/lib: jianying-fonts-ipc.js:101 |

### 素材管理（9）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/material/distinct` | Distinct Field | dsh-tintin-media-bundle/src: useWorkbenchPickers.ts:152；dsh-tintin-ops-bundle/src: opsMaterialPickerData.ts:184 |
| GET | `/material/list` | List Materials | dsh-tintin-bundle/client.js: client.js:509；dsh-tintin-media-bundle/src: useWorkbenchPickers.ts:142（code×5,test×4,decl×3） |
| POST | `/material/search` | Search Materials | dsh-tintin-media-bundle/src: useOpsStoryboard.ts:268；dsh-tintin-shared/lib: server-proxy.js:101（decl×3） |
| POST | 🆕 `/material/usage/report` | Material Usage Report | dsh-tintin-media-bundle/src: useCopywritingMontageStep4Final.ts:105 |
| GET | `/material/serve` | Serve File | dsh-tintin-media-bundle/src: CopywritingStep2Panel.vue:316；dsh-tintin-media-bundle/src: ImitationMontageStep.vue:61（code×6,test×5,decl×1） |
| GET | `/material/thumbnail` | Get Thumbnail | dsh-tintin-media-bundle/src: opsProductLibraryLogic.ts:356；dsh-tintin-ops-bundle/src: opsProductLibraryLogic.ts:356（test×4） |
| POST | `/material/scan` | Scan Directory | dsh-tintin-shared/lib: server-proxy.js:104 |
| POST | `/material/enqueue_analysis` | Enqueue Analysis | dsh-tintin-shared/lib: server-proxy.js:104 |
| POST | `/material/ocr` | Ocr Image | dsh-tintin-bundle/client.js: client.js:586；dsh-tintin-cover-plugin/lib: cover-tools-mcp.js:180（code×5,decl×3） |

### 提示词（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/prompt/image` | Image Prompt | dsh-tintin-bundle/lib: openfilm-tools.js:412；dsh-tintin-media-bundle/src: ReversePromptImage.vue:101 |

### 图片工具（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | 🆕 `/image/text-remove` | Text Remove | dsh-tintin-cover-plugin/lib: cover-tools-mcp.js:203；dsh-tintin-cover-plugin/test: tintin-cover-tools-mcp.test.ts:239（test×1） |

### 文字模板（3）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/text_templates/templates` | Get Templates | dsh-tintin-bundle/lib: jianying-templates.js:203；dsh-tintin-bundle/lib: final-ipc.js:1521（code×5） |
| POST | `/text_templates/templates` | Upload Template | dsh-tintin-bundle/lib: jianying-templates.js:203；dsh-tintin-bundle/lib: final-ipc.js:1521（code×5） |
| POST | `/text_templates/render-preview` | Render Preview | dsh-tintin-bundle/lib: final-ipc.js:83 |

### 系统（4）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/system/license` | License Status | dsh-tintin-shared/lib: server-proxy.js:127（decl×3） |
| GET | `/system/license/machine-id` | Machine Id | dsh-tintin-shared/lib: server-proxy.js:127（decl×3） |
| GET | 🆕 `/system/kb/status` | Kb Control Status | dsh-tintin-ops-bundle/src: OtKbQaPanel.vue:32 |
| GET | `/health` | Health | dsh-tintin-bundle/lib: jianying-audio-sync.js:136；dsh-tintin-bundle/lib: voice-tts-logic.js:258 |

### 系统日志（2）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/api/logs/upload` | Upload Failure Log | dsh-tintin-bundle/lib: channel-table.js:561 |
| GET | `/api/logs` | Get Logs | dsh-tintin-bundle/lib: channel-table.js:561 |

### 音频卡点（13）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/audio/beatmap` | Beatmap | dsh-tintin-bundle/lib: openfilm-tools.js:306 |
| GET | `/audio/library` | Audio Library List | dsh-tintin-bundle/lib: final-ipc.js:1134；dsh-tintin-bundle/lib: final-ipc.js:1153（code×9） |
| GET | `/audio/categories` | Audio Categories | dsh-tintin-media-bundle/src: useAudioGen.ts:473；dsh-tintin-media-bundle/src: useWorkbenchPickers.ts:173（code×3） |
| GET | `/audio/library/{audio_id}` | Audio Library Detail | dsh-tintin-bundle/lib: jianying-audio-sync.js:160；dsh-tintin-bundle/lib: final-ipc.js:1559（code×4） |
| PUT | `/audio/library/{audio_id}` | Audio Library Update | dsh-tintin-bundle/lib: jianying-audio-sync.js:160；dsh-tintin-bundle/lib: final-ipc.js:1559（code×4） |
| DELETE | `/audio/library/{audio_id}` | Audio Library Delete | dsh-tintin-bundle/lib: jianying-audio-sync.js:160；dsh-tintin-bundle/lib: final-ipc.js:1559（code×4） |
| GET | `/audio/library/{audio_id}/file` | Audio Library File | dsh-tintin-media-bundle/src: ImitationFxStep.vue:63；dsh-tintin-media-bundle/src: useCopywritingMontageBgmGen.ts:92（code×3） |
| POST | `/audio/library/upload` | Audio Library Upload | dsh-tintin-bundle/lib: jianying-audio-sync.js:160；dsh-tintin-bundle/lib: final-ipc.js:1559（code×3） |
| POST | `/audio/gen/bgm` | Audio Gen Bgm | dsh-tintin-bundle/client.js: client.js:511；dsh-tintin-bundle/lib: openfilm-tools.js:329（code×3,test×1,decl×3） |
| POST | `/audio/gen/sfx` | Audio Gen Sfx | dsh-tintin-bundle/client.js: client.js:512；dsh-tintin-bundle/lib: openfilm-tools.js:353（code×3） |
| POST | `/audio/library/{audio_id}/analyze` | Audio Library Analyze | dsh-tintin-media-bundle/src: useAudioGen.ts:337 |
| GET | `/audio/bgm/tags` | Audio Bgm Tags | dsh-tintin-media-bundle/src: useAudioGen.ts:189 |
| POST | `/audio/bgm/upload` | Audio Bgm Upload | dsh-tintin-bundle/lib: media-proxy.js:171；dsh-tintin-shared/lib: server-proxy.js:107（test×1） |

### 音效库（3）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/sfx/library` | List Sfx | dsh-tintin-media-bundle/src: CopywritingStep4Panel.vue:149；dsh-tintin-media-bundle/src: ImitationFxPackPanel.vue:141 |
| DELETE | `/sfx/{sfx_id}` | Delete Sfx | dsh-tintin-media-bundle/src: CopywritingStep4Panel.vue:149；dsh-tintin-media-bundle/src: ImitationFxPackPanel.vue:141（code×5） |
| GET | `/sfx/{sfx_id}/file` | Get Sfx File | dsh-tintin-media-bundle/src: CopywritingStep4Panel.vue:238；dsh-tintin-media-bundle/src: ImitationFxPackPanel.vue:230 |

### 语义生成（3）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | 🆕 `/generate/image` | Generate Image | dsh-tintin-bundle/lib: openfilm-tools.js:492；dsh-tintin-cover-plugin/lib: cover-background.js:41（test×2,decl×1） |
| POST | 🆕 `/generate/video` | Generate Video | dsh-tintin-bundle/lib: openfilm-tools.js:522；dsh-tintin-bundle/test: tintin-openfilm-tools.test.ts:84（test×2,decl×1） |
| POST | 🆕 `/generate/cover` | Generate Cover | dsh-tintin-cover-plugin/lib: cover-tools-mcp.js:289；dsh-tintin-cover-plugin/test: tintin-cover-tools-mcp.test.ts:175（test×1） |

### 在线素材（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/material/stock_search` | Stock Search | dsh-tintin-bundle/client.js: client.js:510；dsh-tintin-bundle/lib: openfilm-tools.js:379（code×3,decl×3） |

### 智能混剪（5）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/montage/split` | Split Video | dsh-tintin-shared/lib: server-proxy.js:106（decl×3） |
| POST | `/montage/concat` | Montage Concat | dsh-tintin-bundle/client.js: client.js:583；dsh-tintin-bundle/lib: final-ipc.js:598（code×3,decl×3） |
| GET | 🆕 `/montage/split/analysis/{task_id}` | Split Analysis Pickup | dsh-tintin-bundle/client.js: client.js:576 |
| GET | `/montage/concat/result/{task_id}` | Concat Result | dsh-tintin-bundle/lib: final-ipc.js:607；dsh-tintin-media-bundle/src: useCopywritingMontageStep2Concat.ts:482（code×4） |
| POST | `/montage/bgm` | Montage Add Bgm | dsh-tintin-bundle/client.js: client.js:584；dsh-tintin-shared/lib: server-proxy.js:106（decl×3） |

### 智能体化（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/agent/registry` | Agent Registry | dsh-tintin-bundle/lib: openfilm-tools.js:542；dsh-tintin-shared/lib: server-proxy.js:118（test×1,decl×3） |

### 字幕样式库（3）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/subtitle_styles` | List Styles | dsh-tintin-bundle/lib: final-ipc.js:1383；dsh-tintin-bundle/lib: voice-ipc.js:857（test×1） |
| POST | `/subtitle_styles` | Create Style | dsh-tintin-bundle/lib: final-ipc.js:1383；dsh-tintin-bundle/lib: voice-ipc.js:857（test×1） |
| GET | `/subtitle_styles/{sid}/preview.png` | Preview Style | dsh-tintin-bundle/lib: final-ipc.js:689（客户端按 id 构造预览 URL） |

### AI 一键成片（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/montage/auto` | Auto Oneclick | dsh-tintin-shared/lib: server-proxy.js:106 |

### AI抠图（2）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/matting/models` | Matting Models | dsh-tintin-bundle/client.js: client.js:501；dsh-tintin-shared/lib: server-proxy.js:110（decl×3） |
| POST | `/matting` | Matting Remove Background | dsh-tintin-bundle/lib: media-proxy.js:36；dsh-tintin-cover-plugin/lib: cover-plugin-route.js:602（code×4,test×1,decl×3） |

### CLIP向量（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/clip/health` | Health | dsh-tintin-client-ui/client.js: client.js:25 |

### comfygen 服务接入（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | 🆕 `/comfygen/jobs` | comfygen 任务列表（服务接入，只读） | dsh-tintin-media-bundle/src: ImitationVideo.vue:825 |

### ComfyUI（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/comfyui/run` | 提交 ComfyUI 工作流 | dsh-tintin-bundle/lib: openfilm-tools.js:433 |

### IndexTTS（3）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/indextts/qwen3/voices` | Qwen3 Voices | dsh-tintin-bundle/client.js: client.js:478；dsh-tintin-bundle/lib: openfilm-tools.js:201（code×3,test×1） |
| GET | `/indextts/health` | Health | dsh-tintin-client-ui/client.js: client.js:26 |
| POST | `/indextts/tts` | Tts | dsh-tintin-bundle/lib: openfilm-tools.js:244；dsh-tintin-shared/lib: server-proxy.js:98（test×3,decl×3） |

### LLM大模型（1）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/llm/chat/completions` | Chat Completions | dsh-tintin-bundle/client.js: client.js:473；dsh-tintin-bundle/lib: agent-tools.js:55（code×3,decl×3） |

### MCP（2）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | 🆕 `/mcp` | Mcp Get | dsh-tintin-cover-plugin/lib: cover-plugin-route.js:374；dsh-tintin-cover-plugin/lib: cover-plugin-route.js:390（code×4） |
| POST | 🆕 `/mcp` | Mcp Post | dsh-tintin-cover-plugin/lib: cover-plugin-route.js:374；dsh-tintin-cover-plugin/lib: cover-plugin-route.js:390（code×4） |

### OpenAI Compatible（6）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/v1/models` | List Models | dsh-tintin-bundle/client.js: client.js:474；dsh-tintin-shared/lib: server-proxy.js:95 |
| POST | `/v1/chat/completions` | Chat Completions | dsh-plugin-desktop-tintin/tintin-resources: get.test.mjs:299；dsh-plugin-desktop-tintin/tintin-resources: get.test.mjs:316（code×12） |
| POST | 🆕 `/v1/responses` | Responses Api | dsh-plugin-desktop-tintin/tintin-resources: get.test.mjs:55；dsh-plugin-desktop-tintin/tintin-resources: openai.mjs:188（code×6,test×2） |
| POST | 🆕 `/v1/images/generations` | Images Generations | dsh-plugin-desktop-tintin/tintin-resources: openai.mjs:148；dsh-plugin-desktop-tintin/tintin-resources: openai.test.mjs:49（code×4） |
| POST | `/v1/audio/transcriptions` | Transcriptions | dsh-plugin-desktop-tintin/tintin-resources: get.test.mjs:549；dsh-plugin-desktop-tintin/tintin-resources: openai.mjs:173（code×6） |
| POST | `/v1/audio/speech` | Speech | dsh-plugin-desktop-tintin/tintin-resources: get.test.mjs:567；dsh-plugin-desktop-tintin/tintin-resources: openai.mjs:90（code×4） |

### VSR 去字幕（2）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| POST | `/vsr/remove` | Remove Subtitle | dsh-tintin-bundle/lib: media-proxy.js:104；dsh-tintin-shared/lib: server-proxy.js:109（decl×3） |
| GET | `/vsr/download/{filename}` | Download Result | dsh-tintin-media-bundle/src: vsrQuadLogic.ts:420 |

### Whisper（2）

| 方法 | 路径 | 说明 | 调用证据（抽样） |
|---|---|---|---|
| GET | `/whisper/health` | Health | dsh-tintin-client-ui/client.js: client.js:27 |
| POST | `/whisper/transcribe` | Transcribe | dsh-tintin-bundle/lib: voice-ipc.js:470；dsh-tintin-bundle/lib: openfilm-tools.js:267（code×3,test×1,decl×3） |

## 四、与 09-19 盘点的差异

### 4.1 客户端侧由「确认使用」转为无调用（36）

| 方法 | 路径 | 备注 |
|---|---|---|
| POST | `/system/license/register` | license 面客户端已无调用（server-proxy 仅留 /system/license 基座） |
| GET | `/system/license/status` | 同上 |
| GET | `/system/license/clients` | 同上 |
| PUT | `/system/license/clients/config` | 同上 |
| DELETE | `/system/license/clients/{machine_id}` | 同上 |
| GET | `/audio/library/{audio_id}/analysis` | 未接线（在用的是 POST /audio/library/{id}/analyze 触发分析） |
| POST | `/audio/library/analyze_all` | 未接线 |
| POST | `/audio/library/seed` | 未接线 |
| POST | `/audio/library/import` | 未接线 |
| GET | `/api/product-library/clients/{machine_id}/items` | 需确认是否为客户端功能变更后的正常退役 |
| POST | `/api/product-library/clients/{machine_id}/upsert` | 同上 |
| POST | `/api/product-library/clients/{machine_id}/apply-categories` | base() 追加面外（useOpsProductLibrary.ts 全量核对） |
| GET | `/api/product-library/clients/{machine_id}/categories` | 同上 |
| GET | `/api/product-library/clients/{machine_id}/brands` | 同上 |
| GET | `/api/product-library/grouped` | 客户端只用 clients/{machine_id} 作用域（1009 裁决：views/列表走机器作用域） |
| GET | `/api/product-library/items/{item_id}/prompt` | 需确认是否为客户端功能变更后的正常退役 |
| GET | `/api/product-library/clients/{machine_id}/items/{item_id}/prompt` | 同上 |
| POST | `/api/product-library/items/{item_id}/keywords/generate` | 09-19 曾确认，现客户端无调用（关键词生成未接线） |
| POST | `/api/product-library/clients/{machine_id}/items/{item_id}/keywords/generate` | 同上 |
| GET | `/config/luts/{lut_id}/file` | LUT 应用走服务端合成，客户端不取原文件 |
| DELETE | `/config/luts/{lut_id}` | 客户端只用集合 GET /config/luts（final-ipc.js:1306），按 id 管理未接线 |
| POST | `/config/luts/match` | 未接线 |
| POST | `/config/fonts/scan` | 未接线 |
| GET | `/subtitle_styles/preview.png` | 未接线（按 id 的预览在用，见第三节） |
| GET | `/subtitle_styles/{sid}` | 客户端只用集合 GET /subtitle_styles（voice-ipc.js:857） |
| PUT | `/subtitle_styles/{sid}` | 同上 |
| DELETE | `/subtitle_styles/{sid}` | 同上 |
| GET | `/voice/samples/{sid}` | 仅测试 mock 引用；运行时只用集合 GET /voice/samples |
| PUT | `/voice/samples/{sid}` | 同上 |
| DELETE | `/voice/samples/{sid}` | 同上 |
| GET | `/text_templates/templates/{template_id}` | 客户端只用集合 GET /text_templates/templates，按 id 端点未接线 |
| DELETE | `/text_templates/templates/{template_id}` | 同上，未接线 |
| GET | `/text_templates/templates/{template_id}/preview` | 预览图直接用列表响应的 preview/preview_webm URL（useCopywritingMontageTextFx.ts:475-477） |
| GET | `/text_templates/templates/{template_id}/preview.webm` | 同上 |
| POST | `/text_templates/templates/{template_id}/assets` | 仅服务端能力注释（jianying-templates.js:494），客户端未接线 |
| DELETE | `/fancy/templates/{template_id}` | 客户端只用集合 GET /fancy/templates（voice-ipc.js:636） |

### 4.2 服务端已下线（09-19 有、1110 无，共 45）

/agent/tasks 族（12）、/agent/sessions 族（5）、/agent/chat、/agent/delegate、/agent/artifacts、/agent/agents、/im/*（12，IM 无人值守族）、/viral/clone/*（10）、POST /v1/embeddings、POST /prompt/video、POST /subtitles/prepare。

### 4.3 值得注意的未使用聚类（收敛评审候选）

- **RunningHub（18）/ ComfyUI（21）/ ComfyUI Apps（5）/ comfygen 服务接入（9，除 /comfygen/jobs、/comfygen/enums）**：推理编排面基本全部仅服务端/仪表盘自用。
- **视频评价（38）/ 平台审核（13）/ 评审打标（7）/ 模板统一（14）/ MG 动画（11）**：整模块客户端零调用。
- **素材管理（42）**：09-19 已标记大量「客户端文档」级证据，本轮客户端仍只在 list/search/serve/ocr/distinct 等少数接口有真实调用。
- **strata（8）/ ollama（10）/ inference node（3）/ models 调度（8）/ 编排（1）**：推理资源治理面，客户端零调用。
- **agent 记忆（3）**：/agent/memory 族为 09-19 后新增，客户端未接。
- **LLM 大模型（20 中 13 未用）**：客户端裁决收敛到 /v1/models + /llm/chat/completions + vision 三件套（2026-10-29），providers/keys 管理面未接。

## 五、方法与复跑

- 扫描/复核脚本：`D:/tmp/tintin-api-audit/{scan.mjs, verify-unused.mjs, gen-doc.mjs}`（仓库外），结果快照 `scan-result.json`。
- 复跑方式：更新 `.tmp-openapi-*.json` 后依次执行三个脚本；人工复核残留需重跑 4.x 差异节。
- 本文档只描述客户端维度；服务端仪表盘/内部调用与收敛裁决仍以服务端 `server/tools/api_inventory.py` 产出为准。