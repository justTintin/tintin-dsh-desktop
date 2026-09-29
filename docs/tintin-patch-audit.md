# TinTin 补丁迁移审计(D0-2)

> 逐 hunk 裁决 26 个源补丁(`tintin-dsh-desktop/patches/`,基于 0.1.7-rc.2 patch-package)在目标框架(vendored 0.2.0-rc.2 + 本仓库 `patches/` 体系)中的去向。
> 审计方法:逐文件读完整 diff,与目标仓库同包 `@0.2.0-rc.2` 补丁对比;VERIFY 项已解包 `vendor/dsh-runtime/0.2.0-rc.2/` tarball 实际验证(undici 除外)。
> 依据分类遵循[移植铁律](tintin-iron-rules.md)四类:①用户裁决 ②原实现一比一 ③第三方权威/契约 ④实测证据。本文全部条目为 ③/④。

## 总表

| # | 源补丁 | 包 | 改动摘要 | 裁决 |
|---|---|---|---|---|
| 1 | `@deepseek-ai+cordis-plugin-loader+1.0.5` | cordis-plugin-loader | 加载树 await 超时(`DSH_LOADER_TIMEOUT_MS`)、心跳告警、`dshPluginFailure` 结构化失败链、`lastImportError` 留存 | TRANSLATE |
| 2 | `@deepseek-ai+dsh+0.1.7-rc.2` | dsh | ①CLI 失败 exitCode;②向 harness 注入 9 个宿主包依赖 | DROP-MECHANISM |
| 3 | `@deepseek-ai+dsh-api-remotes+0.1.7-rc.2` | dsh-api-remotes | 注册 `session/delete` remotes schema | VERIFY(未内置→随集群 TRANSLATE) |
| 4 | `@deepseek-ai+dsh-api-session-controller+0.1.7-rc.2` | dsh-api-session-controller | `session/delete` 全链路 + `fileHostPath` 端点 + `retainHandle` + 预设回退 + projections 剥离 | VERIFY(delete 未内置;②–⑤为 TRANSLATE 残留) |
| 5 | `@deepseek-ai+dsh-app-boot+0.1.7-rc.2` | dsh-app-boot | advisory 兼容、`.dsh-market` disabled 读取、`__dshPluginOwner` 标注、fail-loud 启动诊断 | TRANSLATE(disabled 读取部分 DROP) |
| 6 | `@deepseek-ai+dsh-client-file-upload+0.1.7-rc.2` | dsh-client-file-upload | `findStagedFile`(按 attachmentId 查暂存) | TRANSLATE |
| 7 | `@deepseek-ai+dsh-client-modules+0.1.7-rc.2` | dsh-client-modules | newlineCount/identitySectionMap 修复、recordCombo 缓存、createRequire 兜底 | COVERED(部分,余下 TRANSLATE) |
| 8 | `@deepseek-ai+dsh-client-shortcuts+0.1.7-rc.2` | dsh-client-shortcuts | 桌面嵌 Web 时强制 web 快捷键表 | TRANSLATE(低优先,仅 Next 场景) |
| 9 | `@deepseek-ai+dsh-client-ui-agent-preset+0.1.7-rc.2` | dsh-client-ui-agent-preset | 预设导入/导出 UI(`/api/agent-preset.*`)、搜索、Awesome 入口 | TRANSLATE(连同宿主 transfer 端点) |
| 10 | `@deepseek-ai+dsh-client-ui-attachment+0.1.7-rc.2` | dsh-client-ui-attachment | FileCard 可点击打开 + onOpen 透传 | TRANSLATE |
| 11 | `@deepseek-ai+dsh-client-ui-chat+0.1.7-rc.2` | dsh-client-ui-chat | 附件打开 prop 链、FORBIDDEN 文案、`sidebarRightTabs` 服务 | TRANSLATE |
| 12 | `@deepseek-ai+dsh-client-ui-conversation+0.1.7-rc.2` | dsh-client-ui-conversation | hero/accessory 新 slot、无会话时渲染 composer、`openUploadedFile` 链 | TRANSLATE(与现有 conversation 补丁合并 re-base) |
| 13 | `@deepseek-ai+dsh-client-ui-deliverables+0.1.7-rc.2` | dsh-client-ui-deliverables | `localPathReference` 本地路径引用解析、mentions 早退移除 | TRANSLATE |
| 14 | `@deepseek-ai+dsh-client-ui-model-selection+0.1.7-rc.2` | dsh-client-ui-model-selection | 模型菜单搜索框 | TRANSLATE |
| 15 | `@deepseek-ai+dsh-client-ui-settings-general+0.1.7-rc.2` | dsh-client-ui-settings-general | 导航滚动 CSS、onboarding 就绪策略 | TRANSLATE(低优先,先对齐自有 onboarding) |
| 16 | `@deepseek-ai+dsh-client-ui-settings-models+0.1.7-rc.2` | dsh-client-ui-settings-models | 首Run提供商网格、模型搜索、图片输入开关、推理等级编辑;tintin 专属:隐藏 deepseek-official、tintin-server 不可删 | TRANSLATE(最大 re-base 项;tintin 专属 hunks 改写) |
| 17 | `@deepseek-ai+dsh-client-ui-sidebar+0.1.7-rc.2` | dsh-client-ui-sidebar | `data-dsh-sidebar-*` DOM 标记、宽侧栏 padding | COVERED(需求已覆盖;标记引用需改指 `[data-pane="sidebar"]`) |
| 18 | `@deepseek-ai+dsh-client-ui-trajectory+0.1.7-rc.2` | dsh-client-ui-trajectory | QUOTA/FORBIDDEN 失败码文案 | VERIFY(未内置→随集群 TRANSLATE) |
| 19 | `@deepseek-ai+dsh-client-ui-workspace+0.1.7-rc.2` | dsh-client-ui-workspace | 未读标记、`deleteSession`、opener/starter/reuse 钩子 | TRANSLATE(deleteSession 视集群结论) |
| 20 | `@deepseek-ai+dsh-llm-deepseek+0.1.7-rc.2` | dsh-llm-deepseek | providerError:QUOTA 优先、403→FORBIDDEN | VERIFY(未内置→TRANSLATE) |
| 21 | `@deepseek-ai+dsh-llm-pi-ai+0.1.7-rc.2` | dsh-llm-pi-ai | FORBIDDEN 拆分、终态 content 重建、session-id 归因头 | VERIFY(①②未内置→TRANSLATE) |
| 22 | `@deepseek-ai+dsh-plugin-manager+0.1.7-rc.2` | dsh-plugin-manager | 宿主拥有的包安装后端(替代 profile pnpm) | DROP-MECHANISM |
| 23 | `@deepseek-ai+dsh-session-persistence+0.1.7-rc.2` | dsh-session-persistence | `delete()` 基类 + 类型 | VERIFY(未内置→随集群) |
| 24 | `@deepseek-ai+dsh-session-persistence-jsonl+0.1.7-rc.2` | dsh-session-persistence-jsonl | JSONL `delete()` 实现、损坏日志容错 | VERIFY(delete 未内置;list 容错独立 TRANSLATE) |
| 25 | `@deepseek-ai+dsh-workspace+0.1.7-rc.2` | dsh-workspace | `forgetSession` | VERIFY(未内置→随集群) |
| 26 | `undici+8.11.2` | undici | LegacyHandlerWrapper rawHeaders 数组守卫 | VERIFY(未执行;目标锁 6.28/7.29/8.10,8.11.2 路径不存在) |

