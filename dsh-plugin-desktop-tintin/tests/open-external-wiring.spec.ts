// openfilm:native:open-external 三点接线回归面(2026-11-19 即梦登录事故):
// Studio 视图 window.open 恒 deny → 封面编辑器 iframe 的授权链接必须经
// main-hook handler + studio-preload 暴露 + 编辑器取桥三点配合才能拉起系统浏览器。
// 任一点被误删都会复现「点了没反应」,故以源断言钉住接线;协议白名单语义由
// main-hook 实现自守(https/http 之外一律拒绝)。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const read = (rel: string): string => readFileSync(join(pkgRoot, rel), 'utf8')

describe('openfilm:native:open-external wiring', () => {
  it('main-hook registers the channel with the https/http-only guard', () => {
    const source = read('src/tintin/main-hook.ts')
    expect(source).toContain("ipcMain.handle('openfilm:native:open-external'")
    expect(source).toMatch(/open-external[\s\S]{0,800}protocol !== 'https:'[\s\S]{0,200}protocol !== 'http:'/)
  })

  it('studio-preload exposes openExternal through that channel', () => {
    const source = read('src/tintin/studio-preload.ts')
    expect(source).toContain('openExternal:')
    expect(source).toContain("nativeInvoke('openfilm:native:open-external'")
  })

  it('cover editor resolves the bridge from self or parent and auto-opens on login', () => {
    const source = read('../dsh-tintin-cover-plugin/src/editor/server-settings.tsx')
    expect(source).toContain('resolveOpenExternal')
    expect(source).toContain('openfilmNative')
    expect(source).toContain('openVerificationUri(verificationUri)')
  })
})
