/** Headless, confirmation-gated downloads for TinTin GitHub-release installers. */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import {
  assertSecureDownloadUrl,
  MAX_UPDATE_DOWNLOAD_BYTES,
  UpdateDownloadError,
  type UpdateArtifactRequest,
} from '../update-download.ts'
import { resolveTintinInstallerRelease } from './tintin-update-check.ts'

/** Failure categories shared with the fixed-endpoint installer downloads. */
export type TintinDownloadErrorCode = UpdateDownloadError['code']

/** Inputs for one resolved TinTin installer download. */
export interface TintinDownloadOptions {
  /** Download platform; only Windows installers are published today. */
  readonly platform: 'win32'
  /** Absolute installer URL resolved from the GitHub release. */
  readonly url: string
  /** Absolute installer path selected by the user. */
  readonly destinationPath: string
  /** Redirect-following request adapter, normally backed by Electron `net.request`. */
  readonly request: UpdateArtifactRequest
  /** Optional cancellation signal owned by the update coordinator. */
  readonly signal?: AbortSignal
  /**
   * Hex SHA-256 the downloaded installer must match. Resolved from the
   * release when omitted; the check stays optional only so a release without
   * a digest still installs.
   */
  readonly expectedSha256?: string
}

interface TintinDownloadPaths {
  readonly completed: string
  readonly temporary: string
}

const PRIVATE_FILE_MODE = 0o600
const DECIMAL_BYTES = /^(0|[1-9][0-9]*)$/u
const DOS_HEADER_BYTES = 64
const PE_OFFSET_POSITION = 0x3c
const PE_MAGIC = Buffer.from([0x50, 0x45, 0x00, 0x00])

/**
 * Resolve the installer of one exact TinTin version from GitHub Releases.
 * @param version - release version to resolve (the tag without its leading `v`).
 * @param request - fetch-compatible request adapter.
 * @param signal - caller-owned cancellation signal.
 * @returns the asset identity and digest, or null when the listing, version, or digest lookup fails.
 */
