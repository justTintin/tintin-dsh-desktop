/** psd-png.js 的类型面(与 lib/cover-tools-mcp.d.ts 同先例:lib 是 .js,类型就近声明)。 */

/** RGBA(8bit/像素)→ PNG Buffer。逐行 0 滤波(None)+deflate,标准 RGB+Alpha。 */
export function encodeRgbaPng(width: number, height: number, data: Uint8Array): Buffer

/** PNG Buffer → RGBA 像素。仅支持 8-bit、颜色类型 0/2/4/6、无隔行;
 *  其余形态显式抛错(渲染链只产出受支持形态,坏图绝不静默)。 */
export function decodeRgbaPng(buf: Buffer): { width: number; height: number; data: Uint8Array }
