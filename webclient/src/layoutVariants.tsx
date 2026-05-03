/**
 * Runtime-switchable layout-variant scaffold (Slice A).
 *
 * Single source of truth for the {@code ?variant=} URL knob that lets
 * us iterate on multiple layout candidates side-by-side without
 * rebuilds or tab juggling. Today only {@code 'current'} exists (1:1
 * mapping to existing REDESIGN-mode behavior); add new variants by
 * extending {@link LAYOUT_VARIANTS}, adding a sibling component file,
 * and branching inside the consuming component via
 * {@link useLayoutVariant}.
 *
 * <p><b>Default semantics:</b> missing param, empty value, or unknown
 * name all fall back to {@link DEFAULT_VARIANT}. Unknown names log a
 * one-time console warning so a typo is visible during development
 * without spamming on every component re-read.
 *
 * <p><b>Runtime, not build-time.</b> The variant is URL-driven, not a
 * Vite env flag like {@code REDESIGN}. All variants ship in the
 * bundle together and are picked at render time. Dev-only gating in
 * {@code VariantSwitcher} hides the picker UI from production but
 * doesn't tree-shake variants — that's a future step once a variant
 * graduates to "ship to users."
 *
 * <p><b>Test override.</b> Pass an explicit {@code variant} prop to
 * {@link LayoutVariantProvider} to bypass URL parsing — same pattern
 * the tests use for the existing {@code REDESIGN} flag's
 * {@code vi.mock('../featureFlags', ...)} approach, but cleaner
 * because it doesn't require module-mocking gymnastics.
 */
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';

/**
 * Registry of valid variant names. Extend this tuple to add a variant
 * — TypeScript narrows {@link LayoutVariant} accordingly.
 *
 * <p><b>Per-variant living-map docs</b> live under
 * {@code docs/design/variant-<name>.md} (e.g.
 * {@code docs/design/variant-tabletop.md}). Update both this tuple
 * and the matching doc when a variant lands; the doc is the spec
 * authority, this tuple is the runtime registry.
 */
export const LAYOUT_VARIANTS = ['current', 'tabletop'] as const;

export type LayoutVariant = (typeof LAYOUT_VARIANTS)[number];

/** The variant that renders when no override / URL param is set. */
export const DEFAULT_VARIANT: LayoutVariant = 'current';

const VARIANT_PARAM = 'variant';

// Module-scope dedup latch so an unknown-variant typo only warns
// once, not on every getActiveVariant() call. Cleared by tests via
// the exported __resetWarnedForTests helper.
const warnedUnknown = new Set<string>();

/** Test-only — clear the unknown-variant warn-once latch between tests. */
export function __resetWarnedForTests(): void {
  warnedUnknown.clear();
}

function isLayoutVariant(value: string): value is LayoutVariant {
  return (LAYOUT_VARIANTS as readonly string[]).includes(value);
}

/**
 * Read the active variant from a URL search-string. Returns the
 * default when no param is set, the value is empty, or the value
 * doesn't match a registered variant.
 *
 * <p>Accepts an explicit {@code search} for testability; defaults to
 * {@code window.location.search} so callers can omit it in normal use.
 */
export function getActiveVariant(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): LayoutVariant {
  const params = new URLSearchParams(search);
  const raw = params.get(VARIANT_PARAM);
  if (raw === null || raw === '') return DEFAULT_VARIANT;
  const normalized = raw.toLowerCase();
  if (isLayoutVariant(normalized)) return normalized;
  if (!warnedUnknown.has(normalized)) {
    warnedUnknown.add(normalized);
    // eslint-disable-next-line no-console
    console.warn(
      `[layoutVariants] Unknown variant "${raw}" — falling back to "${DEFAULT_VARIANT}". ` +
        `Known variants: ${LAYOUT_VARIANTS.join(', ')}.`,
    );
  }
  return DEFAULT_VARIANT;
}

const LayoutVariantContext = createContext<LayoutVariant>(DEFAULT_VARIANT);

/**
 * Provides the active variant to descendants. Pass an explicit
 * {@code variant} to override URL-driven detection — used by tests,
 * Storybook-style harnesses, and the fixture-mode switcher (which
 * holds the variant in React state above this component).
 *
 * <p>When {@code variant} is omitted, the provider reads from
 * {@code window.location.search} once at mount via
 * {@link getActiveVariant}. To re-read the URL, remount the provider
 * or pass a controlled {@code variant} prop.
 */
export function LayoutVariantProvider({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: LayoutVariant;
}) {
  const value = useMemo(
    () => variant ?? getActiveVariant(),
    [variant],
  );
  return (
    <LayoutVariantContext.Provider value={value}>
      {children}
    </LayoutVariantContext.Provider>
  );
}

/**
 * Read the active layout variant. Returns {@link DEFAULT_VARIANT}
 * outside any provider — production game paths that haven't been
 * wrapped (yet) get the safe default.
 */
export function useLayoutVariant(): LayoutVariant {
  return useContext(LayoutVariantContext);
}

/**
 * Update the URL's {@code ?variant=} param without pushing a history
 * entry. Setting the default variant strips the param so the URL
 * stays clean. The page does NOT reload — callers wrap a React state
 * update around this so the tree re-renders with the new variant.
 *
 * <p>Used by {@code VariantSwitcher}; not normally called from
 * production paths.
 */
export function setVariantInUrl(variant: LayoutVariant): void {
  const url = new URL(window.location.href);
  if (variant === DEFAULT_VARIANT) {
    url.searchParams.delete(VARIANT_PARAM);
  } else {
    url.searchParams.set(VARIANT_PARAM, variant);
  }
  window.history.replaceState({}, '', url.toString());
}
