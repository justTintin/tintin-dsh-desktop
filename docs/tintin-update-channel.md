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
发布 tag 三处一致是构造保证；任一步失败即中止，绝不带旧产物发版；**SHA-256 旁挂在 NSIS
打包脚本收口生成**（2026-11-14 用户裁决：不管走哪个入口——一键链/Release-Builder 各模式/
手工直跑——只要产出 Setup 就有校验文件；`package-nsis-local.mjs` NSIS 成功即写
`.sha256`，Release-Builder 归档时随 Setup 一并拷入 `releases\*-dir`）；发布环节若失败，
Setup 与 `.sha256` 已就绪，可直接手动传到 GitHub Release 页面兜底；发布后自检内置在
publish 脚本末尾（回查清单确认 tag 可见、两份资产 `state=uploaded` 且**字节数与本地文件
一致**，未就绪重试三次）。

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

资产上传走 **curl 子进程**而非 Node fetch 流式 body：大资产长传输被中断后 GitHub 会在
服务端留下**占住资产名的半截资产**（常被定型成 0 字节的 `uploaded` 空壳），后续重试全部
撞 `422 already_exists`——这是「上传一直没成功」的直接元凶。脚本处置：瞬时错误自动重试
×3（进度条直落 stderr）；撞 422 或自检发现空壳时，加 `--force` 即自动删除占名资产重传，
不带 `--force` 则给出明确处置指引。token 经 curl 的 stdin 配置喂入，不落命令行与日志。

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

- **API 限流与 Atom 回退（2026-11-13）**：GitHub REST API 匿名限额 60 次/小时/**每个出口
  IP**——系统代理（PAC）用户走机场共享出口时经常被耗尽（实测 `403 rate limit exceeded,
  remaining: 0`），表现为「未能获取更新信息」。检查器已内置回退：API 失败自动改读
  `github.com/<repo>/releases.atom`（主站路径，不走 API 限流池，同代理路径实测 200）；
  Atom 不含资产，下载端用 tag + 产物名约定（`TinTin-<版本>-x64-Setup.exe`）构造下载与
  `.sha256` 地址，SHA-256 硬校验不变。每次检查会打点 `tintin-update-check` 事件到
  `logs/dsh-*.log`（含 API 状态与限流余量、回退命中、双路失败原因）。
- **检查请求超时**：设置页「检查更新」的 POST 同步等待检查完成（默认 15s 超时），
  网络挂起期间按钮无进行中反馈、期间重复点击被去重——看起来像「点了没反应」。
  超时可用 Host 配置 `desktop-updates.requestTimeoutMs` 调小；「立即响应+弹窗承载结果」
  的改法涉及共享路由（需三包同步），暂未实施。
- **失败弹窗带原因**：版本请求传输失败时，弹窗 detail 直接附上真实报错
  （如代理连接失败）；403 等非传输失败查日志 `tintin-update-check` 事件。
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
