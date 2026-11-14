/** TinTin-channel update checks against the GitHub Releases of this repository. */

import {
  compareSemVerVersions,
  parseSemVer,
  type UpdateCheckOptions,
  type UpdateCheckResult,
  type UpdateRequest,
} from '../update-checker.ts'
import { diagnosticLog } from '../developer-logging.ts'

/**
 * GitHub repository that publishes TinTin Desktop installers. The channel-only
 * override exists so a fork can point its update checks at its own releases.
 */
export const TINTIN_RELEASES_REPO = process.env.TINTIN_UPDATE_REPO ?? 'justTintin/tintin-dsh-desktop'

/** Releases listing returning the newest TinTin installers, newest release first. */
export const TINTIN_RELEASES_ENDPOINT = `https://api.github.com/repos/${TINTIN_RELEASES_REPO}/releases?per_page=20`

/**
 * GitHub Releases Atom feed (github.com main site, not the REST API). It does
 * not share the API's per-IP anonymous rate limit, so it stays reachable when
 * the API returns 403 `rate limit exceeded` — which is exactly what happens
 * behind shared proxy exit addresses (2026-11-13 实测: 应用走 PAC 代理时 API 恒 403,
 * 同一代理路径下 atom 200). The feed carries no assets, so the download path
 * reconstructs asset URLs from the release tag and the artifact-name contract.
 */
export const TINTIN_RELEASES_ATOM_ENDPOINT = `https://github.com/${TINTIN_RELEASES_REPO}/releases.atom`

/** User agent that GitHub's REST API requires on every request. */
export const TINTIN_RELEASE_USER_AGENT = 'tintin-dsh-desktop-updates'

/** Maximum accepted releases-listing body bytes. */
export const MAX_RELEASES_RESPONSE_BYTES = 4 * 1024 * 1024

/** Maximum accepted releases Atom feed body bytes. */
export const MAX_RELEASES_ATOM_BYTES = 512 * 1024

/** Maximum accepted sidecar digest body bytes. */
export const MAX_DIGEST_RESPONSE_BYTES = 4 * 1024

/** installer asset name per the electron-builder `artifactName` contract. */
export function tintinInstallerAssetName(version: string): string {
  return `TinTin-${version}-x64-Setup.exe`
}

/**
 * One parsed TinTin release identity. TinTin versions append a build stamp to
 * the package version — `0.2.2-rc.1-20261112-2217` (or `.` before the clock) —
 * which deliberately breaks the shared stable/beta/tintin SemVer grammar, so
 * this channel parses its own two-part ordering: package version first, then
 * the numeric stamp. An unstamped version (a development build of
 * `0.2.2-rc.1`) orders below every stamp of its own base.
 */
export interface TintinReleaseVersion {
  /** Full version without the optional leading `v`. */
  readonly version: string
  /** Package version that precedes the stamp, compared with SemVer rules. */
  readonly base: string
  /** Numeric build stamp (0 for an unstamped version), compared numerically. */
  readonly stamp: number
}

/** One downloadable installer attached to a TinTin release. */
export interface TintinReleaseAsset {
  /** Original asset file name, used as the save-dialog default. */
  readonly name: string
  /** Absolute download URL of the asset. */
  readonly url: string
  /** Declared asset size in bytes. */
  readonly size: number
  /** Hex SHA-256 when GitHub already publishes one on the asset itself. */
  readonly sha256?: string
}

/** The newest release that carries a TinTin installer. */
export interface TintinInstallerRelease {
  /** Parsed release version (the tag without its leading `v`). */
  readonly version: string
  /** Windows installer asset attached to this release; absent on the Atom path. */
  readonly asset?: TintinReleaseAsset
  /** Sidecar asset carrying a hex digest when the API did not publish one. */
  readonly digestSidecar?: TintinReleaseAsset
}

/** How the newest release was discovered. */
export type TintinReleaseSource = 'api' | 'atom'

/** Trailing `-YYYYMMDD[-.]HHmm` stamp accepted on TinTin release tags. */
const TINTIN_STAMP_PATTERN = /-([0-9]{8})[.\-]([0-9]{3,4})$/u

