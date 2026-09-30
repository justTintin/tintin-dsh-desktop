# TinTin 修复完整性审计(锚点 + bug 记录对拍,2026-09-30)

> 问题:源仓库(`tintin-dsh-desktop`,117 个 fork 提交)的全部功能锚点与 bug 修复记录,在迁移后是否同样在位?
> 方法三层:①源 `verify-tintin-customizations` 的 ~50 条锚点对拍到新树;②逐字节 `diff --strip-trailing-cr` 全部"原样迁移"树(比锚点更强的证据);③117 个 fork 提交逐条按触碰文件归类对账。

## 一、锚点对拍(源核查脚本 v1.1 全表)

| 面 | 结果 |
|---|---|
| **DIRECT**(逐字节迁移面:tintin-bundle lib/index/client、media src、browser、extractors) | **31/32 PASS**。唯一"FAIL"(3.6d 五预设解析)是审计工具裸 node 导入撞宿主单例解析,权威路径 vitest `tintin-preset-definitions.test.ts` 2/2 PASS |
| **EQUIVALENT**(架构替代面:身份/进程管理/宿主包注入/组合) | **6/7 PASS**(失败项为审计期望值笔误,实际在位) |
| **GAP**(计划内未迁,对总账) | 4 组:首启动种子(1.3–1.8)、NSIS 打包器锚点(5.1–5.6)、settings-models 补丁(6.1/6.1b,11 项清单内)、loader 补丁(6.3,11 项清单内) |

关键修复锚点全数在位(源侧事故史):`[object Object]` 占位符剥除(3.9c)、resolver 字符串守卫(3.11b)、高级脚本弹层 14 处 teleport 新形态 + mask 12000(4.7 系,连环事故锚点)、连接测试双文案兼容(4.7e)、preset 无已移除包引用(3.6c)、workflow_type 保留键回避(3.5)。

## 二、逐字节 diff(全部原样迁移树)

| 树 | 差异 |
|---|---|
| tintin-bundle `lib/`、`presets/`、extractors | **0 差异** |
| media `src/`(99 文件) | 仅 `client-entry.ts` 1 行(模块 id 改名) |
| browser(39 文件中 5 文件) | 仅导入 `.ts` 扩展名 + 4 处严格类型适配(expirationDate 条件展开 ×1、referer/headers 条件展开 ×2、副作用句柄 void 锚 ×1),逐行对账 |
| `index.js` | 恰好 1 行(插件 name 改名) |
| `client.js` | 恰好 14 行 = 7 处既定适配:侧栏选择器官方锚点化 ×4、模块 id/设置卡 key/name ×3 |

**结论:除已裁决的适配外,零意外漂移。**

## 三、提交级对账(117 个 fork 提交)

| 判定 | 数量 | 说明 |
|---|---|---|
| **COVERED** | 81 | 修复落在逐字节/已验证适配的树 |
| PARTIAL — gap-first-boot | 4 | 首启动种子/自愈/tintin-server 凭据自愈的**壳层半边**未迁(client/index 半边已覆盖)——Phase 4 余量 |
| PARTIAL — gap-packaging | ~7 | NSIS 安装器修复:asar.unpacked 孤儿清扫、$INSTDIR 域限定、Defender 指向 tintin、**跨产品 session.json 删除移除**——通道 NSIS 定制时必须带上锚点 5.1–5.6 |
| PARTIAL — patches | 3 | models-page 定制恢复(=审计 #16,11 项清单内)、老版本升级提交 |
| PARTIAL — desktop-shell-replaced | ~10 | 壳层状态机/进程树杀/恢复——架构替代(框架自有 profile-manager/recovery/utilityProcess 体系) |
| PARTIAL — scripts/other | ~11 | root 清单/文档/发布脚本混合提交,实质修复均落在已覆盖树 |

## 四、结论与待办

**已迁移面的 bug 修复 100% 在位**(锚点 + 字节 diff + 提交对账三重证实)。真实缺口全部是总账已知项,新增待办仅一条:

1. **通道 NSIS 定制时移植源 installer.nsh 的 5.1–5.6 锚点**(含跨产品删除移除这个破坏性 bug 修复——用 Beta 镜像安装器期间无此风险,因其只动自家数据)。
2. first-boot 种子重放、settings-models/loader 等 11 项补丁——已在总账。

审计脚本与中间产物:`C:\Users\TinTin\AppData\Local\Temp\tintin-patches\{fix-audit,commit-audit}.mjs`(临时,不入库;结论以本文档为准)。
