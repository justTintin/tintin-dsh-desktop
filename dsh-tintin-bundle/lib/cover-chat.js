// cover-chat — 封面编辑器会话框回路(2026-10-27 15:09 用户裁决批次 B)。
// 自含对话:编辑器右栏聊天 → POST /tintin/cover/api/chat → 服务端 LLM
// (/llm/chat/completions,与 agent-tools chatJson 同契约)→ 返回回复 + JSON 动作。
// 动作协议(会话操作图层的词汇 = 注册表图层 id:environment/product/title/subtitle…):
//   {"reply":"…","actions":[
//     {"op":"set_text","layer":"title","text":"新标题"},
//     {"op":"set_style","layer":"title","scale":1.2,"color":"#facc15","dx":0,"dy":20,"font":"KaiTi"},
//     {"op":"toggle_layer","layer":"brand"},
//     {"op":"generate_environment","prompt":"深夜城市霓虹"},   // 编辑器收到后调 AI 底图端点
//     {"op":"set_orientation","orientation":"portrait"},
//     {"op":"export"}                                            // 编辑器收到后走导出
//   ]}
const errText = (e) => (e instanceof Error ? e.message : String(e))

/** 图层摘要(会话可引用与操作的唯一词汇表) */
export function coverSystemPrompt(templateBrief, propsSnapshot) {
  return [
    '你是 TinTin 封面制作编辑器里的对话助手,直接操作当前封面画布。',
    '当前模板与图层(会话里用 layer id 引用):',
    JSON.stringify(templateBrief),
    '当前内容快照(JSON):',
    JSON.stringify(propsSnapshot),
    '',
    '规则:',
    '1. 每次回复必须输出一个 JSON 对象(可带一句自然语言说明放 reply 字段),格式:',
    '{"reply":"给用户的一句话","actions":[...]}',
    '2. actions 可为空数组(仅回答问题);动作一次可多个。',
    '3. 可用动作:',
    '{"op":"set_text","layer":"<图层id>","text":"内容"}  // 文字层内容;主标题(钩子)传数组或 "\\n" 分行',
    '{"op":"set_style","layer":"<图层id>","scale":1.2,"color":"#facc15","dx":10,"dy":-20,"font":"KaiTi"}  // 任选子集;scale 0.5-1.8;font ∈ [Microsoft YaHei,SimHei,KaiTi,SimSun,DengXian,FangSong,Segoe UI]',
    '{"op":"toggle_layer","layer":"<图层id>"}  // 显隐装饰层',
    '{"op":"generate_environment","prompt":"画面描述(不含文字)"}  // AI 生成环境图(服务端 comfygen,分钟级,自动应用)',
    '{"op":"generate_product","prompt":"场景/风格描述"}  // 产品图重绘:以当前产品图为参考(comfygen/即梦,分钟级)',
    '{"op":"set_orientation","orientation":"landscape|portrait"}  // 横竖屏',
    '{"op":"export"}  // 导出 PNG 到工作目录 cover/',
    '4. 文字内容(标题/钩子/卖点)由你生成——用户要「生成文字/帮我想标题」时,直接给文案并 set_text;',
    '   comfygen 画面的 prompt 里不要包含文字要求(文字由模板排版)。',
    '5. 只输出这个 JSON,不要输出其它内容。',
  ].join('\n')
}

/** 从模型输出提取 {"reply","actions"}(extractFirstJson 同口径;坏输出显式报错) */
export function parseCoverAssistant(content) {
  const text = String(content || '')
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return { ok: false, error: '模型未返回 JSON 动作' }
  try {
    const d = JSON.parse(m[0])
    if (typeof d !== 'object' || d === null) return { ok: false, error: '模型输出不是对象' }
    const actions = Array.isArray(d.actions) ? d.actions : []
    for (const a of actions) {
      if (!a || typeof a.op !== 'string') return { ok: false, error: `动作缺 op:${JSON.stringify(a).slice(0, 80)}` }
    }
    return { ok: true, reply: String(d.reply || ''), actions }
  } catch {
    return { ok: false, error: '模型 JSON 解析失败' }
  }
}

/**
 * 一轮封面会话:messages(含 system)→ 服务端 LLM → 解析动作。
 * @returns {Promise<{ok:true,reply:string,actions:Array}|{ok:false,error:string}>}
 */
export async function coverChatTurn({ messages, templateBrief, propsSnapshot }, { httpRequest, log = () => {}, warn = () => {} } = {}) {
  try {
    if (typeof httpRequest !== 'function') return { ok: false, error: '服务端 LLM 通道不可用' }
    const full = [{ role: 'system', content: coverSystemPrompt(templateBrief, propsSnapshot) }, ...messages]
    const result = await httpRequest('POST', '/llm/chat/completions', {
      body: { model: '', messages: full, temperature: 0.3, stream: false },
      timeout: 60_000,
    })
    const content = String(result?.data?.choices?.[0]?.message?.content || '')
    if (!content) return { ok: false, error: '服务端未返回内容(可能离线)' }
    const parsed = parseCoverAssistant(content)
    if (!parsed.ok) return parsed
    log(`cover-chat: ${parsed.actions.length} actions`)
    return { ok: true, reply: parsed.reply, actions: parsed.actions }
  } catch (e) {
    warn('cover-chat failed:', errText(e))
    return { ok: false, error: errText(e) }
  }
}
