import { useEffect, type RefObject } from 'react';

/**
 * Shared modal accessibility wiring. Centralizes the four pieces of
 * keyboard / screen-reader plumbing every modal in the app needs:
 *
 * <ol>
 *   <li><b>Initial focus</b> — on mount, move focus into the modal
 *       (first focusable descendant by default), so keyboard users
 *       don't have to tab past every preceding element on the page
 *       before reaching the dialog's controls.</li>
 *   <li><b>Focus trap</b> — Tab cycles within the modal's focusable
 *       descendants (and Shift+Tab in reverse), preventing focus from
 *       escaping into the now-inert background page.</li>
 *   <li><b>ESC-to-close</b> — Escape invokes {@code onClose} when
 *       provided. Modals that are submission-only (e.g.
 *       sideboarding, terminal match-end) opt out by leaving
 *       {@code onClose} undefined.</li>
 *   <li><b>Restore focus</b> — on unmount, return focus to the
 *       element that held it before the modal opened (typically the
 *       button that triggered it). Falls back gracefully when the
 *       prior focus owner was the body or has been removed from the
 *       DOM.</li>
 * </ol>
 *
 * <p>The keydown listener uses {@code capture: true} +
 * {@code stopImmediatePropagation} on Escape — this preserves the
 * existing ZoneBrowser / concede-confirm convention and prevents
 * background hotkeys (ActionPanel) from firing when a modal is
 * dismissed. Tab handling is also capture-phase so cycling beats any
 * background Tab listeners (none today, but future-proof).
 *
 * @param ref Ref to the modal root. Focus trap and initial-focus
 *            queries scope to descendants of this element.
 * @param onClose Optional close callback for ESC. Submission-only
 *            modals omit this.
 * @param enabled Default {@code true}. Lets callers toggle the
 *            hook off (e.g. when the modal is rendered but visually
 *            disabled mid-submit, though no current call site uses
 *            this).
 */
export function useModalA11y(
  ref: RefObject<HTMLElement | null>,
  options: { onClose?: () => void; enabled?: boolean } = {},
): void {
  const { onClose, enabled = true } = options;

  // --- initial focus + restore on unmount -------------------------
  useEffect(() => {
    if (!enabled) return;
    const root = ref.current;
    if (!root) return;

    // Capture the previously-focused element BEFORE moving focus, so
    // unmount can restore it. May be null/body/etc. — handled below.
    const previouslyFocused =
      typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null;

    const focusables = collectFocusables(root);
    const initial = focusables[0] ?? root;
    // Some modals' root won't be intrinsically focusable (no
    // tabindex). Add a tabindex=-1 fallback so the focus call still
    // moves focus into the dialog (rather than staying outside) when
    // there are no focusable descendants — rare, but defensive.
    if (focusables.length === 0 && !root.hasAttribute('tabindex')) {
      root.setAttribute('tabindex', '-1');
    }
    initial.focus();

    return () => {
      // Restore. Skip when previousFocus is the body (i.e. nothing
      // was actively focused before) or when it's no longer in the
      // document (caller removed it). Both are safe no-ops; calling
      // .focus() on a detached node throws in some browsers.
      if (
        previouslyFocused &&
        previouslyFocused !== document.body &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
    // We intentionally ignore changes to onClose / enabled across
    // renders — this effect should run once on mount and once on
    // unmount, matching the modal's lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- keyboard: ESC + focus trap ---------------------------------
  useEffect(() => {
    if (!enabled) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (onClose) {
          ev.stopImmediatePropagation();
          ev.preventDefault();
          onClose();
        }
        return;
      }
      if (ev.key !== 'Tab') return;
      const root = ref.current;
      if (!root) return;
      const focusables = collectFocusables(root);
      if (focusables.length === 0) {
        // Nothing to cycle through — pin focus on the root itself.
        ev.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      // If focus has somehow escaped the modal entirely, snap it back.
      if (!active || !root.contains(active)) {
        ev.preventDefault();
        first.focus();
        return;
      }
      if (ev.shiftKey && active === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && active === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => {
      document.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [ref, onClose, enabled]);
}

/**
 * Collect tab-reachable descendants of {@code root}. Includes
 * standard form controls, links with hrefs, and any element with an
 * explicit non-negative tabindex. Filters out disabled controls and
 * elements with tabindex="-1" (which are programmatically focusable
 * but skipped by Tab).
 *
 * <p>Detached / hidden detection is intentionally light: this returns
 * the DOM order of matching elements. Tailwind {@code hidden} sets
 * {@code display: none} which removes the element from the
 * accessibility tree, but that's fine for current modals — none
 * conditionally render disabled focusables.
 */
function collectFocusables(root: HTMLElement): HTMLElement[] {
  const selector =
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]';
  const all = Array.from(root.querySelectorAll<HTMLElement>(selector));
  // Filter out elements explicitly hidden via `display: none` /
  // `visibility: hidden` / the HTML {@code hidden} attribute. We
  // can't rely on {@code offsetParent} (always null in jsdom; also
  // null for {@code position: fixed} children of inert ancestors),
  // so check the computed style directly. Falls back to "visible"
  // when getComputedStyle isn't available (some test envs).
  return all.filter((el) => {
    if (el.hasAttribute('hidden')) return false;
    if (typeof window === 'undefined' || !window.getComputedStyle) return true;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  });
}
