// cover-provenance — 封面素材来源记录(需求文档 §七「AI 底图版权」处置:发布向封面
// 记录底图来源 provenance)。单文件 JSON:<插件目录>/cover-assets.json,按图片名追加。
// 上传(cover-plugin-route upload)与 AI 生成(cover-background)写入;导出时引擎
// (插件侧 engine.ts)把用到的素材记录写成 <产物>.json 侧车随图归档。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// 记录形状(JSDoc,纯 JS 无类型语法):
// { name: string, source: 'upload'|'ai', ts: number, prompt?: string, engine?: string, url?: string }

const CAP = 500

export function readAssetProvenance(pluginDir) {
  const file = join(pluginDir, 'cover-assets.json')
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(data?.records)) return data
  } catch { /* 首次/损坏按空处理 */ }
  return { records: [] }
}

export function appendAssetProvenance(pluginDir, record) {
  if (!pluginDir || typeof record?.name !== 'string' || !record.name) throw new Error('provenance 记录缺 name')
  const data = readAssetProvenance(pluginDir)
  // 同名覆盖(重传/重生成取最新一条)
  const records = [record, ...data.records.filter((r) => r.name !== record.name)].slice(0, CAP)
  writeFileSync(join(pluginDir, 'cover-assets.json'), `${JSON.stringify({ records }, null, 2)}\n`, 'utf8')
  return record
}

/** 取指定图片名的记录(导出侧车用;无记录返回 undefined——历史素材/内置样图无来源) */
export function pickAssetRecord(pluginDir, name) {
  if (!name) return undefined
  return readAssetProvenance(pluginDir).records.find((r) => r.name === name)
}

export function provenanceFileExists(pluginDir) {
  return existsSync(join(pluginDir, 'cover-assets.json'))
}
