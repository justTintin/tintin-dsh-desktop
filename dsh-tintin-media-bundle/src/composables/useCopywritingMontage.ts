// ═══════════════════════════════════════════════════════════════
// useCopywritingMontage — 智能混剪·服务端四步链路编排（M8 条目⑥ runner 层）
// 四步（对照原客户端 gui/video_montage_page.py steps_text L257，严格一致）：
//   1. 素材解析   POST /montage/split（同步返回 shots[]，ServerSplitWorker L121-171）
//   2. AI 编排    POST /montage/concat → 任务 → 轮询 GET /scheduled/tasks/{id} →
//        GET /montage/concat/result/{id}（montage_concat_server_worker L57-165：
//        stc.get_task 轮询 / status completed → result.video_url|url|output_url →
//        download_result 落盘；status failed/error → error_msg 透出）
//   3. 口播配音   TTS（voxcpm）逐条生成 + 视频合成（voice_clone_page.py VoiceCloneWorker）
//   4. 合成       POST /montage/bgm（同步返回 {ok, path, video_url}，特效包装/混音）
// 注：原客户端「卡点成片」属独立「一键成片」页（compile_video_page.py tab3，
//     BeatMontageController），不在智能混剪向导内，本端亦不纳入。
// 闭环口径：提交 → 轮询 → 结果下载/打开目录 → 失败重试（复用 useVideoRepair 模式）。
// 纯函数在 copywritingMontageLogic.ts（parser/builder 层），本文件仅编排（IRON-06/07）。
// ═══════════════════════════════════════════════════════════════

import { ref, computed, watch, onUnmounted } from 'vue'
import { clientError } from '../utils/clientLog'
import { API_PATHS } from '../types/server-api'
import {
  // Step3 字幕样式（2026-09-17 用户裁决：字幕样式统一来自服务端 /subtitle_styles）
  serverStylesToPresets,
  SUBTITLE_STYLE_PRESETS_FALLBACK,
  subtitlePresetTileStyle,
  type SubtitleStylePreset,
  // 文字模板（2026-09-09 裁决：服务端 textfx 体系，与花字独立）
  TEXT_RANDOM_COUNT_OPTIONS,
  TEXT_KEYWORD_DENSITY_OPTIONS,
  TEXT_KEYWORD_DENSITY_MAX,
  pickRandomItems,
  extractFancyWordsFromText,
  buildSubtitleRows,
  buildTextFxTracks,
  textFxStyleOf,
  type TextFxTrack,
  // Step4 特效包装（对照 step4_final_view.py / FinalMixWorker / JianyingExporter）
  buildBgmGenPayload,
  parseBgmGenResponse,
  BGM_STYLE_OPTIONS,
  type BgmGenPayload,
  resolveOutFinalDir,
  collectMixCandidates,
  buildFinalTasks,
  fmtBgmTime,
  srcDirName,
  SHOT_TYPE_LABELS,
  SHOT_TYPE_COLORS,
  type SplitSceneRow,
  // Step3 口播配音（对照 step3_voice_view.py / VoiceCloneWorker api / VideoDubbingWorker）
  type VoiceRow,
  FANCY_STYLE_OPTIONS,
  AI_REWRITE_DESC,
  rewriteTemperature,
  buildRewriteSystemPrompt,
  cleanRewriteContent,
  FANCY_POSITION_OPTIONS,
  SUBTITLE_BG_OPTIONS,
  resolveOutMontageDir,
  FPS_OPTIONS,
  voiceStatusText,
  voiceStatusClass,
  fmtDur,
  pathBasename,
  inputNameFromFinalPath,
  // 字幕重切段后处理（2026-09-18 用户裁决：声音克隆完成后即处理）
} from './copywritingMontageLogic'
// 原客户端 SentenceSplitterLLMWorker 拆句机器已整体退役（2026-09-29 报障：
// 品牌词 Blue VO!CE 被半角 ! 跨任务切碎；TTS 文本一律整段直发不拆句），
// 本文件仅剩 extractLlmContent 活消费
import { extractLlmContent } from './voiceCloneLogic'
import { readCacheDir } from './useSettingsConfig'
import { joinDefaultPath } from './settingsIntegrationLogic'
// 模块级工具/轮询常量与 Step1/Step2 编排已迁 montage/（铁律 10 拆分，纯搬迁，
// 蓝图见 docs/智能混剪拆分迁移映射_2026-09-18.md）
import { notify, errText, createMontageSharedRuntime } from './copywritingMontage/context'
import {
  voiceoverCandidatesFromResponse,
  productDescFromInfo,
} from './copywritingMontageStep2ConcatLogic'
import type { VoiceoverCandidate } from './copywritingMontageStep2ConcatLogic'
// 文案编写页选择产品（公共弹窗 WbPickProductDialog）：PickerItem → sharedProductInfo 同
// 镜头重组页弹窗 onPickProduct 口径（stripProductCodeFromModel 型号剥编码 / 关联关键词带回）
import type { PickerItem } from './useWorkbenchPickers'
import { markdownListLines, stripProductCodeFromModel, parseProductKeywords } from './opsProductLibraryLogic'
import { useCopywritingMontageStep1Split } from './copywritingMontage/useCopywritingMontageStep1Split'
import { detectShotKeyword, filterMaterialsByDupMode, projectIdentityOf } from './copywritingMontageStep1SplitLogic'
import { useCopywritingMontageStep2Concat } from './copywritingMontage/useCopywritingMontageStep2Concat'
import { useCopywritingMontageStep3Voice } from './copywritingMontage/useCopywritingMontageStep3Voice'
import { useCopywritingMontageStep4Final } from './copywritingMontage/useCopywritingMontageStep4Final'

