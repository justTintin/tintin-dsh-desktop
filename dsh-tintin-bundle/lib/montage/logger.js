// ═══════════════════════════════════════════════════════════════
// logger.js — montage 域日志垫片（harness 宿主侧）
// 源 desktop/main/logger.js 基于 electron-log + electron（app/shell），
// harness 子进程不可加载；montage 三模块（ffmpeg-gate/voice-ipc/final-ipc）
// 只消费 logInfo/logWarn/logError 三个入口，此处以 console 等价实现
// （harness stdout 由宿主日志桥接采集），签名与「写入失败静默、日志绝不
// 阻塞业务」语义同源。完整日志查看器/滚动清理不在本垫片范围。
// ═══════════════════════════════════════════════════════════════

function logInfo(tag, msg)  { try { console.info(`[${tag}] ${msg}`) } catch (_) { /* 日志失败静默 */ } }
function logWarn(tag, msg)  { try { console.warn(`[${tag}] ${msg}`) } catch (_) { /* 日志失败静默 */ } }
function logError(tag, msg) { try { console.error(`[${tag}] ${msg}`) } catch (_) { /* 日志失败静默 */ } }

export { logInfo, logWarn, logError }
