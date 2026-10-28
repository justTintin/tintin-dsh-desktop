# TinTin 浏览器域移植说明

> 状态:2026-10-26 建立(移植现状对账 + 未移植清单 + 锚点落地)。本文是浏览器域(独立/内嵌浏览器窗口、平台分区、嗅探、下载、扩展、抽取器、cookies 交接)相关改动的**唯一入口文档**;总方案见 [tintin-migration-plan.md](tintin-migration-plan.md) 资产 #10/#11 与 Phase 3。
> 移植基线:`D:\Project\TinTin_Client_Electron`(螺丝钉-电商智能体矩阵 V3 独立客户端)main 分支 HEAD **`9ca9050`**(2026-09-25,reflog 实证为该仓最后一次提交;dist-2026101x 目录为未提交构建产物,无代码漂移)。
> 证据:移植件头注逐文件自证「SRC desktop/main/… 一比一移植,基线 SRC 9ca9050」(ext-manager.ts / bilibili-ext.ts / download-manager.ts / platform-meta.ts / media-storage.ts / creators-store.ts);2026-10-26 逐文件行数与符号 grep 对账(铁律 12 之②一比一 + ④实测)。

## 一、血缘确认(用户问:「客户端浏览器是移植自 TinTin_Client_Electron 吧?」)

**是,直接血缘。** 判定依据:
1. `dsh-tintin-browser/src/browser/*` 多个文件头注明确写「SRC desktop/main/xxx.js 一比一移植,基线 SRC 9ca9050」——`desktop/main/` 正是 TinTin_Client_Electron 的目录布局(总方案表里写的 `src/main/tintin/browser/**` 是 fork 侧的同树镜像路径)。
2. `9ca9050` 经 `.git/logs/refs/heads/main` 实证存在于 TinTin_Client_Electron 仓(2026-09-25,恰为该仓 main 最终提交)。
3. 逐文件比对:extractors 六件行数逐一相同,media-storage/creators-store/platform-meta 行数差仅为 TS 类型化;逻辑符号(Cr24 头解析、BILI_DL_EXTRACT_SCRIPT、`persist:tintin-*` 分区表)逐字一致。

## 二、目标侧三层形态(与源的两层不同)

| 层 | 源形态(TinTin_Client_Electron) | 本仓形态 | 说明 |
|---|---|---|---|
| UI 页 | `renderer/src/browser/Browser.vue`(vite 多入口,独立窗口加载) | `dsh-plugin-desktop-tintin/build/tintin-browser.html`(833 行,自绘工具条/左栏/右栏/下载栏) | 2026-09-28 用户裁决「整体按原客户端实现」;桥=`dshDesktopBrowser`+`tintinBrowserPage`(browser-page-preload.ts) |
| 壳层引擎 | `thickShell-ipc.js` + `thick-shell-viewpool.js` + `browser-window.js`(BrowserView 池) | `dsh-tintin-browser/src/browser/browser-service.ts`(918 行,WebContentsView 池)+ `main-hook.ts` 接线 | 接入层重写(铁律 1 允许);独立窗口(close=hide)+ 主窗内嵌模式(2026-10-19 方案 4)双形态,`BROWSER_VIEW_CHANNEL` 驱动 |
| 下载引擎 | `media-downloader.js`(yt-dlp spawn + 流式直链) | 浏览器域 `dsh-tintin-browser/src/browser/media-downloader.ts`(2026-10-26 复活,见映射表)+ host 侧 `dsh-tintin-bundle/lib/ytdlp.js`(agent 工具,读 `<DSH_HOME>/tintin/browser/cookies` 前置 `--cookies`) | 浏览器端与 host 门是源码里就并存的两个入口;cookies 交接目录 = `browser-service.ts browserCookiesDir()`,回环门面 `/tintin-browser/cookies/export` 主动同步 |

## 三、已移植功能映射(2026-10-26 实测对账)

