// useCopywritingMontageStep4Openfilm.ts — Step4「导出到视频剪辑项目」。
// (2026-10-21 用户裁决：方案二由「服务端生成」替换)。铁律 4：整块从
// useCopywritingMontageStep4Final.ts 原样外提，逻辑零改动；宿主通道
// openfilm:stageAsset / openfilm:writeFilm / openfilm.openProject 由
// dsh-tintin-bundle 的 tintinBridge 提供。
import { ref } from 'vue'
import type { Ref } from 'vue'
import { readCacheDir } from '../useSettingsConfig'
import { pathBasename, type PrecomposePlan } from '../copywritingMontageLogic'
import { notify, joinPath, errText } from './context'

/** 方案二开跑前的轨道检查行（与方案一「轨道检查」同口径：✓/✕ + 说明）。 */
export interface OfTrackCheck {
  label: string
  ok: boolean
  detail: string
}

/** 视频段间分隔（秒）——2026-11-05 用户裁定的 5 秒黑场，与剪映导出同口径。 */
const OF_GAP_SEC = 5

/** 视频剪辑插件可用性（2026-11-07 用户需求：有插件才可导出/渲染）：
 *  probing=探测中；ok=桥+视图+vendored 运行时都在；missing=不可用（reason 给原因） */
export interface OfPluginState {
  state: 'probing' | 'ok' | 'missing'
  reason: string
}

export interface CopywritingStep4OpenfilmDeps {
  assemblePlans: Ref<PrecomposePlan[]>
  getTabById: (id: string) => { voiceWav?: string; narrative?: string } | undefined
  toAbsolute: (url: string) => string
  readCacheDir: () => Promise<string>
  joinPath: (...parts: string[]) => string
  pathBasename: (p: string) => string
  notify: (title: string, message: string) => void
  bgmPath: Ref<string>
  bgmVolume: Ref<number>
  exportDoneMsg: Ref<string>
  /** 方案口播的对齐字幕资产（与剪映导出同源 ensureProcessedSrt：aligned.srt 优先）；
   *  空串=未找到（OpenFilm Studio 可一键 ASR 兜底） */
  getVoiceSrt: (text: string, wavPath: string, candidate: string) => Promise<string>
}

