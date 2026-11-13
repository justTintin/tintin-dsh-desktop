# TinTin 更新通道（GitHub Releases）

> TinTin 通道专属的版本更新链路。共享桌面更新栈（`dsh-plugin-desktop*/src/update-*.ts`）面向官方
> `dshdesktop.cn` 版本服务，其渠道文法（`stable` / `beta.N` / `next` / `tintin.N`）不认 TinTin 的
> 构建时间戳版本（`0.2.2-rc.1-20261112-2217`），官方服务也不发布 TinTin 产物——因此 TinTin 通道
> 把「检查」与「下载」两侧分流到本仓库的 GitHub Releases（2026-11-12 用户裁决）。

## 更新链路

```
检查更新（设置页按钮 / 托盘项 / 打包版每 6 小时后台轮询）
  → GitHub API：repos/justTintin/tintin-dsh-desktop/releases（匿名可读，仓库为 public）
  → 取最新一个带 *.exe 资产的非 draft release，tag 比较版本
  → 有新版：确认弹窗 → 保存对话框（默认文件名 = 发布资产名）
  → 流式下载资产 + 强制 HTTPS 终点 + ≤1GB + PE 魔数 + SHA-256 硬校验
  → 「重启并安装」→ spawn Setup.exe --updated --force-run → 应用退出
  → NSIS 覆盖安装并拉起新版本
```

与共享栈的分工：轮询调度、确认/结果弹窗、托盘项、`/api/desktop/updates/check` 路由、升级后
安装包清理提示全部复用共享 `update-lifecycle.ts` / `updates.ts` 插件；只有「查哪里」「从哪下」
两个函数按 `DESKTOP_RELEASE_CHANNEL === 'tintin'` 分流。

## 版本文法

TinTin 版本 = 包版本 + 构建时间戳（`DSH_VERSION_STAMP`，打包三处一致）：

- 带戳：`0.2.2-rc.1-20261112-2217`（`-` 或 `.` 连接时分与秒后段，等价比较）
- 不带戳（开发构建）：`0.2.2-rc.1`，恒小于同 base 的任何带戳版本

比较规则：先比包版本（SemVer），base 相同再比时间戳数字。发布 tag 形如
`v0.2.2-rc.1-20261112-2217`，与应用内 `app` 版本全字对应——**tag 必须与安装包文件名里的版本
严格一致**，检查按全字匹配解析资产。

## 发布约定（发布侧）

打包产物：`dsh-plugin-desktop-tintin/dist/TinTin-<版本>-x64-Setup.exe`（electron-builder
`artifactName` 决定）。

一键发版（2026-11-13 用户裁决，推荐）：

```bash
corepack yarn package:tintin:release                  # 打包（走 package:dir 菜单）→ Setup → 发布 → 自检
corepack yarn package:tintin:release --hot            # 热调打包起步
corepack yarn package:tintin:release --only-publish   # 复用 dist/ 里现有 Setup 直接发布
corepack yarn package:tintin:release --dry-run        # 只看计划与预期 tag
# 通用旗标：--prerelease  --notes <text>  --repo owner/name  --file <Setup.exe>
```

链式脚本（`scripts/release-tintin.mjs`）的关键点：**版本戳一次定值**——`DSH_VERSION_STAMP`
未设置时取启动时刻 `YYYYMMDD-HHmm` 下发给打包与 NSIS 两步，应用内版本、Setup 文件名、
发布 tag 三处一致是构造保证；任一步失败即中止，绝不带旧产物发版；发布后自检内置在
publish 脚本末尾（回查清单确认 tag 可见、两份资产 `state=uploaded`，未就绪重试三次）。