export async function resolveTintinUpdateAsset(
  version: string,
  request: (url: string, init: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): Promise<{ readonly name: string; readonly url: string; readonly size: number; readonly sha256?: string } | null> {
  const release = await resolveTintinInstallerRelease(version, request, signal)
  if (release === null) return null
  return {
    name: release.asset.name,
    url: release.asset.url,
    size: release.asset.size,
    ...(release.sha256 === undefined ? {} : { sha256: release.sha256 }),
  }
}

/**
 * Download one TinTin installer after its caller has obtained user
 * confirmation. The artifact is validated as a PE executable and, whenever a
 * digest is published, against its hex SHA-256 before it is handed over.
 * @param options - resolved asset URL, selected destination, request, and cancellation inputs.
 * @returns Absolute path to the completely written and validated installer.
 * @throws {UpdateDownloadError} For invalid inputs, transport failures, rejected responses, cancellation, and invalid installers.
 */
export async function downloadTintinUpdateArtifact(options: TintinDownloadOptions): Promise<string> {
  if (options.platform !== 'win32') {
    throw new UpdateDownloadError('invalid-options', `Unsupported tintin update download platform: ${String(options.platform)}`)
  }
  if (options.url.length === 0 || !isTintinDownloadUrl(options.url)) {
    throw new UpdateDownloadError('invalid-options', 'The tintin update asset URL is not an HTTPS GitHub release link.')
  }
  const destinationPath = validatedArtifactPath(options.destinationPath)
  const expectedSha256 = normalizedExpectedDigest(options.expectedSha256)
  const paths = await prepareDownloadPaths(destinationPath)
  options.signal?.throwIfAborted()

  let response: Response
  let finalUrl: string
  try {
    const settled = await options.request(options.url, {
      method: 'GET',
      headers: { Accept: 'application/octet-stream' },
      cache: 'no-store',
      redirect: 'follow',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    response = settled.response
    finalUrl = settled.finalUrl
  } catch (cause) {
    if (options.signal?.aborted === true || isAbortFailure(cause)) throw aborted(cause)
    throw new UpdateDownloadError('network', 'The tintin update installer could not be downloaded.', { cause })
  }

  if (response.status !== 200) {
    await discardResponseBody(response)
    throw new UpdateDownloadError(
      'http-status',
      `The tintin update download returned HTTP ${String(response.status)}.`,
      { status: response.status },
    )
  }
  if (response.body === null) {
    throw new UpdateDownloadError('empty-body', 'The tintin update download returned an empty body.')
  }
  try {
    assertSecureDownloadUrl(finalUrl)
    assertDeclaredSize(response)
  } catch (cause) {
    await discardResponseBody(response)
    throw cause
  }

  let failure: unknown
  try {
    await writeResponseBody(paths.temporary, response.body, options.signal)
    options.signal?.throwIfAborted()
    await assertWindowsInstaller(paths.temporary)
    if (expectedSha256 !== undefined) {
      await assertInstallerDigest(paths.temporary, expectedSha256)
    }
    await unlinkIfPresent(paths.completed)
    await rename(paths.temporary, paths.completed)
    return paths.completed
  } catch (cause) {
    failure = options.signal?.aborted === true || isAbortFailure(cause) ? aborted(cause) : cause
    throw failure
  } finally {
    try {
      await unlinkIfPresent(paths.temporary)
    } catch (cleanupCause) {
      if (failure === undefined) throw cleanupCause
      throw new AggregateError([failure, cleanupCause], 'Failed to download and clean up the tintin update installer.')
    }
  }
}

function validatedArtifactPath(path: string): string {
  if (path.length === 0 || /[\0\r\n]/u.test(path) || !isAbsolute(path)) {
    throw new UpdateDownloadError('invalid-options', 'The tintin update destination path must be absolute.')
  }
  if (extname(path).toLowerCase() !== '.exe') {
    throw new UpdateDownloadError('invalid-options', 'The tintin update destination must use .exe.')
  }
  return resolve(path)
}

async function prepareDownloadPaths(destinationPath: string): Promise<TintinDownloadPaths> {
  const directory = dirname(destinationPath)
  const directoryStat = await lstat(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new UpdateDownloadError('invalid-options', 'The tintin update destination directory must be a real directory.')
  }
  const completedStat = await lstatOptional(destinationPath)
  if (completedStat !== undefined && (!completedStat.isFile() || completedStat.isSymbolicLink())) {
    throw new UpdateDownloadError('invalid-options', 'The completed tintin update path is not a regular file.')
  }
  return {
    completed: destinationPath,
    temporary: join(directory, `.${basename(destinationPath)}.${process.pid}.${randomUUID()}.partial`),
  }
}

async function lstatOptional(filename: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(filename)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
}

/** Release a rejected response body so its connection does not linger until GC. */
async function discardResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

function assertDeclaredSize(response: Response): void {
  const declared = response.headers.get('content-length')
  if (declared === null || !DECIMAL_BYTES.test(declared)) return
  if (BigInt(declared) > BigInt(MAX_UPDATE_DOWNLOAD_BYTES)) {
    throw new UpdateDownloadError(
      'response-too-large',
      `The tintin update installer exceeds ${String(MAX_UPDATE_DOWNLOAD_BYTES)} bytes.`,
    )
  }
}

function normalizedExpectedDigest(expected: string | undefined): string | undefined {
  if (expected === undefined) return undefined
  const normalized = expected.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new UpdateDownloadError('invalid-options', 'The expected tintin installer digest is not a hex SHA-256.')
  }
  return normalized
}

/**
 * Verify the downloaded installer against the published digest. The file is
 * hashed in bounded chunks — installers reach hundreds of megabytes, and a
 * single whole-file buffer would spike main-process memory — and compared in
 * constant time over the decoded bytes.
 */
async function assertInstallerDigest(filename: string, expected: string): Promise<void> {
  const expectedBytes = Buffer.from(expected, 'hex')
  const hash = createHash('sha256')
  const handle = await open(filename, 'r')
  try {
    const chunk = Buffer.alloc(1024 * 1024)
    while (true) {
      const result = await handle.read(chunk, 0, chunk.byteLength, null)
      if (result.bytesRead === 0) break
      hash.update(result.bytesRead === chunk.byteLength ? chunk : chunk.subarray(0, result.bytesRead))
    }
  } finally {
    await handle.close()
  }
  const actualBytes = hash.digest()
  if (actualBytes.byteLength !== expectedBytes.byteLength
    || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new UpdateDownloadError(
      'invalid-artifact',
      'The tintin update installer does not match the published digest.',
    )
  }
}

async function writeResponseBody(
  filename: string,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  onProgress?: (received: number) => void,
): Promise<void> {
  const handle = await open(filename, 'wx', PRIVATE_FILE_MODE)
  const reader = body.getReader()
  let bytesWritten = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const chunk = await reader.read()
      signal?.throwIfAborted()
      if (chunk.done) break
      if (chunk.value.byteLength > MAX_UPDATE_DOWNLOAD_BYTES - bytesWritten) {
        throw new UpdateDownloadError(
          'response-too-large',
          `The tintin update installer exceeds ${String(MAX_UPDATE_DOWNLOAD_BYTES)} bytes.`,
        )
      }
      await writeAll(handle, chunk.value)
      bytesWritten += chunk.value.byteLength
      onProgress?.(bytesWritten)
    }
    if (bytesWritten === 0) {
      throw new UpdateDownloadError('empty-body', 'The tintin update download returned an empty body.')
    }
    await handle.sync()
  } catch (cause) {
    await reader.cancel(cause).catch(() => undefined)
    throw cause
  } finally {
    reader.releaseLock()
    await handle.close()
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset, null)
    if (result.bytesWritten === 0) throw new Error('The tintin update installer write made no progress.')
    offset += result.bytesWritten
  }
}

