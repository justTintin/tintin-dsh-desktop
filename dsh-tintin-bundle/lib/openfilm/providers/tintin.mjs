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
import { billedBy, call, clamp, download, foundPictures, landing, madePicture, needed, notes, number, round, sleep, speechUpload, text, wavSeconds } from './common.mjs';

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
  image: [{ id: 'comfygen-image', name: 'ComfyGen 图片', spec: { ratios: ['9:16', '16:9', '1:1', '4:3'] } }],
  video: [{ id: 'comfygen-video', name: 'ComfyGen 视频', spec: { ratios: ['9:16', '16:9', '1:1'], seconds: [1, 10] } }],
  'image-search': [{ id: 'stock-images', name: 'Stock Images' }],
};

/** The picture ratios Studio asks for → the aspects create_image takes (9:16/16:9/1:1/4:3). */
const ASPECT = { '1:1': '1:1', '4:3': '4:3', '3:2': '4:3', '16:9': '16:9', '9:16': '9:16', '2:3': '9:16' };

/** One MCP tools/call: the answer's first text block, parsed as JSON when it is one. */
async function mcpCall(tool, args, ctx) {
  const res = await call(NAME, `${base()}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  }, ctx);
  const raw = await res.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch {
    const line = raw.split('\n').filter((l) => l.startsWith('data:')).at(-1);
    if (line) { try { payload = JSON.parse(line.slice(5)); } catch { /* plain text answer */ } }
  }
  const said = String(payload?.result?.content?.[0]?.text ?? '');
  if (payload?.result?.isError) throw new Error(`${NAME} 的 ${tool} 失败：${said.slice(0, 300)}`);
  let out = null;
  try { out = JSON.parse(said); } catch { /* 同步文本答案（无 JSON 包装） */ }
  return { said, out };
}

/** 一个生成任务到产物地址：tools/call → task_id → GET /tasks/unified/<id> 轮询 → output_url。 */
async function generate(tool, args, what, ctx) {
  ctx.say(`${what}（TinTin 服务端）…`);
  const { said, out } = await mcpCall(tool, args, ctx);
  const taskId = String(out?.task_id ?? out?.taskId ?? '');
  if (!taskId) throw new Error(`${NAME} 的 ${tool} 没有返回任务 id：${said.slice(0, 200)}`);
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    if (ctx.signal.aborted) throw new Error('stopped');
    const res = await call(NAME, `${base()}/tasks/unified/${encodeURIComponent(taskId)}`, { headers: { accept: 'application/json' } }, ctx);
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
    if (Date.now() > deadline) throw new Error(`${NAME} 的 ${what}任务超时（10 分钟）：${taskId}`);
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
  verbs: ['voice', 'tts', 'asr', 'music', 'sfx', 'cutout', 'image', 'image-search', 'video'],
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
      const { said, out } = await mcpCall('create_music', { style: 'auto', duration: String(duration) }, ctx);
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
      const url = await generate('create_image', { mode: 't2i', prompt, aspect }, '图片', ctx);
      const path = landing('image', args.out, 'png');
      const { bytes } = await download(NAME, url, ctx);
      const made = madePicture({ path, bytes, prompt, provider: 'tintin', model: 'comfygen-image', notes: [] });
      return { ...made, receipt: { ...made.receipt, aspect } };
    }

    if (verb === 'video') {
      const prompt = needed(args, 'prompt');
      const duration = clamp(Math.round(number(args.duration) ?? 5), 1, 10);
      const aspect = ASPECT[text(args.aspect)] || '16:9';
      const url = await generate('create_video', { prompt, duration: String(duration), aspect }, '视频', ctx);
      const path = landing('video', args.out, 'mp4');
      const { bytes } = await download(NAME, url, ctx);
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
        body: JSON.stringify({ query: prompt, kind: 'image' }),
      }, ctx)).json());
      const hits = (Array.isArray(body?.items) ? body.items : []).flatMap((/** @type {any} */ item) => {
        const url = text(item?.url);
        return url ? [{ url }] : [];
      });
      return foundPictures({ service: NAME, provider: 'tintin', args, hits, notes: [] }, ctx);
    }

    throw new Error(`${NAME} does not do ${verb}.`);
  },
};
