// cover-tools — 封面制作 agent 工具组(WP-7/WP-4 会话工具面;需求文档 §9.4)。
// 会话内可直接说「帮我出一张视频封面,标题 XX」→ agent 调 cover_generate →
// PNG 落 <工作目录>/cover/(与编辑器导出同引擎同目录)。引擎经
// cover-plugin-route.js 的模块级单例加载(路由与工具共享 bundle/浏览器缓存)。
// 失败语义与 agent-tools 同:catch → {ok:false,error},agent 可读自纠。
const errText = (e) => (e instanceof Error ? e.message : String(e))

/** props 键名与图层约定摘要(写进 cover_templates 输出,agent 免查文档即可填参) */
function templateBrief(t) {
  return {
    id: t.id,
    label: t.label,
    size: `${t.width}x${t.height}`,
    layers: t.layerDefs.map((l) => ({ key: l.propsKey ?? l.id, label: l.label, type: l.type })),
  }
}

export function createCoverTools({ loadEngine, generateBackground, log = () => {}, warn = () => {} } = {}) {
  if (typeof loadEngine !== 'function') throw new Error('createCoverTools requires loadEngine')

  const templatesTool = {
    name: 'cover_templates',
    description:
      '列出封面模板与图层参数约定(节目封面/商品封面/视频缩略图)。出图前先调用它确认 templateId 与各文字/图片图层的参数键。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true },
        templates: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', kind: 'execute', title: '列出封面模板', rawInput: {} }),
    async execute() {
      try {
        const engine = await loadEngine()
        const templates = engine.listTemplates().map((t) => templateBrief(t))
        return { ok: true, templates }
      } catch (e) {
        warn('cover_templates failed:', errText(e))
        return { ok: false, templates: [] , error: errText(e) }
      }
    },
  }

  const generateTool = {
    name: 'cover_generate',
    description:
      '生成封面 PNG 并落盘到工作目录 cover/(与封面制作编辑器同引擎)。参数:templateId(先看 cover_templates)、props(各图层文字/图片键值,如 hookLines 数组或 title)、fileName(可选)。返回落盘路径。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        templateId: { type: 'string', description: '模板 id:cover(节目/深色)|product(商品/浅色)|video(视频缩略图/点击向)' },
        props: { type: 'object', description: '图层参数;文字键如 title/subtitle/badge/hookLines(数组)/features(数组)/brand/subTag,图片键 image/bgImage(public/ 内文件名,可先经封面上传通道)' },
        fileName: { type: 'string', description: '输出文件名(可选,缺省自动时间戳)' },
      },
      required: ['templateId', 'props'],
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true },
        file: { type: 'string' },
        error: { type: 'string' },
      } },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => false,
    presentCall: (args) => ({ card: 'generic', kind: 'execute', title: '生成封面', rawInput: { templateId: String(args?.templateId || ''), props: args?.props ?? {} } }),
    async execute(args) {
      try {
        const engine = await loadEngine()
        const result = await engine.renderCover({
          templateId: String(args?.templateId || ''),
          props: args?.props && typeof args.props === 'object' ? args.props : {},
          fileName: args?.fileName ? String(args.fileName) : undefined,
        })
        if (result.ok) log(`cover_generate → ${result.file}`)
        else warn('cover_generate failed:', result.error)
        return { ok: !!result.ok, file: result.file || undefined, error: result.error || undefined }
      } catch (e) {
        warn('cover_generate threw:', errText(e))
        return { ok: false, error: errText(e) }
      }
    },
  }

  const backgroundTool = {
    name: 'cover_background',
    description:
      'AI 生成封面底图(无文字氛围图;文字层由模板代码排版,需求文档 §一混合管线)。prompt 描述画面即可,产物自动存为可用底图名(如 bg-xxx.png),随后在 cover_generate 的 props.bgImage 引用;cover 模板(节目/深色)支持 bgImage。分钟级耗时。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: { type: 'string', description: '画面描述(1..2000 字符),不要包含文字内容' },
        aspect: { type: 'string', description: '画幅,封面固定 16:9(缺省)' },
      },
      required: ['prompt'],
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true },
        name: { type: 'string', description: '底图文件名,用于 cover_generate 的 props.bgImage' },
        engine: { type: 'string' },
        error: { type: 'string' },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => false,
    presentCall: (args) => ({ card: 'generic', kind: 'execute', title: 'AI 生成封面底图', rawInput: { prompt: String(args?.prompt || '').slice(0, 80) } }),
    timeoutMs: 960_000,
    async execute(args) {
      if (typeof generateBackground !== 'function') return { ok: false, error: '出图通道未接线' }
      const r = await generateBackground({ prompt: args?.prompt, aspect: args?.aspect })
      if (r.ok) log(`cover_background → ${r.name}`)
      else warn('cover_background failed:', r.error)
      return { ok: !!r.ok, name: r.name || undefined, engine: r.engine || undefined, error: r.error || undefined }
    },
  }

  return [templatesTool, generateTool, backgroundTool]
}
