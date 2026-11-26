// @ts-check
/**
 * TinTin 服务端 as a first-class provider (2026-11-09 用户裁决: TinTin 服务=一等连接服务,
 * 不再借 OpenAI 兼容外皮 —— 按 CONTRIBUTING.md#adding-a-media-provider 的内置形态)。
 * Every verb calls the TinTin server directly; generation goes through the server's
 * MCP endpoint (/mcp: tools/call → task_id → GET /tasks/unified/<id> → artifact URL).
 * The server needs no key: connected while TINTIN_SERVER_URL is set (studio-runtime
 * injects it from server.url). Models are the server's own:
 *   配音=IndexTTS (/indextts/tts, sample voices at /voice/samples)
 *   语音转写=Whisper (/whisper/transcribe, word timings)
 *   音乐=MusicGen BGM (/audio/gen/bgm; 首调模型加载可达数分钟)
 *   音效=/audio/gen/sfx (2026-11-09: 服务端 500 KeyError 'path'，REST 与 MCP 同源，待服务端修)
 *   抠图=/matting (multipart file → PNG 二进制本体)
 *   图片/视频=ComfyGen (MCP create_image/create_video)
 *   图片搜索=/material/stock_search (Pexels 图源)。
 * The source of truth for this file lives in dsh-tintin-bundle/lib/openfilm/providers/
 * (tracked); fetch-openfilm-runtime copies it here and registers it in index.mjs after
 * every runtime fetch — the vendored tree itself is not tracked.
 */
import { billedBy, call, clamp, download, foundClips, foundPictures, landing, list, madePicture, needed, notes, number, round, sleep, speechUpload, text, wavSeconds } from './common.mjs';
import { hitOf, queriesOf, searched } from './web.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').Verb} Verb */

const NAME = 'TinTin 服务端';
/** The server base: injected by studio-runtime from server.url (openfilmCompat gate). */
const base = () => String(process.env.TINTIN_SERVER_URL || '').trim().replace(/\/+$/, '');

/** The models the server makes each kind of media with, the default first. */
const MODELS = {
  tts: [{ id: 'indextts', name: 'IndexTTS' }],
  asr: [{ id: 'whisper', name: 'Whisper' }],
  music: [{ id: 'musicgen-bgm', name: 'MusicGen BGM' }],
  sfx: [{ id: 'sfx-gen', name: 'SFX 生成' }],
  cutout: [{ id: 'matting', name: 'Matting 抠图' }],
  image: [{ id: 'comfygen-image', name: 'ComfyGen 图片', spec: { ratios: ['9:16', '16:9', '1:1', '4:3'], refs: 4, mask: true, markup: true } }],
  video: [{ id: 'comfygen-video', name: 'ComfyGen 视频', spec: { ratios: ['9:16', '16:9', '1:1'], seconds: [1, 10], frames: true, refs: 4 } }],
  'image-search': [{ id: 'stock-images', name: 'Stock Images' }],
  'video-search': [{ id: 'stock-videos', name: 'Stock Videos' }],
  'web-search': [{ id: 'tintin-web', name: 'TinTin 网页搜索' }],
};

/** The picture ratios Studio asks for → the aspects create_image takes (9:16/16:9/1:1/4:3). */
const ASPECT = { '1:1': '1:1', '4:3': '4:3', '3:2': '4:3', '16:9': '16:9', '9:16': '9:16', '2:3': '9:16' };

/** 整体 JSON.parse（会话模式契约：text 块=纯 JSON，无尾注） */
function tryParseJson(said) {
  try { return JSON.parse(said); } catch { return null; }
}

/** 画布模式契约（Studio 画面）：text 块=JSON 对象 + 尾部说明文字（如「[异步任务] 轮询: GET …」，
 *  给人看的操作提示）。解析=提取首个平衡 JSON 对象（字符串/转义感知配对）——按契约确定性地
 *  走这条路径，不是「parse 失败后再猜」（2026-11-20 用户裁决：两种请求模式两个接口）。 */
