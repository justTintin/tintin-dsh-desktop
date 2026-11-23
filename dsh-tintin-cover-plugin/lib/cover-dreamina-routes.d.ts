// cover-dreamina-routes.js 类型声明(测试消费;真源=lib JS)
export declare function registerCoverDreaminaRoutes(deps: {
  registeringWebServer: { register: (route: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => () => void }
  mutationAllowed: (req: unknown) => Promise<boolean>
  sendJson: (res: unknown, status: number, body: unknown) => void
}): Array<() => void>
