import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FilmAgentManager } from '../src/tintin/film-acp.js'

/** 真实端到端(2026-10-25 用户要求"自己先测试"): 真实服务端 /llm + /mcp + 真实补丁。 */
describe('film agent e2e against the live server', () => {
  it('completes a prompt round trip', async () => {
    const home = process.env.TINTIN_E2E_HOME ?? mkdtempSync(join(tmpdir(), 'tintin-e2e-home-'))
    const project = process.env.TINTIN_E2E_CWD ?? mkdtempSync(join(tmpdir(), 'tintin-e2e-proj-'))
    /* A/B 对照(2026-10-25): TINTIN_E2E_DSH_BIN 指定被测 dsh(打包版/工作区构建), 缺省=工作区 */
    if (process.env.TINTIN_E2E_DSH_BIN) process.env.TINTIN_DSH_BIN = process.env.TINTIN_E2E_DSH_BIN
    const events: Array<Record<string, unknown>> = []
    const manager = new FilmAgentManager({
      channelHome: home,
      serverUrl: () => 'http://192.168.111.31:8000',
      onEvent: (u: import('../src/tintin/film-acp.js').FilmAgentUpdate) => {
        events.push(u.event as unknown as Record<string, unknown>)
        if (u.event.kind === 'update') console.log('[update]', JSON.stringify(u.event.update).slice(0, 160))
      },
      log: (m: string) => console.log('[film-acp]', m),
    })
    /* 实机轮次走 TinTin 智能体(服务端模型链路;真实服务端 /llm + /mcp)——DeepSeek Harness
       链路用客户端自己的 DeepSeek 凭据,无 key 时无从实机轮次(见下例) */
    const info = await manager.begin(project, 'tintin-agent')
    expect(info.sessionId).toBeTruthy()
    await manager.prompt(project, '只回复两个字母: ok')
    const deadline = Date.now() + 120_000
    let done: Record<string, unknown> | null = null
    while (Date.now() < deadline) {
      done = (events.find((e) => e.kind === 'done') as Record<string, unknown> | undefined) ?? null
      if (done) break
      await new Promise((r) => setTimeout(r, 400))
    }
    expect(done, `120s 内未完成; 事件: ${JSON.stringify(events.slice(-6))}`).toBeTruthy()
    expect(done!.ok).toBe(true)
  }, 180_000)
})

describe('film agent e2e: DeepSeek Harness(客户端链路)', () => {
  /** 2026-11-24:DeepSeek Harness = 客户端自己的 dsh(照上游 openfilm,DSH_HOME=客户端 home),
   *  凭据/模型用客户端的(设置→模型填的密钥存进客户端 home 的 .credentials.yaml refs 段,或
   *  DEEPSEEK_API_KEY)。环境与客户端 home 都没有 key 时跳过——链路由 .tmp 下的真实 dsh
   *  探针(已配密钥状态)与 dsh 报错文案(no API key for provider route "deepseek-official")实证。 */
  it.skipIf(!process.env.DEEPSEEK_API_KEY)('completes a prompt round trip (client-routed)', async () => {
    const home = process.env.TINTIN_E2E_HOME ?? mkdtempSync(join(tmpdir(), 'tintin-e2e-home-'))
    const project = process.env.TINTIN_E2E_CWD ?? mkdtempSync(join(tmpdir(), 'tintin-e2e-proj-'))
    const events: Array<Record<string, unknown>> = []
    const manager = new FilmAgentManager({
      channelHome: home,
      serverUrl: () => 'http://192.168.111.31:8000',
      onEvent: (u: import('../src/tintin/film-acp.js').FilmAgentUpdate) => {
        events.push(u.event as unknown as Record<string, unknown>)
      },
      log: (m: string) => console.log('[film-acp]', m),
    })
    const info = await manager.begin(project, 'deepseek')
    expect(info.sessionId).toBeTruthy()
    await manager.prompt(project, '只回复两个字母: ok')
    const deadline = Date.now() + 120_000
    let done: Record<string, unknown> | null = null
    while (Date.now() < deadline) {
      done = (events.find((e) => e.kind === 'done') as Record<string, unknown> | undefined) ?? null
      if (done) break
      await new Promise((r) => setTimeout(r, 400))
    }
    expect(done, `120s 内未完成; 事件: ${JSON.stringify(events.slice(-6))}`).toBeTruthy()
    expect(done!.ok).toBe(true)
  }, 180_000)
})
