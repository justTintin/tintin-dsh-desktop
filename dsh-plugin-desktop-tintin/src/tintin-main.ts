// TinTin channel composition entry. package.json "main" points at the built
// lib/tintin-main.js: the hook module installs the channel-only main-process
// capabilities as soon as it loads, then the mirrored desktop bootstrap starts
// the application. The mirrored src/ tree stays byte-identical to Beta (see
// scripts/verify-desktop-variants.mjs and docs/tintin-iron-rules.md).

import './tintin/main-hook.ts'
import './main.ts'
