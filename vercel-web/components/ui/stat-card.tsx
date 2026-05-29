import type { ReactNode } from "react";

/**
 * KPI card used on the dashboard and other summary panels.
 *
 * - `label`   — required heading text.
 * - `value`   — required headline figure (number, formatted string, or "—").
 * - `detail`  — optional secondary line under the value.
 * - `tooltip` — optional explanatory string surfaced via the native
 *               `title` attribute. M3-H4 introduced this so the
 *               "Profit / Loss" card can document its formula without
 *               adding a new design-system component. Screen readers
 *               read the `title` attribute as accessible text.
 * - `loading` — optional boolean. When `true`, the value cell renders a
 *               subtle placeholder and the card sets `aria-busy` so
 *               assistive tech announces "loading". M3-C1.
 */
export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tooltip?: string;
  loading?: boolean;
}

export function StatCard({ label, value, detail, tooltip, loading }: StatCardProps) {
  return (
    <div
      className="panel card"
      title={tooltip || undefined}
      aria-busy={loading ? "true" : undefined}
    >
      <h3>{label}</h3>
      <strong>
        {loading ? (
          <span
            // Subtle dim placeholder — no animation dependency to add to
            // global CSS. Replace with a true skeleton block when the
            // design system grows one.
            style={{ opacity: 0.45, letterSpacing: "0.1em" }}
            aria-hidden="true"
          >
            ·····
          </span>
        ) : (
          value
        )}
      </strong>
      {detail ? <div className="mini-muted">{detail}</div> : null}
    </div>
  );
}
