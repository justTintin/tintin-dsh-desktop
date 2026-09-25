// test/tintin-context-task.test.ts — context:writeTask 通道回归（lib/context-task.js）
// 覆盖：task.json 落盘结构与路径派生、载荷防御解析（非法降级/超限截断/条件回退）、
// 失败语义（{error}，不打断会话回路）、渲染层两种调用形态（task 包装/直接载荷）。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createContextTaskApi, defaultWorkspaceDir } from '../packages/tintin-bundle/lib/context-task.js'

const tmpDirs: string[] = []
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeApi() {
  const dir = mkdtempSync(join(tmpdir(), 'tintin-task-'))
  tmpDirs.push(dir)
  const api = createContextTaskApi({ resolveWorkspaceDir: () => dir })
  return { dir, api }
}

describe('context:writeTask', () => {
  it('写入 task.json：结构化条目 + version/updatedAt，路径指向工作区', () => {
    const { dir, api } = makeApi()
    const r = api['context:writeTask']([{ task: { product: { brand: 'Kehe' }, materials: [{ id: 1 }], scripts: [], audios: [] } }])
    expect(r.ok).toBe(true)
    expect(r.path).toBe(join(dir, 'task.json'))
    const written = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8'))
    expect(written.version).toBe(1)
    expect(typeof written.updatedAt).toBe('string')
    expect(written.product).toEqual({ brand: 'Kehe' })
    expect(written.materials).toEqual([{ id: 1 }])
  })

  it('渲染层直接传载荷（无 task 包装）同样可写', () => {
    const { dir, api } = makeApi()
    const r = api['context:writeTask']([{ scripts: [{ id: 's1' }] }])
    expect(r.ok).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8')).scripts).toEqual([{ id: 's1' }])
  })

  it('非法载荷降级默认（product 非对象 → null；materials 非数组 → []），不抛出', () => {
    const { dir, api } = makeApi()
    const r = api['context:writeTask']([{ product: 42, materials: 'no', scripts: [{}, 'junk', { id: 2 }] }])
    expect(r.ok).toBe(true)
    const written = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8'))
    expect(written.product).toBeNull()
    expect(written.materials).toEqual([])
    expect(written.scripts).toEqual([{}, { id: 2 }]) // 非对象条目剔除（空对象保留，与渲染层 sanitize 同口径）
  })

  it('条目超限截断到 200', () => {
    const { dir, api } = makeApi()
    const many = Array.from({ length: 300 }, (_, i) => ({ id: i }))
    api['context:writeTask']([{ materials: many }])
    const written = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8'))
    expect(written.materials.length).toBe(200)
  })

  it('空调用（无载荷）→ 合法空 task.json', () => {
    const { api } = makeApi()
    const r = api['context:writeTask']([])
    expect(r.ok).toBe(true)
  })

  it('目录不可写（resolveWorkspaceDir 指向已存在文件）→ {error}，不抛出', () => {
    // 用一个必然失败的解析器：返回一个已存在的文件路径，mkdirSync 对文件路径会抛
    const parent = mkdtempSync(join(tmpdir(), 'tintin-task-'))
    tmpDirs.push(parent)
    const filePath = join(parent, 'blocked')
    writeFileSync(filePath, 'x', 'utf8')
    const api = createContextTaskApi({ resolveWorkspaceDir: () => filePath })
    const r = api['context:writeTask']([{ product: { brand: 'A' } }])
    expect(r.error).toBeTruthy()
    expect(r.ok).toBeUndefined()
  })

  it('defaultWorkspaceDir：TINTIN_WORKSPACE_DIR 优先，否则 Documents\\tintin-workspace', () => {
    expect(defaultWorkspaceDir({ TINTIN_WORKSPACE_DIR: 'D:/ws' })).toBe('D:/ws')
    const r = defaultWorkspaceDir({ USERPROFILE: 'C:/Users/u' } as NodeJS.ProcessEnv)
    expect(r).toContain('tintin-workspace')
    expect(r).toContain('Documents')
  })
})
