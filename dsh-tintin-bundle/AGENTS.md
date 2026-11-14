# DSH TinTin Bundle（视频剪辑 / OpenFilm）— 领域规则（AGENTS.md）

本文件是**视频剪辑域的开发侧契约**：任何编码智能体在本目录工作前必须先读。批次台账在 [docs/tintin-openfilm-port.md](../docs/tintin-openfilm-port.md)（逐批追加，铁律与事故全在里面）。

## 1. 运行时指令面 vs 开发面

| 面 | 位置 | 注入机制 |
|---|---|---|
| **会话智能体契约** | `resources/skills/openfilm/SKILL.md` | `dsh-plugin-desktop-tintin/src/tintin/film-acp.ts`（`start()` 内 bundled→dev 源回退，拷入 agent home `skills/openfilm/`；同步失败不阻断启动） |
| **会话智能体进程** | `film-acp.ts`（spawn dsh `--profile acp --patch` `ensureFilmAgentPatch`） | 多人设（FilmAgentPersona）分 home/补丁；resume 续接；server.url 缺失=启动报错 |
| **MCP 工具挂载** | `lib/openfilm-tools.js`（`tintin_*` 会话工具族）+ `lib/film-tools.js`（`film_compile`/`film_render`） | 经补丁挂进会话 |
| **开发契约（本文件）** | `AGENTS.md` | 编码智能体进入本目录时发现 |

改 SKILL.md = 改影片会话行为；改本文件 = 改开发纪律。MCP/skill 的注册机制在本包与 film-acp 的代码里，本文件只记录位置。

## 2. 能力面

- **本包=OpenFilm 集成宿主**：`lib/openfilm/`（vendored 运行时适配）、`lib/montage/`（剪辑合成）、`lib/media-proxy.js`（媒体代理）、`lib/jianying/`（剪映通道）、`lib/channel-table.js`/`agent-tools.js`/`loopback-helpers.js`
- **会话 MCP 工具**（`mcp__tintin-bundle__*` 形态，`openfilm-tools.js`）：`tintin_asr`/`tintin_tts`/`tintin_voices`/`tintin_sfx`/`tintin_bgm`/`tintin_beatmap`/`tintin_comfyui`/`tintin_generate_image`/`tintin_generate_video`/`tintin_image_reverse`/`tintin_stock_images`/`tintin_download`/`tintin_task_status`/`tintin_capabilities`——会话内一切生成/检索/轮询走这些，禁止 curl 直调服务端
- **渲染链**：`film-tools.js` `film_render`/`film_compile`（时间轴→成片）
- **服务端**：TinTin 一等 provider（模型实名清单）+ 业务 API；模型/服务能力探测走 `tintin_capabilities`

## 3. OpenFilm 升级与 vendor 铁律（本域最大事故源，逐条有实机背书）

1. **vendor 树补丁重放清单**：上游 OpenFilm 前进 → 补丁按机锚清单重放（现 122 锚，`scripts/tintin-anchors.json` 登记），禁止手改运行时 patch（2026-10-26 安全模式事故固化）
2. **variants 白名单**：能改的文件在清单内，清单外改动=升级即丢
3. **热同步每次 Get-Process 重锚定**（现锚 2303）——锚定基于运行实例，不是上次记录
4. **改代码第一位=完成态提交**，再热同步/打包；CDP 自检法抓完整栈
5. 升级流程与坑（清单末行无换行 while read 吞行、标签对象坑、i18n 双逗号）见台账 §升级机制

## 4. 热同步与载荷

- shell dist：`dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src`（源）→ 构建产物热同步安装版；**skills 整目录补拷**（npm 包产物无 skills/，工作区版才有——fetch-openfilm-runtime 已修）
- 会话真身：`AppData/Local/Programs/TinTin`（win-unpacked 是测试载荷，两者同步路径不同）
- 本地工具 MCP/路由族真源：`lib/openfilm-tools.js`、`lib/film-tools.js`、`lib/montage/`

## 5. 门禁与测试

- `yarn workspace dsh-tintin-bundle test`（vitest）
- `check:tintin`（150 锚/86 文档一致性）+ verify-tintin-gate 行门禁（≤1000 行，超限按域拆不加基线）
- 升级验收：锚点数对账 + 204+ 测试 + CDP 抓栈

## 6. 会话纪律（SKILL.md 同款）

- 工具不可达/失败如实转述，不静默重试；反循环（3 次无进展=停手汇报）
- 长任务（渲染/生成）走 task 轮询工具，预算内如实报进度
