// test/tintin-server-proxy-endpoints.test.ts — API_ENDPOINTS 表面收缩回归
// 服务端 /agent/* 编排已于 2026-09-25 退役（仅能力目录 /agent/registry 保留），
// /health/capabilities 服务端从未实现：两者同属"声明即 404 陷阱"的死面。
// 本测试钉住收缩后的端点表，防止后续按 SRC 契约同步或回移时把死路径加回来；
// 并钉住 workbenchChatContext 的对话死族不再复活、活工具函数未被误伤。
import { describe, expect, it } from 'vitest'
import { API_ENDPOINTS } from '../packages/tintin-bundle/lib/server-proxy.js'
import * as chatContext from '../packages/tintin-media-bundle/src/composables/workbenchChatContext'

describe('API_ENDPOINTS 收缩后的表面（/agent/* 编排退役）', () => {
  it('agent 块仅保留能力目录 registry', () => {
    expect(API_ENDPOINTS.agent).toEqual({ registry: '/agent/registry' })
  })

  it('health 块不含从未实现的 capabilities，保留 check', () => {
    expect(API_ENDPOINTS.health).toEqual({ check: '/health/check' })
  })
})

describe('workbenchChatContext 对话死族随退役移除', () => {
  const removedNames = [
    'parseAgentsResponse',
    'buildQuickEntries',
    'isAgentPrefix',
    'filterSlashCandidates',
    'detectSlashKeyword',
    'applyAgentWakeInsert',
    'fitQuickBar',
    'buildContextText',
    'appendContextText',
    'productSummary',
    'materialSummary',
    'scriptSummary',
    'audioSummary',
    'mediaTypeLabel',
  ]

  it('智能体对话函数族不再导出', () => {
    for (const name of removedNames) {
      expect(Object.prototype.hasOwnProperty.call(chatContext, name), `${name} 不应再导出`).toBe(false)
    }
  })

  it('仍被弹窗/面板消费的工具函数完好', () => {
    for (const name of ['buildMediaServeUrl', 'buildMediaThumbUrl', 'buildAudioFileUrl', 'pickListItems', 'pickListTotal', 'pickDistinctValues', 'searchErrorText']) {
      expect(typeof chatContext[name as keyof typeof chatContext], name).toBe('function')
    }
  })
})
