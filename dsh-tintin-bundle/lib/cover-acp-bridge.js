// cover-acp-bridge.js — 封面制作 ACP 会话桥(WP-7 P1;2026-10-27 用户裁决:
// 编辑器内嵌真实 agent 会话,走 ACP 协议,复用 dsh --profile acp 子进程模式)。
// 会话驱动 comfygen 生图 / PhotoCraft 操作 / 图层文字编辑 —— 三层统一由 agent 编排。
// 本文件懒加载依赖(@agentclientprotocol/sdk / @deepseek-ai/dsh),缺失时显式报错。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'

const require_ = createRequire(import.meta.url)
const errText = (e) => (e instanceof Error ? e.message : String(e))

let sdk = null
function acpSdk() {
  if (!sdk) sdk = require_('@agentclientprotocol/sdk')
  return sdk
}
function dshBin() {
  const manifest = require_.resolve('@deepseek-ai/dsh/package.json')
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  const bin = typeof pkg.bin === 'object' && pkg.bin !== null ? pkg.bin.dsh : pkg.bin
  if (typeof bin !== 'string' || !bin) throw new Error('@deepseek-ai/dsh 无 dsh 可执行文件')
  return join(dirname(manifest), bin)
}

const state = { child: null, conn: null, sessionId: null, cwd: null, ready: false }

function serverUrl() {
  return String(process.env.TINTIN_SERVER_URL || '').replace(/\/+$/, '')
}

function patchPath() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const dir = join(root, '..', 'dsh-plugin-desktop-tintin', 'tintin-resources', 'cover-agent')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'cover-agent.patch.yml')
}

function writePatch(serverUrl) {
  const path = patchPath()
  const models = [
    { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
  ]
  const rows = models.map((m) => `          - id: ${m.id}\n            name: ${m.name}`).join('\n')
  const text = [
    '# TinTin 封面智能体: 模型路由到 TinTin 服务端',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      tintin-server:',
    '        displayName: TinTin',
    '        apiKeyEnv: TINTIN_SERVER_API_KEY',
    '        api: openai-completions',
    `        baseURL: ${serverUrl}/llm`,
    '        models:',
    rows,
    '- id: acp',
    '  config:',
    '    provider: tintin-server',
    `    model: ${models[0]?.id ?? 'deepseek-v4-flash'}`,
    '- id: permission',
    '  config:',
    '    defaultPreset: danger-full-access',
    '',
  ].join('\n')
  writeFileSync(path, text, 'utf8')
  return path
}

function coverSkillDir() {
  const dir = join(dirname(patchPath()), 'cover-agent-home', 'skills', 'cover')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 启动(或复用)ACP 会话;返回 { ok, sessionId?, error? } */
export async function startSession(cwd) {
  if (state.ready && state.child?.exitCode === null) return { ok: true, sessionId: state.sessionId }
  const url = serverUrl()
  if (!url) return { ok: false, error: 'server.url 未配置' }
  const sdk_ = acpSdk()
  const bin = dshBin()
  const patch = writePatch(url)
  const home = join(dirname(patch), 'cover-agent-home')
  mkdirSync(home, { recursive: true })
  // 注入封面制作技能
  const skillSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dsh-tintin-cover-plugin', 'skills', 'cover', 'SKILL.md')
  if (existsSync(skillSrc)) {
    const skillDir = join(home, 'skills', 'cover')
    mkdirSync(skillDir, { recursive: true })
    const { copyFileSync } = require('node:fs')
    copyFileSync(skillSrc, join(skillDir, 'SKILL.md'))
  }
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, TINTIN_SERVER_API_KEY: 'sk-tintin-local' }
  state.cwd = cwd
  state.child = spawn(process.execPath, [bin, '--profile', 'acp', '--patch', patch], {
    cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  const stream = sdk_.ndJsonStream(
    Writable.toWeb(state.child.stdin),
    Readable.toWeb(state.child.stdout),
  )
  state.conn = sdk_.client({ name: 'tintin-cover' })
    .onRequest(sdk_.methods.client.session.requestPermission, () =>
      new Promise((res) => res({ outcome: { outcome: 'allow_always' } })))
    .onRequest(sdk_.methods.client.elicitation.create, () =>
      new Promise((res) => res({ action: 'decline' })))
    .onNotification(sdk_.methods.agent.session.update, (update) => {
      // 语义更新:agent 工具调用/文本 → 会话动作卡片(编辑器侧消费)
      if (state.onUpdate) state.onUpdate(update)
    })
  const init = await state.conn.agent.request(sdk_.methods.agent.initialize, {
    protocolVersion: sdk_.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    clientInfo: { name: 'tintin-cover', title: 'TinTin Cover Editor' },
  })
  const session = await state.conn.agent.request(sdk_.methods.agent.session.new, {
    cwd, mcpServers: [],
  })
  state.sessionId = String(session.sessionId ?? '')
  state.ready = true
  return { ok: true, sessionId: state.sessionId }
}

/** 发送对话消息(等待 agent 完成整轮;返回 stopReason) */
export async function prompt(text) {
  if (!state.ready || !state.conn) return { ok: false, error: 'ACP 会话未启动' }
  const result = await state.conn.agent.request(
    acpSdk().methods.agent.session.prompt,
    { sessionId: state.sessionId, prompt: [{ type: 'text', text }] },
  )
  return { ok: true, stopReason: String(result?.stopReason ?? 'end_turn') }
}

export function isRunning() {
  return state.ready && state.child !== null && state.child.exitCode === null
}

export function stopSession() {
  try { state.child?.kill() } catch { /* 已退出 */ }
  state.child = null; state.conn = null; state.ready = false
  state.sessionId = null
}
