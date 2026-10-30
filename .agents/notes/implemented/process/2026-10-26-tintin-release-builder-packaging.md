# TinTin 打包与运行事实（Release Builder 口径，2026-10-26 用户裁定）

## 打包入口（唯一口径）

- **打包工具：`D:\Project\TinTin_DSH_Release_Builder`**（`run.bat` / `build.js` / `builder.config.json`）。
  - `build.js` 四档模式：1=全新重建（full）／2=快速热调（hot）／3=本地全编（local）／4=全新重建·仅 win-unpacked（unpack，2026-10-19 用户裁决，跳过 NSIS）。
  - 各档最终都走 monorepo 根脚本（`package:tintin:dir:full|hot|local`），产物归档在 `releases\<版本>-dir\win-unpacked\`，版本号形如 `0.2.1-rc.1-20261026-1153`。
- **不要再用 `dsh-plugin-desktop-tintin` 包内脚本口径或 `Programs\TinTin` 安装目录推断打包结果。**

## 运行事实

- **用户从 `releases\*\win-unpacked\TinTin.exe` 直接启动**（build.js cleanup 注释亦认可此用法）。
- `C:\Program Files`、`%LOCALAPPDATA%\Programs\TinTin` 下的安装是**陈旧安装**（其 `resources\openfilm\...\dist` 仍是官方原版），**不代表当前运行的版本**——2026-10-26 排查时在此误判"shell 没打进去"，已纠正。
- 判断"运行的包里 shell 是否在"的唯一正确方法：读**实际启动的那个** `releases\<版本>-dir\win-unpacked\resources\openfilm\node_modules\openfilm\studio\ui\dist\index.html`——title 必须是 `TinTin`、含 `of-chat`、主资产 `index-CwQle1pX.js`（2026-10-26 实测：1134 与 1153 两个产物均为 shell 版，shell **一直在包里**）。
- 指纹（`.dsh-tintin\openfilm-studio\run.tintin.json`）`0.2.5-1400cb18d3c115d1` = **shell dist 的内容哈希**，不是官方 dist 的。

## 2026-10-26 排查遗留（真问题，与打包无关）

- 「film agent exited (null)」每启动必现一条，7/7 次精确在 Studio 服务启动后 3.4–3.8 秒（16:31:46→16:31:49 等）——启动探测的收尾，**不是**测试轮次被杀（16:32:16 的会话在其之后创建并跑了 12 步真模型请求）。
- **轮次挂死才是主缺陷**：16:32:16 测试（BV1F4nm6XEHB）走 12 步 / 982 output tokens 后冻在第 13 步（seq 81），ACP 长请求无超时 → 永远悬着。修复（2026-10-26）：film-acp 看门狗 5 分钟无语义事件即失败回执+终结智能体；进程退出→在途轮次立即错误收尾；等待审批/提问挂起计时（film-acp.ts，doc 已对齐 §13）。
- dsh 固化覆盖原本只在 local 收尾（package-tintin-local.mjs L77-87），full/unpack 直发未固化副本（§16 挂死缺陷）——已挪进 package-dir.mjs 收尾，全模式生效。
- Studio worker 周期性 `exit code 1`（studio.log，10-23 起）；renderer 每次启动有一个 `Cannot read properties of undefined (reading 'effect')` 注册错误；updater 报版本号不属于受支持通道。

## 顺带的低成本加固（保留）

- `dsh-plugin-desktop-tintin/scripts/verify-tintin-resources.mjs` 与 `dsh-tintin-bundle/openfilm-shell/build.mjs` 各加了一道 dist 内容闸门（必须含 shell 标记）——与 Release Builder 无冲突，作为防回归保险。
