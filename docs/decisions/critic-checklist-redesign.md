# Critic Checklist — Redesign Push (slices 70-I → 70-Z)

> **Why this exists.** Slice 70-K shipped with a row-stretch bug that
> picture-catalog §2.1 explicitly specs against ("rows fixed, cards
> shrink uniformly when count grows"). The critic pass on 70-K didn't
> catch it because the dispatched agents weren't required to load the
> picture-catalog and cross-check each visual decision. User feedback
> 2026-04-30: this needs to be a **standing requirement**, not an
> ad-hoc instruction per dispatch.
>
> Every critic dispatched on a redesign-push slice (70-I through 70-Z
> + any future visual-surface work referencing the catalog) is
> contractually required to use this checklist. The prompt template
> below is what I (Claude) include in every dispatch — verbatim. If a
> dispatched critic returns findings without referencing this
> checklist's items, treat the critique as incomplete and re-dispatch.
>
> **Canonical visual source of truth:** `docs/design/picture-catalog.md`.
> When the catalog and the implementation disagree, the catalog wins.
> When the catalog and any older spec doc disagree, the catalog wins
> (per the precedence notes in `target-visual-reference.md`,
> `screens-game-table-commander-4p.md`, and `design-system.md`).

---

## Required prompt template (paste into every redesign-slice critic dispatch)

```
You are reviewing slice {SLICE_ID} of the xmage modernUI redesign push.

REQUIRED WORKFLOW:

1. LOAD the canonical visual spec:
   docs/design/picture-catalog.md

2. IDENTIFY the affected region(s) of the catalog this slice
   touches. Quote the relevant catalog clauses verbatim in your
   review (e.g. "§2.D — Bottom local pod portrait position:
   centered horizontally near the bottom of the battlefield
   region (above the hand fan)").

3. CROSS-REFERENCE every visual decision in the implementation
   against the catalog. For each catalog clause that applies:
     - Does the implementation match? (cite file:line)
     - Does the implementation diverge? (flag as CRITICAL or
       IMPORTANT depending on severity)
     - Is there ambiguity in the catalog itself? (flag as
       NICE-TO-HAVE: "spec needs clarification")

4. CHECK FOR CARRY-OVER BUGS — visual code preserved from earlier
   slices that violates the catalog. The slice 70-K row-stretch
   bug (flex-wrap survived from slice 53 even though the
   redesign's catalog §2.1 specs "rows fixed, cards shrink") is
   the canonical example of what to look for. Specifically scan
   for:
     - flex-wrap on layout containers that the catalog specs as
       "fixed dimensions" or "single line"
     - hardcoded pixel sizes where tokens exist
     - inline overlays composed in legacy positions when the
       redesign's anatomy moved them

5. ADJACENT IMPACTS — when this slice changes a component, list
   every other component that imports or depends on the changed
   surface. Verify each one still composes correctly.

6. PRE-EXISTING ISSUES are in scope when they (a) violate the
   picture-catalog or (b) are exposed by the slice's changes.
   The slice "didn't introduce" rationale is not a pass — if the
   catalog says the behavior is wrong, flag it regardless of when
   it was introduced.

OUTPUT FORMAT:

# Critic Report — Slice {SLICE_ID}

## Catalog clauses checked
List each catalog clause/section that applies, e.g.:
- §2.0 (pod common anatomy) — implementation: ...
- §2.D (bottom pod) — implementation: ...
- §6.1 (action footer removal) — implementation: ...

## CRITICAL findings
(blocks ship — must fix before slice commits)

## IMPORTANT findings
(should fix this slice; can argue for follow-up if scope-bounded)

## NICE-TO-HAVE findings
(log for polish slice 70-Z; not blocking)

## Carry-over violations
(visual code preserved from earlier slices that violates the
catalog; flag even if "not introduced by this slice")

## Adjacent components verified
(other files that import the changed surface; verdict per file)

## Catalog clauses NOT checked
(any catalog clauses skipped — explain why; default expectation
is to check ALL clauses for the affected region(s))
```

---

## Per-tier guidance

The CLAUDE.md cadence reform tier table determines which critics
fire (Technical / UI / UX / Graphical). The picture-catalog
checklist applies UNIFORMLY across tiers — every critic loads the
catalog regardless of their specialty. Specialists differ in WHAT
they evaluate the implementation against:

| Tier | What this critic checks against picture-catalog |
|---|---|
| **Technical** | Wire-shape contracts, performance, race conditions, null-safety. Catalog clauses: §0 (implementation cross-reference) — verify the slice consumes the right tokens / atoms. |
| **UI** | Visual structure, spacing, typography, color tokens, DOM hierarchy. Catalog clauses: per-region anatomy + the "What's NOT in X" callouts. |
| **UX** | Interaction flow, state composition (active / disconnected / eliminated), keyboard nav, aria-labels, mode transitions. Catalog clauses: §2.4 (state composition), §Region per-element interaction notes. |
| **Graphical** | Motion timing, glow tuning, halo geometry, animation composition. Catalog clauses: "Color and motion impressions" + animation references in each region. |

---

## Rejected critic outputs (re-dispatch criteria)

Re-dispatch a critic when their report:

- Does NOT quote at least one picture-catalog clause verbatim
- Does NOT have a "Catalog clauses checked" section
- Returns "looks good" without citing specific cross-checks
- Misses a carry-over bug that's flagged in this checklist's example list
- Returns findings that contradict the catalog without flagging the contradiction

The point is to make the catalog load-bearing in every review, not
optional. A critic that didn't load the catalog isn't reviewing
against the design spec; they're reviewing against their own
intuition about "what looks right."

---

## Lessons log

### 2026-04-30 — slice 70-K row-stretch bug

**What slipped through:** Slice 70-K shipped with `BattlefieldRowGroup.tsx:40`
using `flex flex-wrap`. When a top opponent has many permanents,
each card wraps to its own line, growing the row vertically off-
screen.

**Picture-catalog clause that was violated:** §2.1 + the
"Card sizing under board complexity" subsection of design-system §7.1
referenced by picture-catalog §0:
> If a player has more than ~12 permanents in a single row, cards
> shrink uniformly. Below the minimum readable size, cards start
> overlapping (each subsequent card overlaps the previous by 30%).

**Why critics missed it:**
1. The `flex-wrap` line was carried over from slice 53 (slice 70-K
   didn't touch the row container).
2. Critic prompts didn't require "scan for carry-over violations
   that the catalog specs against."
3. Critic prompts didn't require "cite catalog clauses in your
   findings."
4. Tests pass with flex-wrap (wrapping is observably correct as
   layout — just not catalog-correct).

**Process fix:** This checklist (§4 "Carry-over violations") +
required workflow steps 1-4. From slice 70-K.1 onward, every
critic dispatch references this document.