export function useCopywritingMontage() {
  // 2026-09-23 模块代码前缀两连改（产品名仍为文案混剪）：copy-montage → plan-montage → copywriting-montage。
  // localStorage 历史键一次性迁移（copy-montage.* 与 plan-montage.* 两个来源均收）——
  // 新键不存在时整串复制（旧键保留作回滚保险）。必须先于各 step 组合函数的 revive 恢复执行，故置于本函数首行。
  try {
    const legacyPrefixes = ['copy-montage.', 'plan-montage.']
    const staleKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && legacyPrefixes.some((p) => k.startsWith(p))) staleKeys.push(k)
    }
    for (const k of staleKeys) {
      const nk = 'copywriting-montage.' + k.slice(legacyPrefixes.find((p) => k.startsWith(p))!.length)
      if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k) as string)
    }
  } catch (_) { /* 存储不可写静默 */ }
  // ── 共享运行时（已迁 montage/context.ts，铁律 10 纯搬迁；
  //    clearBusy 槽经 setClearBusy 存取，槽语义不变）──
  const {
    serverUrl, ensureServerUrl, toAbsolute,
    polling, activeTaskId, statusText,
    stopPolling, cancelPolling, abortPolling, startPolling, setClearBusy,
  } = createMontageSharedRuntime()

  // ── 跨步共享 ref（铁律 10 拆分上提：Step3 textfx 与 Step4 混音/合成双向消费，
  //    上提至主文件使两侧函数体零改动；见映射文档 §四）──
  const finalBusy = ref(false)
  const finalDone = ref(false)     // 三按钮启用开关（原版 btn_open_final_dir 等初始 disabled）
  const finalVideoList = ref<Array<{ name: string; path: string }>>([])
  const finalVideoPath = ref('')   // 首个成片（final_video_path 口径）
  /** Step4 合成候选路径（界面统一联动预览 2026-09-10：右栏预览块数据源；
   *  与 textFxPreviewTracks 同批刷新，另在 enterStep4 主动刷一次不依赖 textFx 开关） */
  const step4Candidates = ref<string[]>([])
  // finalProgress 同属跨步共享：nextVoiceChannel（Step3）写、Step4 混音读写
  const finalProgress = ref(-1)    // 混音进度 0-100（-1=隐藏；原版共享 progress_bar 口径）

  // ══ Step1 素材解析（已迁 montage/useCopywritingMontageStep1Split.ts，铁律 10 纯搬迁；
  //    解构回原名 → 下文与 return 键集合零改动）═════════════════
  // 素材重复度（2026-11-05 用户裁定：导入素材量过大——按分镜脚本景别需求×三档筛选，
  //  默认中度；dupMode 随选择素材弹窗下拉切换）
  const dupMode = ref<'low' | 'mid' | 'all'>('mid')
  const applyMaterialFilter = (paths: string[]): string[] => {
    // 从各分镜脚本镜头的「镜别」聚合景别需求：sums=跨脚本总和（mid 档=各脚本独立
    // 配齐）、needs=单脚本最大（low 档=跨脚本复用最省）、scripts=脚本个数
    const needs: Record<string, number> = {}
    const sums: Record<string, number> = {}
    let scripts = 0
    for (const t of storyboards.value) {
      if (!t.shots.length) continue
      scripts++
      const per: Record<string, number> = {}
      for (const sh of t.shots) {
        const kw = detectShotKeyword(String(sh.shot_type || ''))
        if (!kw) continue
        per[kw] = (per[kw] || 0) + 1
      }
      for (const [kw, n] of Object.entries(per)) {
        sums[kw] = (sums[kw] || 0) + n
        needs[kw] = Math.max(needs[kw] || 0, n)
      }
    }
    return filterMaterialsByDupMode(paths, { needs, sums, scripts }, dupMode.value)
  }
  const step1 = useCopywritingMontageStep1Split({
    statusText, ensureServerUrl, toAbsolute, materialFilter: applyMaterialFilter,
    // 项目身份签名（2026-11-06 用户裁决：一次完整文案混剪=一个项目）=本轮生成口径的
    // product_desc（有产品按产品、无产品按提示词）；签名变化=换项目，下次分割开新目录
    projectSignature: () => projectIdentityOf(copyPrompt.value, productDescFromInfo(sharedProductInfo.value || {})),
  })
  const {
    srcVideos, srcDurations, threshold, minSceneLen, imageDuration,
    scenes, scoreFilter, filteredScenes,
    splitBusy, splitError, splitMsg, splitProgress, splitResolution, splitFps,
    splitsJobId, splitsDownloading,
    previewUrl, previewTranscoding,
    addVideos, selectFolder, onDrop, removeVideo, clearAllVideos: clearAllVideosStep1, runSplit, splitMode, requestStopSplit, splitStatusOf,
    updateSceneDesc, previewSourceVideo, previewScene, closePreview,
    clearSplitCache, openSplitsDir, restoreProjectBatch,
  } = step1

  // ── 出入场超长片段自动裁剪（已迁 useCopywritingMontageStep1Split.ts，铁律 10 纯搬迁）──

  /** 取消/复位统一清 busy（方案生成 / 确认合成 / 口播文案 / 混音四个异步步） */
  function clearAllBusy(): void {
    concatBusy.value = false
    confirmBusy.value = false
    copyBusy.value = false
    finalBusy.value = false
  }

  // ══ Step2 镜头重组（已迁 montage/useCopywritingMontageStep2Concat.ts，铁律 10 纯搬迁；
  //    clearBusy 槽赋值改走 setClearBusy，语义不变；解构回原名→ return 键零改动）══
  const step2 = useCopywritingMontageStep2Concat({
    statusText, ensureServerUrl, toAbsolute, startPolling, setClearBusy,
    clearAllBusy, scenes, splitFps, splitResolution, srcVideos, splitsJobId,
  })
  const {
    assembleLogic, concatLayout, concatFps, durationLimit, DURATION_LIMITS,
    batchCount, recBatchCount, randomness,
    concatTransition, concatBusy, confirmBusy, copyBusy, concatError, concatProgress,
    edgeSpeedup, EDGE_SPEEDUP_OPTIONS, TRANSITIONS,
    checkedCount, assemblePlans, currentPlanIdx, currentPlan, hasUnconfirmed,
    confirmedPaths, concatResults, seqClips, seqIdx, seqSrc, detailDragFrom,
    planConfirmQueue, sharedProductInfo,
    planDurText, runConcat, runConcatFromAllStoryboards, planRowText, selectPlan, startSeqPreview, onSeqEnded,
    submitConcatTask, confirmAllPrecompose, confirmPlanSingle,
    openProductDlg, productDlg, closeProductDlg, productDlgGenerate,
    copyViewDlg, viewPlanCopy, closeCopyView,
    planMenu, openPlanMenu, closePlanMenu,
    onDetailDragStart, onDetailDragEnd, onDetailDrop, toggleClipDeleted,
  } = step2

  // ══ 文案编写页（2026-10-03 用户裁决三连：①场景选择与时长限制删除——写法维度由
  //    服务端 FORMULAS 承担、时长走服务端缺省预算；②生成改调 /copywriting/voiceover
  //    十稿全量（formula 缺省=每次 10 种文案写法），客户端弹窗挑选确认一种写入文案框；
  //    ③高级脚本设置整体删除——自定义文案要求随入口退役，hint 不传。旧客户端提示词链
  //    （生成方式/段落数量/系统提示/场景指令织入）整体退役——服务端自持 prompt（字数
  //    预算/扩缩重试/终结标点/平台指引）。保留：选择产品（product_desc 必填）、平台下拉
  //    （→platform 结构化直传，字典 GET /copywriting/platforms）。文案仍为页面级草稿
  //    （localStorage 只存 copy）══
  const scriptLsKey = (k: string): string => `copywriting-montage.script.${k}`
  // 投放平台（2026-10-03 用户裁决：场景后平台下拉，默认抖音）——字典/默认值均来自
  // 服务端 GET /copywriting/platforms；选中名随请求 platform 直传（指引由服务端织入）
  interface PlatformItem { name: string; guide: string }
  const platformOptions = ref<PlatformItem[]>([])
  const platformDefault = ref('抖音')
  const scriptPlatform = ref('抖音')    // 选中平台名（恒非空——2026-11-05 用户报障空下拉）
  async function loadPlatforms(): Promise<void> {
    try {
      const res = await window.tintin.server.get(API_PATHS.copywriting.platforms)
      const data = (res && typeof res === 'object' ? res : null) as { default?: string; platforms?: Array<{ name?: string; guide?: string }> } | null
      const list = Array.isArray(data?.platforms) ? data!.platforms! : []
      platformOptions.value = list
        .filter((x) => x && typeof x.name === 'string' && x.name)
        .map((x) => ({ name: String(x.name), guide: String(x.guide || '') }))
      if (typeof data?.default === 'string' && data.default) platformDefault.value = data.default
      // 兜底：抖音恒在字典（2026-11-05 用户报障「默认平台没了」——服务端字典变更/缺项时
      // 选中值落空，下拉显示空白）
      if (!platformOptions.value.some((p) => p.name === '抖音')) {
        platformOptions.value = [{ name: '抖音', guide: '' }, ...platformOptions.value]
      }
      // 选中值优先保持用户已选；否则取服务端 default；default 也不在字典则取字典首项
      //（选中值恒有对应选项，下拉不再出现空白）
      const keep = platformOptions.value.some((p) => p.name === scriptPlatform.value)
      if (!keep) {
        const def = platformDefault.value || '抖音'
        scriptPlatform.value = platformOptions.value.some((p) => p.name === def)
          ? def
          : (platformOptions.value[0]?.name || '抖音')
      }
    } catch (err) {
      // 字典拉取失败不阻塞生成：保底"抖音"（服务端对未知平台 400 会显式暴露）
      if (!scriptPlatform.value) scriptPlatform.value = '抖音'
      clientError('copywriting-montage', '平台字典拉取失败，使用默认抖音', err)
    }
  }
  const manualCopy = ref('')            // 视频文案（可选，可编辑）
  const manualCopyBusy = ref(false)     // 「AI生成视频文案」进行中（唯一生成入口；
  // 2026-11-05 用户裁定：「根据产品生成文案」按钮回归纯产品选择，不触发生成）
  // 生成提示词（2026-11-05 用户裁决：无产品时按输入提示词生成文案；有产品时产品优先，
  // 提示词忽略。随本地设置持久化，重启保留）
  const copyPrompt = ref('')
  // localStorage 恢复：显式判 null 为未设置才回退默认
  const lsGet = (k: string): string | null => {
    try { return localStorage.getItem(scriptLsKey(k)) } catch { return null }
  }
  // 2026-11-05 用户裁决：视频文案进来默认空——历史草稿不再持久化/回填（旧裁决
  // 「文案随本地设置保存」随之废止）；提示词输入保留持久化
  const savedPrompt = lsGet('prompt')
  if (savedPrompt !== null) copyPrompt.value = savedPrompt
  function persistScript(): void {
    try {
      localStorage.setItem(scriptLsKey('prompt'), copyPrompt.value)
    } catch { /* 隐私模式等写入失败静默 */ }
  }
  watch([copyPrompt], persistScript)
  /** 进入文案混剪模块默认空态（2026-11-05 用户裁决：视频文案进来默认空；
   *  同日追加裁定：上次会话的分镜标签不残留——「不是这次选择的应该没有」。
   *  分镜列表整体清空：文案框/分镜区/标签行全部回到本次会话的空白起点，
   *  历史脚本仍以服务端脚本库为准；挂载/KeepAlive 每次进入都执行（幂等） */
  function resetScriptPageOnEnter(): void {
    activeStoryboardId.value = ''
    manualCopy.value = ''
    storyboards.value = []
  }

  /** 文案编写页「选择产品」（公共弹窗 WbPickProductDialog）：PickerItem → sharedProductInfo
   *  （与镜头重组页弹窗 onPickProduct 同口径：型号剥商品编码、关联关键词随选带回、
   *  核心卖点逐条拼入）。产品信息单一来源 → 本页生成提示词与后续命中管线共用，
   *  镜头重组页弹窗打开时即预填本产品 */
  function applyScriptProduct(it: PickerItem): void {
    sharedProductInfo.value = {
      brand: String(it.brand || ''),
      product: String(it.category || ''),
      model: stripProductCodeFromModel(it.model),
      keywords: parseProductKeywords(it),
      extra: markdownListLines(it.selling_points).join('\n'),
    }
  }

  /** 清除已选产品（恢复空产品信息） */
  function clearScriptProduct(): void {
    sharedProductInfo.value = { brand: '', product: '', model: '', extra: '', keywords: [] }
  }

  // ── 十稿全量生成与挑选确认（2026-10-03 用户裁决：服务端每次返回 10 种文案写法；
  //    2026-11-05 用户裁决二改：弹窗改多选——按勾选个数装载，每种勾选稿一个「仅文案」
  //    分镜 tab（由「AI 生成分镜脚本」批量补全分镜），不再单稿写回文案框）──────────
  const voiceoverCandidates = ref<VoiceoverCandidate[]>([])
  const voiceoverFailedFormulas = ref<string[]>([])
  const voiceoverDlgOpen = ref(false)
  const voiceoverSelectedIdxs = ref<number[]>([])
  function closeVoiceoverDlg(): void { voiceoverDlgOpen.value = false }
  /** 确定采用勾选稿（可多选）：每种勾选稿装载为一个分镜 tab（shots 留空待批量补全），
   *  替换上一批「仅文案」装载；已生成分镜的 tab 不受影响。loadCopyCandidateTabs 在
   *  step3 组合函数（本函数体延迟执行，声明顺序无碍） */
  function confirmVoiceoverCandidates(): void {
    const picks = voiceoverSelectedIdxs.value
      .map((i) => voiceoverCandidates.value[i])
      .filter((c): c is VoiceoverCandidate => !!c && !!c.text.trim())
    if (!picks.length) {
      notify('未选择文案', '请先勾选要采用的文案写法（可多选）。')
      return
    }
    const n = loadCopyCandidateTabs(picks.map((c) => ({ name: c.formula, narrative: c.text })))
    voiceoverDlgOpen.value = false
    const secs = picks.length > 1 ? `，共 ${picks.length} 份` : ''
    statusText.value = `完成：已装载 ${n} 份文案${secs}，点击「✨ AI 生成分镜脚本」为每份各生成一套分镜`
    notify('已装载文案', `已按勾选装载 ${n} 份文案（每份一个分镜标签）；点击「✨ AI 生成分镜脚本」将为每份文案各生成一套分镜。`)
  }

  /** ✨ 生成视频文案：POST /copywriting/voiceover 十稿全量（formula 缺省=每次 10 种）；
   *  2026-11-05 用户裁决：product_desc 取值=有产品按产品（productDescFromInfo），无产品
   *  按输入提示词（提示词文本即 product_desc——服务端必填缺失 400），两者皆空报错。
   *  时长不再由客户端指定（走服务端缺省 30s 字数预算）。活服务端未部署新版时
   *  响应为旧版单稿形态（顶层 text）→ 直接采用免弹窗（双形态兼容见逻辑层归一） */
  async function genVoiceoverCandidates(): Promise<void> {
    if (manualCopyBusy.value) return
    const desc = productDescFromInfo(sharedProductInfo.value || {})
    const prompt = copyPrompt.value.trim()
    if (!desc && !prompt) {
      notify('无法生成', '两个方案必须有一个：请「选择产品」（方案一），或输入提示词（方案二）后再生成。')
      return
    }
    manualCopyBusy.value = true
    try {
      const resp = await window.tintin.server.post(API_PATHS.copywriting.voiceover, {
        product_desc: desc || prompt,
        platform: scriptPlatform.value,
      })
      const parsed = voiceoverCandidatesFromResponse(resp)
      if (!parsed.candidates.length) {
        // 断点值纪律：契约外响应必须带实得键名，不发明字段
        const keys = resp && typeof resp === 'object' ? Object.keys(resp as object).join(',') : 'null'
        clientError('copywriting-montage', `文案生成响应无可用文稿（实得字段：${keys}）`, { resp })
        notify('生成失败', `服务端未返回可用的文案稿（实得字段：${keys}）`)
        return
      }
      if (parsed.single || parsed.candidates.length === 1) {
        // 旧版服务端单稿形态（顶层 text）→ 同样装载为分镜标签（2026-11-05 用户裁定：
        // 文案与脚本一一对应，不再写全局草稿——视频文案随脚本显示、进默认空）
        loadCopyCandidateTabs([parsed.candidates[0]!].map((c) => ({ name: c.formula, narrative: c.text })))
        if (parsed.failedFormulas.length) {
          notify('部分写法出稿失败', `未出稿写法：${parsed.failedFormulas.join('、')}`)
        }
        return
      }
      voiceoverCandidates.value = parsed.candidates
      voiceoverFailedFormulas.value = parsed.failedFormulas
      voiceoverSelectedIdxs.value = [0] // 默认勾选第一种（旧单选默认的延续，可增勾）
      voiceoverDlgOpen.value = true
    } catch (e) {
      clientError('copywriting-montage', '生成视频文案失败', errText(e))
      notify('生成失败', errText(e))
    } finally {
      manualCopyBusy.value = false
    }
  }

  // ══ Step3 口播配音（已迁 montage/useCopywritingMontageStep3Voice.ts，铁律 10 纯搬迁；
  //    S3↔S4 双向点经 ctx：collectCandidates/ensureProcessedSrt 惰性 lambda、
  //    finalBusy/step4Candidates 上提主文件，见映射文档 §四）══
  const step3 = useCopywritingMontageStep3Voice({
    statusText, serverUrl, ensureServerUrl, assemblePlans, previewUrl,
    finalBusy, finalProgress, finalDone, finalVideoList, finalVideoPath,
    step4Candidates, sharedProductInfo,
    // 素材池（2026-09-29 跨机绑定恢复：按 serverPath 入池/去重，deep watch 自动持久化）
    scenes,
    // 2026-09-21 用户裁决：第一步文案带入口播配音页（扫描建行无 .txt 时回退）
    getScriptCopy: () => manualCopy.value,
    // 选择脚本应用时回填旁白（第一步文案 = 镜头旁白拼接，与分镜脚本页「继续创作」同口径）
    setScriptCopy: (text: string) => { manualCopy.value = text },
    collectCandidates: (useSource?: boolean) => step4.collectCandidates(useSource),
    ensureProcessedSrt: (text: string, wavPath: string, candidate: string) =>
      step4.ensureProcessedSrt(text, wavPath, candidate),
  })
  const {
    voiceDirInput, selectedVoiceFiles, voicesDir, voiceRows,
    refSamples, selectedRefSample, refAudioPath, refAudioLabel, refPreviewUrl, refText,
    ttsApiUrl, ttsSteps, ttsCfg, ttsSpeedMin, ttsSpeedMax,
    // Qwen3-TTS 专属（2026-09-20 用户裁决）
    qwen3Speaker, qwen3Instruct, qwen3Voices, qwen3VoicesLoading, loadQwen3Voices,
    addSubtitles, subtitleFont, fontOptions, fontsLoading,
    fancyEnabled, fancyStyle, subtitleStyleKey, subtitleStylePresets, subtitleAnimKey,
    subtitleFontSize, fancyPosition, subtitleBgOpacity, fancyTemplateId, fancyTemplates,
    fancyPreviews, fancyTemplatesLoading, textFxEnabled, lutRestore, lutId, lutList,
    lutListLoading, textTemplateId, textRandomCount, textKeywordDensity, textTemplates,
    textTemplatesLoading, activeTextPool, activeTextCount, textTemplateOptions,
    textFxPreviewTracks, textFxStyleSamples, srvBase, rewriteTemp, aiRewriteDlg,
    textFxAnnotate, addManualKeyword, removeManualKeyword, addManualAnnot, removeManualAnnot, annotsFor,
    ttsEngine, ttsDurationFactor, ttsEmoText, ttsEmoAlpha, ttsPauseMs, cloneParamsDlg,
    editDlg, voiceBusy, rewriteBusy, voiceProgress,
    copyShots, copyShotsStale, shotClipGroup, bindShotMaterial, removeShotClipAt, unbindShotMaterial, genStoryboard, storyboardBusy, scriptSaving, saveStoryboard,
    storyboards, activeStoryboardId, activeStoryboard, setActiveStoryboard, renameStoryboardTab, removeStoryboardTab, activeNarrative, COPY_STORYBOARD_MAX,
    loadCopyCandidateTabs, voiceDone, voiceTotal, cloneProgressLabel, lastCloneFailedIds, retryFailedClones,
    scriptPickDlg, openScriptPick, refreshScriptOptions, pickDetail, selectScriptOption, applySelectedScript, syncStoryboardsToServer,
    refreshTabNamesFromServer,
    loadLuts, loadCatalogLanes, resolveKeywordHits,
    currentMatchTemplateIds, refreshTextFxTracks, loadTextTemplates, ensureTtsApiUrl,
    nextVoiceChannel, clearVoiceProgressListener, scanVoiceDir, enterStepVoice,
    loadRefSamples, selectRefAudio, pickNewSampleFile, transcribeNewSample,
    nsFilePath, nsName, nsText, nsError, nsSuccess, nsBusy, nsTranscribing,
    uploadNewSampleRef, batchAiRewrite, startSynthesizeVoice, runDubBatch, runCloneBatch,
    selectedFontFamily, ensureServerFontFace, fontOptionStyle, selectedSubtitlePreset,
    subtitlePreviewStyle, refreshFonts, refreshSubtitleStyles, loadFancyTemplates,
    selectedFancyTemplate, openEditDlg, saveEditDlg, exportVoice, playRowVideo,
    playDubbedVideo, toggleLengthMode, lengthModeTip, regenVoice,
    openRewriteSettings, closeRewriteSettings, saveRewriteSettings,
    openCloneParams, closeCloneParams, saveCloneParams,
  } = step3

  // 清空素材=清此项目原绑定素材（2026-11-06 用户裁决）：列表/选择池/分割状态之外，
  // 各分镜 tab 的 clipGroups 绑定一并清空——旧实现只清列表（确认文案却写「绑定随之
  // 失效」），重应用脚本会经 restoreTabClipGroups 把旧批素材重新入池=清空后旧素材复活
  function clearAllVideos(): void {
    clearAllVideosStep1()
    for (const t of storyboards.value) t.clipGroups = []
  }
  // 项目素材批次恢复（2026-11-06 用户裁决：按项目身份校验，本项目的批次才恢复）——
  // 须在提示词/产品状态装配完成后调用（签名依赖两者），故挂在编排层 init 尾部
  restoreProjectBatch()

  // ══ Step4 特效包装（已迁 montage/useCopywritingMontageStep4Final.ts，铁律 10 纯搬迁；
  //    ctx 消费 step2/step3 产物与上提 ref，见映射文档 §四）══
  const step4 = useCopywritingMontageStep4Final({
    statusText, ensureServerUrl, toAbsolute, assemblePlans, concatTransition,
    sharedProductInfo, splitResolution, voiceRows, voiceDirInput,
    // 2026-09-30 用户裁决：草稿名产品回退源——全局产品为空（如重启后未重选且缓存损坏）
    // 时取激活分镜的产品快照（productBrief 随 storyboards 持久化）
    activeProductBrief: () =>
      storyboards.value.find((t) => t.id === activeStoryboardId.value)?.productBrief || '',
    // 2026-09-22 用户裁决：候选↔分镜按方案 tabId 精确解析（原 getTabVoiceWavs 过滤
    // 未生成 tab 与 getTabNarratives 不过滤口径不一致，候选按下标错位拿错声音/旁白）
    getTabById: (id: string) =>
      storyboards.value
        .filter((t) => t.id === id)
        .map((t) => ({ voiceWav: t.voiceWav, narrative: t.narrative, transition: t.transition, shots: t.shots.map((s) => ({ sfxWavLocal: s.sfxWavLocal, sfxDurSec: s.sfxDurSec })) }))[0] ?? null,
    runDubBatch, nextVoiceChannel, loadTextTemplates, refreshTextFxTracks,
    currentMatchTemplateIds, resolveKeywordHits,
    scanVoiceDir, activeTextPool,
    activeTextCount, selectedFancyTemplate, selectedSubtitlePreset, selectedFontFamily,
    addSubtitles, subtitleStyleKey, subtitleBgOpacity, subtitleAnimKey, fancyEnabled,
    fancyStyle, fancyPosition, textFxEnabled, lutRestore, lutId, textTemplateId,
    textKeywordDensity, subtitleFontSize, clearVoiceProgressListener,
    finalBusy, finalProgress, finalDone, finalVideoList, finalVideoPath, step4Candidates,
  })
  const {
    bgmPath, bgmName, bgmVolume, rowBgm, finalMode, exportBusy, exportProgress, exportStage,
    lastExportDraftPath, exportDoneMsg, exportWarnMsg, trackChecks, finalSelIdx, finalPreviewUrl, finalPreviewTitle,
    bgmSource, bgmGenPrompt, bgmGenStyle, bgmGenDuration, bgmGenBusy, bgmGenError, bgmGenUrl,
    bgmGenMeta, bgmPreviewUrl, bgmPlaying, bgmPosMs, bgmDurMs, lastComposeTasks,
    generateBgm, downloadLibraryBgm, applyLibraryBgm, pickBgm, rowBgmName, setRowBgm,
    clearRowBgm, pickRowBgm, rowBgmForCandidate, collectCandidates, ensureProcessedSrt,
    enterStep4, startFinalMix, openFinalDir, openExportDraftDir, exportAllToJianyingDraft,
    previewFinalVideo,
    toggleBgmPlay, stopBgmPlay, onBgmVolumeInput, seekBgm,
    // 导出到视频剪辑项目（2026-10-21 用户裁决：替换「服务端生成」占位）
    ofBusy, ofStage, ofProject, ofProgress, ofChecks, exportToEditingProject, openEditingProject,
    filmPlugin, ofRendered, ofRendering, renderExportedProject,
  } = step4

  onUnmounted(() => {
    abortPolling()
    clearVoiceProgressListener()
  })

  // ── 每脚本视频设置（2026-09-23 用户裁决：输出画幅/转场/帧率按 tab 绑定）──
  // 读写都落在激活 tab 上（切 tab 即切设置）；无 tab 回退全局 ref（legacy 口径）。
  // 时长限制=派生只读值：跟随本 tab 克隆声音时长，未生成回退全局（30 缺省）。
  const activeTabLayout = computed<string>({
    get: () => activeStoryboard.value?.layout ?? concatLayout.value,
    set: (v) => { const t = activeStoryboard.value; if (t) t.layout = v; else concatLayout.value = v },
  })
  const activeTabTransition = computed<string>({
    get: () => activeStoryboard.value?.transition ?? concatTransition.value,
    set: (v) => { const t = activeStoryboard.value; if (t) t.transition = v; else concatTransition.value = v },
  })
  const activeTabFps = computed<number | 'source'>({
    get: () => activeStoryboard.value?.fps ?? concatFps.value,
    set: (v) => { const t = activeStoryboard.value; if (t) t.fps = v; else concatFps.value = v },
  })
  const activeTabDurationLimit = computed(() => {
    const t = activeStoryboard.value
    return t && t.voiceDurSec > 0 ? Math.max(1, Math.round(t.voiceDurSec)) : Number(durationLimit.value)
  })

  return {
    // 共享
    serverUrl, polling, activeTaskId, statusText, cancelPolling, stopPolling,
    // Step1 素材解析
    srcVideos, srcDurations, threshold, minSceneLen, imageDuration,
    scenes, scoreFilter, filteredScenes, checkedCount,
    splitBusy, splitError, splitMsg, splitProgress, splitResolution, concatProgress,
    addVideos, selectFolder, onDrop, removeVideo, clearAllVideos, runSplit, splitMode, dupMode, requestStopSplit, splitStatusOf,
    // 文案编写（2026-10-03 用户裁决：平台选择 + 服务端十稿全量；2026-11-05 二改：
    // 提示词兜底 + 弹窗多选按勾选个数装载）
    sharedProductInfo, applyScriptProduct, clearScriptProduct,
    manualCopy, manualCopyBusy, activeNarrative, syncStoryboardsToServer,
    storyboards, activeStoryboardId, activeStoryboard, setActiveStoryboard, renameStoryboardTab, removeStoryboardTab, COPY_STORYBOARD_MAX,
    scriptPlatform, platformOptions, platformDefault, loadPlatforms,
    copyPrompt, resetScriptPageOnEnter,
    voiceDone, voiceTotal, cloneProgressLabel, lastCloneFailedIds, retryFailedClones,
    voiceoverCandidates, voiceoverFailedFormulas, voiceoverDlgOpen, voiceoverSelectedIdxs, closeVoiceoverDlg,
    genVoiceoverCandidates, confirmVoiceoverCandidates,
    updateSceneDesc, previewSourceVideo, previewScene, closePreview, clearSplitCache,
    previewUrl, previewTranscoding, openSplitsDir, splitsDownloading,
    // Step2 镜头重组
    assembleLogic, concatLayout, durationLimit, DURATION_LIMITS, batchCount, recBatchCount,
    concatFps, FPS_OPTIONS, splitFps,
    concatTransition, edgeSpeedup, EDGE_SPEEDUP_OPTIONS, TRANSITIONS,
    // 每脚本视频设置（2026-09-23 用户裁决：按激活 tab 读写的绑定视图）
    activeTabLayout, activeTabTransition, activeTabFps, activeTabDurationLimit,
    concatBusy, confirmBusy, copyBusy, concatError,
    assemblePlans, currentPlanIdx, currentPlan, hasUnconfirmed, confirmedPaths,
    runConcat, planRowText, selectPlan, startSeqPreview,
    detailDragFrom, onDetailDragStart, onDetailDragEnd, onDetailDrop, toggleClipDeleted,
    submitConcatTask, confirmAllPrecompose, confirmPlanSingle,
    openProductDlg, productDlg, closeProductDlg, productDlgGenerate,
    copyViewDlg, viewPlanCopy, closeCopyView,
    planMenu, openPlanMenu, closePlanMenu,
    seqClips, seqIdx, seqSrc,
    onSeqEnded,
    concatResults, runConcatFromAllStoryboards,
    // Step3 口播配音（对照 step3_voice_view.py 逐控件）
    voiceDirInput, voicesDir, voiceRows,
    refSamples, selectedRefSample, refAudioPath, refText, selectRefAudio,
    ttsApiUrl, ttsSteps, ttsCfg, ttsSpeedMin, ttsSpeedMax,
    qwen3Speaker, qwen3Instruct, qwen3Voices, qwen3VoicesLoading, loadQwen3Voices,
    addSubtitles, subtitleFont, fontOptions, fontsLoading, refreshFonts,
    refreshSubtitleStyles,
    subtitleStyleKey, subtitleStylePresets, selectedSubtitlePreset, subtitlePreviewStyle,
    subtitleAnimKey,
    subtitleFontSize,
    fontOptionStyle,
    fancyEnabled, fancyStyle, fancyPosition, subtitleBgOpacity,
    fancyTemplateId, fancyTemplates, fancyPreviews,
    voiceProgress, fancyTemplatesLoading,
    selectedFancyTemplate, loadFancyTemplates,
    // 文字模板（textfx；与花字独立；随机样式默认 3 个）
    lutRestore, lutId, lutList, lutListLoading, loadLuts, textFxEnabled, textTemplateId, textTemplateOptions, textTemplates,
    textRandomCount, textKeywordDensity, TEXT_RANDOM_COUNT_OPTIONS, TEXT_KEYWORD_DENSITY_OPTIONS,
    textFxPreviewTracks, textFxStyleSamples, loadTextTemplates,
    textFxAnnotate, addManualKeyword, removeManualKeyword, addManualAnnot, removeManualAnnot,
    FANCY_STYLE_OPTIONS, FANCY_POSITION_OPTIONS, SUBTITLE_BG_OPTIONS, AI_REWRITE_DESC,
    aiRewriteDlg, openRewriteSettings, closeRewriteSettings, saveRewriteSettings,
    ttsEngine, ttsDurationFactor, ttsEmoText, ttsEmoAlpha, ttsPauseMs,
    cloneParamsDlg, openCloneParams, closeCloneParams, saveCloneParams,
    editDlg, openEditDlg, saveEditDlg,
    rewriteTemp,
    voiceBusy, rewriteBusy,
    copyShots, copyShotsStale, shotClipGroup, bindShotMaterial, removeShotClipAt, unbindShotMaterial, genStoryboard, storyboardBusy, scriptSaving, saveStoryboard,
    scriptPickDlg, openScriptPick, refreshScriptOptions, pickDetail, selectScriptOption, applySelectedScript,
    scanVoiceDir, enterStepVoice, loadRefSamples, refPreviewUrl,
    nsFilePath, nsName, nsText, nsError, nsSuccess, nsBusy, nsTranscribing,
    pickNewSampleFile, transcribeNewSample, uploadNewSampleRef,
    batchAiRewrite, startSynthesizeVoice,
    regenVoice, exportVoice, playRowVideo, playDubbedVideo,
    toggleLengthMode, lengthModeTip,
    voiceStatusText, voiceStatusClass, fmtDur, pathBasename,
    planDurText,
    // Step4 特效包装
    bgmPath, bgmName, bgmVolume, finalBusy, finalMode, finalDone, finalProgress,
    exportBusy, exportProgress, exportStage, // 2026-09-16：导出剪映时间轴进度
    lastExportDraftPath, // 2026-09-16：导出成功后草稿目录路径（供「打开草稿目录」按钮）
    exportDoneMsg, // 2026-09-18：导出完成提示行（内嵌「打开草稿目录」按钮）
    trackChecks, // 2026-10-13：逐轨检查清单（导出区左侧面板）
    exportWarnMsg,
    finalVideoList, finalVideoPath, finalSelIdx, finalPreviewUrl, finalPreviewTitle,
    bgmSource, bgmGenPrompt, bgmGenStyle, bgmGenDuration,
    bgmGenBusy, bgmGenError, bgmGenUrl, bgmGenMeta, bgmPreviewUrl,
    bgmPlaying, bgmPosMs, bgmDurMs,
    generateBgm,
    pickBgm, applyLibraryBgm, toggleBgmPlay, stopBgmPlay, onBgmVolumeInput, seekBgm,
    // 2026-09-18：逐视频 BGM 指派 + 弹窗下载助手（行目标不回填全局）
    rowBgm, rowBgmName, setRowBgm, clearRowBgm, pickRowBgm, downloadLibraryBgm, rowBgmForCandidate,
    enterStep4, startFinalMix, openFinalDir, openExportDraftDir,
    exportAllToJianyingDraft, previewFinalVideo, step4Candidates, toAbsolute,
    // 导出到视频剪辑项目（2026-10-21 用户裁决：替换「服务端生成」占位）
    ofBusy, ofStage, ofProject, ofProgress, ofChecks, exportToEditingProject, openEditingProject,
    filmPlugin, ofRendered, ofRendering, renderExportedProject,
    fmtBgmTime,
    // 景别分类（UI 展示用）
    SHOT_TYPE_LABELS, SHOT_TYPE_COLORS,
  }
}