export function useCopywritingMontageStep4Openfilm(deps: CopywritingStep4OpenfilmDeps) {
  const { assemblePlans, getTabById, toAbsolute, bgmPath, bgmVolume, exportDoneMsg, getVoiceSrt } = deps
  // 把与剪映导出同源的剪辑方案时间线转译为 OpenFilm 项目：视频段顺序上 P1 轨、
  // 逐方案口播 wav 上 A 轨、全局 BGM 上音轨；素材经 openfilm:stageAsset 落进项目
  // assets/，时间轴经 openfilm:writeFilm 写 film.html。字幕/花字/转场/音效包装为
  // 剪映特有轨，v1 不转译（导出后可在 Studio 里继续精剪补齐）。
  const ofBusy = ref(false)
  const ofStage = ref('')
  const ofProject = ref('')
  // 2026-10-21 用户裁决：方案二同样要有真实进度与逐轨检验（素材/口播/BGM）。
  const ofProgress = ref(0)
  const ofChecks = ref<OfTrackCheck[]>([])
  // 2026-11-07 用户需求：有视频剪辑插件才可导出/渲染。判定=window.tintin.openfilm
  // 桥在（同步）+ openfilm:skills 的 native 非空（vendored 运行时在位，唯一不
  // spawn Studio 的运行时信号，client-ui 同款先例）；失败原因直接给用户文案。
  const filmPlugin = ref<OfPluginState>({ state: 'probing', reason: '' })
  const ofRendered = ref('')
  const ofRendering = ref(false)
  const ofExtOf = (path: string) => (String(path).match(/\.[a-z0-9]+$/i)?.[0] || '.mp4').toLowerCase()
  async function probeFilmPlugin(): Promise<void> {
    try {
      if (typeof (window as any).tintin?.openfilm !== 'object') {
        filmPlugin.value = { state: 'missing', reason: '视频剪辑插件未加载（TinTin 桥缺失）' }
        return
      }
      const r = await (window.tintin as any).openfilm.skills()
      if (Array.isArray(r?.native) && r.native.length > 0) { filmPlugin.value = { state: 'ok', reason: '' }; return }
      filmPlugin.value = { state: 'missing', reason: 'OpenFilm 运行时未安装：请重装 TinTin 安装包' }
    } catch (error) {
      filmPlugin.value = { state: 'missing', reason: `视频剪辑插件不可用：${errText(error)}` }
    }
  }
  void probeFilmPlugin()
  async function ofStageFile(project: string, rel: string, sourcePath: string): Promise<void> {
    const res = await (window.tintin as any).openfilm.stageAsset({ project, rel, sourcePath })
    if (res?.error) throw new Error(res.error)
  }
  async function openEditingProject(): Promise<void> {
    if (!ofProject.value) return
    try {
      await (window.tintin as any).openfilm.openProject({ project: ofProject.value })
      ;(window as any).__tintinChrome?.open?.('openfilm')
    } catch (error) { notify('打开失败', String((error as Error)?.message || error)) }
  }
  async function exportToEditingProject(): Promise<void> {
    if (ofBusy.value) return
    if (filmPlugin.value.state === 'missing') { notify('视频剪辑插件不可用', filmPlugin.value.reason); return }
    ofBusy.value = true
    ofProgress.value = 0
    ofChecks.value = []
    ofRendered.value = ''
    ofStage.value = '正在准备剪辑方案...'
    try {
      // 与 exportMontageTracksDraft 同源的时间线组装（虚拟剪辑方案）
      const vPlans = assemblePlans.value.filter(
        (p): p is typeof p & { groups: NonNullable<typeof p.groups>; tabId: string } =>
          !!(p.confirmed && p.virtual && p.groups?.length && p.tabId),
      )
      if (!vPlans.length) { notify('没有剪辑方案', '请先在「视频素材」页完成智能匹配并点「生成剪辑方案」。'); return }
      ofStage.value = '正在准备剪辑方案素材...'
      const allScenes = vPlans.flatMap((p) => p.groups.flatMap((g) => g.scenes))
      let prepared = 0
      for (const s of allScenes) {
        if (!s.clipLocalPath && s.clipUrl) {
          try {
            const dir = joinPath(await readCacheDir(), 'montage_cache', 'groups')
            const local = joinPath(dir, `${s.idx}_${pathBasename(s.name)}`)
            await window.tintin.server.downloadResult(toAbsolute(s.clipUrl), local)
            s.clipLocalPath = local
          } catch (_) { /* 缺失片段在下方显式报错 */ }
        }
        prepared += 1
        ofProgress.value = 5 + Math.round((prepared / Math.max(1, allScenes.length)) * 25)
        ofStage.value = `准备剪辑方案素材 ${prepared}/${allScenes.length}`
      }
      interface OfSeg { path: string; durSec: number; c0: number }
      const segs: OfSeg[] = []
      const voices: Array<{ path: string; at: number; narrative: string; candidate: string }> = []
      let missing = 0
      // 2026-11-06 用户裁决（方案 B+方案级间隔）：全部方案顺序铺一条视频轨，5s 黑场
      // 只加在方案成片之间（方案内镜头紧密）。原先 c0 每方案清零，四方案全叠在 0 秒
      // ——Studio 把重叠段拆成平行 lane，而 lane 共享所属轨（<section>）的静音/隐藏
      // 状态（film.html 状态存轨上），无法单 lane 操作。
      let c0 = 0
      vPlans.forEach((p) => {
        const tab = getTabById(p.tabId)
        if (!tab) return
        let planStart = -1
        p.groups.forEach((g) => {
          g.scenes.forEach((s, si) => {
            const durSec = Math.max(0.1, Number(g.useDurs[si]) || Math.max(0.1, Number(s.duration) || 0.1))
            if (!s.clipLocalPath) { missing += 1; return }
            // 以文件时长收口（2026-10-21 实机：计划时长 5.17 秒 > 文件 5.166667 秒，
            // film.html 的 #t=0,5.17 越界，Studio 报 "ends past the file's length" 拒绝绘制）
            const fileDur = Number(s.duration) || 0
            const cut = fileDur > 0.05 ? Math.min(durSec, Math.max(0.05, fileDur - 0.02)) : durSec
            if (planStart < 0) planStart = c0
            segs.push({ path: s.clipLocalPath, durSec: cut, c0 })
            c0 += cut
          })
        })
        c0 += OF_GAP_SEC // 方案成片之间 5s 黑场；末方案后多出的 5s 不落在任何 clip 上
        if (planStart >= 0 && tab.voiceWav) voices.push({ path: tab.voiceWav, at: planStart, narrative: String(tab.narrative || ''), candidate: tab.voiceWav })
      })
      const bgm = String(bgmPath.value || '')
      const totalSec = segs.reduce((sum, seg) => sum + seg.durSec, 0)
      // 字幕旁挂（2026-11-07 用户需求）：SRT（wav 自身秒）→ VTT 1:1 抄写零换算；
      // OpenFilm 的字幕载体=媒体同目录同名 .vtt（film.html 严格解析不收文本元素）
      const srtOfVoice = new Map<string, string>()
      for (const v of voices) {
        const srtPath = await getVoiceSrt(v.narrative, v.path, v.candidate)
        if (srtPath) srtOfVoice.set(v.path, srtPath)
      }
      // 逐轨检验（导出前一次性生成，导出后在按钮下方常驻展示）
      ofChecks.value = [
        { label: '剪辑方案', ok: vPlans.length > 0, detail: `${vPlans.length} 个已确认方案` },
        {
          label: '视频素材轨',
          ok: segs.length > 0 && missing === 0,
          detail: `${segs.length} 段 · ${totalSec.toFixed(1)}s${missing ? ` · 缺 ${missing} 段` : ''}`,
        },
        {
          label: '口播轨',
          ok: voices.length > 0 && voices.length >= vPlans.length,
          detail: `${voices.length}/${vPlans.length} 个方案带口播`,
        },
        {
          label: '字幕轨',
          ok: voices.length > 0 && srtOfVoice.size > 0,
          detail: voices.length === 0
            ? '无口播轨（无字幕可挂）'
            : `${srtOfVoice.size}/${voices.length} 个方案带字幕（VTT 旁挂，样式在视频剪辑里调）`,
        },
        {
          label: 'BGM 轨',
          ok: bgm !== '',
          detail: bgm ? `${pathBasename(bgm)} · 音量 ${Math.round(Number(bgmVolume.value) || 0)}%` : '未选择 BGM（工程不含背景音乐）',
        },
      ]
      if (!segs.length) { notify('没有剪辑方案', '方案内没有可用片段：请重新智能匹配。'); return }
      ofProgress.value = 32
      ofStage.value = '创建视频剪辑项目...'
      const created = await (window.tintin as any).openfilm.createProject({ name: `文案混剪-${new Date().toISOString().slice(0, 10)}` })
      if (created?.error) throw new Error(created.error)
      const project = String(created.project)
      const relOfPath = new Map<string, string>()
      let seq = 0
      for (const seg of segs) {
        if (!relOfPath.has(seg.path)) { seq += 1; relOfPath.set(seg.path, `assets/seg-${seq}${ofExtOf(seg.path)}`) }
      }
      const relOfVoice = new Map<string, string>()
      let vseq = 0
      for (const v of voices) { if (!relOfVoice.has(v.path)) { vseq += 1; relOfVoice.set(v.path, `assets/vo-${vseq}.wav`) } }
      let bgmRel = ''
      if (bgm) { bgmRel = `assets/bgm${ofExtOf(bgm)}`; if (!relOfPath.has(bgm)) relOfPath.set(bgm, bgmRel) }
      const stageTotal = Math.max(1, relOfPath.size + relOfVoice.size)
      let staged = 0
      for (const [sourcePath, rel] of relOfPath) {
        ofStage.value = `落素材 ${rel}...`
        await ofStageFile(project, rel, sourcePath)
        staged += 1
        ofProgress.value = 35 + Math.round((staged / stageTotal) * 45)
      }
      for (const [sourcePath, rel] of relOfVoice) {
        ofStage.value = `落口播 ${rel}...`
        await ofStageFile(project, rel, sourcePath)
        const srtPath = srtOfVoice.get(sourcePath)
        if (srtPath) {
          // 字幕旁挂失败不阻断导出（Studio 侧可一键 ASR 兜底）
          const stagedVtt = await (window.tintin as any).openfilm.stageVttFromSrt({ project, rel: rel.replace(/\.wav$/i, '.vtt'), srtPath })
          if (stagedVtt?.error) console.warn('[openfilm] 字幕旁挂失败（不影响导出）：', stagedVtt.error)
        }
        staged += 1
        ofProgress.value = 35 + Math.round((staged / stageTotal) * 45)
      }
      ofProgress.value = 88
      ofStage.value = '写时间轴 film.html...'
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      const videoTags = segs.map((seg) => `  <video src="${esc(relOfPath.get(seg.path)!)}#t=0,${seg.durSec.toFixed(3)}" at="${seg.c0.toFixed(3)}"></video>`)
      const voiceTags = voices.map((v) => `  <audio src="${esc(relOfVoice.get(v.path)!)}" at="${v.at.toFixed(3)}"></audio>`)
      const vol = Math.min(1, Math.max(0, Number(bgmVolume.value) / 100)).toFixed(2)
      const bgmTag = bgmRel ? [`  <audio src="${esc(bgmRel)}" volume="${vol}" at="0"></audio>`] : []
      const html = [
        '<!doctype html>',
        '<html><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=1920, height=1080">',
        '</head><body>',
        '<section>',
        ...videoTags,
        '</section>',
        '<section>',
        ...voiceTags,
        '</section>',
        '<section>',
        ...bgmTag,
        '</section>',
        '</body></html>',
      ].join('\n')
      const written = await (window.tintin as any).openfilm.writeFilm({ project, html })
      if (written?.error) throw new Error(written.error)
      ofProject.value = project
      // 渲染成片（2026-11-07 用户需求：有视频剪辑插件时直接出视频）——确定性时间线
      // 已写好，接 vendored CLI render（本机 Chromium+ffmpeg，几十秒到几分钟）；
      // 渲染失败不回滚导出结果（项目仍在，可去 Studio 精剪后重渲）
      ofProgress.value = 92
      ofStage.value = '正在渲染成片（本机 Chromium+ffmpeg，约几十秒到几分钟）...'
      let renderNote = ''
      try {
        const rendered = await (window.tintin as any).openfilm.renderProject({ project })
        if (rendered?.error) throw new Error(rendered.error)
        ofRendered.value = String(rendered?.path || '')
        ofChecks.value.push({
          label: '成片',
          ok: !!ofRendered.value,
          detail: ofRendered.value
            ? `${pathBasename(ofRendered.value)} · 渲染 ${Math.round((Number(rendered?.ms) || 0) / 1000)}s`
            : '渲染完成但未定位到 mp4',
        })
        renderNote = '，已渲染成片'
      } catch (renderError) {
        ofChecks.value.push({ label: '成片', ok: false, detail: `渲染失败：${errText(renderError)}（可打开视频剪辑手动导出）` })
        notify('渲染失败', `项目已导出，但自动渲染成片失败：\n${errText(renderError)}\n可打开视频剪辑手动精剪导出。`)
      }
      ofProgress.value = 100
      ofStage.value = `已导出 ${segs.length} 段 · ${totalSec.toFixed(1)}s${renderNote}`
      exportDoneMsg.value = `✓ 已导出到视频剪辑项目${renderNote}`
    } catch (error) {
      ofStage.value = '导出失败'
      notify('导出失败', `导出到视频剪辑项目时发生错误：\n${(error as Error)?.message || String(error)}`)
    } finally { ofBusy.value = false }
  }
  /** 已导出项目的独立重渲入口（2026-11-07）：不走完整导出，直接对当前项目再出成片 */
  async function renderExportedProject(): Promise<void> {
    if (ofRendering.value || !ofProject.value) return
    if (filmPlugin.value.state !== 'ok') { notify('视频剪辑插件不可用', filmPlugin.value.reason || '请先安装/启用视频剪辑插件'); return }
    ofRendering.value = true
    try {
      const rendered = await (window.tintin as any).openfilm.renderProject({ project: ofProject.value })
      if (rendered?.error) throw new Error(rendered.error)
      ofRendered.value = String(rendered?.path || '')
      notify('渲染完成', `成片已产出：${ofRendered.value || '(未定位到 mp4)'}`)
    } catch (error) { notify('渲染失败', String((error as Error)?.message || error)) }
    finally { ofRendering.value = false }
  }
  return { ofBusy, ofStage, ofProject, ofProgress, ofChecks, exportToEditingProject, openEditingProject, filmPlugin, ofRendered, ofRendering, renderExportedProject }
}