| 源文件(desktop/main) | 目标对应件 | 对应关系 |
|---|---|---|
| platform-meta.js (99) | `src/browser/platform-meta.ts` (102) | 1:1(+TS 接口);9 平台分区/详情页白名单/cookie 域/URL 识别全在 |
| media-storage.js (248) | `src/browser/media-storage.ts` (248) | 1:1;10 个 `media:storage*` 通道同名同序,已在 browser-service 接线 |
| ext-manager.js (245) | `src/browser/ext-manager.ts` (284) | 1:1 工厂化;crx/zip 安装(含 Cr24 头)、卸载、清单广播、B站/抖音内置助手预装 |
| bilibili-ext.js (289) | `src/browser/bilibili-ext.ts` (273) | 1:1;`tintin-ext://` 协议(Electron 43 改 protocol.handle)、content script 注入、SPA reload 兜底、**BILI_DL_EXTRACT_SCRIPT 逐字保留** |
| douyin-parse-logic.js (76) | `src/browser/douyin-parse-logic.ts` (71) | 1:1(2026-10-26 复活);短链正则/302 定位/API 响应契约/video id 拼接全在,纯函数可单测 |
| media-downloader.js (708) | `src/browser/media-downloader.ts` (547) | 有界 1:1(2026-10-26 复活):`browser:douyinParse`、`browser:downloadMediaStart`(yt-dlp 主链路含 Netscape cookie 临时文件/格式回退)、流式直链(Range 206/分区 Cookie/Referer)、音视频分离 FFmpeg 合并(失败仅存视频)、Cancel/Pause;**未迁**:downloads-history.json 持久化、任务档案/snapshot/OpenFile/Reveal/SetDir、浮窗面板(随工作包 #2)。差异(接入层,已注明):广播改下载总线 downloads:progress/done/error 与 download-manager 同轨;下载根=workspace/materials;内置工具查找加 TINTIN_BIN_DIR 候选 |
| thick-shell-viewpool.js(B站推送段 L237-254/L371-396) | `src/browser/bili-ext-dl.ts` (104) | 等价抽取(2026-10-26 复活):`[TINTIN_BILI_DL]` console 捕获 + 2s 主动轮询(BILI_DL_EXTRACT_SCRIPT 经 browser-service 在 B站 view 挂接,推送 `browser:bili-ext-dl`);依赖注入无 electron,可单测 |
| extensions-panel.html(安装流) | `tintin-browser.html` 扩展管理视图 + `browser:extensionPickAndInstall` | 并入 UI 页(2026-10-26 复活):列表/内置标识/卸载/对话框选包安装(crx/zip);floating-panel-logic.js 失焦状态机未迁(页面内视图替代浮层) |
| —(预存缺陷修复) | `tintin-browser.html` 自动上架死接线清除 | **2026-09-29 裁决把操作面板移至「运营工具」时,页面标记删了、脚本没删**——顶层仍给已删除的 al* 元素绑 onclick,TypeError 使整个页面 IIFE 崩死(左栏平台/功能扩展全空、主区空白,浏览器完全不可用)。2026-10-26 修复:清除 ~103 行死接线,`alLogLine` 保留并元素缺失安全降级(达人采集进度复用点) |
| download-manager.js (283) | `src/browser/download-manager.ts` (241) | 1:1;原生 will-download 接管 + URL 下载(重定向/节流/暂停取消)+ `downloads:*` IPC |
| media-sniff-utils.js (99) | `src/browser/media-sniffer-logic.ts`(36)+`media-sniffer.ts`(78) | 等价拆分;来源为 browser-webview.js URL 规则(响应头嗅探分支未迁,见未移植 #5) |
| hotspot-capture.js (278) | `hotspot-logic.ts`(160)+`hotspot-capture.ts`(118) | 1:1 拆分(行数守恒);CDP 隐藏采集 runner 全在 |
| daily-assets.js (159) | `daily-assets-logic.ts`(127)+browser-service IPC 段 | 1:1 逻辑;目录口径改 workspace/materials+系统下载 |
| creators-store.js (347) | `src/browser/creators-store.ts` (316) | 1:1;+B8 入库回写字段(超源) |
| extractors/ 六件 | `dsh-tintin-browser/extractors/` | 逐字节(行数逐一相同);打包链 build/extractors→resources/extractors 已接 |
| auto-listing/* | `src/browser/auto-listing/*` | 1:1(按用户指示本轮不列入对账) |
| cookies 导出 | `netscape-cookies.ts` + browser-service 导出/迁移 | Netscape 格式 1:1;默认 session→分区存量救援(2026-09-28 分区事故) |
| 抽取 IPC(thickShell-ipc browser:extractDOM) | `browser-service.ts extractNow` + 回环 `/tintin-browser/extract` | E3 结构化错误四型同口径 |

浏览器 UI 页已含:工具条(后退/前进/刷新/主页/地址栏)、平台左栏(登录态徽章)、功能扩展组(自动上架/收藏/每日素材/达人库/素材采集)、右栏媒体嗅探、底部下载栏、历史视图(下载+嗅探记录)。

## 四、未移植清单(除自动上架;按用户影响排序)

### P0 — 下载/扩展链(用户点名重点「下载扩展功能」)

| # | 缺口 | 源 | 现状与影响 |
|---|---|---|---|
| 1 | ~~**B站扩展下载链接消费链(死代码)**~~ ✅ **已复活(2026-10-26)** | `thick-shell-viewpool.js` L237-254(console-message `[TINTIN_BILI_DL]` 捕获)+ L371-396(2s 轮询 `BILI_DL_EXTRACT_SCRIPT`)+ `browser:onBiliExtDownloads` 订阅 | 轮询+console 双通道迁入 `bili-ext-dl.ts`,browser-service 在 B站 view 挂接并推送 `browser:bili-ext-dl`;右栏「B站下载助手」区渲染下载列表,条目按源 `downloadBiliExtLink` 口径发起 `downloadMediaStart`(直链+Referer+可选 audioUrl 双流) |
| 2 | ~~**抖音分享链接解析下载**~~ ✅ **已复活(2026-10-26)** | `douyin-parse-logic.js`(76 行,全文件)+ `media-downloader.js` 的 `browser:douyinParse` + 右栏粘贴分享文本 UI | 解析纯函数层 1:1 迁入 `douyin-parse-logic.ts` + `browser:douyinParse` IPC(主链路短链 302→videoPageUrl→yt-dlp,API dy.xs25.cn 兜底直链);UI 右栏抖音分区「抖音视频下载助手」粘贴框,文案对齐源(「解析成功,已开始下载(无水印完整视频)」) |
| 3 | ~~**media-downloader.js(708 行)整体**~~ ◐ **核心链路已复活(2026-10-26),面板/历史随工作包 #2** | 任务注册表+`downloads-history.json` 持久化(300 条)、流式直链下载(Range/206、partition Cookie/Referer 注入)、音视频分离+FFmpeg 合并、取消/暂停(kill)、下载目录设置、`browser:downloadMedia*` 通道族 | `media-downloader.ts` 有界 1:1:`browser:douyinParse/downloadMediaStart/downloadMediaCancel/downloadMediaPause` 四通道 + 流引擎 + ffmpeg 合并在位;**未迁**:history 持久化、snapshot/OpenFile/Reveal/RemoveRecord/GetDir/SetDir、浮窗面板。`browser:sniffDownload` 同步改走本引擎(SRC SniffTab 口径:分区 Cookie/Referer 注入,m3u8/flv/videoplayback 交 yt-dlp;此前为最简直链,签名 CDN 会 403) |
| 4 | ~~**扩展管理 UI(extensions-panel.html + 浮层)**~~ ✅ **已复活(2026-10-26,并入 UI 页)** | `extensions-panel.html`、`main.js browser:openExtensionsPanel`、`floating-panel-logic.js`(52 行失焦自动关闭状态机)、工具栏扩展图标(`BrowserToolbar.vue`) | 主进程 IPC + preload 暴露原有在位,新增 `browser:extensionPickAndInstall`(dialog crx/zip 选包,源 extensions-panel 安装流 1:1);UI 页功能扩展组新增「扩展管理」视图(列表/内置标识/卸载/安装,`browser:extensions-changed` 刷新)。floating-panel-logic.js 失焦状态机未迁——浮层被页面内视图替代,独立浮窗形态若后续需要再评 |
| 5 | **浮窗下载面板(downloads-panel.html)+ 下载历史** | `downloads-panel.html`、`main.js browser:openDownloadsPanel`、下载历史持久化读取 | 页面底部下载栏(实时镜像)已替代实时进度,但**持久化下载历史浮层**无对应(media-storage 下载记录数据在,缺 UI 面) |

### P1 — 壳层健壮性(viewpool 逐条对账缺口)

| # | 缺口 | 源 | 影响 |
|---|---|---|---|
| 6 | 离线兜底页 | `offline-page.js` + viewpool `did-fail-load`→主题化离线 HTML | 断网/加载失败时显示白屏(抽取链只继承了错误结构 `extractionError`) |
| 7 | 协议拦截 | `ALLOWED_PROTOCOLS` onBeforeRequest 取消 + `will-navigate/will-frame-navigate/will-redirect` 拦截 | `bytedance://` 等非标协议会外弹 |
| 8 | 崩溃自愈 | viewpool `crashed`→1s 重建(≤3 次)+ `browser:platform-error` | 页面崩溃后浏览器域不可恢复 |
| 9 | 切换平台暂停媒体 | viewpool `_detachAllFrom` detach 前 pause 所有 video/audio | 切平台后原页面继续出声(2026-09-02 用户反馈过的原事故) |
| 10 | 嗅探响应头分支 + 详情页门控 | `_sniffMediaFromHeaders`(Content-Type/大小/特例命名)+ `isDetailPage` 门控 + `browser:media-sniffed` 实时推送 | `platform-meta.ts isDetailPage` 已迁但**嗅探器未消费**;列表页/预加载视频会误入嗅探列表,无文件大小展示,页面靠 2s 轮询非推送 |
| 11 | `browser:url-updated`(detectedPlatform) | viewpool did-navigate 推送检测平台 | 跨域跳转的平台自动识别未推给 UI(hostTip 仍按切换平台显示) |

### P2 — 次要

| # | 缺口 | 源 |
|---|---|---|
| 12 | 浏览器窗口尺寸/位置持久化(显示器校验) | `browser-window.js` windowState.browser(本仓固定 1280×840) |
| 13 | 浏览历史记录 | `history-panel.html` + `main.js history:*` 四通道(全仓 0 命中) |
| 14 | 外链窗口打开行为分歧 | 源 viewpool=页内 loadURL;本仓=shell.openExternal(2026-10-26 对账标注,是否回切待裁决,见下) |
| 15 | 热点定时联动 | 源 `local-scheduler.js`→`scheduled:hotspot-trigger`→开窗补发;本仓仅手动 `browser:captureHotspots`(定时任务集成原注释挂 P2) |

**待裁决(铁律 12 ①类)**:#14 外链行为(页内导航 vs 系统浏览器,C7 红线两种读法);#15 定时热点是否随本框架调度体系重建而非照搬 local-scheduler.js。

## 五、锚点表(铁律 15;2026-10-26 落地 32 条 + 复活批 14 条)

`scripts/tintin-anchors.json` 新增 browser 域段(此前 25 条锚点 0 条覆盖浏览器域,违反铁律 15「每合入一批能力同步更新锚点表」)。覆盖:`registerBrowserService`、`tintin-browser-page:*` 五通道、cookies 导出/分区迁移、内嵌 bounds 合成、extractDOM、扩展清单广播与安装 IPC、下载进度镜像、扩展管理三符号(工厂/Cr24 解压/抖音预装)、`BILI_DL_EXTRACT_SCRIPT`(防下载链核心资产被误删)、`tintin-ext` 协议、注入函数、下载管理四符号、嗅探规则两件、媒体存储/达人/每日素材/热点/回环/Netscape 格式、`persist:tintin-*` 分区表(≥8)、详情页白名单、抽取器公共契约、UI 页桥、preload 通道字面量、main-hook 接线。
2026-10-26 复活批新增 14 条:`DOUYIN_PARSE_API`、`extractDouyinShareUrl`、`browser:douyinParse`、`browser:downloadMediaStart`、`browser:downloadMediaCancel`、`content-range`(206 进度)、`ffmpeg`(合并)、`browser:bili-ext-dl`、`startBiliExtPolling`、`attachBiliDlConsoleCapture`、`browser:extensionPickAndInstall`(壳侧)+ preload `browser:downloadMediaStart` + UI 页 `onBiliExtDownloads`/`douyinParse`。
运行:`corepack yarn check:tintin`(已实测 `verify-tintin-gate: 71 anchors over 36 documents and 12 baseline entries are consistent`;bridge-surface OK 216 files/8 bridges;gate 单测 5/5)。

## 六、文档对账(用户问:「是不是有对应的移植文档?」)

| 文档 | 浏览器域覆盖 |
|---|---|
| [tintin-migration-plan.md](tintin-migration-plan.md) | 资产 #10/#11/#14 映射 + Phase 3「逻辑迁移完成」+ 遗留工作包 #2(窗口接线,现已由 2026-10-19 内嵌方案落地大半) |
| [tintin-spike-report.md](tintin-spike-report.md) | Spike C:浏览器域接入点裁决(通道包 Electron main,不能走插件形态) |
| [tintin-api-diff.md](tintin-api-diff.md) | 接触面结论 #14 |
| [tintin-fix-audit.md](tintin-fix-audit.md) | fork 侧 117 提交对账(browser 树逐字节 0 意外漂移) |
| **本文** | 之前**不存在**浏览器域专属移植文档——Phase 3 只有总账一行;本篇补齐(现状对账/未移植清单/锚点表/裁决挂起项) |

## 七、建议工作包(承接第四节)

1. ~~**下载扩展链复活**(P0 #1+#2+#4)~~ ✅ **已交付(2026-10-26)**:`douyin-parse-logic.ts`(1:1)+ `bili-ext-dl.ts`(轮询/console 双通道,依赖注入可单测)+ `media-downloader.ts`(有界 1:1,yt-dlp 主链路/流引擎/ffmpeg 合并/取消暂停)+ browser-service 接线(B站 view 挂接、`browser:extensionPickAndInstall`、`browser:sniffDownload` 改走媒体引擎)+ preload 四桥 + UI 页三面(B站下载助手/抖音解析框/扩展管理视图)。依据:②一比一(源码在位,脚本资产已迁);新增单测 3 件 23 例,全仓 browser 87 例全绿。剩余:面板/历史通道见 #2。
2. **下载面板/历史收尾**(P0 #3 余量):`downloads-history.json` 持久化(300 条)、任务档案 snapshot/OpenFile/Reveal/RemoveRecord/GetDir/SetDir 通道、浮窗下载面板或页面历史视图承接(media-storage 数据面已在)。
3. **壳层健壮性五件**(P1 #6-#10):小切口,各自独立可测。
