"use client";
import { useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "./Icon";

export default function WorkRefresh() {
  const router = useRouter(),
    [pending, startTransition] = useTransition();
  const refresh = useCallback(
    () => startTransition(() => router.refresh()),
    [router],
  );
  useEffect(() => {
    const onFocus = () => {
      if (!document.hidden) refresh();
    };
    const timer = setInterval(onFocus, 60000);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  return (
    <button className="btn-secondary" disabled={pending} onClick={refresh}>
      <Icon name="refresh" size={16} />
      {pending ? "Refreshing…" : "Refresh workspace"}
    </button>
  );
}
