"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The one modal in the application.
 *
 * This wraps a native `<dialog>` rather than a `fixed inset-0` overlay div, because the platform
 * then provides the three things every hand-rolled overlay here was missing:
 *
 *   1. Escape closes it — previously keyboard users were stuck inside an open modal.
 *   2. Everything behind is inert and it renders in the top layer, so it cannot be clipped or
 *      painted over by page content — and it cannot be tabbed into behind the modal.
 *   3. A backdrop click is distinguishable from a click on the panel.
 *
 * Children supply their own `<form>`; the dialog is only the frame, the backdrop, the focus
 * contract and the dismissal rules.
 *
 * Two things the platform does NOT do here, and which the code below therefore owns:
 *
 *   - **Wrapping the Tab cycle.** Chromium keeps focus out of the inert page behind, but Tab from
 *     the last control lands on `<body>` before the next Tab re-enters the dialog. Measured with
 *     real key presses on the "New task" modal: stops 1-12 walked the form, stop 13 was `<body>`.
 *     A keyboard user sees the ring disappear and has no way to tell where they are, so `onKeyDown`
 *     wraps the cycle at both ends itself.
 *   - **Handing focus back on close.** React removes the `<dialog>` from the DOM when the parent
 *     clears its state, and a removed element cannot restore anything, so focus fell to `<body>`
 *     instead of returning to the button that opened the modal. The opener is captured during the
 *     first render (React has already run `autoFocus` inside the dialog by the time an effect
 *     runs, so reading it there would capture the modal's own field) and re-focused on unmount.
 */

/** Controls a user can Tab to. Disabled controls and hidden inputs are not stops. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function stopsIn(scope: HTMLElement) {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
  );
}

export default function Modal({
  label,
  labelledBy,
  onClose,
  children,
  width = "max-w-lg",
  busy = false,
}: {
  /** Accessible name, when the modal has no visible heading to point at. */
  label?: string;
  /** Id of the visible heading, preferred over `label` when there is one. */
  labelledBy?: string;
  onClose: () => void;
  children: ReactNode;
  /** Tailwind max-width class for the panel. */
  width?: string;
  /** While a save is in flight, neither Escape nor a backdrop click may discard the work. */
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (!el.open) el.showModal();
    return () => {
      // Closing first lets the platform run its own focus restore; the explicit focus below covers
      // the case where React has already detached the node by the time this cleanup runs, which is
      // the order React 18 actually uses for passive effects.
      if (el.open) el.close();
      const active = document.activeElement;
      const focusWasInside = !active || active === document.body || el.contains(active);
      if (focusWasInside && opener?.isConnected) opener.focus();
    };
  }, [opener]);

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        if (busy) {
          event.preventDefault();
          return;
        }
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const el = dialog.current;
        if (!el) return;
        const stops = stopsIn(el);
        if (!stops.length) return;
        const first = stops[0];
        const last = stops[stops.length - 1];
        const active = document.activeElement;
        // Wraps at both ends, and also pulls focus back in if it is somehow outside the dialog.
        const leavingForward = !event.shiftKey && (active === last || !el.contains(active));
        const leavingBackward = event.shiftKey && (active === first || !el.contains(active));
        if (!leavingForward && !leavingBackward) return;
        event.preventDefault();
        (leavingForward ? first : last).focus();
      }}
      onClick={(event) => {
        // The backdrop belongs to the dialog element itself, so a click that targets the dialog
        // (rather than its form) is a click outside the panel.
        if (event.target === dialog.current && !busy) onClose();
      }}
      className={`panel m-auto max-h-[90vh] w-[calc(100%-2rem)] ${width} overflow-y-auto p-6 backdrop:bg-slate-900/40 tos-scroll`}
    >
      {children}
    </dialog>
  );
}
