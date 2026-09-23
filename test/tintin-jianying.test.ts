// test/tintin-jianying.test.ts — 剪映模块族 CJS→ESM 纯搬迁回归（packages/tintin-bundle/lib/jianying）。
// 只断言「符号存在 + 导出名集合与源一致 + 纯函数可测行为」；不调用需要
// ipcMain/网络/真实剪映目录的重函数（createJianyingFontsIpc/initJianyingAudioSync/
// exportToDraft/uploadFontFiles/scanAll 均只做存在性检查）。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import TEMPLATE from '../packages/tintin-bundle/lib/jianying/jianying-draft-template.js'
import * as textAnimations from '../packages/tintin-bundle/lib/jianying/jianying-text-animations.js'
import * as exporter from '../packages/tintin-bundle/lib/jianying/jianying-exporter.js'
import * as templates from '../packages/tintin-bundle/lib/jianying/jianying-templates.js'
import * as fontsIpc from '../packages/tintin-bundle/lib/jianying/jianying-fonts-ipc.js'
import * as audioSync from '../packages/tintin-bundle/lib/jianying/jianying-audio-sync.js'

describe('jianying-draft-template skeleton', () => {
  it('keeps the pyJianYingDraft 0.3.0 baseline fields (new_version 110.0.0 / version 360000)', () => {
    expect(TEMPLATE.canvas_config).toEqual({ width: 1920, height: 1080, ratio: 'original' })
    expect(TEMPLATE.new_version).toBe('110.0.0')
    expect(TEMPLATE.version).toBe(360000)
    expect(TEMPLATE.fps).toBe(30)
    expect(TEMPLATE.tracks).toEqual([])
    expect(TEMPLATE.materials.videos).toEqual([])
    expect(TEMPLATE.materials.transitions).toEqual([])
    expect(TEMPLATE.materials.texts).toEqual([])
  })
})

describe('jianying-text-animations', () => {
  it('exports exactly the source name set', () => {
    expect(Object.keys(textAnimations).sort()).toEqual(['TEXT_INTRO_ANIMATIONS', 'findTextIntroAnimation'].sort())
  })

  it('findTextIntroAnimation is a function with exact/partial lookup and null miss', () => {
    expect(textAnimations.findTextIntroAnimation).toBeTypeOf('function')
    expect(textAnimations.TEXT_INTRO_ANIMATIONS).toHaveLength(67)
    expect(textAnimations.findTextIntroAnimation('弹入')?.effect_id).toBe('1644313')
    // 部分匹配：精确不中时按表序取第一个 includes 命中（"复古打字机"在"打字机 I"之前）
    expect(textAnimations.findTextIntroAnimation('打字机')?.name).toBe('复古打字机')
    expect(textAnimations.findTextIntroAnimation('')).toBeNull()
    expect(textAnimations.findTextIntroAnimation('不存在的动画zzz')).toBeNull()
  })
})

