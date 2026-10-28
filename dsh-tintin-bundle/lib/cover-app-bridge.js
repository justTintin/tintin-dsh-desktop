// CoverAppBridge — 封面编辑器会话桥(实现 openfilm chat App 的 window.openfilmDesktop 接口,
// 适配封面场景:comfygen 生图/PhotoCraft 操作/图层编辑)。
// 参考:openfilm-shell-src/chat/app-bridge.ts 的 AppBridge 接口。
// 覆盖率:MVP 实现核心方法(hello/chat/技能/文件),非核心方法返回空值。
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'

export interface CoverProject { id: string; name: string; path: string }

export class CoverAppBridge {
  private pluginDir: string
  private coverDir: string
  private log: (msg: string) => void

  constructor(pluginDir: string, coverDir: string, log: (msg: string) => void = () => {}) {
    this.pluginDir = pluginDir
    this.coverDir = coverDir
    this.log = log
  }

  hello() {
    return {
      platform: 'win32',
      flavor: 'tintin-cover',
      theme: 'dark',
      language: 'zh-CN',
      chatOpen: true,
      project: { id: 'cover', name: '封面制作', path: this.coverDir },
      selection: null,
      ffmpeg: true,
      version: '0.1.0',
      chatMin: 200,
    }
  }
  onTheme() { return () => {} }
  onLanguage() { return () => {} }
  onProject() { return () => {} }
  onChatOpen() { return () => {} }
  onStudioBrowser() { return () => {} }
  onStudioFailed() { return () => {} }
  onRefer() { return () => {} }
  onFfmpeg() { return () => {} }
  showInStudio() {}
  showExamples() {}
  onUseSkill() { return () => {} }
  onAddSkill() { return () => {} }
  useSkill() {}
  withPicture(ref: unknown) { return Promise.resolve(ref) }
  highlightInStudio() {}
  draftRefsInStudio() {}
  onStudioHover() { return () => {} }
  setChatWidth() {}
  setChatOpen() {}
  assetsOpen() { return false }
  setAssetsOpen() {}
  onAssets() { return () => {} }
  setComposerHeight() {}
  setMenuOpen() {}

  /** 项目文件列表(@ 补全数据源): cover 目录里的图片/侧车/底稿 */
  projectFiles() {
    try {
      const files: Array<{ path: string; kind: string; size: number }> = []
      const walk = (dir: string, prefix: string): void => {
        if (!existsSync(dir)) return
        for (const f of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, f.name)
          if (f.isDirectory()) { walk(full, prefix + f.name + '/'); continue }
          const rel = prefix + f.name
          const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
          const kind = ['png','jpg','jpeg','webp'].includes(ext) ? 'image' : ext === 'pcraft' ? 'document' : 'file'
          files.push({ path: rel, kind, size: f.size })
        }
      }
      walk(this.coverDir, '')
      // 插件 public/ 的素材也列入
      const pub = join(this.pluginDir, 'public')
      if (existsSync(pub)) {
        for (const f of readdirSync(pub, { withFileTypes: true })) {
          if (f.isFile()) files.push({ path: `public/${f.name}`, kind: 'image', size: f.size })
        }
      }
      return { files }
    } catch { return { files: [] } }
  }
  onSelection() { return () => {} }

  /** 会话持久化: cover-assets.json 同目录 */
  chat = {
    load: (project: string) => {
      try {
        const file = join(this.coverDir, 'chat-history.json')
        if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
      } catch { /* ignore */ }
      return { sessions: [], last: null, turns: [] }
    },
    saveSessions: (project: string, sessions: unknown[], last: string | null) => {
      try {
        const file = join(this.coverDir, 'chat-history.json')
        const existing = this.chat.load(project)
        writeFileSync(file, JSON.stringify({ ...existing, sessions, last }, null, 2), 'utf8')
      } catch { /* ignore */ }
      return null
    },
    saveTurn: (project: string, turn: unknown, items: unknown[]) => {
      try {
        const file = join(this.coverDir, 'chat-turns.json')
        let turns: unknown[] = []
        if (existsSync(file)) turns = JSON.parse(readFileSync(file, 'utf8'))
        turns.push({ turn, items, ts: Date.now() })
        writeFileSync(file, JSON.stringify(turns, null, 2), 'utf8')
      } catch { /* ignore */ }
      return null
    },
    log: () => null,
    reveal: (project: string) => { return null },
    saveRefImage: () => ({ path: '' }),
    saveAttachment: () => ({ path: '' }),
    describePaths: () => [],
    unsaved: () => [],
    snapshot: () => null,
    changes: () => null,
  }

  asks = { get: () => [], onChange: () => () => {}, answer: () => {} }

  /** 技能:封面制作的操作技能 */
  skills = {
    list: () => ({
      openfilm: [
        { name: '生成封面', description: 'comfygen 生成底图 + Remotion 排版导出 PNG', source: 'project', folder: '', scripts: [] },
        { name: '精修封面', description: 'PhotoCraft 打开封面进行 PS 式精修', source: 'project', folder: '', scripts: [] },
        { name: '生成底图', description: 'comfygen 生成环境底图(无文字)', source: 'project', folder: '', scripts: [] },
        { name: '产品图重绘', description: '以当前产品图为参考重绘(图生图)', source: 'project', folder: '', scripts: [] },
      ],
      own: { agent: 'deepseek', filtered: false, skills: [] },
      mine: '',
    }),
    texts: async (_project: string, _agent: string, names: string[]) => {
      return names.map((name) => ({ name, text: `技能: ${name}(封面制作)` }))
    },
    allow: async () => ({ ok: true }),
    changed: async () => null,
    preview: async () => ({ ok: false, error: '不支持' }),
    previewFolder: async () => ({ ok: false, cancelled: true }),
    commit: async () => ({ ok: true, skills: [] }),
    discard: async () => null,
    reveal: async () => null,
  }

  developer = {
    get: async () => ({ logs: false, changes: false }),
    onChange: () => () => {},
  }
}

// Node fs 需要的(因为 class 方法里用了)
function readdirSync(dir: string, opts?: { withFileTypes: boolean }) {
  // 委托到 node:fs 的 readdirSync
  const fs = require('node:fs') as typeof import('node:fs')
  return fs.readdirSync(dir, opts)
}