## 统计与集群裁决

| 裁决 | 数量 |
|---|---|
| DROP-MECHANISM(机制被内嵌启动器/构建期市场取代) | 2 |
| COVERED(部分覆盖,余量 re-base) | 2 |
| VERIFY→未内置(实测确认 0.2.0-rc.2 缺失) | 8 |
| TRANSLATE | 13 |
| 未执行验证 | 1(undici) |

**功能集群**(必须整批决策,不存在部分生效):

1. **SessionDelete 集群**(#3 #4 #23 #24 #25 + #19 deleteSession):实测 vendored 0.2.0-rc.2 无 `session/delete`、无 `delete()`、无 `forgetSession`。tintin 产品有"永久删除会话"用户功能 → 裁决:**整集群 TRANSLATE**(依据②原实现一比一),五包 + workspace 的 delete hunk 以 yarn patch 分代移植,时间排 Phase 2(UI 相关)。
2. **FORBIDDEN/QUOTA 错误码集群**(#18 #20 #21 + #11 文案):实测 0.2.0 仍 403→AUTH。错误分级是 tintin 配额提示的依据 → 裁决:**TRANSLATE**,三包 + chat 文案,排 Phase 2。
3. **附件打开集群**(#4② fileHostPath + #6 + #10 + #11① + #12 openUploadedFile):横跨 5 包的最大功能链 → 裁决:**TRANSLATE**,同一批次 re-base,排 Phase 2。
4. **宿主包注入/宿主包管理后端**(#2② #22):目标框架已有等价机制(内嵌启动器 + vendored 市场) → DROP,依据③本仓库 `dsh-app-boot@0.2.0-rc.2.patch`/`dsh-plugin-manager@0.2.0-rc.2.patch` 实证。

## COVERED 明细(需 re-base 的余量)

- **#7 dsh-client-modules**:newlineCount 前半已覆盖;`identitySectionMap` 空行修复、`recordCombo` WeakMap 缓存未覆盖(vendored `lib/index.js:308` 仍 `Array.from(...).join(";")`,`:670` 无缓存);createRequire 兜底已被上游 `locatePkgJson` 内建,无需迁。
- **#17 dsh-client-ui-sidebar**:需求(DOM 锚点)已由本仓库补丁以 `data-sidebar-header-controls` 实现;tintin 的 `data-dsh-sidebar-*` 四属性与宽侧栏 padding 未覆盖——引用侧改指框架官方锚点 `[data-pane="sidebar"]`(见 plugin-services.md),或把属性并入本仓库补丁。

## TRANSLATE 目标文件名(遵循本仓库 `dsh-<pkg>@0.2.0-rc.2.patch` 约定)

cordis-plugin-loader(锁 ~1.0.5)、dsh-app-boot(并入现有)、dsh-client-file-upload、dsh-client-shortcuts(Next 场景)、dsh-client-ui-agent-preset、dsh-client-ui-attachment、dsh-client-ui-chat、dsh-client-ui-conversation(并入现有)、dsh-client-ui-deliverables、dsh-client-ui-model-selection、dsh-client-ui-settings-general(并入现有)、dsh-client-ui-settings-models、dsh-client-ui-workspace;集群项:dsh-api-remotes、dsh-api-session-controller、dsh-session-persistence、dsh-session-persistence-jsonl、dsh-workspace、dsh-llm-deepseek、dsh-llm-pi-ai、dsh-client-ui-trajectory。

## 验证命令记录(实测证据)

```bash
# SessionDelete 集群(vendored 0.2.0-rc.2 tarball 解包后)
grep -c "session/delete" dsh-api-session-controller/lib/typert.host.js        # 0
grep "SessionDeleteRequest" dsh-api-session-controller/lib/types/types.d.ts   # 空
grep -n "async delete" dsh-session-persistence-jsonl/lib/index.js             # 空
grep -n "forgetSession" dsh-workspace/lib/index.js                            # 空
# FORBIDDEN 集群
grep -n "FORBIDDEN" dsh-llm-deepseek/lib/index.js                             # 空(:1750 仍 403→AUTH)
grep -n "completeTerminalMessage" dsh-llm-pi-ai/lib/index.js                  # 空
```
