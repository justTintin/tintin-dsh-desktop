# DSH Desktop repository rules

This repository owns the desktop product around an unmodified DeepSeek Harness checkout.

## Prerequisites and setup

- Use Node.js `^22.19.0` or `>=24.0.0` and the root Yarn `4.18.0` release through Corepack.
- Initialize the pinned upstream checkout with `git submodule update --init --recursive`.
- Install root dependencies with `corepack yarn install --immutable`.

## Build, run, and verify

- Start the desktop development workflow with `corepack yarn dev`.
- Build the desktop package with `corepack yarn build`.
- Root build, dev/start, and packaging commands refresh `dshmarket` from npm `latest` for Stable, Beta, Next, and the TinTin channel via `corepack yarn market:prepare`. Commit its exact dependency versions, Desktop compatibility patch, and lockfile together. `corepack yarn market:check` verifies freshness without writes; offline lookups or incompatible patches fail rather than silently retaining an old market. Installed apps do not hot-update executable plugins on launch.
- Before each release, run `corepack yarn aa:prepare-release` to build the latest official Agents Anywhere `main` for both Desktop channels. Commit the resulting artifact, provenance, manifests, and lockfile before packaging. Signed macOS releases and root Windows distribution commands verify freshness and installed versions; `DSH_AA_SOURCE_REF=pinned` is no longer supported.
- Run unit tests with `corepack yarn test`.
- Run type checking with `corepack yarn typecheck`.
- Run the complete headless gate with `corepack yarn check`.
- `corepack yarn dev:next` explicitly launches the experimental Next app; `corepack yarn check:next` validates it without a graphical application. Next uses the official published Web frontend and the recorded upstream Desktop presentation, with product capabilities composed as a separate bundle.
- Develop and validate Desktop feature changes in `dsh-plugin-desktop-beta/` first, then synchronize shared changes into `dsh-plugin-desktop/` while preserving declared variant differences. Before committing or pushing shared Desktop changes, run `corepack yarn check:desktop-variants` and validate both affected packages; neither package automatically inherits the other's source edits.
- Run upstream operations through the root scripts, such as `corepack yarn upstream:build`.

- `deepseek-harness/` is a pinned upstream Git submodule. Never edit files inside it from a desktop feature branch.
- `dsh-plugin-desktop/` owns the Cordis Host and Client faces, Electron bootstrap, packaging, and release tests.
- `dsh-desktop-next/` owns the separate experimental Desktop shell, Profiles and recovery, and adapters for the existing AA bridge and Community Market. Next-only changes do not belong in the Stable/Beta variant mirror. Keep its upstream reference and published runtime versions aligned; do not fork the official main frontend.
- `dsh-community-fabric/` owns the community interoperability RFC. Until schemas and a reviewed reference adapter exist, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- `dsh-community-market/` owns the community-market shell. Until its runtime is implemented, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- `dsh-tintin-bundle/`, `dsh-tintin-media-bundle/`, `dsh-tintin-browser/`, and `dsh-plugin-desktop-tintin/` own the TinTin port: the host bridge plugin, the media Vue sub-application, the browser domain, and the mirrored TinTin product channel. TinTin business code lives only in these workspaces; the channel keeps its source a three-way mirror of the Beta desktop package (see the TinTin porting section and [docs/tintin-iron-rules.md](docs/tintin-iron-rules.md)).
- The outer repository and all owned packages use the root Yarn release with `nodeLinker: node-modules`.
- The upstream submodule keeps its own pnpm workspace. Run upstream commands through the root `upstream:*` scripts, whose Yarn portable-shell commands enter the submodule before invoking Corepack.
- Compatibility mode must run the upstream default client without overrides. Advanced presentation belongs to desktop-owned client plugins and may replace documented slots or services through profile composition.
- Keep graphical application launch explicit. Builds, typechecks, unit tests, and Loader smokes must remain headless-safe.
- Commit before major changes of direction and keep the submodule pin update separate from desktop behavior changes.
- Keep the repository topology and package-manager split consistent with the [owning Agent Note](.agents/notes/implemented/process/2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md).

## TinTin porting

- The TinTin business port from the dataelement-lineage fork is planned in [docs/tintin-migration-plan.md](docs/tintin-migration-plan.md) and governed by the mandatory rules in [docs/tintin-iron-rules.md](docs/tintin-iron-rules.md); implementations violating the iron rules are rejected in review. The source repository and its documents are read-only references.
- TinTin business code lives only in dedicated `dsh-tintin-*` workspace packages composed through profile patches. It never enters `dsh-plugin-desktop/` or `dsh-plugin-desktop-beta/` `src/`, and never edits `deepseek-harness/`, vendored runtime artifacts, or third-party packages in place.
- Every porting operation needs one of the four evidence classes defined in the iron rules (user ruling, 1:1 source parity, third-party contract or authority, measured evidence); upstream patch hunks are dispositioned in `docs/tintin-patch-audit.md` before conversion, and runtime API differences are accepted only from spike measurements.
