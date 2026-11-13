import { describe, expect, it } from 'vitest'
import {
  compareTintinVersions,
  checkForTintinDesktopUpdate,
  parseTintinReleaseVersion,
  resolveTintinInstallerRelease,
  selectTintinInstallerRelease,
  TINTIN_RELEASES_ENDPOINT,
} from '../src/tintin/tintin-update-check.ts'
import type { UpdateRequest } from '../src/update-checker.ts'

const INSTALLER_DIGEST = 'a'.repeat(64)
const SIDECAR_DIGEST = 'b'.repeat(64)

function assetUrl(tag: string, name: string): string {
  return `https://github.com/justTintin/tintin-dsh-desktop/releases/download/${tag}/${name}`
}

function installerAsset(tag: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const name = `TinTin-${tag.replace(/^v/u, '')}-x64-Setup.exe`
  return { name, browser_download_url: assetUrl(tag, name), size: 654_311_424, ...overrides }
}

function releaseEntry(
  tag: string,
  options: { draft?: boolean; assets?: readonly Record<string, unknown>[] } = {},
): Record<string, unknown> {
  return {
    tag_name: tag,
    draft: options.draft === true,
    prerelease: true,
    assets: options.assets ?? [installerAsset(tag)],
  }
}

/** Route a fake request by URL: the listing plus any sidecar digest bodies. */
function listingRequest(
  releases: readonly unknown[],
  sidecars: Readonly<Record<string, string>> = {},
  status = 200,
): UpdateRequest {
  return async (url: string) => {
    if (url === TINTIN_RELEASES_ENDPOINT) {
      if (status !== 200) return new Response('nope', { status })
      return Response.json(releases)
    }
    const body = sidecars[url]
    if (body === undefined) return new Response('missing', { status: 404 })
    return new Response(body, { status: 200 })
  }
}

describe('tintin release version parsing', () => {
  it('parses stamped versions with both stamp separators and an optional v prefix', () => {
    expect(parseTintinReleaseVersion('v0.2.2-rc.1-20261112-2217')).toEqual({
      version: '0.2.2-rc.1-20261112-2217',
      base: '0.2.2-rc.1',
      stamp: 202611122217,
    })
    expect(parseTintinReleaseVersion('0.2.2-rc.1-20261112.2217')?.stamp).toBe(202611122217)
  })

  it('parses unstamped versions as stamp zero', () => {
    expect(parseTintinReleaseVersion('0.2.2-rc.1')).toEqual({
      version: '0.2.2-rc.1',
      base: '0.2.2-rc.1',
      stamp: 0,
    })
    expect(parseTintinReleaseVersion('0.2.2')).toEqual({ version: '0.2.2', base: '0.2.2', stamp: 0 })
  })

  it.each([
    '',
    'not-a-version',
    '01.2.3-20261112-2217',
  ])('rejects invalid versions %s', input => {
    expect(parseTintinReleaseVersion(input)).toBeNull()
  })

  it('treats truncated stamp tails as ordinary unstamped SemVer', () => {
    expect(parseTintinReleaseVersion('0.2.2-rc.1-20261112')).toEqual({
      version: '0.2.2-rc.1-20261112',
      base: '0.2.2-rc.1-20261112',
      stamp: 0,
    })
  })
})

describe('tintin version comparison', () => {
  it('orders by package version before the stamp', () => {
    expect(compareTintinVersions('0.3.0-rc.1-20261112-2217', '0.2.2-rc.1-20261113-2300')).toBeGreaterThan(0)
    expect(compareTintinVersions('0.2.2-rc.2-20261112-2217', '0.2.2-rc.1-20261113-2300')).toBeGreaterThan(0)
    expect(compareTintinVersions('0.2.2-rc.1-20261112-2217', '0.2.2')).toBeLessThan(0)
  })

  it('orders equal bases by the numeric stamp', () => {
    expect(compareTintinVersions('0.2.2-rc.1-20261113-0930', '0.2.2-rc.1-20261112-2217')).toBeGreaterThan(0)
    expect(compareTintinVersions('0.2.2-rc.1-20261112.2217', '0.2.2-rc.1-20261112-2217')).toBe(0)
    expect(compareTintinVersions('0.2.2-rc.1', '0.2.2-rc.1-20261112-2217')).toBeLessThan(0)
  })

  it('returns null for invalid inputs instead of guessing an order', () => {
    expect(compareTintinVersions('garbage', '0.2.2-rc.1-20261112-2217')).toBeNull()
  })
})

