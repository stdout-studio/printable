/**
 * Kerf brand mark — the drop-point RETICLE: a precise crosshair-in-a-ring with
 * one quadrant lit in Flux. It ties the mark to the core interaction (place a
 * point, the machine measures from it) and reads as "instrument / measuring."
 *
 * v1 — a clean, geometric mark; the alternate "slotted-K" concept (the kerf cut
 * through square stock) is in context/design-brief.md to explore with visual QA.
 */
export function BrandMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" stroke="var(--fg)" strokeWidth="1.4" opacity="0.82" />
      <path
        d="M12 2.7 V8 M12 16 V21.3 M2.7 12 H8 M16 12 H21.3"
        stroke="var(--fg)"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.65"
      />
      {/* the lit quadrant + center — the only Flux in the mark */}
      <path
        d="M12 3.5 A8.5 8.5 0 0 1 20.5 12"
        stroke="var(--flux)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2" fill="var(--flux)" />
    </svg>
  );
}