外部 Release Builder（`D:\Project\TinTin_DSH_Release_Builder`，编排壳：媒体资源补齐、
构建互斥锁、产物校验、`releases\` 归档）已接入同一发布脚本：双击菜单选
**5) 全新重建+发布**，或命令行 `run.bat --publish`（与 `--hot`/`--local` 等模式叠加；
模式 4/--no-nsis 与 --publish 互斥，启动即报错）。它打的包与仓库链完全同源——最终都走
`package:tintin:dir` + `package-nsis-local.mjs`。

只发布已有安装包（两步流程）：

```bash
TINTIN_GITHUB_TOKEN=ghp_xxx corepack yarn package:tintin:publish
# 可选：--file <Setup.exe>  --prerelease  --force（覆盖同名资产）  --repo owner/name
```

发布脚本（`dsh-plugin-desktop-tintin/scripts/publish-github-release.mjs`）会：

1. 默认取 `dist/` 里最新的 `TinTin-*-x64-Setup.exe`（或 `--file` 指定）；
2. 计算并旁挂 `sha256sum` 格式的 `<Setup>.exe.sha256`——客户端下载后的硬校验来源
   （GitHub API 资产自带 `digest` 字段时优先用它）；
3. 创建（或 `--force` 复用）release，tag = `v<版本>`，上传 Setup + sha256 两份资产；
4. 发布后自检（见上）。

token 来源：`TINTIN_GITHUB_TOKEN` → `GITHUB_TOKEN`/`GH_TOKEN` → git 凭据管理器
（push 已缓存的同一份 PAT；仅进程内使用）。

## 实现文件（TinTin 通道专属）

| 文件 | 职责 |
| --- | --- |
| `dsh-plugin-desktop-tintin/src/tintin/tintin-update-check.ts` | 版本文法解析/比较、releases 清单选择、摘要解析、`checkForTintinDesktopUpdate` |
| `dsh-plugin-desktop-tintin/src/tintin/tintin-update-download.ts` | 资产解析、流式下载、PE/SHA-256 校验、临时文件清理 |
| `dsh-plugin-desktop-tintin/src/update-lifecycle.ts` | （通道副本）检查器按 `channel === 'tintin'` 分流；状态文件接受带戳版本 |
| `dsh-plugin-desktop-tintin/src/electron-runtime.ts` | （通道副本）`downloadAndOpenTintinUpdate`：解析资产 → 保存对话框 → 下载 → 安装交接 |
| `dsh-plugin-desktop-tintin/scripts/publish-github-release.mjs` | 发布侧：找包、算摘要、建 release、传资产 |
| `scripts/verify-desktop-variants.mjs` | 上述新增文件已登记进 `allowedTintinAdditions` 豁免清单 |

镜像纪律：`update-lifecycle.ts` / `electron-runtime.ts` 本就位于 stable↔beta 差异豁免清单
（Next 过渡遗留），beta↔tintin 比较同样跳过；TinTin 对这两个副本的最小分流改动不影响共享语义，
其余共享文件（`update-checker.ts` / `update-download.ts` / `runtime.ts` / `host-runtime-bridge.ts`
/ `updates.ts`）保持与 Beta 字节一致。

## 已知边界

- **升级下载体积**：更新为全量下载完整 Setup（NSIS 无差分）。2026-11-13 方案 A 瘦包已落地：
  安装包不再内置 `playwright-browsers`（690MB chromium），应用首跑按需下载到通道 home
  （`src/tintin/film-browsers.ts`：旧安装 resources 副本优先沿用 → 开发 staging → 首跑下载，
  主源失败回退 npmmirror 镜像；升级/卸载不清，装一次管所有版本）。差分升级（blockmap，
  每次只下变化块）留作后续可选项。
- 首个发布版本只对**之后**构建的客户端生效（旧版应用的检查仍指向官方服务，检查结果为
  「无法检查更新」）；本仓库第一个 GitHub release 是更新链的基线。
- GitHub `/releases/latest` 不返回 pre-release 标记的版本，检查器因此走列表接口自行取最新，
  发布时可以放心勾选 pre-release。
- 匿名 GitHub API 限流 60 次/小时/IP；轮询默认 6 小时一次，手动检查一次最多两次请求，
  正常使用不会触顶。
- 下载端点跟随重定向，最终落在 `objects.githubusercontent.com`（HTTPS 校验覆盖终点）。