/** Asset hosts that GitHub release downloads resolve against. */
const TINTIN_ASSET_HOSTS = new Set(['github.com', 'objects.githubusercontent.com'])

/* 铁律 3:检查更新的每个失败分支必须打点(2026-11-13 实测教训——失败分支静默,
   用户弹「未能获取更新信息」时日志查无证据)。developer:false 无条件落盘。 */
function logCheck(event: string, fields: Record<string, string | number | boolean | null | undefined> = {}, level: 'info' | 'error' = 'info'): void {
  diagnosticLog({ source: 'tintin-update-check', event, level, developer: false, fields })
}

/**
 * Parse one TinTin release tag or installed version.
 * @param input - complete version or release tag, with optional leading `v`.
 * @returns parsed base and stamp, or null when the input is not valid SemVer.
 */
export function parseTintinReleaseVersion(input: string): TintinReleaseVersion | null {
  const version = input.startsWith('v') ? input.slice(1) : input
  const match = TINTIN_STAMP_PATTERN.exec(version)
  if (match === null) {
    const parsed = parseSemVer(version)
    if (parsed === null || parsed.version !== version) return null
    return { version, base: version, stamp: 0 }
  }
  const base = version.slice(0, match.index)
  const parsed = parseSemVer(base)
  if (parsed === null || parsed.version !== base) return null
  return { version, base, stamp: Number(`${match[1]}${match[2]}`) }
}

/**
 * Compare two TinTin versions by package version first, then build stamp.
 * @param left - first version or release tag.
 * @param right - second version or release tag.
 * @returns negative, zero, or positive ordering, or null when either input is invalid.
 */
export function compareTintinVersions(left: string, right: string): number | null {
  const leftVersion = parseTintinReleaseVersion(left)
  const rightVersion = parseTintinReleaseVersion(right)
  if (leftVersion === null || rightVersion === null) return null
  const base = compareSemVerVersions(leftVersion.base, rightVersion.base)
  if (base === null || base !== 0) return base
  if (leftVersion.stamp === rightVersion.stamp) return 0
  return leftVersion.stamp < rightVersion.stamp ? -1 : 1
}

/**
 * Extract release tags from one Releases Atom feed, newest first. Only tags
 * that parse as TinTin versions survive; everything else (notes-only tags,
 * malformed entries) is skipped.
 * @param xml - raw Atom feed body.
 * @returns ordered tag list (leading `v` preserved), possibly empty.
 */
export function parseTintinReleaseFeed(xml: string): string[] {
  const tags: string[] = []
  const pattern = /<id>tag:github\.com,2008:Repository\/[0-9]+\/([^<]+)<\/id>/gu
  for (const match of xml.matchAll(pattern)) {
    const tag = match[1]!
      .replace(/&amp;/gu, '&')
      .replace(/&lt;/gu, '<')
      .replace(/&gt;/gu, '>')
      .replace(/&quot;/gu, '"')
    if (parseTintinReleaseVersion(tag) !== null && !tags.includes(tag)) tags.push(tag)
  }
  return tags
}

/**
 * Select the newest release that carries a Windows installer from a parsed
 * releases listing. Drafts and releases without a parseable tag are skipped;
 * prerelease flags are not filtered, because every TinTin build ships as one.
 * @param releases - decoded GitHub releases listing response.
 * @returns the newest installer release, or undefined when none qualifies.
 */
export function selectTintinInstallerRelease(releases: unknown): TintinInstallerRelease | undefined {
  if (!Array.isArray(releases)) return undefined
  for (const entry of releases) {
    if (!isRecord(entry) || typeof entry.tag_name !== 'string' || entry.draft === true) continue
    const parsed = parseTintinReleaseVersion(entry.tag_name)
    if (parsed === null) continue
    const assets = Array.isArray(entry.assets) ? entry.assets : []
    const asset = selectInstallerAsset(assets)
    if (asset === undefined) continue
    const digestSidecar = selectDigestSidecar(assets, asset.name)
    return {
      version: parsed.version,
      asset,
      ...(digestSidecar === undefined ? {} : { digestSidecar }),
    }
  }
  return undefined
}

