"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Toast, type ToastTone } from "@/components/ui";

/**
 * Transient confirmation state, in one place.
 *
 * Every module used to hand-roll `useState<string | null>` plus a bare `setTimeout` that was never
 * cancelled. Two consequences: a timer could fire after the component unmounted, and — worse —
 * a failure and a success rendered in the same teal-bordered panel, so a rejected action could be
 * mistaken for a saved one at a glance.
 *
 * Errors now look like errors, are announced assertively, and stay on screen long enough to read.
 */
export function useToast() {
  const [current, setCurrent] = useState<{ message: string; tone: ToastTone } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((message: string, tone: ToastTone = "success") => {
    clearTimeout(timer.current);
    setCurrent({ message, tone });
    // A failure needs longer to read than a confirmation, and must not vanish before it is seen.
    timer.current = setTimeout(() => setCurrent(null), tone === "error" ? 6000 : 3000);
  }, []);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setCurrent(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    show,
    dismiss,
    /** Render directly — `{toast}` — and it is null whenever there is nothing to say. */
    toast: current ? <Toast message={current.message} tone={current.tone} /> : null,
  };
}