describe('release selection', () => {
  it('takes the newest non-draft release carrying a Windows installer', () => {
    const release = selectTintinInstallerRelease([
      releaseEntry('v0.2.2-rc.1-20261113-0930'),
      releaseEntry('v0.2.2-rc.1-20261112-2217'),
    ])
    expect(release?.version).toBe('0.2.2-rc.1-20261113-0930')
    expect(release?.asset.name).toBe('TinTin-0.2.2-rc.1-20261113-0930-x64-Setup.exe')
    expect(release?.asset.url).toBe(assetUrl('v0.2.2-rc.1-20261113-0930', 'TinTin-0.2.2-rc.1-20261113-0930-x64-Setup.exe'))
  })

  it('skips drafts, non-installer releases, and unparseable tags', () => {
    const release = selectTintinInstallerRelease([
      releaseEntry('v0.2.3-rc.1-20261114-1000', { draft: true }),
      releaseEntry('notes-only', { assets: [{ name: 'README.md', browser_download_url: assetUrl('notes', 'README.md'), size: 12 }] }),
      releaseEntry('v0.2.2-rc.1-20261112-2217'),
    ])
    expect(release?.version).toBe('0.2.2-rc.1-20261112-2217')
  })

  it('accepts the API digest header and the sidecar asset as digest sources', () => {
    const withHeader = selectTintinInstallerRelease([
      releaseEntry('v0.2.2-rc.1-20261112-2217', { assets: [installerAsset('v0.2.2-rc.1-20261112-2217', { digest: `sha256:${INSTALLER_DIGEST}` })] }),
    ])
    expect(withHeader?.asset.sha256).toBe(INSTALLER_DIGEST)
    expect(withHeader?.digestSidecar).toBeUndefined()

    const sidecarName = 'TinTin-0.2.2-rc.1-20261112-2217-x64-Setup.exe.sha256'
    const withSidecar = selectTintinInstallerRelease([
      releaseEntry('v0.2.2-rc.1-20261112-2217', {
        assets: [installerAsset('v0.2.2-rc.1-20261112-2217'), { name: sidecarName, browser_download_url: assetUrl('v0.2.2-rc.1-20261112-2217', sidecarName), size: 76 }],
      }),
    ])
    expect(withSidecar?.asset.sha256).toBeUndefined()
    expect(withSidecar?.digestSidecar?.name).toBe(sidecarName)
  })

  it('ignores assets outside the GitHub release hosts and malformed entries', () => {
    const release = selectTintinInstallerRelease([
      releaseEntry('v0.2.2-rc.1-20261112-2217', {
        assets: [
          { name: 'evil.exe', browser_download_url: 'http://evil.example/evil.exe', size: 1 },
          installerAsset('v0.2.2-rc.1-20261112-2217'),
        ],
      }),
    ])
    expect(release?.asset.name).toBe('TinTin-0.2.2-rc.1-20261112-2217-x64-Setup.exe')
    expect(selectTintinInstallerRelease('garbage')).toBeUndefined()
    expect(selectTintinInstallerRelease([{ tag_name: 'v0.2.2-rc.1-20261112-2217' }])).toBeUndefined()
  })
})

