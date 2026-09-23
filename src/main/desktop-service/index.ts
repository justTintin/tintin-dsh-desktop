import { app, net } from 'electron'
import { join } from 'node:path'
import { DesktopService } from './service'
import type { UpdateDecision } from './service'
import { attachDiagnostics } from './diagnostics'

let service: DesktopService | undefined
export let desktopDiagnostics: ReturnType<typeof attachDiagnostics> | undefined

/** Call only after the single-instance lock, before bootstrap writes this session's log. */
export function initializeDesktopService(): void {
  if (!app.isPackaged || service) return
  try {
    service = new DesktopService({
      stateDir: join(app.getPath('userData'), 'desktop-service'),
      logPath: join(app.getPath('logs'), 'harness.log'),
      version: app.getVersion(), platform: process.platform, arch: process.arch,
      // Chromium networking uses the same proxy configuration as the desktop app.
      request: (url, init) => net.fetch(url, init),
      // TinTin fork (2026-09-23): crash reports must not leave to the official
      // dshdesktop.com telemetry endpoint; they are discarded until the TinTin
      // service endpoint exists (A3), replacing the upstream consent dialog.
      confirmUpload: async () => false
    })
    desktopDiagnostics = attachDiagnostics(app, service, {
      onError: error => console.warn('[desktop-service]', error instanceof Error ? error.name : 'Diagnostic failure')
    })
  } catch (error) {
    service = undefined
    console.warn('[desktop-service] initialization failed', error instanceof Error ? error.name : 'Unknown error')
  }
}
export async function checkDesktopUpdate(): Promise<UpdateDecision> {
  // TinTin fork (2026-09-23): update checks are cut from the official channel.
  // The upstream policy server hard-requires feedUrl to be a dshdesktop.com
  // archive URL (service.ts:134), so this product can never legitimately update
  // through it — report not-available until the TinTin feed is wired (A3).
  return { updateAvailable: false }
}
