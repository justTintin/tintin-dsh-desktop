// logger.d.ts — montage 域日志垫片（console 等价实现，见 logger.js 头注）。
// 签名与源 desktop/main/logger.js 的三个入口一致；完整日志查看器不在垫片范围。
export function logInfo(tag: string, msg: unknown): void
export function logWarn(tag: string, msg: unknown): void
export function logError(tag: string, msg: unknown): void