interface RequestedReleases {
  readonly source: TintinReleaseSource
  /** Newest installer release; on the Atom path it carries no asset. */
  readonly release?: TintinInstallerRelease
}

/**
 * Request the newest installer release: the REST listing first, the Atom feed
 * as the rate-limit fallback. API failures are expected behind shared proxy
 * exits (anonymous 60/h per IP); the Atom path keeps checks working there.
 */
async function requestNewestTintinRelease(
  request: UpdateRequest,
  signal?: AbortSignal,
): Promise<RequestedReleases | null> {
  const init: RequestInit = {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': TINTIN_RELEASE_USER_AGENT,
    },
    cache: 'no-store',
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  }
  try {
    const response = await request(TINTIN_RELEASES_ENDPOINT, init)
    if (response.status === 200) {
      const listing = JSON.parse(await readLimitedBody(response, MAX_RELEASES_RESPONSE_BYTES))
      const release = selectTintinInstallerRelease(listing)
      if (release !== undefined) return { source: 'api', release }
      // A listing without any installer release means nothing is published yet.
      return { source: 'api' }
    }
    const rateLimit = response.headers.get('x-ratelimit-remaining')
    logCheck('api-status', { status: response.status, rateLimitRemaining: rateLimit }, 'error')
  } catch (cause) {
    logCheck('api-request-failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    }, 'error')
  }

  // Rate-limit or transport fallback: the Atom feed shares no API quota.
  try {
    const response = await request(TINTIN_RELEASES_ATOM_ENDPOINT, {
      ...init,
      headers: { ...init.headers, Accept: 'application/atom+xml' },
    })
    if (response.status !== 200) {
      logCheck('atom-status', { status: response.status }, 'error')
      return null
    }
    const tags = parseTintinReleaseFeed(await readLimitedBody(response, MAX_RELEASES_ATOM_BYTES))
    const tag = tags[0]
    const parsed = tag === undefined ? null : parseTintinReleaseVersion(tag)
    if (parsed === null) {
      logCheck('atom-no-tintin-release')
      return { source: 'atom' }
    }
    logCheck('atom-fallback-hit', { tag })
    return { source: 'atom', release: { version: parsed.version } }
  } catch (cause) {
    logCheck('atom-request-failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    }, 'error')
    return null
  }
}

/**
 * Check the TinTin GitHub Releases for an installer newer than the installed
 * version. The shared version service does not serve the tintin channel, so
 * this channel queries GitHub; when the REST API is rate-limited (403 behind
 * shared proxy exits) the Atom feed keeps the check alive.
 * @param options - installed version, caller-owned signal, and optional request adapter.
 * @returns a successful comparison, or null when every request path failed.
 */
export async function checkForTintinDesktopUpdate(
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult | null> {
  const current = parseTintinReleaseVersion(options.currentVersion)
  if (current === null) {
    logCheck('version-unparseable', { currentVersion: options.currentVersion }, 'error')
    return null
  }

  const request = options.request ?? defaultTintinRequest
  logCheck('check-start', { currentVersion: current.version })
  const requested = await requestNewestTintinRelease(request, options.signal)
  if (requested === null) {
    logCheck('check-failed', { reason: 'api-and-atom-unavailable' }, 'error')
    return null
  }
  const release = requested.release
  if (release === undefined) {
    // Nothing published yet: the installed build is the newest known release.
    logCheck('no-installable-release')
    return { status: 'up-to-date', currentVersion: current.version, latestVersion: current.version }
  }

  const comparison = compareTintinVersions(release.version, current.version)
  if (comparison === null) {
    logCheck('comparison-failed', { release: release.version, current: current.version }, 'error')
    return null
  }
  const updateAvailable = comparison > 0 || (options.allowDowngrade === true && comparison !== 0)
  if (!updateAvailable) {
    logCheck('check-done', { status: 'up-to-date', latestVersion: release.version, via: requested.source })
    return { status: 'up-to-date', currentVersion: current.version, latestVersion: release.version }
  }

  // The Atom path carries no assets, so the digest resolves at download time.
  const sha256 = release.asset === undefined
    ? undefined
    : await resolveTintinInstallerSha256(release, request, options.signal)
  logCheck('check-done', {
    status: 'update-available',
    latestVersion: release.version,
    via: requested.source,
    digest: sha256 !== undefined,
  })
  return {
    status: 'update-available',
    currentVersion: current.version,
    latestVersion: release.version,
    ...(sha256 === undefined ? {} : { installerSha256: { win32: sha256 } }),
  }
}

/**
 * Resolve the installer of one exact TinTin version: the REST listing first;
 * when it is unavailable, the Atom feed confirms the release exists and the
 * asset URLs are reconstructed from the artifact-name contract
 * (`TinTin-<version>-x64-Setup.exe` beside its `.sha256` sidecar).
 * @param version - release version to resolve (the tag without its leading `v`).
 * @param request - fetch-compatible request adapter.
 * @param signal - caller-owned cancellation signal.
 * @returns the asset identity and digest, or null when every path failed.
 */
export async function resolveTintinInstallerRelease(
  version: string,
  request: UpdateRequest,
  signal?: AbortSignal,
): Promise<{ readonly asset: TintinReleaseAsset; readonly sha256?: string } | null> {
  const target = parseTintinReleaseVersion(version)
  if (target === null) return null
  const init: RequestInit = {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': TINTIN_RELEASE_USER_AGENT,
    },
    cache: 'no-store',
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  }
  try {
    const response = await request(TINTIN_RELEASES_ENDPOINT, init)
    if (response.status === 200) {
      const listing = JSON.parse(await readLimitedBody(response, MAX_RELEASES_RESPONSE_BYTES))
      const release = selectTintinInstallerRelease(listing)
      if (release !== undefined && release.version === target.version) {
        // API-selected releases always carry an asset; guard for typing only.
        if (release.asset === undefined) return null
        const sha256 = await resolveTintinInstallerSha256(release, request, signal)
        return { asset: release.asset, ...(sha256 === undefined ? {} : { sha256 }) }
      }
      if (release !== undefined) logCheck('resolve-version-mismatch', { release: release.version, requested: version }, 'error')
      return null
    }
    logCheck('resolve-api-status', { status: response.status }, 'error')
  } catch (cause) {
    logCheck('resolve-api-failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    }, 'error')
  }

  // Atom fallback: confirm the tag exists, then reconstruct the asset URLs.
  try {
    const response = await request(TINTIN_RELEASES_ATOM_ENDPOINT, {
      ...init,
      headers: { ...init.headers, Accept: 'application/atom+xml' },
    })
    if (response.status !== 200) {
      logCheck('resolve-atom-status', { status: response.status }, 'error')
      return null
    }
    const tags = parseTintinReleaseFeed(await readLimitedBody(response, MAX_RELEASES_ATOM_BYTES))
    if (!tags.includes(`v${target.version}`)) {
      logCheck('resolve-atom-tag-missing', { requested: version }, 'error')
      return null
    }
    const asset = reconstructedAsset(target.version)
    if (asset === undefined) {
      logCheck('resolve-asset-url-rejected', { requested: version }, 'error')
      return null
    }
    logCheck('resolve-atom-hit', { requested: version })
    const sha256 = await resolveReconstructedSha256(asset, request, signal)
    return { asset, ...(sha256 === undefined ? {} : { sha256 }) }
  } catch (cause) {
    logCheck('resolve-atom-failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    }, 'error')
    return null
  }
}

/** Reconstructed installer asset per the artifact-name contract, or undefined when the URL fails the host checks. */
function reconstructedAsset(version: string): TintinReleaseAsset | undefined {
  const name = tintinInstallerAssetName(version)
  let url: URL
  try {
    url = new URL(`https://github.com/${TINTIN_RELEASES_REPO}/releases/download/v${version}/${name}`)
  } catch {
    return undefined
  }
  if (!isTintinAssetUrl(url.toString())) return undefined
  return { name, url: url.toString(), size: 0 }
}

/**
 * Resolve the hex SHA-256 of one installer release: from the digest GitHub
 * publishes on the asset itself, or by fetching a `<asset>.sha256` sidecar.
 * @param release - installer release selected from the listing.
 * @param request - fetch-compatible request adapter.
 * @param signal - caller-owned cancellation signal.
 * @returns normalized lowercase hex digest, or undefined when none is published.
 */
export async function resolveTintinInstallerSha256(
  release: TintinInstallerRelease,
  request: UpdateRequest,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (release.asset !== undefined && release.asset.sha256 !== undefined) return release.asset.sha256
  const sidecar = release.digestSidecar
  if (sidecar === undefined) return undefined
  try {
    const response = await request(sidecar.url, {
      method: 'GET',
      headers: { Accept: 'application/octet-stream', 'User-Agent': TINTIN_RELEASE_USER_AGENT },
      cache: 'no-store',
      redirect: 'error',
      ...(signal === undefined ? {} : { signal }),
    })
    if (response.status !== 200) return undefined
    // sha256sum-format sidecars are "<digest>  <filename>"; take the first hex token.
    const body = (await readLimitedBody(response, MAX_DIGEST_RESPONSE_BYTES)).trim()
    const digest = /^([0-9a-fA-F]{64})(?:\s|$)/u.exec(body)?.[1]
    if (digest === undefined) {
      logCheck('sidecar-digest-unparseable', { asset: sidecar.name }, 'error')
      return undefined
    }
    return digest.toLowerCase()
  } catch (cause) {
    logCheck('sidecar-fetch-failed', {
      asset: sidecar.name,
      error: cause instanceof Error ? cause.message : String(cause),
    }, 'error')
    return undefined
  }
}

/** Same digest resolution for a reconstructed (Atom-path) asset. */
async function resolveReconstructedSha256(
  asset: TintinReleaseAsset,
  request: UpdateRequest,
  signal?: AbortSignal,
): Promise<string | undefined> {
  return resolveTintinInstallerSha256({
    version: '',
    asset,
    digestSidecar: { name: `${asset.name}.sha256`, url: `${asset.url}.sha256`, size: 0 },
  }, request, signal)
}

function selectInstallerAsset(assets: readonly unknown[]): TintinReleaseAsset | undefined {
  for (const entry of assets) {
    if (!isRecord(entry)) continue
    const name = entry.name
    const url = entry.browser_download_url
    const size = entry.size
    if (typeof name !== 'string' || typeof url !== 'string' || typeof size !== 'number') continue
    if (!name.toLowerCase().endsWith('.exe') || !isTintinAssetUrl(url)) continue
    const sha256 = normalizeHexDigest(entry.digest)
    return { name, url, size, ...(sha256 === undefined ? {} : { sha256 }) }
  }
  return undefined
}

function selectDigestSidecar(assets: readonly unknown[], installerName: string): TintinReleaseAsset | undefined {
  for (const entry of assets) {
    if (!isRecord(entry)) continue
    const name = entry.name
    const url = entry.browser_download_url
    if (typeof name !== 'string' || typeof url !== 'string') continue
    if (name !== `${installerName}.sha256` || !isTintinAssetUrl(url)) continue
    return { name, url, size: typeof entry.size === 'number' ? entry.size : 0 }
  }
  return undefined
}

/**
 * Require a usable HTTPS asset URL. Public releases publish
 * `github.com/...` download links that redirect to the asset store, and the
 * download path re-checks the settled URL after following those redirects.
 */
function isTintinAssetUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  return parsed.protocol === 'https:'
    && !parsed.username
    && !parsed.password
    && TINTIN_ASSET_HOSTS.has(parsed.hostname.toLowerCase())
}

/** Normalize a GitHub asset digest header (`sha256:<hex>`) into plain hex. */
function normalizeHexDigest(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^sha256:([0-9a-fA-F]{64})$/iu.exec(value.trim())
  return match === null ? undefined : match[1]!.toLowerCase()
}

async function readLimitedBody(response: Response, limit: number): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null && /^[0-9]+$/u.test(declared) && BigInt(declared) > BigInt(limit)) {
    throw new Error('tintin update response is too large')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > limit) {
        await reader.cancel().catch(() => undefined)
        throw new Error('tintin update response is too large')
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

async function defaultTintinRequest(url: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(url, init)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
