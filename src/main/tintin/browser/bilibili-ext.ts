// bilibili-ext.ts — B站下载助手扩展（SRC desktop/main/bilibili-ext.js 一比一移植，基线 SRC 9ca9050）
//   目录查找 / tintin-ext 协议注册 / content script 手动注入 / shadow DOM 下载链接提取脚本
// 移植差异（铁律 6 注记）：
//   ① Electron 43 移除 protocol.registerFileProtocol → protocol.handle（Response 回包，语义等价）。
//   ② CJS → ESM。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, net, protocol, type Session, type WebContents } from 'electron'

// ── B站扩展协议注册（只注册一次）──
let bilibiliProtoRegistered = false
let bilibiliCspBypassRegistered = false

/** B站下载插件是否已随包分发（dev=build/ext-assets，打包=resources/ext-assets）。装了插件 → B站下载交给插件，无需嗅探 */
export function bilibiliHelperInstalled(): boolean {
  return !!findBilibiliHelperDir()
}

/**
 * 查找 B站扩展真实目录。多候选（打包=resources/ext-assets、开发=build/ext-assets、cwd/assets 兼容 SRC 布局），
 * 失败时在 resources 下递归探测含 bilibili-helper 的目录（SRC 同款兜底）。
 */
export function findBilibiliHelperDir(): string | null {
  const candidates: string[] = []
  const res = process.resourcesPath
  if (res) {
    candidates.push(join(res, 'ext-assets', 'bilibili-helper'))
    candidates.push(join(res, 'assets', 'bilibili-helper'))
    candidates.push(join(res, 'bilibili-helper'))
  }
  try { const base = app?.getAppPath?.(); if (base) { candidates.push(join(base, 'build', 'ext-assets', 'bilibili-helper')); candidates.push(join(base, 'assets', 'bilibili-helper')) } } catch { /* 非 Electron 环境（单测） */ }
  candidates.push(join(process.cwd(), 'assets', 'bilibili-helper'))
  for (const p of candidates) {
    try { if (existsSync(join(p, 'manifest.json'))) return p } catch { /* 候选不可用 */ }
  }
  // 兜底：在 resources 下递归搜索含 bilibili-helper 的目录
  if (res) {
    try {
      const hits: string[] = []
      const walk = (dir: string, depth: number): void => {
        if (depth > 4) return
        let ents
        try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const en of ents) {
          if (!en.isDirectory()) continue
          const sub = join(dir, en.name)
          if (/bilibili-helper/i.test(en.name)) {
            try { if (existsSync(join(sub, 'manifest.json'))) hits.push(sub) } catch { /* skip */ }
          }
          walk(sub, depth + 1)
        }
      }
      walk(res, 0)
      if (hits.length) return hits[0] ?? null
    } catch { /* ignore */ }
  }
  return null
}

