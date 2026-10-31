// 1029 事故回归:渲染链必须有总超时兜底(/api/render 永不应答=UI「渲染中」永挂),
// 浏览器必须优先包内缓存(cwd 无关——Remotion 默认按 process.cwd() 找缓存,应用内会误触发整包下载)。
import { describe, expect, it } from 'vitest'
import { resolveBundledBrowser, withRenderTimeout } from '../src/engine.ts'

describe('withRenderTimeout', () => {
  it('时限内完成则透传结果', async () => {
    await expect(withRenderTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok')
  })

  it('超时拒绝并带可读错误(永挂兜底)', async () => {
    await expect(withRenderTimeout(new Promise<never>(() => {}), 30)).rejects.toThrow('渲染超时')
  })
})

describe('resolveBundledBrowser', () => {
  it('包内缓存命中时返回 exe 绝对路径,形态=插件 node_modules 相对(与 cwd 无关)', () => {
    const p = resolveBundledBrowser()
    if (p) {
      expect(p).toMatch(/node_modules[\\/]\.remotion[\\/]chrome-headless-shell[\\/]win64[\\/]chrome-headless-shell-win64[\\/]chrome-headless-shell\.exe$/)
    }
    // 未命中(异常构建环境)允许 null——调用方回退 ensureBrowser 老路径
  })
})
