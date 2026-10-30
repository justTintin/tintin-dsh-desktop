# Agent Note: TinTin Studio 服务生命周期所有权

Status: proposed

[English](2026-10-23-tintin-studio-service-lifecycle-ownership.md) | 中文

> **裁决落地记录(2026-10-23)**:用户裁决采纳第 1、3、4 项方向。第 1 项(指纹化附着
> 与对账)已落地 `dsh-tintin-bundle/lib/openfilm/studio-runtime.js`
> (`editorFingerprint`/`reconcileStudioInstance`/`run.tintin.json` 账本,
> startStudio spawn 前对账);第 3 项(视图自愈)已落地
> `dsh-plugin-desktop-tintin/src/tintin/main-hook.ts`(按址重载、did-fail-load
> 清失败态、重启改 60s 时间窗);单测见
> `dsh-tintin-bundle/test/tintin-openfilm.test.ts` 的 `studio-runtime` 组。
> 第 2 项的 stderr 收集与"最后窗口关闭收尾"仍未落地,note 保持 proposed。

## 问题

TinTin 影片壳(官方聊天 + Studio 编辑器,由 overlay 后的 editor dist 伺服)依赖一个
DSH 并不拥有的 detached OpenFilm Studio 服务。启动器
(`dsh-tintin-bundle/lib/openfilm/studio-runtime.js`)只负责拉起官方 CLI,CLI 自己
detach 出服务进程 + supervisor 后退出;DSH 仅靠读 `run.json` 附着。进程的生命周期——
存活时间、版本、崩溃行为——完全归 OpenFilm 的 supervisor 所有。

2026-10-23 这套模型酿成影片工作台整体不可用:Studio 服务进入崩溃循环
(`logs/studio.log`:连续 `exit code 1; starting it again`),新构建的 app 附着到
(或撞上正在重启的)陈旧服务,嵌入视图吃了一次 `did-fail-load`,此后 shell 聊天探测
8 轮全败。由于接管设计存在两个自愈缺口——`ensureStudioView` 复用既有视图、从不
重新加载失败的 URL(`main-hook.ts`),以及陈旧服务的重启每次启动只允许一次
(`filmShellRestarted`)——用户最终停在一个永久性的「需重装含 shell 构建的包」画面,
而包本身完好。

这是两个结构性原因,不止一个:

1. **实例无主。** DSH 附着到"恰好活着"的服务,跨 app 重启、跨 app 版本。app(及其
   editor dist)与运行中服务之间的版本漂移无法察觉:`run.json` 只有 pid/origin/key。
2. **撤销兜底时没有审计错误路径。** 接管设计最初保留过渡版聊天列作"功能减但可用"
   的降级,若干恢复上的偷懒(只重启一次、视图永不重载)在该假设下都可以接受。同一批
   改动撤销了这个兜底(官方聊天是唯一聊天,2026-10-23 用户裁决),却没有回头重新审计
   这些偷懒,探测失败于是从"降级可用"变成"整屏空白"。

## 复盘:架构缺口为何存在

- 1:1 源码对齐规则被套用到了生命周期上:官方桌面 app 的 detached 服务模型被当作
  契约的一部分原样移植,尽管它的成立前提(app 与服务同步安装、同步更新)在 TinTin
  里不成立——app 按自己的节奏构建,editor dist 走 overlay。这种量级的偏离本应按
  铁规则用实测证据显式申请处置,实际没有走到裁决层。
- 验收工作全部压在成功路径的体验上(焦点让渡、bounds 偏移、播放条抖动)。没有任何
  测试覆盖"旧版本服务还在运行时附着"或"探测窗口内服务重启"。无头测试矩阵里这一
  缝隙没有跨重启、跨版本、时序竞争的场景。
- "有兜底"掩盖了"兜底是坏的":降级路径的存在,削弱了把主路径做成可自愈的动力。

## 决策(提请裁决)

Studio 服务实例归 DSH 所有。具体:

1. **指纹化附着。** `run.json` 增加构建指纹(openfilm 包版本 + editor dist hash +
   app 构建号)。附着前桌面端校验指纹;不匹配则结束陈旧实例并启动自己的。现在的
   一次性、靠猜的 stale 检测改为确定性的版本管理。
2. **有主生命周期。** 服务改为 DSH 直接子进程(或保持 detached,但每次桌面启动时
   对账,最后一个影片窗口关闭时收尾)。supervisor 的重启循环变为可观测:stderr
   收进 DSH 日志,崩溃循环向用户上报状态,而不是无限黑屏。
3. **视图自愈。** `ensureStudioView` 在目标 URL 与已加载的不一致、或上次加载失败
   时,必须重载(或销毁重建)视图;`did-fail-load` 清除缓存视图;
   `filmShellRestarted` 改为时间窗,让「点击这里重试」真正重试。
4. **撤兜底审计规则。** 凡撤销某条降级路径的改动,必须同步重新审计所有"假设兜底
   存在而放宽"的错误处理。这是移植流程规则,在本 note 获准后提议落入
   `docs/tintin-iron-rules.md`。

第 3、4 项属缺陷类修复,可独立落地;第 1、2 项是本 note 提请的架构裁决。

## 失败与平台行为

- 第 1 项落地前,官方 OpenFilm 桌面 app 或旧版 TinTin 启动的服务仍可能被收养;
  独立的 `OPENFILM_HOME` 与端口约定让这不太可能,但并非不可能。
- 结束陈旧实例可能丢失 Studio 侧未保存的界面状态(不是影片数据;工程在磁盘上)。
  接管重试循环本就容忍一次重启,这在现有失败契约之内。

## 验证

计划(均未实现):

- 指纹校验与附着/对账决策的单元测试;
- 无头场景测试:以陈旧指纹起一个服务,走附着路径,断言 kill + 重启 + `has-shell`
  探测成功;
- 无头场景测试:首次 open `did-fail-load`,随后服务恢复,断言视图被重建、探测成功;
- 手工:2026-10-23 复现(崩溃循环服务 + 接管)不经重启 app、仅靠重试即可恢复。

## 后果

获准后,`resolveOpenfilmRuntime`/`startStudio` 收进一个 owner 模块(建议缝隙:
`dsh-plugin-desktop-tintin` 的 `studio-service`),`main-hook.ts` 改为消费它而非
自行解析 `run.json`,`docs/tintin-patch-audit.md` 以本 note 为用户裁决记录与官方
app 的生命周期偏离。若否决第 1、2 项,即接受版本漂移故障在每次陈旧服务竞争时复发,
且错误文案不应再归咎安装包。
