// dreamina.js — 即梦创作 CLI（dreamina）宿主门：进程封装 + IPC 通道。(2026-10-31 用户裁决自 bundle/lib/dreamina-cli.js 随迁改名:即梦是全产品共用的生图引擎,归属共享叶子包)
// 依据（铁律 9）：用户裁决 2026-10-25（创作模式加「即梦 CLI」后端）+
// dreamina 1.4.21 -h 实测与官方安装脚本（安装位置/退出码/输出形态）。
// 策略（白名单/参数/解析/状态汇总）全在 dreamina-logic.js；本文件只做 I/O。
//
// 二进制定位链：TINTIN_DREAMINA_BIN 环境变量 > %USERPROFILE%\bin\dreamina.exe
// （Windows 官方脚本默认安装位）> ~/.local/bin/dreamina（macOS/Linux 默认位）
// > PATH 裸名。找不到不炸装——available=false，渲染层呈现「未安装」态。
//
// 输出形态实测（2026-10-25）：--version / user_credit / list_task = JSON 文本；
// login 设备码材料 = `key: value` 行；两类都经 parseCliOutput 归一，raw 兜底。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as logic from './dreamina-logic.js'

/** 二进制定位（每通道现查——用户装完 CLI 无需重启宿主） */
export function resolveDreaminaBin(env = process.env, platform = process.platform) {
  const configured = String(env.TINTIN_DREAMINA_BIN ?? '').trim()
  if (configured && existsSync(configured)) return configured
  const home = env.USERPROFILE || env.HOME || homedir()
  const candidate = platform === 'win32' ? join(home, 'bin', 'dreamina.exe') : join(home, '.local', 'bin', 'dreamina')
  if (existsSync(candidate)) return candidate
  return 'dreamina'
}

/** 结果落盘根（「保存到本地」；与 context-task 工作区同源：Documents/tintin-workspace） */
export function dreaminaDownloadRoot(env = process.env) {
  return join(env.USERPROFILE || env.HOME || homedir(), 'Documents', 'tintin-workspace', 'dreamina')
}