function parseAnnotatedJson(said) {
  const start = said.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < said.length; i++) {
    const ch = said[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(said.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** 一张本地图 → 服务端路径（upload_file：file_b64 → {paths:[…]}，i2i/i2v 契约 §4.1/§5.1：
 *  服务端不接触客户端本地路径，一切二进制先上传换路径再引用）。 */
async function uploadOne(path, ctx) {
  const bytes = Buffer.from(await ctx.read(path));
  const { said } = await mcpCall('upload_file', { file_b64: bytes.toString('base64'), filename: path.split('/').pop() }, ctx, 'strict');
  const out = tryParseJson(said) || parseAnnotatedJson(said) || {};
  const first = Array.isArray(out.paths) ? String(out.paths[0] ?? '') : '';
  if (!first) throw new Error(`${NAME} 的 upload_file 没有返回服务端路径：${said.slice(0, 200)}`);
  return first;
}

/** One MCP tools/call：mode 契约——'strict'=会话（纯 JSON）；'annotated'=画布（JSON+尾注，
 *  Studio 画面 create_image/edit_image 的服务端返回形态）。 */
async function mcpCall(tool, args, ctx, mode = 'strict', netMs = 120_000) {
  /* patience 30s（2026-11-20 报障 create_music fetch failed）：缺省 patience=0=不重试，
     公网网关间歇抖动一次即抛「could not be reached」；30s 窗口内 1s/2s/4s…指数退避
     自动穿越抖动（call 内建机制，此前未启用）。netMs：单次网络超时（2026-11-21 实测：
     upload/submit 无界挂起 6 分钟撞 360s 窗——挂起必须响亮失败重试，不许无声等死；
     music 同步生成走 600s 长档）。 */
  const res = await call(NAME, `${base()}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  }, { ...ctx, networkTimeoutMs: netMs }, { patience: 30_000 });
  const raw = await res.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch {
    const line = raw.split('\n').filter((l) => l.startsWith('data:')).at(-1);
    if (line) { try { payload = JSON.parse(line.slice(5)); } catch { /* plain text answer */ } }
  }
  const said = String(payload?.result?.content?.[0]?.text ?? '');
  if (payload?.result?.isError) throw new Error(`${NAME} 的 ${tool} 失败：${said.slice(0, 300)}`);
  const out = mode === 'annotated' ? parseAnnotatedJson(said) : tryParseJson(said);
  return { said, out };
}

/** 一个生成任务到产物地址：tools/call → task_id → GET /tasks/unified/<id> 轮询 → output_url。 */
async function generate(tool, args, what, ctx) {
  ctx.say(`${what}（TinTin 服务端）…`);
  const { said, out } = await mcpCall(tool, args, ctx, 'annotated')
  const taskId = String(out?.task_id ?? out?.taskId ?? '');
  if (!taskId) throw new Error(`${NAME} 的 ${tool} 没有返回任务 id：${said.slice(0, 200)}`);
  /* 预算分档（2026-11-21 实测：画布 1080p 5s 视频单渲染段 ~21 分钟）：视频 45 分钟
     （引擎排队+渲染都要盖住；film-acp 同款 30 分钟预算先例再放宽），图片 15 分钟。 */
  const budgetMin = tool === 'create_video' ? 45 : 15;
  const deadline = Date.now() + budgetMin * 60_000;
  for (;;) {
    if (ctx.signal.aborted) throw new Error('stopped');
    const res = await call(NAME, `${base()}/tasks/unified/${encodeURIComponent(taskId)}`, { headers: { accept: 'application/json' } }, { ...ctx, networkTimeoutMs: 120_000 });
    const body = /** @type {any} */ (await res.json());
    const status = String(body?.status ?? '').toLowerCase();
    if (status === 'completed') {
      const url = String(body?.result?.output_url ?? body?.result?.url ?? '');
      if (!url) throw new Error(`${NAME} 的任务 ${taskId} 完成了但没有产物地址。`);
      return url.startsWith('http') ? url : `${base()}${url}`;
    }
    if (status === 'failed' || status === 'error' || body?.error) {
      throw new Error(`${NAME} 的 ${what}任务失败了：${String(body?.error ?? body?.last_message ?? '未知原因').slice(0, 300)}`);
    }
    if (Date.now() > deadline) throw new Error(`${NAME} 的 ${what}任务超时（${budgetMin} 分钟）：${taskId}`);
    await sleep(3000, ctx.signal);
  }
}

/** @type {Provider} */
export default {
  id: 'tintin',
  name: NAME,
  env: '',
  keysUrl: '',
  billingUrl: '',
  verbs: ['voice', 'tts', 'asr', 'music', 'sfx', 'cutout', 'image', 'image-search', 'video-search', 'video', 'web-search'],
  models: MODELS,
  /* 连接=服务端地址在（studio-runtime 注入 TINTIN_SERVER_URL）；无密钥。 */
  ready: () => Boolean(base()),
  async run(verb, args, ctx) {
    if (!base()) throw new Error(`${NAME} 未连接：服务端地址未配置（server.url）。`);

    if (verb === 'voice') {
      const limit = clamp(Math.round(number(args.limit) ?? 10), 1, 100);
      const body = /** @type {any} */ (await (await call(NAME, `${base()}/voice/samples`, {}, ctx)).json());
      const items = Array.isArray(body?.items) ? body.items : [];
      const ignored = ['gender'].filter((f) => text(args[f])).map((f) => `--${f} does not narrow TinTin's voices`);
      return {
        files: [],
        index: [],
        receipt: { provider: 'tintin', voices: items.slice(0, limit).map((item) => ({ voiceId: String(item.id ?? ''), name: String(item.name ?? `样本 ${item.id ?? ''}`), language: 'zh', gender: null, description: text(item.text) || null })), ...notes(ignored) },
      };
    }

    if (verb === 'tts') {
      const voice = needed(args, 'voice');
      const said = needed(args, 'text');
      ctx.say(`配音（IndexTTS，音色 ${voice}）…`);
      const body = /** @type {any} */ (await (await call(NAME, `${base()}/indextts/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: said, resp: 'json', sample_id: Number.isFinite(Number(voice)) ? Number(voice) : voice }),
      }, ctx)).json());
      const url = String(body?.audio_url ?? '');
      if (!url) throw new Error(`${NAME} 的配音没有返回音频地址。`);
      const path = landing('audio/vo', args.out, 'wav');
      const { bytes, type } = await download(NAME, url.startsWith('http') ? url : `${base()}${url}`, ctx);
      const dur = wavSeconds(bytes);
      return {
        files: [{ path, bytes }],
        index: [{ src: path, kind: 'audio', ...(dur !== null ? { dur } : {}), text: said, voice, from: { mode: 'synth', text: said, voice, provider: 'tintin', model: 'indextts' } }],
        receipt: { provider: 'tintin', model: 'indextts', src: path, dur, voice, ...(Number.isFinite(Number(body?.sample_rate)) ? { sampleRate: Number(body.sample_rate) } : {}), ...(type && !type.includes('wav') ? { format: type } : {}) },
      };
    }

    if (verb === 'asr') {
      const src = needed(args, 'src');
      ctx.say('转写（Whisper，TinTin 服务端）…');
      const upload = await speechUpload(src, ctx);
      const form = new FormData();
      form.set('file', upload.blob, upload.name);
      form.set('fmt', 'json');
      form.set('mode', 'raw');
      const body = /** @type {any} */ (await (await call(NAME, `${base()}/whisper/transcribe`, { method: 'POST', body: form }, ctx)).json());
      const segments = Array.isArray(body?.segments) ? body.segments : [];
      const words = segments.flatMap((/** @type {any} */ s) => (Array.isArray(s?.words) ? s.words : []))
        .filter((/** @type {any} */ w) => Number.isFinite(w?.start) && text(w.word))
        .map((/** @type {any} */ w) => ({ token: text(w.word), start: w.start, end: Number.isFinite(w.end) ? w.end : w.start }));
      const said = segments.map((/** @type {any} */ s) => text(s.text)).join('').trim();
      const dur = words.length ? round(words.at(-1)?.end ?? 0) : null;
      return {
        files: [],
        index: [{ src, ...(dur ? { dur } : {}), text: said, words, transcribed: true }],
        receipt: { provider: 'tintin', model: 'whisper', src, text: said, words: words.length },
      };
    }

    if (verb === 'music') {
      const prompt = needed(args, 'prompt');
      const duration = clamp(Math.round(number(args.sec) ?? 20), 3, 30);
      ctx.say(`音乐（MusicGen BGM，${duration}s）…`);
      const { said, out } = await mcpCall('create_music', { style: 'auto', prompt, duration: String(duration) }, ctx, 'annotated', 600_000)
      const url = String(out?.url ?? out?.audio_url ?? '') || (said.match(/https?:\/\/\S+/)?.[0] ?? '');
      if (!url) throw new Error(`${NAME} 的音乐生成没有返回音频地址：${said.slice(0, 200)}`);
      const path = landing('audio/music', args.out, 'mp3');
      const { bytes, type } = await download(NAME, url.startsWith('http') ? url : `${base()}${url}`, ctx);
      return {
        files: [{ path, bytes }],
        index: [{ src: path, kind: 'audio', dur: duration, from: { mode: 'generate', prompt, provider: 'tintin', model: 'musicgen-bgm' } }],
        receipt: { provider: 'tintin', model: 'musicgen-bgm', src: path, dur: number(out?.duration) ?? duration, ...(type && !type.includes('mpeg') ? { format: type } : {}), notes: ['MusicGen 给无词 BGM：字词不入轨'] },
      };
    }

    if (verb === 'sfx') {
      const prompt = needed(args, 'prompt');
      const duration = clamp(Math.round(number(args.sec) ?? 3), 1, 10);
      ctx.say(`音效（TinTin 服务端，${duration}s）…`);
      const body = /** @type {any} */ (await (await call(NAME, `${base()}/audio/gen/sfx`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, duration }),
      }, ctx)).json());
      const url = String(body?.url ?? body?.audio_url ?? '');
      if (!url) throw new Error(`${NAME} 的音效没有返回音频地址。`);
      const path = landing('audio/sfx', args.out, 'mp3');
      const { bytes } = await download(NAME, url.startsWith('http') ? url : `${base()}${url}`, ctx);
      return {
        files: [{ path, bytes }],
        index: [{ src: path, kind: 'audio', dur: duration, from: { mode: 'generate', prompt, provider: 'tintin', model: 'sfx-gen' } }],
        receipt: { provider: 'tintin', model: 'sfx-gen', src: path, dur: duration },
      };
    }

    if (verb === 'cutout') {
      const src = needed(args, 'src');
      ctx.say('抠图（Matting，TinTin 服务端）…');
      const bytes = await ctx.read(src);
      const form = new FormData();
      form.set('file', new Blob([bytes], { type: 'image/png' }), src.split('/').pop());
      const out = new Uint8Array(await (await call(NAME, `${base()}/matting`, { method: 'POST', body: form }, ctx)).arrayBuffer());
      const path = landing('image', args.out, 'png');
      const made = madePicture({ path, bytes: out, prompt: '', provider: 'tintin', model: 'matting', notes: [] });
      return { ...made, index: made.index.map((row) => ({ ...row, from: { mode: 'cutout', src, provider: 'tintin', model: 'matting' } })) };
    }

    if (verb === 'image') {
      const prompt = needed(args, 'prompt');
      const aspect = ASPECT[text(args.ratio)] || '1:1';
      /* 带参考图走 i2i（契约 §4.1：images 第 1 张=底图，2..N=辅助参考；mask/markup 互斥由服务端
         校验，尺寸不一致服务端明确报错）。strength 不传=服务端缺省档（2026-11-21 实测标定：
         全档指令生效）。 */
      const refs = list(args.ref).slice(0, 8);
      const body = { mode: refs.length ? 'i2i' : 't2i', prompt, aspect };
      if (refs.length) {
        body.images = (await Promise.all(refs.map((p) => uploadOne(p, ctx)))).join(',');
        const mask = text(args.mask);
        const markup = text(args.markup);
        if (mask) body.mask = await uploadOne(mask, ctx);
        if (markup) body.markup = await uploadOne(markup, ctx);
      }
      const url = await generate('create_image', body, '图片', ctx);
      const path = landing('image', args.out, 'png');
      const { bytes } = await download(NAME, url, { ...ctx, networkTimeoutMs: 300_000 });
      const made = madePicture({ path, bytes, prompt, provider: 'tintin', model: 'comfygen-image', notes: [] });
      return { ...made, receipt: { ...made.receipt, aspect, ...(refs.length ? { mode: 'i2i', refs: refs.length } : {}) } };
    }

    if (verb === 'video') {
      const prompt = needed(args, 'prompt');
      const duration = clamp(Math.round(number(args.duration) ?? 5), 1, 10);
      /* Studio 画布发 'aspect-ratio'（lib/canvas.ts makeRequest），此前只读 'aspect' 恒落 16:9 缺省
         ——两个键都收。图生视频三形态（契约 §5.1）：首帧(+last_image 尾帧插值)/参考图(≤4,与首帧
         互斥)。值域守卫：服务端 1080p 档仅 16:9/9:16，其他比例落 720p。 */
      const aspect = ASPECT[text(args['aspect-ratio'])] || ASPECT[text(args.aspect)] || '16:9';
      const body = { prompt, duration: String(duration), aspect };
      const first = text(args['first-frame']);
      const last = text(args['last-frame']);
      const refs = list(args['input-reference']);
      if (first) {
        body.image = await uploadOne(first, ctx);
        if (last) body.last_image = await uploadOne(last, ctx);
      } else if (refs.length) {
        body.reference_images = (await Promise.all(refs.slice(0, 4).map((p) => uploadOne(p, ctx)))).join(',');
      }
      if ((body.image || body.reference_images) && aspect !== '16:9' && aspect !== '9:16') body.resolution = '720p';
      const url = await generate('create_video', body, '视频', ctx);
      const path = landing('video', args.out, 'mp4');
      const { bytes } = await download(NAME, url, { ...ctx, networkTimeoutMs: 300_000 });
      return {
        files: [{ path, bytes }],
        index: [{ src: path, kind: 'video', dur: duration, from: { mode: 'generate', prompt, provider: 'tintin', model: 'comfygen-video' } }],
        receipt: { provider: 'tintin', model: 'comfygen-video', src: path, dur: duration, aspect },
      };
    }

    if (verb === 'image-search') {
      const prompt = needed(args, 'prompt');
      const body = /** @type {any} */ (await (await call(NAME, `${base()}/material/stock_search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: prompt, kind: 'image', ...(text(args.orientation) ? { orientation: text(args.orientation) } : {}) }),
      }, ctx)).json());
      const hits = (Array.isArray(body?.items) ? body.items : []).flatMap((/** @type {any} */ item) => {
        const url = text(item?.url);
        return url ? [{ url }] : [];
      });
      return foundPictures({ service: NAME, provider: 'tintin', args, hits, notes: [] }, ctx);
    }

    /* 视频搜索(2026-11-13 用户问「服务端已提供视频搜索,客户端没对接」): 同一端点 kind=video,
       服务端聚合 Pexels/Pixabay。items 带 width/height/duration_sec/author —— foundClips 的
       hits 形状直接对上;orientation(2026-11-21 R6)服务端已收参并透传图源,未传时命中后按
       横竖匹配交给 Studio 的下载挑选。 */
    if (verb === 'video-search') {
      const prompt = needed(args, 'prompt');
      const per = clamp(Math.round(number(args.n) ?? 1) + 2, 1, 30);
      const body = /** @type {any} */ (await (await call(NAME, `${base()}/material/stock_search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: prompt, kind: 'video', per, ...(text(args.orientation) ? { orientation: text(args.orientation) } : {}) }),
      }, ctx)).json());
      const hits = (Array.isArray(body?.items) ? body.items : []).flatMap((/** @type {any} */ item) => {
        const url = text(item?.url);
        if (!url) return [];
        return [{
          url,
          credit: item?.author ? `Video by ${text(item.author)} on ${text(item.provider) || 'stock'}` : null,
          dur: Number(item?.duration_sec) > 0 ? Number(item.duration_sec) : null,
          w: Number(item?.width) > 0 ? Number(item.width) : null,
          h: Number(item?.height) > 0 ? Number(item.height) : null,
        }];
      });
      return foundClips({ service: NAME, provider: 'tintin', args, hits, notes: [] }, ctx);
    }

    /* 网页搜索（契约 §7.3）：GET /search/web {query,count} → items[{title,url,snippet}]；
       searched() 消费面与 brave 同形（queries 多查询并发、ignored 溢出）。 */
    if (verb === 'web-search') {
      const { queries, ignored } = queriesOf(args);
      const rows = await Promise.all(queries.map(async (query) => {
        const q = new URLSearchParams({ query: query.slice(0, 600), count: '6' });
        const body = /** @type {any} */ (await (await call(NAME, `${base()}/search/web?${q}`, {}, ctx)).json());
        const items = Array.isArray(body?.items) ? body.items : [];
        return { query, hits: items.map((/** @type {any} */ h) => hitOf({ title: h?.title, url: h?.url, excerpt: text(h?.snippet) })) };
      }));
      return { ...searched('tintin', rows, ignored), cost: billedBy(NAME) };
    }

    throw new Error(`${NAME} does not do ${verb}.`);
  },
};
