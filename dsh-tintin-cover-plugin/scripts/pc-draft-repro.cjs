// 复现:photocraft-cli run --new → .pcraft 底稿
const { spawnSync } = require('node:child_process')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const cli = 'D:/localprogram/photocraft-0.16.0-windows-x64-portable/photocraft-cli.exe'
const dir = mkdtempSync(require('node:path').join(tmpdir(), 'pcdraft-'))
const out = join(dir, 'draft.pcraft')
const args = [
  'run',
  '--new', '{"width":1280,"height":720}',
  '--cmd', 'edit.fill', '--params', '{"color":[0.04,0.05,0.12,1],"target":"layer"}',
  '--cmd', 'type.create', '--params', '{"text":"冒烟","x":84,"y":120,"size":88,"color":"#ffffff"}',
  '--out', out,
]
const r = spawnSync(cli, args, { encoding: 'utf8' })
console.log('status:', r.status)
console.log('stderr:', (r.stderr || '').slice(0, 400))
console.log('exists:', require('node:fs').existsSync(out))