describe('jianying-exporter', () => {
  it('exports exactly the source name set (32 names, duplicate buildSubtitleSegment collapsed)', () => {
    expect(Object.keys(exporter).sort()).toEqual([
      'TRANSITION_MAP', 'DRAFT_SCHEMA', 'getDefaultDraftRoot', 'exportToDraft', 'exportMultiToDraft',
      'registerInRootMeta', 'verifyDraftFolder', 'validateDraftPackage', 'auditDraftStandardConformance',
      'normalizeTransitions', 'normalizeOneTransition', 'parseSrt', 'timestampToSec', 'appendKeywordTrack',
      'KEYWORD_TRACK_STYLES', 'findJianyingExe', 'launchJianying', 'findTextPreset', 'presetAttachToDraft',
      'buildTemplateClipTrio', 'normalizeTextTemplateClips', 'appendTextTemplateSegments',
      'appendSfxTrackFromEvents', 'jianyingSubtitleStyleFromServer', 'buildSubtitleSegment',
      'draft_content_tracks_render_index', 'normalizeVoiceClips', 'SUBTITLE_TRANSFORM_Y',
      'SUBTITLE_ALIGNMENT', 'SUBTITLE_FONT_SIZE_DEFAULT', 'TEXT_TEMPLATE_TRANSFORM_Y', 'VIDEO_GAP_US',
    ].sort())
  })

  it('key export symbols exist as functions/objects', () => {
    expect(exporter.TRANSITION_MAP).toBeTypeOf('object')
    expect(exporter.DRAFT_SCHEMA).toBeTypeOf('object')
    expect(exporter.exportToDraft).toBeTypeOf('function')
    expect(exporter.exportMultiToDraft).toBeTypeOf('function')
    expect(exporter.registerInRootMeta).toBeTypeOf('function')
    expect(exporter.verifyDraftFolder).toBeTypeOf('function')
    expect(exporter.parseSrt).toBeTypeOf('function')
    expect(exporter.timestampToSec).toBeTypeOf('function')
    expect(exporter.getDefaultDraftRoot).toBeTypeOf('function')
    expect(exporter.normalizeTransitions).toBeTypeOf('function')
  })

  it('keeps TRANSITION_MAP / DRAFT_SCHEMA baseline values', () => {
    expect(Object.keys(exporter.TRANSITION_MAP)).toHaveLength(8)
    expect(exporter.TRANSITION_MAP.fade?.resourceId).toBe('6911569618171597320')
    expect(exporter.TRANSITION_MAP.fade?.duration).toBe(500000)
    expect(exporter.DRAFT_SCHEMA.new_version).toBe('110.0.0')
    expect(exporter.DRAFT_SCHEMA.version).toBe(360000)
    expect(exporter.SUBTITLE_TRANSFORM_Y).toBe(-0.8)
    expect(exporter.VIDEO_GAP_US).toBe(500000)
  })

  it('timestampToSec parses hh:mm:ss(,|.)mmm and returns 0 on garbage', () => {
    expect(exporter.timestampToSec('00:00:02,120')).toBe(2.12)
    expect(exporter.timestampToSec('01:02:03.5')).toBe(3723.5)
    expect(exporter.timestampToSec('bad')).toBe(0)
  })

  it('parseSrt parses a real srt file into [startSec, endSec, text] cues', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tintin-jy-srt-'))
    try {
      const srtPath = join(dir, 'sample.srt')
      writeFileSync(srtPath, [
        '1',
        '00:00:01,500 --> 00:00:03,250',
        '你好剪映',
        '',
        '2',
        '00:01:02,000 --> 00:01:04,500',
        '第二行',
        '字幕',
        '',
      ].join('\n'), 'utf-8')
      expect(exporter.parseSrt(srtPath)).toEqual([
        [1.5, 3.25, '你好剪映'],
        [62, 64.5, '第二行 字幕'],
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('jianying-templates', () => {
  it('exports exactly the source name set', () => {
    expect(Object.keys(templates).sort()).toEqual([
      'CATEGORIES', 'scanAll', 'scanAllAsync', 'scanTextPresets', 'scanEffectCache', 'scanAudioCache',
      'getTransitions', 'pngSize', 'buildSyncPackage', 'collectTemplateFonts', 'buildAssetPackage',
      'buildRawSyncPackage',
    ].sort())
  })

  it('CATEGORIES matches the six(+audio) menu groups and scanners are functions', () => {
    expect(templates.CATEGORIES).toEqual(['花字库', '文字模板', '特效', '贴纸', '转场', '字幕', '音频'])
    expect(templates.scanAll).toBeTypeOf('function')
    expect(templates.scanAllAsync).toBeTypeOf('function')
  })

  it('getTransitions maps a transition map (or the built-in one) to lane entries', () => {
    expect(templates.getTransitions({ fade: { name: '模糊', duration: 500000, isOverlap: true } })).toEqual([
      { id: 'fade', name: '模糊', durationUs: 500000, isOverlap: true },
    ])
    // 缺省回退到 jianying-exporter 的 TRANSITION_MAP（CJS 延迟 require → ESM namespace import）
    expect(templates.getTransitions()).toHaveLength(8)
  })
})

describe('jianying-fonts-ipc', () => {
  it('exports exactly the source name set', () => {
    expect(Object.keys(fontsIpc).sort()).toEqual([
      'scanFontFiles', 'fontMatches', 'matchServerFont', 'fetchServerFonts', 'uploadFontFiles',
      'createJianyingFontsIpc',
    ].sort())
  })

  it('scanFontFiles/matchServerFont are functions; scanning missing dirs yields []', () => {
    expect(fontsIpc.scanFontFiles).toBeTypeOf('function')
    expect(fontsIpc.matchServerFont).toBeTypeOf('function')
    expect(fontsIpc.scanFontFiles(join(tmpdir(), 'tintin-no-font-dir'), join(tmpdir(), 'tintin-no-cache-dir'))).toEqual([])
  })

  it('matchServerFont/fontMatches follow the containment / exact-filename rules', () => {
    // 家族互含（大小写不敏感）：服务端家族名是字体内部英文名
    expect(fontsIpc.matchServerFont('HelloFont ID QiQiao', 'hellofont')).toBe(true)
    expect(fontsIpc.matchServerFont('完全不相关', '另一个')).toBe(false)
    // filename 精确相等命中（服务端按文件名去重 409 口径）
    expect(fontsIpc.fontMatches({ filename: 'a.ttf' }, 'x', 'a.ttf')).toBe(true)
    expect(fontsIpc.fontMatches(null, 'x', 'a.ttf')).toBe(false)
  })
})

describe('jianying-audio-sync', () => {
  it('exports exactly the source name set', () => {
    expect(Object.keys(audioSync).sort()).toEqual([
      'initJianyingAudioSync', 'startJianyingAudioSyncTimer', 'collectNewAudioItems',
      'listAudioCacheFiles', 'buildDraftAudioNameMap', 'DEFAULT_INTERVAL_MIN',
    ].sort())
  })

  it('pure scan helpers exist with DEFAULT_INTERVAL_MIN=30', () => {
    expect(audioSync.collectNewAudioItems).toBeTypeOf('function')
    expect(audioSync.buildDraftAudioNameMap).toBeTypeOf('function')
    expect(audioSync.DEFAULT_INTERVAL_MIN).toBe(30)
  })

  it('collectNewAudioItems prefers draft names, splits sfx/music by <2s and drops synced files', () => {
    const items = audioSync.collectNewAudioItems({
      files: [
        { file: 'C:/jy/Cache/music/abcd1234567890.mp3', id: 'abcd1234567890', ext: '.mp3', duration: 1.2 },
        { file: 'C:/jy/Cache/music/effe9876543210.mp3', id: 'effe9876543210', ext: '.mp3', duration: 3 },
        { file: 'C:/jy/Cache/music/skip0000000000.mp3', id: 'skip0000000000', ext: '.mp3', duration: 1 },
      ],
      nameByPath: new Map([['c:/jy/cache/music/abcd1234567890.mp3', '真实音频名']]),
      excludeNames: new Set(['skip0000000000.mp3']),
    })
    expect(items).toHaveLength(2)
    // 草稿真实名优先（哈希文件名不可读问题）
    expect(items[0]?.name).toBe('真实音频名')
    expect(items[0]?.filename).toBe('真实音频名.mp3')
    expect(items[0]?.category).toBe('音效')
    // 无真实名回退「剪映音频_<id前8>」；≥2s 归音乐
    expect(items[1]?.name).toBe('剪映音频_effe9876')
    expect(items[1]?.category).toBe('音乐')
    expect(items[1]?.durSec).toBe(3)
  })
})

describe('jianying module family loads lazily without electron', () => {
  // 音频同步/字体 IPC 的 electron 依赖在实现内经 createRequire 惰性加载：
// 模块顶层 import 全族（含 fonts-ipc/audio-sync）成功本身即回归——harness 子进程
  // 加载本模块族不得触碰 electron。
  it('all six modules were importable at the top of this file', () => {
    expect(TEMPLATE).toBeTruthy()
    expect(Object.keys(exporter).length).toBeGreaterThan(0)
    expect(Object.keys(templates).length).toBeGreaterThan(0)
    expect(Object.keys(fontsIpc).length).toBeGreaterThan(0)
    expect(Object.keys(audioSync).length).toBeGreaterThan(0)
  })
})