// ── B站扩展下载链接提取脚本：主进程 executeJavaScript 主动从页面 shadow DOM 提取下载地址 ──
//    支持扩展的三种链接形式：href（兼容模式）、durl（单段高级）、durls（合并模式）
//    （SRC 逐字保留；纯 ES2020 文本，页面内执行）
export const BILI_DL_EXTRACT_SCRIPT = `(function(){
  function _dec(en){ try { return JSON.parse(decodeURIComponent(en)) } catch(_){} try { return JSON.parse(en) } catch(_){} return null; }
  function _norm(u){ try { return decodeURIComponent(u) } catch(_){ return u } }
  var host = document.getElementById('bilibili-helper-host');
  if(!host || !host.shadowRoot) return { hostFound: false, downloads: [] };
  try {
    var sr = host.shadowRoot;
    var list = sr.querySelectorAll('#durls li a');
    var titleEl = sr.querySelector('#title');
    var title = (titleEl && titleEl.textContent || '').trim();
    var qm = title.match(/^\\[([^\\]]+)\\]/);
    var quality = qm ? ('[' + qm[1] + '] ') : '';
    var items = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var t = (a.textContent || '').trim();
      var sm = t.match(/\\(([^)]+)\\)/);
      var sizeText = sm ? sm[1] : '';
      var href0 = a.getAttribute('href') || '';
      if (href0 && href0 !== '#nogo' && href0.indexOf('javascript:') !== 0) {
        items.push({ url: href0, download: a.getAttribute('download') || '', text: quality + t + (sizeText?('<'+sizeText+'>'):''), sizeText: sizeText });
        continue;
      }
      var durl = a.getAttribute('durl');
      if (durl) {
        var e = _dec(durl);
        if (e && e.url) { items.push({ url: _norm(e.url), download: a.getAttribute('title') || '', text: quality + t + (sizeText?('<'+sizeText+'>'):''), sizeText: sizeText }); continue; }
      }
      var durls = a.getAttribute('durls');
      if (durls) {
        var arr = _dec(durls);
        if (Object.prototype.toString.call(arr) === '[object Array]' && arr.length) {
          var base = a.getAttribute('title') || '';
          var liSize = '';
          try {
            var szSpan = a.parentElement ? a.parentElement.querySelector('span.size') : null;
            liSize = szSpan ? (szSpan.textContent || '').replace(/^[（(共]+/, '').replace(/[）)]$/, '') : '';
          } catch (_eSz) {}
          var mergeText = quality + t + (liSize ? (' (' + liSize + ')') : '');
          if (arr.length >= 2) {
            var vIdx = 0, aIdx = 1;
            var tAttr = a.getAttribute('type') || '';
            if (/a\\+v/.test(tAttr)) { aIdx = 0; vIdx = 1 }
            else {
              var s0 = Number(arr[0] && arr[0].size) || 0, s1 = Number(arr[1] && arr[1].size) || 0;
              if (s1 > s0) { vIdx = 1; aIdx = 0 } else { vIdx = 0; aIdx = 1 }
            }
            if (arr[vIdx] && arr[vIdx].url && arr[aIdx] && arr[aIdx].url) {
              items.push({ url: _norm(arr[vIdx].url), audioUrl: _norm(arr[aIdx].url), download: quality + base + '.mp4', text: mergeText, sizeText: liSize, dual: true });
              continue;
            }
          }
          if (arr[0] && arr[0].url) { items.push({ url: _norm(arr[0].url), download: quality + base + '.mp4', text: mergeText, sizeText: liSize }); }
          continue;
        }
      }
    }
    return { hostFound: true, title: title, downloads: items, url: window.location.href, ts: Date.now() };
  } catch(e) { return { hostFound: true, downloads: [] }; }
})()`

