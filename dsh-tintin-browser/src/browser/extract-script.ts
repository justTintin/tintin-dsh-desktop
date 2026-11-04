// ═══════════════════════════════════════════════════════════════
// extract-script.ts — 抽取脚本拼接层（2026-11-04 自 browser-service.ts 提取：
// 千行红线付账，限制清除批净增行按「自己功能增长走提取付账」纪律拆分）。
// E3 抽取链的脚本侧三件套：脚本目录解析 + 结构化错误 + wrapper 拼接。
// ═══════════════════════════════════════════════════════════════
import { app } from 'electron'
import { join } from 'node:path'

/** 抽取器脚本目录：打包=resources/extractors；开发=仓库 build/extractors（SRC thickShell 同形态） */
export function extractorScriptDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'extractors')
    : join(app.getAppPath(), 'build', 'extractors')
}

/** E3 结构化错误（SRC offline-page.js extractionError 1:1） */
export function extractionError(type: string, message: string, hint = '') {
  return { ok: false, error: { type: type || 'EXTRACTOR_ERROR', message: message || '抽取失败', hint: hint || '' } }
}

/**
 * 抽取脚本拼接（SRC thickShell-ipc browser:extractDOM wrapper 1:1）：
 * _common（公共契约挂 window.__TIN_EX_COMMON__）前置 + 平台脚本，wrapper 显式
 * return __TIN_EXTRACT_RESULT__（否则 IIFE 返回值被丢弃 → undefined）。
 * 执行期异常折叠为结构化 DOM_MISMATCH，主进程不崩。
 */
export function buildExtractorScript(commonScript: string, platformScript: string): string {
  const combined = commonScript + '\n' + platformScript
  return `(function(){
  var __TIN_EXTRACT_RESULT__;
  try { ${combined} }
  catch(e){ return { ok:false, error:{type:'DOM_MISMATCH', message:String(e.message||e), hint:'平台DOM可能已变更'} } }
  return (typeof __TIN_EXTRACT_RESULT__ !== 'undefined') ? __TIN_EXTRACT_RESULT__
    : { ok:false, error:{type:'DOM_MISMATCH', message:'抽取脚本未返回结果', hint:'平台脚本结构需升级'} }
})()`
}
