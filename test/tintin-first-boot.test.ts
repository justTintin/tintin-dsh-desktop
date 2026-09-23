// Regression for the 2026-09-24 provider-permanence backstop. The original
// defect: ensureTinTinProvider's rpc helper checked `method === 'describe'`
// while callers passed the full 'settings/describe' name, so describe was
// POSTed to /api/settings/mutate, failed, and the provider never self-healed
// after a delete. These tests drive the real token→cookie→RPC chain against a
// mocked fetch and pin both the restored payload and the request URLs.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeSnapshot } from '../src/shared/contracts'

interface CapturedRequest {
  url: string
  body: Record<string, unknown>
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function cookieExchange(): Response {
  return new Response(null, { headers: { 'set-cookie': 'sid=tok123; Path=/' } })
}

function describeBody(args: { serverUrl?: string, provider?: unknown }): unknown {
  return {
    type: 'server-response',
    result: {
      ok: true,
      value: {
        namespaces: [
          { ns: 'tintin-bundle', value: args.serverUrl ? { server: { url: args.serverUrl } } : {} },
          { ns: 'llm-pi-ai', value: { providers: args.provider === undefined ? {} : { 'tintin-server': args.provider } } },
        ],
      },
    },
  }
}

function credentialDescribeBody(configured: boolean): unknown {
  return {
    type: 'server-response',
    result: { ok: true, value: { TINTIN_SERVER_API_KEY: { configured } } },
  }
}

const credentialSetOk = { type: 'server-response', result: { ok: true, value: null } }

function readySnapshot(): RuntimeSnapshot {
  return { phase: 'ready', message: '', logs: [], url: 'http://127.0.0.1:43130', authToken: 'launch-token' }
}

/** Install a fetch stub serving the cookie exchange plus per-URL RPC replies. */
function stubFetch(rpcReplies: Record<string, () => Response>): CapturedRequest[] {
  const captured: CapturedRequest[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof URL ? input : (input as Request).url ?? input)
    if (url.startsWith('http://127.0.0.1:43130/?token=')) return cookieExchange()
    for (const [suffix, reply] of Object.entries(rpcReplies)) {
      if (url === `http://127.0.0.1:43130/api/${suffix}`) {
        captured.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
        return reply()
      }
    }
    return jsonResponse({ type: 'server-response', result: { ok: false, error: { message: `no route for ${url}` } } }, { status: 404 })
  }))
  return captured
}

async function loadModule(): Promise<typeof import('../src/main/tintin-first-boot')> {
  // The ensure guards are module-level one-shot flags; reset so each test sees
  // a fresh module (same discipline a brand-new process boot would have).
  vi.resetModules()
  return import('../src/main/tintin-first-boot')
}

