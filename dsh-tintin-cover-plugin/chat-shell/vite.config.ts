// 封面会话页 vite 构建(2026-10-28 用户裁决:源码共享,构建隔离)。结构复刻
// openfilm-shell/vite.config.ts(别名/双树/scoped css 同法),但只有聊天树一个入口,
// 无 Studio、无影片 shell——与视频剪辑的构建零耦合。源树由 fetch-openfilm-shell.mjs
// vendor 到 tintin-resources/openfilm-shell-src/。
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import type { Plugin as PostcssPlugin } from 'postcss';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src');
/* with forward slashes, as Vite names files on Windows too */
const STUDIO = normalize(join(SRC, 'openfilm/studio/ui/src') + '/');
const CHAT = normalize(join(SRC, 'chat') + '/');
/* npm 包自带(未被剥离):film-doc 的构建产物 */
const OPENFILM_PKG = normalize(join(here, '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm/node_modules/openfilm') + '/');
const SHARED = normalize(join(SRC, 'shared') + '/');

/** `openfilm/studio-ui/*` 在 npm 包里指向被剥离的 src —— 别名到 vendor 的源树(聊天只引用
    其类型与常量);film-doc 用包内构建产物;`@openfilm/shared` 是上游 workspace 包(npm 无),
    别名到 vendor 的源码。 */
function openfilmAliases(): Plugin {
  return {
    name: 'tintin-cover-chat-alias',
    enforce: 'pre',
    resolveId(source) {
      if (source === '@openfilm/shared/markdown') return this.resolve(join(SHARED, 'markdown-blocks.ts'), undefined, { skipSelf: true });
      if (source === '@openfilm/shared') return this.resolve(join(SHARED, 'index.ts'), undefined, { skipSelf: true });
      if (source.startsWith('openfilm/studio-ui/')) return this.resolve(join(STUDIO, source.slice('openfilm/studio-ui/'.length)), undefined, { skipSelf: true });
      if (source === 'openfilm/film-doc') return this.resolve(join(SRC, 'openfilm/src/film-doc.mjs'), undefined, { skipSelf: true });
      return null;
    },
  };
}

/** `@/…` is the importing file's own tree (the chat's files name their `src` so). */
function chatTree(): Plugin {
  return {
    name: 'tintin-cover-chat-tree',
    enforce: 'pre',
    resolveId(source, importer, options) {
      if (!source.startsWith('@/') || !importer) return null;
      return this.resolve(join(CHAT, source.slice(2)), importer, { ...options, skipSelf: true });
    },
  };
}

/** The chat's styles, kept to the chat (same scoping as the film shell build). */
const scopeChat: PostcssPlugin = {
  postcssPlugin: 'tintin-cover-scope-chat',
  Once(root, { result }) {
    if (!normalize(result.opts.from ?? '').startsWith(CHAT)) return;
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && /keyframes$/i.test((rule.parent as { name: string }).name)) return;
      const selectors = new Set<string>();
      for (const raw of rule.selectors) {
        const s = raw.trim();
        if (/:not\(\[data-theme\]\)|data-assets-open|openfilm-inset-titlebar|openfilm-fullscreen|tl-scrubbing|data-focus-nav/.test(s)) continue;
        const page = /^(?::root|html|body)(?![\w-])/.exec(s);
        const theme = /^\[data-theme='(?:light|dark)'\]/.exec(s);
        if (page) selectors.add(`.of-chat${s.slice(page[0].length)}`);
        else if (theme) selectors.add(`${theme[0]} .of-chat${s.slice(theme[0].length)}`);
        else selectors.add(`.of-chat ${s}`);
      }
      if (selectors.size) rule.selectors = [...selectors];
      else rule.remove();
    });
  },
};

export default defineConfig({
  plugins: [chatTree(), openfilmAliases(), react(), tailwind()],
  css: { postcss: { plugins: [scopeChat] } },
  resolve: { dedupe: ['react', 'react-dom', 'lucide-react'] },
  /* 页面伺服于 /tintin/cover/chat 前缀下:base 必须是完整前缀(相对 './' 在无尾斜杠的
     页面 URL 上会解析到 /tintin/cover/assets → 404;根绝对 /assets 则与宿主资产打架) */
  base: '/tintin/cover/chat/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    /* 单页面入口(无 index.html 约定名,必须显式指定) */
    rollupOptions: { input: resolve(here, 'cover-chat.html') },
  },
});
