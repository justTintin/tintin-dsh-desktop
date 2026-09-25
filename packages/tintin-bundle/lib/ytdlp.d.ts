// ytdlp.d.ts — 参考视频下载宿主门类型（实现见同目录 ytdlp.js）
export interface YtdlpDeps {
  /** yt-dlp 二进制（宿主解析：TINTIN_BIN_DIR > PATH） */
  ytdlpPath: string
  ffmpegPath: string
  ffprobePath: string
  /** --ffmpeg-location 目录（打包 resources/bin；空串不传） */
  ffmpegDir: string
  /** 壳层浏览器引擎的 cookies 交接目录（<DSH_HOME>/tintin/browser/cookies） */
  cookiesDir: () => string
  /** 下载工作目录基座（cacheDir；作业目录 = <cacheDir>/video_download/<job>） */
  cacheDir: () => string
  log?: (...a: unknown[]) => void
  warn?: (...a: unknown[]) => void
}

export function createYtdlpApi(deps: YtdlpDeps): {
  'ytdlp:status': () => { available: boolean; path: string; external: boolean }
  'ytdlp:probe': (args: Array<{ url?: unknown; proxy?: unknown }>) =>
    Promise<{ probe?: unknown; options?: unknown[]; error?: string; code?: string; stderrTail?: string }>
  'ytdlp:download': (args: Array<{ url?: unknown; option?: unknown; proxy?: unknown }>) =>
    Promise<{ path?: string; fileName?: string; normalized?: boolean; meta?: unknown; error?: string; code?: string; stderrTail?: string }>
  'ytdlp:saveAs': (args: Array<{ src?: unknown; dst?: unknown }>) => { ok?: boolean; error?: string }
}

/** safeOutputPath：realpath 校验输出不逃逸工作目录 */
export function safeOutputPath(workDir: string, filePath: string): string
