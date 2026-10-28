// 独立验证:buildLayeredDraft + exportPngFromDraft 真实链路(ESM)
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
process.env.TINTIN_COVER_DIR = 'D:/Project/tintin-dsh-desktop/dsh-tintin-cover-plugin/.tmp/cover-verify'
mkdirSync(process.env.TINTIN_COVER_DIR, { recursive: true })
const m = await import('../src/engine.ts')
const draft = await m.buildLayeredDraft({
  templateId: 'video',
  props: { hookLinesText: '0.2ms 光轴鼠标 能有多快?', subTag: '开箱实测', brand: 'LOGITECH G' },
  fileName: 'verify-draft',
})
console.log('draft:', JSON.stringify(draft))
if (!draft.ok) process.exit(1)
const png = await m.exportPngFromDraft({ pcraftFile: draft.file, fileName: 'verify-final.png' })
console.log('png:', JSON.stringify(png))
process.exit(png.ok ? 0 : 1)
