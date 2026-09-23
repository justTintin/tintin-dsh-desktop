# TinTin 移植文档快照

本目录是移植源项目 `D:\Project\TinTin_Client_Electron\docs\` 的**只读快照**（2026-09-23 拷贝，md5 全量一致）。原目录仍在演进，若上游文档更新需重新同步，不要在本仓库内直接修改这些文件。

## 背景

本仓库（tintin-dsh-desktop）是 dsh-desktop 的 fork，作为 TinTin 的桌面壳：TinTin 现有功能以 bundle 插件挂入 harness，服务端只出算力。裁决与目标架构见 `客户端集成DeepSeek-Harness实现方案_2026-09-12.md`。

## 核心文档索引

| 文档 | 用途 |
| --- | --- |
| 客户端集成DeepSeek-Harness实现方案_2026-09-12.md | **移植主方案**：目标架构、P0 骨架验证（V1~V11 闸门清单）、P1/P2 分期 |
| 工程规范铁律.md | 全任务门禁（源项目侧规则，移植时仍适用） |
| 剪映互通整体方案_2026-09-12.md、剪映轨道格式标准_2026-09-17.md | 剪映互通纯逻辑层，方案中约定直接搬运 |
| BUSINESS_ALIGNMENT_移植业务对齐清单、各「移植需求文档/迁移映射」 | 逐功能的移植范围与映射 |
| DESIGN_Electron_v3.md、PRD_Electron_v3_SchemeA.md | 源项目 v3 架构与 PRD（被移植的现有形态） |

## 基线偏移警示

主方案第 0~2 章的事实基线是 dsh-desktop 0.1.1（锁 `@deepseek-ai/dsh@0.1.2-rc.1`、251 个 vendored tarball、23 个 patch）。本仓库现已切换到 npm 正式版 `0.1.5-rc.2`（patch 29 个），因此方案中所有「文件:行号」级 API 引用**须按当前锁版本重新实读验证**后再动手；方案中的接缝选型（webServer 路由、client module、slot、defineTool）仍为公开扩展点，不受影响。选型与 slot 契约另见本仓库 `docs/patch-plugin-contract.md`。
