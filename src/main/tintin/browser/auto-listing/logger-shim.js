// 自动上架移植：SRC ../logger 依赖的壳侧 shim（console 打点；harness 日志环不经壳）
export const loggerShim = {
  logError: (tag, msg) => console.error('[' + tag + ']', msg),
  logWarn: (tag, msg) => console.warn('[' + tag + ']', msg),
  logInfo: (tag, msg) => console.log('[' + tag + ']', msg),
}
