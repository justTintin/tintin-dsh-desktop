/**
 * 封面会话页入口(2026-10-28 会话移植,chat-shell 独立构建):先装桥
 * (window.openfilmDesktop,见 cover-chat-bridge.ts),再挂官方聊天组件
 * (mountChat 内部 app.hello() 取项目与语言)。与影片 shell(openfilm-shell)
 * 完全独立的构建——同款界面、同款架构(ACP 会话+桥+mount),业务对接不同。
 */
import './cover-chat-bridge';
import './cover-chat-products';
import './cover-chat-skills';
import './cover-chat-tailwind.css';
import './cover-chat-page.css';
import '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src/chat/chat.css';
import { mountChat } from '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src/chat/mount';

// 构建标记(2026-10-29 用户排障:实例混合态鉴别——F12 控制台可见)
console.log('[cover-chat] build 2026-10-30-a (skills manager on ▦ button)')

void mountChat(document.getElementById('root')!);