describe('channel update check', () => {
  const CURRENT = '0.2.2-rc.1-20261112-2217'

  it('reports a newer stamped release with its published digest', async () => {
    const sidecarName = 'TinTin-0.2.3-rc.1-20261113-0930-x64-Setup.exe.sha256'
    const result = await checkForTintinDesktopUpdate({
      currentVersion: CURRENT,
      channel: 'tintin',
      request: listingRequest(
        [releaseEntry('v0.2.3-rc.1-20261113-0930', {
          assets: [
            installerAsset('v0.2.3-rc.1-20261113-0930'),
            { name: sidecarName, browser_download_url: assetUrl('v0.2.3-rc.1-20261113-0930', sidecarName), size: 76 },
          ],
        })],
        { [assetUrl('v0.2.3-rc.1-20261113-0930', sidecarName)]: `${SIDECAR_DIGEST}  TinTin-0.2.3-rc.1-20261113-0930-x64-Setup.exe\n` },
      ),
    })
    expect(result).toEqual({
      status: 'update-available',
      currentVersion: CURRENT,
      latestVersion: '0.2.3-rc.1-20261113-0930',
      installerSha256: { win32: SIDECAR_DIGEST },
    })
  })

  it('prefers the digest GitHub publishes on the asset itself', async () => {
    const result = await checkForTintinDesktopUpdate({
      currentVersion: CURRENT,
      channel: 'tintin',
      request: listingRequest([
        releaseEntry('v0.2.3-rc.1-20261113-0930', {
          assets: [installerAsset('v0.2.3-rc.1-20261113-0930', { digest: `SHA256:${INSTALLER_DIGEST.toUpperCase()}` })],
        }),
      ]),
    })
    expect(result).toMatchObject({ status: 'update-available', installerSha256: { win32: INSTALLER_DIGEST } })
  })

  it('stays up to date for equal, older, and unstamped installed versions', async () => {
    const releases = [releaseEntry('v0.2.2-rc.1-20261112-2217'), releaseEntry('v0.2.2-rc.1-20261111-1100')]
    expect(await checkForTintinDesktopUpdate({ currentVersion: CURRENT, channel: 'tintin', request: listingRequest(releases) }))
      .toEqual({ status: 'up-to-date', currentVersion: CURRENT, latestVersion: CURRENT })
    expect(await checkForTintinDesktopUpdate({ currentVersion: '0.2.3-rc.1-20261114-1000', channel: 'tintin', request: listingRequest(releases) }))
      .toEqual({ status: 'up-to-date', currentVersion: '0.2.3-rc.1-20261114-1000', latestVersion: CURRENT })
    expect(await checkForTintinDesktopUpdate({ currentVersion: '0.2.2-rc.1', channel: 'tintin', request: listingRequest(releases) }))
      .toEqual({ status: 'update-available', currentVersion: '0.2.2-rc.1', latestVersion: CURRENT })
  })

  it('reports up to date when nothing installable is published yet', async () => {
    const result = await checkForTintinDesktopUpdate({
      currentVersion: CURRENT,
      channel: 'tintin',
      request: listingRequest([releaseEntry('notes', { assets: [{ name: 'README.md', browser_download_url: assetUrl('notes', 'README.md'), size: 12 }] })]),
    })
    expect(result).toEqual({ status: 'up-to-date', currentVersion: CURRENT, latestVersion: CURRENT })
  })

  it('returns null on transport, status, payload, and version failures', async () => {
    const failing: UpdateRequest = async () => { throw new Error('offline') }
    expect(await checkForTintinDesktopUpdate({ currentVersion: CURRENT, channel: 'tintin', request: failing })).toBeNull()
    expect(await checkForTintinDesktopUpdate({
      currentVersion: CURRENT,
      channel: 'tintin',
      request: listingRequest([], {}, 403),
    })).toBeNull()
    expect(await checkForTintinDesktopUpdate({
      currentVersion: CURRENT,
      channel: 'tintin',
      request: async () => new Response('not json', { status: 200 }),
    })).toBeNull()
    // Unstamped development versions are valid; only non-SemVer inputs fail.
    expect(await checkForTintinDesktopUpdate({ currentVersion: 'dev', channel: 'tintin', request: listingRequest([]) })).toBeNull()
  })

  it('offers a downgrade only when explicitly allowed', async () => {
    const releases = [releaseEntry('v0.2.2-rc.1-20261111-1100')]
    expect(await checkForTintinDesktopUpdate({ currentVersion: CURRENT, channel: 'tintin', request: listingRequest(releases) }))
      .toMatchObject({ status: 'up-to-date' })
    expect(await checkForTintinDesktopUpdate({ currentVersion: CURRENT, channel: 'tintin', allowDowngrade: true, request: listingRequest(releases) }))
      .toMatchObject({ status: 'update-available', latestVersion: '0.2.2-rc.1-20261111-1100' })
  })
})

describe('installer resolution for the download path', () => {
  it('resolves the exact version with its sidecar digest', async () => {
    const sidecarName = 'TinTin-0.2.2-rc.1-20261112-2217-x64-Setup.exe.sha256'
    const sidecarUrl = assetUrl('v0.2.2-rc.1-20261112-2217', sidecarName)
    const resolved = await resolveTintinInstallerRelease(
      '0.2.2-rc.1-20261112-2217',
      listingRequest(
        [releaseEntry('v0.2.2-rc.1-20261112-2217', {
          assets: [installerAsset('v0.2.2-rc.1-20261112-2217'), { name: sidecarName, browser_download_url: sidecarUrl, size: 76 }],
        })],
        { [sidecarUrl]: SIDECAR_DIGEST },
      ),
    )
    expect(resolved).toEqual({
      asset: { name: 'TinTin-0.2.2-rc.1-20261112-2217-x64-Setup.exe', url: assetUrl('v0.2.2-rc.1-20261112-2217', 'TinTin-0.2.2-rc.1-20261112-2217-x64-Setup.exe'), size: 654_311_424 },
      sha256: SIDECAR_DIGEST,
    })
  })

  it('returns null when the listing does not contain the requested version', async () => {
    const resolved = await resolveTintinInstallerRelease(
      '0.2.9-rc.1-20261112-2217',
      listingRequest([releaseEntry('v0.2.2-rc.1-20261112-2217')]),
    )
    expect(resolved).toBeNull()
  })
})
