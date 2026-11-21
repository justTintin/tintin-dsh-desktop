// cover-photocraft-routes.js 类型声明(测试消费;运行时=宿主 webServer 能力)
export interface CoverPhotocraftRouteDeps {
  registeringWebServer: {
    register: (route: { kind: string; path: string; handler: (req: { method: string; url: string }, res: unknown) => Promise<void> }) => () => void
  }
  isTrustedRequest: (req: unknown, body: boolean) => boolean
  sendJson: (res: unknown, status: number, body: unknown) => void
  loadEngine: () => Promise<unknown>
  getServerUrl: () => string
}
export declare function registerCoverPhotocraftRoutes(deps: CoverPhotocraftRouteDeps): Array<() => void>
