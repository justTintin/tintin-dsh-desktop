// media-proxy.d.ts — 图像抠图域原生通道类型（实现见同目录 media-proxy.js）
export type MultipartPart =
  | { name: string; value: string }
  | { name: string; path: string; contentType?: string }
  | { name: string; buffer: Buffer; filename?: string; contentType?: string }

export type MultipartPost = (
  endpoint: string,
  parts: MultipartPart[],
  timeout?: number,
) => Promise<unknown>

/** 抠图结果落盘路径：原图同目录、剥扩展名 + `_matting.png`（SRC 口径） */
export function mattingOutPath(imagePath: string): string

export function createRembgApi(deps: {
  multipartPost: MultipartPost
  isExpectedOfflineError: (err: unknown) => boolean
  log?: (tag: string, msg: string) => void
}): {
  /** multipart POST /matting → PNG 落盘返 {path, bytes}；离线 null、失败 {error} */
  'rembg:submit': (
    args: Array<{ image?: unknown; model?: unknown }>,
  ) => Promise<{ path: string; bytes: number } | { error: string } | null>
}

/** 音频生成域原生通道（audio:downloadTemp / audio:archiveGen / audio:bgmUpload，
 *  SRC server-proxy.js:938-1032 契约；离线 null、失败 {error}） */
export function createAudioArchiveApi(deps: {
  httpRequest: (method: string, url: string, opts?: { timeout?: number }) => Promise<{
    data: unknown
    status: number
    headers: Record<string, unknown>
    raw: Buffer
  }>
  getServerUrl: () => string
  multipartPost: MultipartPost
  isExpectedOfflineError: (err: unknown) => boolean
  /** 临时目录基座（宿主传 os.tmpdir()；下载落 `${tmpDir}/tintin_ai_audio/`） */
  tmpDir: string
}): {
  'audio:downloadTemp': (args: Array<{ url?: unknown; prefix?: unknown; defaultExt?: unknown }>) =>
    Promise<{ path: string; contentType?: string } | { error: string } | null>
  'audio:archiveGen': (args: Array<{ url?: unknown; basePath?: unknown; defaultExt?: unknown }>) =>
    Promise<{ path: string } | { error: string } | null>
  'audio:bgmUpload': (args: Array<{ filePath?: unknown; style?: unknown; tags?: unknown; scene?: unknown; mood?: unknown }>) =>
    Promise<Record<string, unknown> | { error: string } | null>
}
