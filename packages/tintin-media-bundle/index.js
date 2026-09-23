// tintin-media-bundle host side. The media capability grows here on the
// tintinBridge service (WP-1 契约); the UI lives in dist/client.js (Vue).
export const name = 'tintin-media-bundle'
export const inject = ['tintinBridge']

export async function apply(ctx) {
  ctx.logger.info('tintin-media-bundle host ready (bridge server: %s)', ctx.tintinBridge.getServerUrl())
}
