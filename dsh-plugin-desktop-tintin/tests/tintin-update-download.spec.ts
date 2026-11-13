import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  downloadTintinUpdateArtifact,
  resolveTintinUpdateAsset,
  type TintinDownloadOptions,
} from '../src/tintin/tintin-update-download.ts'
import { UpdateDownloadError, type UpdateArtifactRequest, type UpdateArtifactResponse } from '../src/update-download.ts'

const temporaryRoots: string[] = []

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tintin-update-download-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const INSTALLER_URL = 'https://objects.githubusercontent.com/packages/tintin-setup.exe'
const INSTALLER_DIGEST = 'a'.repeat(64)

function windowsArtifact(): Uint8Array {
  const artifact = Buffer.alloc(512, 0)
  artifact.write('MZ', 0, 'ascii')
  artifact.writeUInt32LE(0x80, 0x3c)
  artifact.set([0x50, 0x45, 0x00, 0x00], 0x80)
  return artifact
}

function artifactResponse(
  chunks: readonly Uint8Array[],
  finalUrl: string = INSTALLER_URL,
  headers: HeadersInit = {},
): UpdateArtifactResponse {
  let index = 0
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index]
      index += 1
      if (chunk === undefined) controller.close()
      else controller.enqueue(chunk)
    },
  }), { status: 200, headers })
  return { response, finalUrl }
}

function requestServing(artifact: Uint8Array, finalUrl?: string): UpdateArtifactRequest {
  return async () => artifactResponse([artifact], finalUrl)
}

async function expectFailure(
  promise: Promise<unknown>,
  code: UpdateDownloadError['code'],
): Promise<UpdateDownloadError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(UpdateDownloadError)
    expect(error).toMatchObject({ code })
    return error as UpdateDownloadError
  }
  throw new Error('Expected the tintin update download to fail.')
}

function downloadOptions(root: string, overrides: Partial<TintinDownloadOptions> = {}): TintinDownloadOptions {
  return {
    platform: 'win32',
    url: INSTALLER_URL,
    destinationPath: join(root, 'TinTin-0.2.2-rc.1-20261112-2217-x64-Setup.exe'),
    request: requestServing(windowsArtifact()),
    ...overrides,
  }
}

describe('tintin installer download', () => {
  it('writes a valid installer and settles on the completed path', async () => {
    const root = await temporaryDirectory()
    const artifactPath = await downloadTintinUpdateArtifact(downloadOptions(root))
    expect(artifactPath).toBe(join(root, 'TinTin-0.2.2-rc.1-20261112-2217-x64-Setup.exe'))
    const stored = await readFile(artifactPath)
    expect(stored.subarray(0, 2).toString('ascii')).toBe('MZ')
    await expect(access(`${artifactPath}.partial`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enforces the published digest when one is provided', async () => {
    const root = await temporaryDirectory()
    const artifact = windowsArtifact()
    const digest = createHash('sha256').update(artifact).digest('hex')
    await downloadTintinUpdateArtifact(downloadOptions(root, { expectedSha256: digest.toUpperCase() }))
    await expectFailure(
      downloadTintinUpdateArtifact(downloadOptions(root, { expectedSha256: INSTALLER_DIGEST })),
      'invalid-artifact',
    )
  })

  it('rejects non-HTTPS redirect settlements and bad responses', async () => {
    const root = await temporaryDirectory()
    await expectFailure(
      downloadTintinUpdateArtifact(downloadOptions(root, { request: requestServing(windowsArtifact(), 'http://objects.githubusercontent.com/tintin-setup.exe') })),
      'redirect-origin',
    )
    await expectFailure(
      downloadTintinUpdateArtifact(downloadOptions(root, {
        request: async () => artifactResponse([], INSTALLER_URL, { 'content-length': '0' }),
      })),
      'empty-body',
    )
    await expectFailure(
      downloadTintinUpdateArtifact(downloadOptions(root, {
        request: async () => ({ response: new Response('nope', { status: 404 }), finalUrl: INSTALLER_URL }),
      })),
      'http-status',
    )
    await expectFailure(
      downloadTintinUpdateArtifact(downloadOptions(root, {
        request: async () => { throw new Error('offline') },
      })),
      'network',
    )
  })

  it('rejects files that are not PE executables and oversized declarations', async () => {
    const root = await temporaryDirectory()
    await expectFailure(
      downloadTintinUpdateArtifact(downloadOptions(root, { request: requestServing(new Uint8Array(Buffer.alloc(512, 0x5a))) })),
      'invalid-artifact',
    )
    await expectFailure(
      downloadTintinUpdateArtifact(downloadOptions(root, {
        request: async () => artifactResponse([windowsArtifact()], INSTALLER_URL, { 'content-length': String(1024 * 1024 * 1024 + 1) }),
      })),
      'response-too-large',
    )
  })

  it('validates options before any network work', async () => {
    const root = await temporaryDirectory()
    await mkdir(join(root, 'nested'), { recursive: true })
    await expectFailure(
      downloadTintinUpdateArtifact(downloadOptions(root, { destinationPath: join(root, 'installer.dmg') })),
      'invalid-options',
    )
    await expectFailure(
      downloadTintinUpdateArtifact(downloadOptions(root, { destinationPath: 'TinTin-Setup.exe' })),
      'invalid-options',
    )
    await expectFailure(
      downloadTintinUpdateArtifact(downloadOptions(root, { url: 'http://github.com/x.exe' })),
      'invalid-options',
    )
    await expectFailure(
      downloadTintinUpdateArtifact(downloadOptions(root, { expectedSha256: 'zz'.repeat(32) })),
      'invalid-options',
    )
    await expectFailure(
      downloadTintinUpdateArtifact(downloadOptions(root, { request: async () => { throw new DOMException('stop', 'AbortError') } })),
      'aborted',
    )
  })
})

describe('asset resolution for the tintin download flow', () => {
  it('resolves the exact version with its published digest', async () => {
    const resolved = await resolveTintinUpdateAsset(
      '0.2.2-rc.1-20261112-2217',
      async url => {
        if (url.includes('/releases?')) {
          return Response.json([{
            tag_name: 'v0.2.2-rc.1-20261112-2217',
            draft: false,
            assets: [{
              name: 'TinTin-0.2.2-rc.1-20261112-2217-x64-Setup.exe',
              browser_download_url: INSTALLER_URL,
              size: 654_311_424,
              digest: `sha256:${INSTALLER_DIGEST}`,
            }],
          }])
        }
        throw new Error(`unexpected request: ${url}`)
      },
    )
    expect(resolved).toEqual({
      name: 'TinTin-0.2.2-rc.1-20261112-2217-x64-Setup.exe',
      url: INSTALLER_URL,
      size: 654_311_424,
      sha256: INSTALLER_DIGEST,
    })
  })

  it('returns null when the listing fails or the version is absent', async () => {
    expect(await resolveTintinUpdateAsset('0.2.2-rc.1-20261112-2217', async () => new Response('nope', { status: 403 }))).toBeNull()
    expect(await resolveTintinUpdateAsset('9.9.9-rc.1-20261112-2217', async () => Response.json([]))).toBeNull()
    expect(await resolveTintinUpdateAsset('garbage', async () => Response.json([]))).toBeNull()
  })
})
