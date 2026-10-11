import type { HTMLAttributes, ReactNode } from "react";

/**
 * A board column: a labelled region with its count. Every card board in the app uses this, so a
 * column looks and collapses the same whether it shows visa cases or customers. An empty column
 * keeps its header (still a labelled drop target) and drops its body; the CSS does the collapsing.
 */
export function BoardColumn({
  title, description, step, dot, count, countLabel, empty = false, drop = null, className = "", children, ...rest
}: HTMLAttributes<HTMLElement> & {
  title: string;
  description?: string;
  step?: number;
  dot: string;
  count: number;
  countLabel: string;
  empty?: boolean;
  drop?: "ok" | "blocked" | null;
  children: ReactNode;
}) {
  const state = drop === "ok" ? "drop-ok" : drop === "blocked" ? "drop-blocked" : "";
  return (
    <section aria-label={title} data-empty={empty} className={`board-column h-full ${state} ${className}`} {...rest}>
      <div className="board-column-head">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-800">{step && <span className="board-step">{step}</span>}{title}</h2>
        </div>
        <span className="board-count" aria-label={countLabel}>{count}</span>
      </div>
      {description && <p className="board-column-description">{description}</p>}
      <div className="board-column-body flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">{children}</div>
    </section>
  );
}

/** The card shell. Dragging state and the in-flight state are explicit props, not class strings the caller builds. */
export function BoardCard({
  busy = false, dragging = false, className = "", children, ...rest
}: HTMLAttributes<HTMLElement> & { busy?: boolean; dragging?: boolean; children: ReactNode }) {
  return (
    <article aria-busy={busy} className={`board-card ${dragging ? "dragging" : ""} ${className}`} {...rest}>
      {children}
    </article>
  );
}

/**
 * Documents verified as a labelled bar plus text. The text carries the number, so the bar is never
 * the only signal of progress.
 */
export function DocumentMeter({ ready, total }: { ready: number; total: number }) {
  if (total === 0) return <p className="text-small text-slate-500">No documents requested</p>;
  const complete = ready === total;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-small text-slate-600">
        <span>Documents</span>
        <span className="font-medium tabular-nums text-slate-700">{ready} of {total} verified</span>
      </div>
      <div
        role="progressbar"
        aria-label="Documents verified"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={ready}
        aria-valuetext={`${ready} of ${total} verified`}
        className="doc-meter"
      >
        <span className={complete ? "bg-emerald-500" : "bg-amber-500"} style={{ width: `${Math.round((ready / total) * 100)}%` }} />
      </div>
    </div>
  );
}
