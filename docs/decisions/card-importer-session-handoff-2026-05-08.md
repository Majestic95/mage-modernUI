# Card Importer Session Handoff — 2026-05-08

## Current Focus

We built and reviewed the standalone XMage Card Importer Workbench in
`tools/card-importer/`. The tool is intentionally isolated from the main
`webclient/` app and from upstream XMage engine files. It remains preview-first:
it scans a selected XMage checkout, fetches/imports card metadata, classifies
implementation difficulty, and generates reviewable patch/code snippets rather
than silently modifying `Mage/`, `Mage.Sets/`, or `Mage.Client/`.

## Implemented Workbench Capabilities

- React/Vite/TypeScript app under `tools/card-importer/`.
- Tauri desktop executable support under `tools/card-importer/src-tauri/`.
- Native checkout scanner that validates an XMage checkout, reads tracked and
  untracked candidate files, scans card classes, set entries, token database
  data, and basic lands, and reports diagnostics.
- Browser fallback scanner for selected local files.
- Local checkout search for card/set presence.
- Java/set/token/image patch preview generation.
- Centralized verification command generation using XMage `Mage.Verify` tests.
- Set completion dashboard backed by scanned `RepoScan` data.
- `init.txt` snippet generation for manual smoke-test setup.

## Recent Fixes Applied

- Set completion now checks actual scanned card classes and set entries instead
  of inferring completion from generated changes.
- Duplicate set summary and duplicate verification command UI were removed.
- `init.txt` snippets now normalize set codes consistently and prefer
  non-reprint cards for set samples.
- Dead `set-exists-missing-card` checkout status was removed.
- Verification command generation no longer creates a fake `ImportedCard`.
- Clipboard copy failures in workflow panels now surface user feedback.
- React list keys in workflow panels were made collision-resistant.
- Tests were added/updated for set completion, verification commands,
  `init.txt` snippets, workflow panels, native scanner behavior, and basic
  lands.

## Validation Last Run

Before this handoff, the desktop executable was rebuilt successfully after the
user closed the locked executable. The generated executable path viewed during
the session was:

`tools/card-importer/src-tauri/target/release/xmage-card-importer.exe`

The exact validation commands were run during the prior session context; when
resuming serious work, rerun the local gate from `tools/card-importer/`:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm desktop:check
pnpm desktop:build
```

## Research Artifacts

A succinct PDF summary of unsupported or disputed MTG mechanics was generated:

`tools/card-importer/xmage-unimplemented-mechanics.pdf`

The research categorized mechanics roughly as:

- Fair hard stops: ante, dexterity effects, people/outside-the-game effects.
- Possible but low-priority or novelty-heavy: subgames, contraptions/assemble,
  draft-matters, Host/Augment, art/artist/expansion-symbol matters.
- Real engine backlog candidates: text-changing effects, perpetually, paradigm,
  mutate gaps, Spy Kit, Ertai's Meddling, Magnetic Web.

## The War Doctor Finding

`The War Doctor` is commented out in
`Mage.Sets/src/mage/sets/DoctorWho.java`. The likely implementation blocker is
its trigger:

> Whenever one or more other cards are put into exile from anywhere, put a time
> counter on The War Doctor.

This appears implementable, not impossible. XMage has related zone-change batch
patterns such as `RakshasaVizier`, but `The War Doctor` needs a careful custom
trigger for cards entering exile from any source zone, batching "one or more",
excluding itself, and avoiding over-triggering on simultaneous exile. The attack
ability appears comparatively straightforward: deal damage equal to time
counters, then remove all time counters.

## Important Constraints For Next Session

- Do not modify upstream-owned files unless the user explicitly approves it.
  In particular, `Mage.Sets/src/mage/sets/DoctorWho.java` is upstream territory.
- Keep `tools/card-importer/` standalone and preview-first.
- If implementing any new card-engine support, start with the mandatory
  breakage analysis and confirm before touching upstream modules.
- For Card Importer changes, prefer focused tests plus `pnpm test`,
  `pnpm typecheck`, `pnpm build`, and Tauri checks/builds when executable output
  changes.
