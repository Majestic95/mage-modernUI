# 0014 — Self-Authored Spec Failure Modes (Bundle 3 Slice 3-C Post-Mortem)

- **Status:** Accepted
- **Date:** 2026-05-09
- **Deciders:** Austin
- **Scope:** Process rules for slices where the same agent wrote the brief and the code. Triggered by Bundle 3 Slice 3-C shipping the wrong feature (a duration-tracker bar instead of the 6-tick sub-step indicator the brief specified) and surfaces a wider class of failure modes the cadence didn't fail-safe against.

---

## Context

Bundle 3 — Combat Dashboard ([scope brief](../design/combat-bundle-3-dashboard.md)) was a 4-slice ship on `feat/combat-bundle-3-dashboard` (slices 3-A, 3-B, 3-C, 3-D). After all four slices landed, a parallel critic pass surfaced one merge blocker plus six spec divergences plus six latent bugs. Resolving them took three follow-up commits (`18cfbdff7a`, `165fa486d5`, `a0232cf7b3`).

The most striking single finding was that **Slice 3-C shipped the wrong feature**:

- The brief's literal motion spec for 3-C (lines 111–127 of the scope brief) called for a "five-tick mini meter under the banner sub-title, mirroring the combat runway from Slice 3-A" with per-tick opacity / translate / cross-fade behavior.
- The implementation was a continuous progress bar driven by a 1 Hz `setInterval` that grew from 0% to 100% over 120 seconds with calm/warm/hot color buckets at 30s/90s thresholds — a stopwatch that had no overlap with the brief.

The cost was non-trivial: ~7 KB of dead code (a hook + tests + intensity buckets), four commits of work along the wrong axis, and a follow-up slice (3-X.1) to delete the wrong feature and build the right one.

This is not the only spec-divergence finding from the critic pass — five other 3-X.1 items were brief-vs-shipped mismatches (recap empty-state copy, line-clamp-2 vs truncate, "…and N more" overflow phrasing, `aria-label` on the priority ribbon, controller filter on the attacker recap). But the tempo-meter divergence is the most instructive because the implementation didn't merely deviate from the brief — it built a feature the brief didn't describe at all.

### Why the cadence didn't catch it

The slice cadence in CLAUDE.md has six independent safeguards. **Every single one of them failed for Slice 3-C:**

1. **Per-slice recon scope brief** — CLAUDE.md prescribes a 1-paragraph restatement of the spec at recon time. The act of paraphrasing the brief is what catches comprehension drift. For 3-C, recon was skipped; the agent jumped straight from "next slice" to writing `useCombatTempo.ts`.

2. **Mandatory breakage analysis before coding** — CLAUDE.md is explicit: "Every change — no matter how small — gets a written breakage analysis before any code is written. This is a hard constraint, not a guideline." None was written for 3-C. A real "What I'm changing" line would have been "I'm adding a duration-tracking hook with thresholds at 30s/90s/120s" — which, compared to the brief, would have caught the mismatch at typing stage.

3. **Per-slice critic pass** — Standard tier slices that touch new visual or motion surface mandate builder + 2 critics (technical + UI/UX). Slice 3-C ran builder-only. The bundle-level critic pass eventually caught the divergence, but four commits late.

4. **Critic-pass log entry written at commit time** — `docs/decisions/critic-pass-log.md` has rows for every slice from 70-A through to recent 2026-05-09 work, and the "Specialists run" column makes coverage gaps visible at a glance. Bundle 3's slices were never logged. A row reading `Specialists run: Builder` for a Standard-tier visual/motion slice is a visible flag; that flag never landed in the doc.

5. **Acceptance criteria expressed as literal countables, not abstract feelings** — Slice 3-C's brief acceptance was *"meter updates in lock-step with the runway; no jank; total animation budget per step change ≤200ms."* Abstract criteria let any plausible implementation pass. A literal criterion like *"renders 6 elements with `data-testid='combat-banner-tempo-tick'` in turn order"* is fail-loud against a continuous bar.

6. **Tests written from the brief, not from the implementation** — The 3-C tests asserted intensity buckets, fill widths, and motion-safe transitions. They tested what was built. Tests written from the brief's literal renderable outcomes would have failed against a continuous bar.

### The aggravating factor

Single-author cadence collapses are the highest-risk class because **the same person wrote the brief and the code**. When you author your own spec, you don't read it carefully when implementing — "I know what I meant." Except the mental model that wrote the brief and the mental model that interprets it the next session can drift. Ambiguous words — "tempo," "priority," "active," "primary" — collapse to whichever interpretation the implementer happens to anchor on first. Without a second reader to challenge the interpretation, the drift is invisible until something downstream surfaces the disconnect.