async function assertWindowsInstaller(filename: string): Promise<void> {
  const handle = await open(filename, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_UPDATE_DOWNLOAD_BYTES) throw invalidArtifact()
    if (stat.size < DOS_HEADER_BYTES) throw invalidArtifact()
    const dosHeader = Buffer.alloc(DOS_HEADER_BYTES)
    const dosResult = await handle.read(dosHeader, 0, dosHeader.byteLength, 0)
    if (dosResult.bytesRead !== dosHeader.byteLength || dosHeader[0] !== 0x4d || dosHeader[1] !== 0x5a) {
      throw invalidArtifact()
    }
    const peOffset = dosHeader.readUInt32LE(PE_OFFSET_POSITION)
    if (peOffset > stat.size - PE_MAGIC.byteLength) throw invalidArtifact()
    const peMagic = Buffer.alloc(PE_MAGIC.byteLength)
    const peResult = await handle.read(peMagic, 0, peMagic.byteLength, peOffset)
    if (peResult.bytesRead !== peMagic.byteLength || !peMagic.equals(PE_MAGIC)) throw invalidArtifact()
  } finally {
    await handle.close()
  }
}

function invalidArtifact(): UpdateDownloadError {
  return new UpdateDownloadError('invalid-artifact', 'The downloaded file is not a PE executable.')
}

function aborted(cause: unknown): UpdateDownloadError {
  return new UpdateDownloadError('aborted', 'The tintin update installer download was cancelled.', { cause })
}

function isAbortFailure(value: unknown): boolean {
  return value instanceof UpdateDownloadError
    ? value.code === 'aborted'
    : typeof value === 'object'
      && value !== null
      && 'name' in value
      && value.name === 'AbortError'
}

async function unlinkIfPresent(filename: string): Promise<void> {
  try {
    await unlink(filename)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
}

/** Require a usable HTTPS GitHub asset URL before any byte is requested. */
function isTintinDownloadUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  return parsed.protocol === 'https:'
    && !parsed.username
    && !parsed.password
    && (parsed.hostname.toLowerCase() === 'github.com'
      || parsed.hostname.toLowerCase().endsWith('.githubusercontent.com'))
}
