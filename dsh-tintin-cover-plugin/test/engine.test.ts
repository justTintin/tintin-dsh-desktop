// 引擎路径与输出清洗(不触渲染;渲染冒烟走 scripts/render.mjs 手动/打包核验)
// 测试产物统一落 D 盘 .tmp(C: temp 受沙箱限制,photocraft CLI 子进程无法写入)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCoverProject, deleteCoverProject, renameCoverProject, resolveCoverDir, resolveWorkspaceDir, switchCoverProject, renderCover } from '../src/engine.ts'

const testRoot = 'D:/Project/tintin-dsh-desktop/dsh-tintin-cover-plugin/.tmp/test'

const saved = { ws: process.env.TINTIN_WORKSPACE_DIR, cover: process.env.TINTIN_COVER_DIR }

afterEach(() => {
  // 恢复必须 delete-on-undefined:process.env.X = undefined 会被字符串化成 "undefined",
  // 引擎 truthy 直用会解析出 字面量 undefined\cover 目录(实撞,2026-10-30)
  if (saved.ws === undefined) delete process.env.TINTIN_WORKSPACE_DIR
  else process.env.TINTIN_WORKSPACE_DIR = saved.ws
  if (saved.cover === undefined) delete process.env.TINTIN_COVER_DIR
  else process.env.TINTIN_COVER_DIR = saved.cover
})

describe('产物目录解析(G5 + 2026-10-30 项目制:cover/projects/<当前项目>)', () => {
  it('TINTIN_WORKSPACE_DIR 优先:目录=projects/<当前项目>,指针稳定', () => {
    process.env.TINTIN_WORKSPACE_DIR = mkdtempSync(join(testRoot, 'ws-x-'))
    delete process.env.TINTIN_COVER_DIR
    const first = resolveCoverDir()
    expect(first).toContain(join('cover', 'projects'))
    expect(existsSync(first)).toBe(true)
    expect(resolveCoverDir()).toBe(first) // 指针稳定:重复解析同一项目
  })
  it('旧 cover 根目录散文件不做迁移:原地保留,项目制从空白项目开始(2026-10-30 二次裁决)', () => {
    const ws = mkdtempSync(join(testRoot, 'ws-nomigrate-'))
    process.env.TINTIN_WORKSPACE_DIR = ws
    const legacy = join(ws, 'cover')
    mkdirSync(join(legacy, '.cover-chat'), { recursive: true })
    writeFileSync(join(legacy, 'cover.props.json'), '{}', 'utf8')
    delete process.env.TINTIN_COVER_DIR
    const dir = resolveCoverDir()
    // 新项目=projects/<日期时间> 空目录,旧文件原地不动(不删不藏,不进任何项目)
    expect(dir).toContain(join('cover', 'projects'))
    expect(existsSync(join(dir, 'cover.props.json'))).toBe(false)
    expect(existsSync(join(legacy, 'cover.props.json'))).toBe(true)
    expect(existsSync(join(legacy, 'current.json'))).toBe(true) // 指针已建
  })
  it('新建/切换/重命名项目语义(create/switch/rename)', () => {
    const ws = mkdtempSync(join(testRoot, 'ws-ops-'))
    process.env.TINTIN_WORKSPACE_DIR = ws
    delete process.env.TINTIN_COVER_DIR
    const a = createCoverProject('产品A')
    expect(resolveCoverDir()).toContain('产品A')
    const b = createCoverProject() // 缺省名=日期时间
    expect(resolveCoverDir()).toContain(b.name)
    switchCoverProject('产品A')
    expect(resolveCoverDir()).toContain('产品A')
    renameCoverProject('产品A', '产品A-改')
    expect(existsSync(join(ws, 'cover', 'projects', '产品A-改'))).toBe(true)
    expect(resolveCoverDir()).toContain('产品A-改') // 当前项目改名=指针跟随
  })
  it('删除项目语义(delete:连目录删;删当前=指针回退剩余最新;删空=清指针;防穿越)', () => {
    const ws = mkdtempSync(join(testRoot, 'ws-del-'))
    process.env.TINTIN_WORKSPACE_DIR = ws
    delete process.env.TINTIN_COVER_DIR
    createCoverProject('甲项目')
    const b = createCoverProject('乙项目')
    const c = createCoverProject('丙项目') // 当前=丙(新建即设当前)
    writeFileSync(join(ws, 'cover', 'projects', '丙项目', 'cover.props.json'), '{}', 'utf8')
    // 删非当前:指针不动
    expect(deleteCoverProject('甲项目').current).toBe(c.name)
    expect(resolveCoverDir()).toContain('丙项目')
    // 删当前:指针回退剩余最新(乙),目录连数据一起消失
    expect(deleteCoverProject('丙项目').current).toBe(b.name)
    expect(existsSync(join(ws, 'cover', 'projects', '丙项目'))).toBe(false)
    expect(resolveCoverDir()).toContain('乙项目')
    // 删空:清指针 current=null(前端自行新建;引擎不再按首访自动造)
    expect(deleteCoverProject('乙项目').current).toBeNull()
    expect(existsSync(join(ws, 'cover', 'projects', '乙项目'))).toBe(false)
    // 防穿越:洗名后仍不得指到 projects 之外;不存在显式报错
    expect(() => deleteCoverProject('..')).toThrow(/非法项目名/)
    expect(() => deleteCoverProject('不存在的项目')).toThrow(/项目不存在/)
    // 指针已清 → resolveCoverDir 走首访建新项目(既有语义)
    expect(resolveCoverDir()).toContain(join('cover', 'projects'))
  })
  it('TINTIN_COVER_DIR 覆盖(测试注入口,保持旧单目录行为)', () => {
    process.env.TINTIN_COVER_DIR = join(testRoot, 'cover-override')
    expect(resolveCoverDir()).toBe(join(testRoot, 'cover-override'))
  })
  it('两者皆缺省 → 工作区路径形状(项目制解析会建真实项目,测试不碰真实工作区,只验 resolveWorkspaceDir 回落)', () => {
    delete process.env.TINTIN_WORKSPACE_DIR
    delete process.env.TINTIN_COVER_DIR
    expect(resolveWorkspaceDir()).toContain(join('Documents', 'tintin-workspace'))
  })
})

describe('renderCover 入参防线(不触渲染)', () => {
  it('未知模板 → ok:false 显式错误', async () => {
    process.env.TINTIN_COVER_DIR = join(testRoot, 'nope')
    const r = await renderCover({ templateId: 'nope' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未知封面模板')
  })
  it('空文本 props → ok:false 校验错误', async () => {
    process.env.TINTIN_COVER_DIR = join(testRoot, 'nope')
    const r = await renderCover({ templateId: 'cover', props: { title: '' } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('主标题')
  })
})
