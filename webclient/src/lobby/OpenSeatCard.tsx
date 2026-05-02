/**
 * Slice L1 — empty seat placeholder. Slice L4 wires the click to
 * open the invite/AI menu.
 */
export function OpenSeatCard() {
  return (
    <div
      data-testid="open-seat-card"
      className="relative flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-card-frame-default/80 p-4 text-center"
      style={{ background: 'rgba(21, 34, 41, 0.45)', minHeight: 460 }}
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed"
        style={{
          borderColor: 'var(--color-accent-primary)',
          color: 'var(--color-accent-primary)',
        }}
      >
        <PlusIcon />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-text-primary">Open Seat</p>
        <p className="px-2 text-xs leading-relaxed text-text-secondary">
          Invite a friend or wait for another player
        </p>
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