export function createDreaminaApi({ log = () => {}, warn = () => {} } = {}) {
  /** 执行 dreamina 收集完整输出（超时 kill；login 等待授权的通道给足时限） */
  function run(binPath, args, timeoutMs) {
    return new Promise((resolve) => {
      const proc = spawn(binPath, args, { windowsHide: true })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; proc.kill() }, timeoutMs)
      proc.stdout.on('data', (d) => { stdout += d })
      proc.stderr.on('data', (d) => { stderr += d })
      proc.on('error', (e) => {
        clearTimeout(timer)
        resolve({ code: -1, stdout, stderr: `${stderr}\n${e.message}`.trim(), missing: e.code === 'ENOENT' })
      })
      proc.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code: code ?? -1, stdout, stderr, timedOut, missing: false })
      })
    })
  }

  async function runParsed(args, timeoutMs = 60000) {
    const bin = resolveDreaminaBin()
    const res = await run(bin, args, timeoutMs)
    if (res.missing) {
      const err = new Error('未找到 dreamina 可执行文件——请先安装即梦创作 CLI（curl -s https://jimeng.jianying.com/cli | bash）')
      err.missing = true
      throw err
    }
    if (res.timedOut) throw new Error(`dreamina ${args[0]} 超时（${Math.round(timeoutMs / 1000)}s）`)
    return { bin, code: res.code, stdout: res.stdout, stderr: res.stderr, parsed: logic.parseCliOutput(res.stdout || res.stderr) }
  }

  /** 统一结果包装：CLI 非零退出 → {ok:false,...}；异常（缺二进制/超时）→ {error} */
  function wrap(promise) {
    return promise.catch((e) => ({ error: e?.message ?? String(e), missing: e?.missing === true }))
  }

  return {
    // dreamina:status — 二进制/版本/登录态/积分一次取全（status 卡 + 登录引导共用）
    'dreamina:status': async () => wrap((async () => {
      const bin = resolveDreaminaBin()
      const versionRes = await run(bin, ['--version'], 15000)
      if (versionRes.missing) return { available: false, bin: '', error: '未找到 dreamina 可执行文件' }
      const versionParsed = logic.parseCliOutput(versionRes.stdout)
      const credit = await runParsed(['user_credit'], 30000)
      return logic.summarizeStatus({
        bin,
        versionParsed,
        creditParsed: credit.parsed,
        creditError: credit.code === 0 ? '' : credit.parsed.kind === 'raw' ? credit.parsed.value : credit.stderr,
      })
    })()),

    // dreamina:generate — 提交生成任务（白名单命令；poll=0 仅提交，查询走 dreamina:query）
    'dreamina:generate': async (args) => {
      const p = args?.[0] ?? {}
      try {
        const argv = logic.buildGenerateArgs(p)
        const res = await runParsed(argv, 120000)
        const submitId = logic.extractSubmitId(res.parsed)
        return {
          ok: res.code === 0,
          code: res.code,
          command: p.command,
          submitId,
          genStatus: logic.extractGenStatus(res.parsed),
          failReason: logic.extractFailReason(res.parsed),
          parsed: res.parsed.value,
          stdout: res.stdout,
          stderr: res.stderr,
        }
      } catch (e) {
        return { ok: false, command: p?.command, error: e?.message ?? String(e) }
      }
    },

    // dreamina:query — 按 submit_id 查询；download=true 落盘到 Documents/tintin-workspace/dreamina/<id>/
    'dreamina:query': async (args) => {
      const p = args?.[0] ?? {}
      const submitId = String(p?.submitId ?? '').trim()
      if (!submitId) return { error: 'dreamina:query 缺 submitId' }
      const argv = ['query_result', `--submit_id=${submitId}`]
      if (p?.download) {
        const dir = join(dreaminaDownloadRoot(), submitId)
        try { mkdirSync(dir, { recursive: true }) } catch { /* 目录已存在/竞态不阻塞 */ }
        argv.push(`--download_dir=${dir}`)
      }
      return wrap((async () => {
        const res = await runParsed(argv, 180000)
        return {
          ok: res.code === 0,
          code: res.code,
          submitId,
          genStatus: logic.extractGenStatus(res.parsed),
          failReason: logic.extractFailReason(res.parsed),
          mediaUrls: logic.extractMediaUrls(res.parsed.value),
          localDir: p?.download ? join(dreaminaDownloadRoot(), submitId) : undefined,
          parsed: res.parsed.value,
          stdout: res.stdout,
          stderr: res.stderr,
        }
      })())
    },

    // dreamina:tasks — list_task（只读；genStatus/taskType/limit/offset/submitId 过滤）
    'dreamina:tasks': async (args) => {
      const p = args?.[0] ?? {}
      const argv = ['list_task']
      if (p?.genStatus) argv.push(`--gen_status=${p.genStatus}`)
      if (p?.taskType) argv.push(`--gen_task_type=${p.taskType}`)
      if (p?.submitId) argv.push(`--submit_id=${p.submitId}`)
      if (p?.limit !== undefined && p.limit !== null) argv.push(`--limit=${Number(p.limit)}`)
      if (p?.offset !== undefined && p.offset !== null) argv.push(`--offset=${Number(p.offset)}`)
      return wrap((async () => {
        const res = await runParsed(argv, 60000)
        return { ok: res.code === 0, tasks: res.parsed.kind === 'json' ? res.parsed.value : [], stdout: res.stdout }
      })())
    },

    // dreamina:credit — 余额（只读）
    'dreamina:credit': async () => wrap((async () => {
      const res = await runParsed(['user_credit'], 30000)
      return { ok: res.code === 0, credit: res.parsed.kind === 'json' ? res.parsed.value : null, stderr: res.stderr }
    })()),

    // dreamina:loginHeadless — 设备码材料即取即退（渲染层引导授权，checklogin 后补）
    'dreamina:loginHeadless': async () => wrap((async () => {
      const res = await runParsed(['login', '--headless'], 30000)
      const v = res.parsed.kind === 'kv' ? res.parsed.value : {}
      return {
        ok: res.code === 0,
        verificationUri: String(v.verification_uri ?? ''),
        userCode: String(v.user_code ?? ''),
        deviceCode: String(v.device_code ?? ''),
        expiresAt: String(v.expires_at ?? ''),
        stdout: res.stdout,
      }
    })()),

    // dreamina:loginCheck — 用户完成网页授权后收尾（poll 秒内轮询终态）
    'dreamina:loginCheck': async (args) => {
      const p = args?.[0] ?? {}
      const deviceCode = String(p?.deviceCode ?? '').trim()
      if (!deviceCode) return { error: 'dreamina:loginCheck 缺 deviceCode' }
      const poll = Math.max(1, Math.min(600, Number(p?.poll ?? 60)))
      return wrap((async () => {
        const res = await runParsed(['login', 'checklogin', `--device_code=${deviceCode}`, `--poll=${poll}`], poll * 1000 + 30000)
        return { ok: res.code === 0, stdout: res.stdout, stderr: res.stderr }
      })())
    },

    // dreamina:login — 阻塞式登录（渲染层默认走 headless 两段式；此通道留给终端场景）
    'dreamina:login': async () => wrap((async () => {
      const res = await runParsed(['login'], 15 * 60 * 1000)
      return { ok: res.code === 0, stdout: res.stdout, stderr: res.stderr }
    })()),

    // dreamina:logout — 清本地 OAuth 态（不动任务与配置）
    'dreamina:logout': async () => wrap((async () => {
      const res = await runParsed(['logout'], 30000)
      return { ok: res.code === 0, stdout: res.stdout, stderr: res.stderr }
    })()),
  }
}

// 逻辑层再导出：通道消费方（测试/agent 工具）单一入口（同 ytdlp 的 logic 桶口径）
export { buildGenerateArgs, parseCliOutput, extractSubmitId, extractGenStatus, extractMediaUrls, summarizeStatus, DREAMINA_GENERATE_COMMANDS } from './dreamina-logic.js'
