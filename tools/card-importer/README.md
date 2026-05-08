# XMage Card Importer Workbench

Standalone developer tool for generating reviewable XMage card-import patches.

The importer is intentionally isolated from the player-facing Modern UI. It reads
official card data, scans a local XMage checkout, classifies work, and previews
generated Java/set/token/image changes without silently editing engine files.

## Commands

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm desktop:dev
pnpm desktop:build
```

## Desktop Executable

The desktop app is the recommended workflow for real card-import work. It uses
Tauri to open a native folder picker, scans the selected XMage checkout with
`git ls-files --cached --others --exclude-standard` when available, and falls
back to a filtered filesystem scan when Git is unavailable.

```bash
cd tools/card-importer
pnpm install
pnpm desktop:dev
```

Build the Windows executable and installers with:

```bash
pnpm desktop:build
```

Successful Windows builds produce:

- Raw executable:
  `src-tauri/target/release/xmage-card-importer.exe`
- MSI installer:
  `src-tauri/target/release/bundle/msi/XMage Card Importer Workbench_0.1.0_x64_en-US.msi`
- NSIS installer:
  `src-tauri/target/release/bundle/nsis/XMage Card Importer Workbench_0.1.0_x64-setup.exe`

If packaging fails on a fresh Windows machine, install the normal Tauri
prerequisites first: Rust, Microsoft C++ Build Tools, WebView2 runtime, and the
Tauri-supported Windows bundler tooling. The raw release executable may still be
created even if an installer step fails.

Use `pnpm desktop:check` before sharing a build. It runs the frontend checks,
Rust unit tests, and Rust compile check.

## Safety Model

- Default output is a patch preview only.
- Generated changes target XMage paths, but the app does not apply them directly.
- Existing-file snippets are informational review text, not `git apply` patches.
- Unknown mechanics become TODO-rich stubs that intentionally throw until a human
  implements the rules and removes the stub marker.
- Whole-set previews follow Scryfall pagination and include token/image proposal
  snippets for every card that appears to create tokens.
- Desktop scans are read-only. The native backend exposes no command that writes
  to the selected XMage checkout.

## Review Expectations

- Review every generated card class before applying it to XMage.
- Treat parameterized keywords, dynamic power/toughness, non-normal layouts, and
  core basic lands as human-review work.
- Token image rows contain a `TODO` URL placeholder unless the exact Scryfall token
  printing has been verified.