// ── B站扩展：手动注入 content script（兼容 Electron）──
export function injectBilibiliHelper(wc: WebContents, extPath: string, sess: Session): void {
  try {
    const contentScriptPath = join(extPath, 'bilibili-helper-content-script.js')
    if (!existsSync(contentScriptPath)) {
      console.warn(`[TinTinBrowser::bilibili] Content script not found: ${contentScriptPath}`)
      return
    }

    const scriptContent = readFileSync(contentScriptPath, 'utf8')
    const manifestPath = join(extPath, 'manifest.json')
    let manifestData: Record<string, unknown> = { name: 'bilibili-helper', version: '3.0.4' }
    if (existsSync(manifestPath)) {
      try { manifestData = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { /* 默认 manifest */ }
    }

    // 注册自定义协议服务扩展文件（SRC registerFileProtocol → Electron 43 protocol.handle，
    // Response 回包语义等价；只注册一次）
    if (!bilibiliProtoRegistered) {
      try {
        protocol.handle('tintin-ext', (request) => {
          let urlPath = decodeURIComponent(request.url.replace('tintin-ext://', ''))
          if (/^[a-zA-Z]:[\\/]/.test(urlPath)) {
            urlPath = urlPath.replace(/\//g, '\\')
          } else {
            urlPath = join(extPath, urlPath)
          }
          return net.fetch(pathToFileURL(urlPath).toString())
        })
        bilibiliProtoRegistered = true
        console.log(`[TinTinBrowser::bilibili] Registered tintin-ext protocol for: ${extPath}`)
      } catch (err) {
        console.warn(`[TinTinBrowser::bilibili] Protocol registration failed: ${(err as Error).message}`)
      }
    }

    const extBaseUrl = `tintin-ext://${extPath.replace(/\\/g, '/')}`

    // chrome.runtime polyfill + 扩展信息注入 + 主脚本
    // 幂等守卫：同一文档只完整执行一次（重复执行会让 customElements.define 二次定义抛错）。
    // content script 是 MV3 模块化产物，内含 import.meta.url（经典脚本求值是 SyntaxError）——
    // 替换为页面 URL 表达式（SRC 同款修正；ffmpeg 仅合成/转码时惰性用到且与链接提取无关）。
    const safeContent = String(scriptContent || '').replace(
      /import\.meta\.url/g,
      "(window.location && window.location.href || 'https://www.bilibili.com/')"
    )
    const injectScript = `
      if (!window.__TINTIN_BILI_INJECTED__) {
      window.__TINTIN_BILI_INJECTED__ = true;
      (function() {
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.runtime) {
          window.chrome.runtime = {
            getManifest: function() {
              return ${JSON.stringify(manifestData)};
            },
            getURL: function(path) {
              return '${extBaseUrl}/' + path.replace(/^\\//, '');
            }
          };
        }
      })();
      (function() {
        const EL_ID = 'bilibili-helper-ext-content-script';
        let el = document.getElementById(EL_ID);
        if (!el) {
          el = document.createElement('div');
          el.id = EL_ID;
          el.style.display = 'none';
          (document.head || document.documentElement).appendChild(el);
        }
        el.dataset.internals = JSON.stringify({
          manifest: ${JSON.stringify(manifestData)},
          baseUrl: '${extBaseUrl}'
        });
      })();
    ` + safeContent + `
      } // __TINTIN_BILI_INJECTED__ guard end
`

    // 在会话中移除 CSP 限制（允许内联脚本和 Worker）——只注册一次
    if (sess && !bilibiliCspBypassRegistered) {
      try {
        sess.webRequest.onHeadersReceived({ urls: ['*://*.bilibili.com/*'] }, (details, callback) => {
          const headers = details.responseHeaders || {}
          const cspKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-security-policy')
          if (cspKey) {
            delete headers[cspKey]
            headers['content-security-policy'] = ["default-src * 'unsafe-inline' 'unsafe-eval' 'unsafe-wasm-utils' 'self' data: blob: tintin-ext:; script-src * 'unsafe-inline' 'unsafe-eval' 'unsafe-wasm-utils' 'self' data: blob: tintin-ext:; worker-src * 'unsafe-inline' 'unsafe-eval' 'self' data: blob: tintin-ext:; style-src * 'unsafe-inline' 'self' data:; img-src * 'self' data: blob:; connect-src * 'self' data: blob:; font-src * 'self' data:;"]
          }
          callback({ responseHeaders: headers })
        })
        bilibiliCspBypassRegistered = true
        console.log(`[TinTinBrowser::bilibili] CSP bypass registered for bilibili.com`)
      } catch (err) {
        console.warn(`[TinTinBrowser::bilibili] CSP bypass failed: ${(err as Error).message}`)
      }
    }

    // 文档开始时注入
    // Electron 43 类型面无此 API（SRC 同款防御式调用）：存在则文档开始注入，
    // 否则依赖立即注入 + did-finish-load 补注（SRC 行为一致）。
    const wcExt = wc as unknown as { addScriptToEvaluateOnNewDocument?: (opts: { content: string; runAt: string }) => void }
    if (typeof wcExt.addScriptToEvaluateOnNewDocument === 'function') {
      wcExt.addScriptToEvaluateOnNewDocument({ content: injectScript, runAt: 'document_start' })
      console.log(`[TinTinBrowser::bilibili] Content script registered for document_start injection`)
    }

    // 页面已加载 → 立即注入一次
    if (!wc.isLoading()) {
      wc.executeJavaScript(injectScript).then(() => {
        console.log(`[TinTinBrowser::bilibili] Content script injected immediately`)
      }).catch((err) => {
        console.warn(`[TinTinBrowser::bilibili] Immediate injection failed: ${(err as Error).message}`)
      })
    }

    // 每次页面加载后重新注入 + SPA 内页跳转兜底（SRC 同款：跳到视频页但扩展未初始化时整页 reload）
    wc.on('did-finish-load', () => {
      const url = wc.getURL()
      if (url && (url.includes('bilibili.com'))) {
        wc.executeJavaScript(injectScript).then(() => {
          console.log(`[TinTinBrowser::bilibili] Content script injected after page load`)
        }).catch((err) => {
          console.warn(`[TinTinBrowser::bilibili] Post-load injection failed: ${(err as Error).message}`)
        })
      }
    })
    wc.on('did-navigate-in-page', (_e: unknown, navUrl: string, isMainFrame: boolean) => {
      try {
        if (!isMainFrame) return
        const url = navUrl || wc.getURL() || ''
        if (!/bilibili\.com\/(video\/(av|bv)|bangumi\/play)/i.test(url)) return
        Promise.resolve(wc.executeJavaScript(`(function(){
          if (!window.__TINTIN_BILI_INJECTED__) return 'FRESH'
          if (document.getElementById('bilibili-helper-host')) return 'ACTIVE'
          return 'NEED_RELOAD'
        })()`)).then((state) => {
          if (state === 'NEED_RELOAD') {
            console.log(`[TinTinBrowser::bilibili] SPA navigate to video page without initialized helper, reloading: ${url}`)
            wc.reload()
          }
        }).catch(() => {})
      } catch { /* ignore */ }
    })
  } catch (err) {
    console.warn(`[TinTinBrowser::bilibili] Injection error: ${(err as Error).message}`)
  }
}