describe('ensureTinTinProvider self-heal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('restores a deleted provider and its missing credential, posting describe to /api/settings/describe (the original bug posted it to settings/mutate)', async () => {
    const captured = stubFetch({
      'settings/describe': () => jsonResponse(describeBody({ serverUrl: 'http://192.168.111.31:8000' })),
      'settings/mutate': () => jsonResponse({ type: 'server-response', result: { ok: true, value: {} } }),
      'credentials/describe': () => jsonResponse(credentialDescribeBody(false)),
      'credentials/set': () => jsonResponse(credentialSetOk),
    })
    const mod = await loadModule()

    await mod.ensureTinTinProvider(readySnapshot())

    const describeReq = captured.find((r) => r.url.endsWith('/api/settings/describe'))
    const mutateReq = captured.find((r) => r.url.endsWith('/api/settings/mutate'))
    expect(describeReq).toBeDefined()
    expect(mutateReq).toBeDefined()
    expect(mutateReq?.body?.method).toBe('settings/mutate')
    const args = mutateReq?.body?.payload as { args?: { ns?: string, ops?: Array<{ op: string, path: string[], value: unknown }> } } | undefined
    expect(args?.args?.ns).toBe('llm-pi-ai')
    const op = args?.args?.ops?.[0]
    expect(op?.op).toBe('set')
    expect(op?.path).toEqual(['providers', 'tintin-server'])
    const value = op?.value as { baseURL?: string, apiKeyEnv?: string } | undefined
    expect(value?.baseURL).toBe('http://192.168.111.31:8000/llm')
    expect(value?.apiKeyEnv).toBe('TINTIN_SERVER_API_KEY')
    // Credential half: describe → set with the placeholder key.
    const setCred = captured.find((r) => r.url.endsWith('/api/credentials/set'))
    expect(setCred).toBeDefined()
    expect(setCred?.body?.method).toBe('credentials/set')
    const credArgs = setCred?.body?.payload as { args?: { ref?: string, value?: string } } | undefined
    expect(credArgs?.args?.ref).toBe('TINTIN_SERVER_API_KEY')
    expect(credArgs?.args?.value).toBe('sk-tintin-local')
  })

  it('is a no-op when the provider and its stored credential both exist (no writes)', async () => {
    const captured = stubFetch({
      'settings/describe': () => jsonResponse(describeBody({
        serverUrl: 'http://192.168.111.31:8000',
        provider: { displayName: 'TinTin', baseURL: 'http://192.168.111.31:8000/llm' },
      })),
      'credentials/describe': () => jsonResponse(credentialDescribeBody(true)),
    })
    const mod = await loadModule()

    await mod.ensureTinTinProvider(readySnapshot())

    expect(captured.some((r) => r.url.endsWith('/api/settings/describe'))).toBe(true)
    expect(captured.some((r) => r.url.endsWith('/api/settings/mutate'))).toBe(false)
    expect(captured.some((r) => r.url.endsWith('/api/credentials/set'))).toBe(false)
  })

  it('restores a missing credential even when the provider is intact and never overwrites one already stored', async () => {
    const captured = stubFetch({
      'settings/describe': () => jsonResponse(describeBody({
        serverUrl: 'http://192.168.111.31:8000',
        provider: { displayName: 'TinTin', baseURL: 'http://192.168.111.31:8000/llm' },
      })),
      'credentials/describe': () => jsonResponse(credentialDescribeBody(false)),
      'credentials/set': () => jsonResponse(credentialSetOk),
    })
    const mod = await loadModule()

    await mod.ensureTinTinProvider(readySnapshot())

    expect(captured.some((r) => r.url.endsWith('/api/settings/mutate'))).toBe(false)
    const setCred = captured.find((r) => r.url.endsWith('/api/credentials/set'))
    expect(setCred?.body?.method).toBe('credentials/set')
    const credArgs = setCred?.body?.payload as { args?: { ref?: string, value?: string } } | undefined
    expect(credArgs?.args?.ref).toBe('TINTIN_SERVER_API_KEY')
    expect(credArgs?.args?.value).toBe('sk-tintin-local')
  })

  it('does not invent a provider when no server URL is configured', async () => {
    const captured = stubFetch({
      'settings/describe': () => jsonResponse(describeBody({})),
      'credentials/describe': () => jsonResponse(credentialDescribeBody(true)),
    })
    const mod = await loadModule()

    await mod.ensureTinTinProvider(readySnapshot())

    expect(captured.some((r) => r.url.endsWith('/api/settings/mutate'))).toBe(false)
  })

  it('surfaces the RPC method and server error when describe is rejected (was: bare method name)', async () => {
    stubFetch({
      'settings/describe': () => jsonResponse({
        type: 'server-response',
        result: { ok: false, error: { message: 'ns llm-pi-ai not found' } },
      }),
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mod = await loadModule()

    await mod.ensureTinTinProvider(readySnapshot())

    expect(warn).toHaveBeenCalledWith(
      '[tintin-first-boot] provider ensure failed:',
      expect.stringContaining('settings/describe'),
    )
    expect(warn).toHaveBeenCalledWith(
      '[tintin-first-boot] provider ensure failed:',
      expect.stringContaining('ns llm-pi-ai not found'),
    )
  })

  it('skips RPC work until the runtime snapshot is ready', async () => {
    const captured = stubFetch({})
    const mod = await loadModule()

    await mod.ensureTinTinProvider({ phase: 'starting', message: '', logs: [] })

    expect(captured).toHaveLength(0)
  })
})
