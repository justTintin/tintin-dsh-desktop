# Agent Note: TinTin Studio 服务生命周期所有权

Status: proposed

English | [中文](2026-10-23-tintin-studio-service-lifecycle-ownership.zh.md)

> **Ruling record (2026-10-23)**: the user adopted directions 1, 3, and 4. Item 1
> (fingerprinted attach and reconciliation) landed in
> `dsh-tintin-bundle/lib/openfilm/studio-runtime.js` (`editorFingerprint` /
> `reconcileStudioInstance` / the `run.tintin.json` ledger; `startStudio`
> reconciles before spawning). Item 3 (self-healing view) landed in
> `dsh-plugin-desktop-tintin/src/tintin/main-hook.ts` (reload on URL change,
> `did-fail-load` clears the failure state, restart moved to a 60s window).
> Unit tests: the `studio-runtime` group in
> `dsh-tintin-bundle/test/tintin-openfilm.test.ts`. Item 2's stderr capture and
> last-window teardown remain open, so the note stays proposed.

## Problem

The TinTin film shell (official chat + Studio editor, served from the shell-overlaid
editor dist) depends on a detached OpenFilm Studio server that DSH does not own. The
launcher (`dsh-tintin-bundle/lib/openfilm/studio-runtime.js`) spawns the official CLI,
which detaches a server plus supervisor and exits; DSH only re-attaches by reading
`run.json`. Ownership of the process — its lifetime, its version, its crash behavior —
stays with the OpenFilm supervisor.

On 2026-10-23 this produced a full outage of the film workbench: the Studio server
entered a crash loop (`logs/studio.log`: repeated `exit code 1; starting it again`),
a fresh app attached to (or raced against) a stale or restarting server, the embedded
view consumed a `did-fail-load`, and the shell-chat probe then failed all 8 rounds.
Because the takeover design has two self-healing gaps — `ensureStudioView` reuses an
existing view and never reloads a failed URL (`main-hook.ts`), and the stale-server
restart is allowed only once per app launch (`filmShellRestarted`) — the user was left
with a permanent "需重装含 shell 构建的包" screen even though the package was fine.

Two structural causes, not one:

1. **No instance ownership.** DSH attaches to whatever server happens to be running,
   across app restarts and across app versions. Version skew between the app (and its
   editor dist) and the running server is undetectable: `run.json` carries only
   pid/origin/key.
2. **Fallback retirement without an error-path audit.** The takeover design originally
   kept the transition chat column as a degraded-but-working fallback, and several
   recovery shortcuts (`restart once`, `never reload the view`) were acceptable under
   that assumption. The same change set retired the fallback
   (官方聊天是唯一聊天, 2026-10-23 用户裁决) without re-auditing those shortcuts, so
   probe failure went from "degraded" to "nothing on screen".

## Retrospective: why the architecture gap existed

- The 1:1 source-parity rule was applied to the lifecycle too: the official desktop
  app's detached-server model was ported as if it were part of the contract, although
  its precondition (app and server are installed and updated together) does not hold
  in TinTin, where the app builds on its own cadence and the editor dist is overlaid.
  A deviation this size should have been dispositioned explicitly with measured
  evidence, and was not.
- Acceptance work concentrated on success-path UX (focus handoff, bounds offset,
  playhead jitter). No test covers "attach while an older-version server is running"
  or "the server restarts inside the probe window". The headless test matrix has no
  cross-restart, cross-version, or timing-race scenarios for this seam.
- "It has a fallback" masked "the fallback is broken": degraded paths reduced the
  pressure to make the primary path self-healing.

## Decision (proposed ruling)

DSH owns the Studio service instance. Concretely:

1. **Fingerprinted attach.** `run.json` gains a build fingerprint (openfilm package
   version + editor-dist hash + app build id). Before attaching, the desktop verifies
   the fingerprint; on mismatch it kills the stale instance and starts its own. The
   current one-shot, guess-based stale detection is replaced by deterministic version
   management.
2. **Owned lifecycle.** The server becomes a DSH child process (or stays detached but
   is reconciled on every desktop launch and torn down when the last film window
   closes). The supervisor's restart loop becomes observable: stderr is captured into
   DSH logging, and a crash loop raises user-visible status instead of an infinite
   black view.
3. **Self-healing view.** `ensureStudioView` must reload (or destroy and recreate) the
   view when the requested URL differs from what was loaded or the last load failed;
   `did-fail-load` clears the cached view; `filmShellRestarted` becomes time-windowed
   so "点击这里重试" actually retries.
4. **Fallback-retirement audit rule.** Whenever a change retires a degraded path, the
   same change must re-audit every error handler that was relaxed on the assumption
   that the fallback existed. This is a porting-process rule, proposed for
   `docs/tintin-iron-rules.md` after this note is approved.

Items 3 and 4 are bug-class fixes and can land independently; items 1 and 2 are the
architecture ruling this note requests.

## Failure and platform behavior

- Until item 1 lands, a server started by the official OpenFilm desktop app or an
  older TinTin build can still be adopted; the isolated `OPENFILM_HOME` and port keep
  this unlikely but not impossible.
- Killing a stale instance may lose unsaved Studio-side UI state (not film data; the
  project lives on disk). The takeover retry loop already tolerates one restart, so
  this is within the current failure contract.

## Verification

Plan (none of this is implemented yet):

- unit tests for fingerprint validation and attach/reconcile decisions;
- a headless scenario test: start a server with a stale fingerprint, run the attach
  path, assert kill + restart + successful `has-shell` probe;
- a headless scenario test: `did-fail-load` on first open, then server recovery,
  assert the view is recreated and the probe succeeds;
- manual: the 2026-10-23 repro (crash-looping server + takeover) recovers via retry
  without relaunching the app.

## Consequences

If approved, `resolveOpenfilmRuntime`/`startStudio` gain an owner module (proposed
seam: `studio-service` in `dsh-plugin-desktop-tintin`), `main-hook.ts` consumes it
instead of reaching into `run.json` itself, and `docs/tintin-patch-audit.md` records
the lifecycle deviation from the official app with this note as the user ruling.
Rejecting items 1–2 means accepting that version-skew outages recur on every
stale-server race, and the error message should then stop blaming the package.