For Slice 3-C, "tempo meter" had two valid readings: rhythm/pacing through sub-steps (the brief's intent, made explicit by the motion spec) or duration/elapsed time (a stopwatch, what got built). The motion spec resolved the ambiguity unambiguously to the former. The implementer didn't re-read the motion spec.

---

## Decisions

The CLAUDE.md cadence is correct in shape; the failure was discipline, not design. These rules harden discipline against the single-author failure mode without expanding the cadence's surface area.

### D1. Self-authored specs require literal paraphrase in the breakage analysis

When the spec author and the implementer are the same person (or sequential sessions of the same agent), the per-slice breakage analysis carries an extra mandatory section: **paraphrase the brief's spec for this slice in your own words, then compare your paraphrase to what you're about to build.** If they disagree, stop and re-read the brief.

This is the cheapest possible counter-measure to comprehension drift. It costs three sentences. It would have caught Slice 3-C's tempo divergence at typing stage.

**Concrete artifact:** breakage analyses for self-authored slices include a `### Spec paraphrase` heading with two paragraphs — one paraphrasing the brief for this slice, one paraphrasing what the implementation will produce — and an explicit `### Paraphrases match: yes/no` line. If "no," the slice doesn't enter builder phase until the disagreement is resolved.

### D2. Acceptance criteria must be countable, not abstract

Brief revisions and new briefs use literal, testable acceptance criteria. Examples:

| Bad (abstract) | Good (countable) |
|---|---|
| "Meter feels in lock-step with the runway" | "Renders 6 elements with `data-testid='combat-banner-tempo-tick'` in `data-step` order matching `TIMELINE_PHASES.combat`" |
| "No jank during step transitions" | "`prefers-reduced-motion: reduce` test asserts the active tick's class includes `motion-reduce:scale-125` and excludes `motion-safe:-translate-y-0.5`" |
| "Header stays slim outside combat" | "`document.querySelector('.phase-timeline').clientHeight <= 24` when `gameView.phase !== 'COMBAT'`" |
| "Recap shows what's staged" | "When `combat[0].attackers = { 'a-1': {...} }`, recap renders text matching `/^1 attacker — /`" |

Briefs going forward will be reviewed against this rubric before they're scope-locked. Existing briefs are not retroactively rewritten, but slice-level acceptance criteria are upgraded as slices are written.

### D3. Per-slice critic pass is non-negotiable for Standard tier slices that touch new visual or motion surface

The CLAUDE.md tier table already mandates this. The fix is procedural, not structural: **the critic-pass log row is written before the commit lands, not after.** Empty `Specialists run: Builder` rows on Standard-tier visual/motion slices are blocked at commit time with a one-line justification or a critic dispatch.

For trivial-tier slices and pure data slices, builder-only continues to be correct.

### D4. Critic-pass log row is a commit-time artifact, not a post-hoc one

CLAUDE.md already says "Add a row at commit time so coverage gaps stay traceable." This ADR upgrades that from a guideline to a hard constraint: **no commit on a non-trivial slice without a critic-pass log row.** The row's "Specialists run" column is the audit surface. If it reads `Builder` and the tier doesn't justify that, the slice isn't ready to commit.

For self-authored slices specifically, the row's `Critical findings caught` column should also note whether the implementer's paraphrase matched the brief (D1).

### D5. Backfill the Bundle 3 critic-pass log

Slices 3-A, 3-B, 3-C, 3-D, 3-X.0, 3-X.1, and 3-X.2 are backfilled in `docs/decisions/critic-pass-log.md` so the audit gap is traceable. The 3-C row explicitly notes the spec divergence and that no per-slice critic pass ran.

### D6. CLAUDE.md gets a "Self-authored specs" subsection under Mandatory Breakage Analysis

A new subsection codifies D1 (literal paraphrase) and D2 (countable acceptance criteria) so the rules are discoverable from the project contract, not just this ADR.

---

## Consequences

### What changes

- Breakage analyses for slices where the agent authored the brief gain a `### Spec paraphrase` block. Three sentences of structured comparison; cost is negligible.
- Brief acceptance criteria go from abstract to countable. New briefs follow the rubric in D2; existing briefs are upgraded incrementally as slices are written against them.
- Critic-pass log rows are written before commit. A `Specialists run: Builder` row on a Standard-tier visual/motion slice without a justification is a process failure that has to be addressed before the commit lands.
- CLAUDE.md gains a "Self-authored specs" subsection under Mandatory Breakage Analysis.

### What doesn't change

- The CLAUDE.md tier table is unchanged. Trivial-tier slices stay builder-only.
- The critic-pass log format is unchanged.
- The recon → builder → critic → fixer loop is unchanged in shape.

### Cost vs benefit

The cost is ~3 sentences per slice (the paraphrase block). The benefit is catching spec divergences at typing stage instead of at bundle-critic-pass stage four commits later. For Slice 3-C, a 3-sentence paraphrase would have saved 4 commits + ~7 KB of dead code + the cognitive cost of the rebuild. The breakeven is one prevented divergence per ~50 slices, which is a generous threshold given that Bundle 3 alone produced six.

### Open question for future reference

Is there a class of slice where D1 doesn't apply because the spec is so simple that paraphrase is redundant? Probably yes for trivial-tier slices ("rename foo to bar," "fix typo"). Trivial tier already gets no critic pass; D1 is also exempted there. The question is whether there's a "Mechanical" tier carve-out (rename, extract, doc reconciliation) that should also exempt D1. Provisional answer: yes, mechanical-tier slices skip D1 because the implementation IS the paraphrase ("rename X to Y" is its own spec). This is documented inline in the CLAUDE.md update; revisit if a mechanical-tier slice ever surfaces a spec divergence in retrospect.

---

## Related

- [`docs/design/combat-bundle-3-dashboard.md`](../design/combat-bundle-3-dashboard.md) — the Bundle 3 scope brief, including Slice 3-C's literal spec.
- [`docs/decisions/critic-pass-log.md`](critic-pass-log.md) — the audit log; backfilled per D5.
- `CLAUDE.md` § Mandatory Breakage Analysis — updated per D6.
- Bundle 3 commits: `8959f228c5`, `2df528da02`, `a616a4daf9`, `03af69b471`, `18cfbdff7a`, `165fa486d5`, `a0232cf7b3`.
