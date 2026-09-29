# 0.1.7-rc.2 → 0.2.0-rc.2 API 差异实测清单(D0-3)

> 每个接触面以实测为准(铁律 14),不凭 changelog 推断。实测环境:vendored `0.2.0-rc.2`(经 `--patch` 叠加层引导 `dsh web`)+ 本仓库已装 node_modules + vendored tarball 解包比对。

| # | 接触面 | 结论 | 实测证据 |
|---|---|---|---|
| 1 | **宿主路由注册** `ctx.inject(['webServer'])` + `webServer.register({kind:'exact', path, handler})` | **一致,直接平移** | 本仓库 `dsh-community-market/src/host/routes.ts:698+` 与 tintin-bundle `index.js:1055+` 签名逐字相同;Spike A 实机 200 |
| 2 | **宿主路由处置函数** 返回 dispose | 一致 | 两边均 `const dispose = register(...)` + effect 清理 |
| 3 | **客户端模块缝** `window.__ModuleLoader__.load({id, factory})` | **一致** | vendored `dsh-client-modules/lib/index.js:17` 明文该 factory 协议;市场构建产物与 tintin dist 同型 |
| 4 | **客户端模块工厂契约** factory 须返回带 `apply`/`inject` 的 CommonJS 风格 exports | 一致(0.1.7 同) | 市场 `lib/client.js` 尾部 `exports.apply = apply`;tintin media dist `:39958` 同;**Spike B 曾因工厂返回裸对象被拒,已证实强制** |
| 5 | **客户端声明** `package.json dsh.client {inject, platform}` + `exports["./client"]` | 一致 | 市场与 tintin 两包声明同构;Spike B 实机加载成功 |
| 6 | **组合叠加** `dsh <profile> --patch <yml>`(insert: [{id, name, config}]) | 可用(与桌面 cordis.patch.yml 同一机制) | Spike A/B 用 `--patch` 叠加 insert 两条目,宿主+客户端均生效 |
| 7 | **profile 内包解析** junction 到 profile `node_modules/<pkg>` | 可用 | spike home `profiles/web/node_modules/dsh-tintin-bundle` junction 实测加载成功(Windows junction) |
| 8 | **`@deepseek-ai/*` 宿主回退** ERR_MODULE_NOT_FOUND 时回退宿主安装 | 可用(插件自身依赖 cordis 经回退解析) | spike 插件声明 `@deepseek-ai/cordis 4.0.4` 但 junction 目录无 node_modules,加载成功 |
| 9 | **agentPresets 注册表** | **待实测**(Phase 1 预设迁移时) | 目标:注册 1 个 tintin 预设进 `agentPresets`,与源 `packages/tintin-bundle/index.js` 的注册路径比对 |
| 10 | **预设格式** standard 基底 schema 0.1.7→0.2.0 | **待实测**(Phase 1) | `scripts/build-tintin-presets.mjs` 改基底重新生成后 diff |
| 11 | **会话持久化** `delete()` / `forgetSession` | **缺失**(详见补丁审计集群 1) | vendored grep 全 0 |
| 12 | **错误码分级** FORBIDDEN/QUOTA | **缺失**(详见补丁审计集群 2) | vendored grep 全 0 |
| 13 | **`webServer.port`** | 存在 | 市场 `routes.ts:627` 使用 |
| 14 | **桌面 client 服务** `desktopWindow`(只读几何) | 新增,几何专用,**无窗口创建能力** | `dsh-plugin-desktop/docs/plugin-services.md:66` 明文 "does not expose window mutation, focus, Electron, or IPC capabilities" |
| 15 | **Shell DOM 锚点** `[data-pane="sidebar"]`、`[data-shell-overlay]`、`[data-rightbar-col]` | 官方稳定契约(替代 tintin 的 `data-dsh-sidebar-*` 补丁标记) | plugin-services.md "Shell DOM anchors" 节 |

## 对移植方案的直接影响

- 宿主桥(tintin-bundle 主体)接入层改动量**降级为接近零**(#1–#3 全一致)。
- Vue 子应用挂载缝零改动(#3–#5);仅工厂返回值契约需在 Phase 2 构建管线中保证(#4)。
- Phase 2 的侧栏入口注入改用官方锚点 `[data-pane="sidebar"]`(#15),不再依赖补丁 #17 的自定义标记。
- Phase 4 浏览器域不能走插件形态(#14),集成点定在通道包 Electron main(见 spike 报告 C)。
