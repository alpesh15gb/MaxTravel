"use client";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { createPackageDraftMemory, PACKAGE_DRAFT_TTL, type PackageDraftMemory } from "@/lib/package-draft-memory";
const DraftContext = createContext<PackageDraftMemory | null>(null);
const emptySnapshot = () => null;
export function PackageDraftProvider({ context, children }: { context: string; children: React.ReactNode }) {
  const memory = useRef<PackageDraftMemory | null>(null);
  if (!memory.current) memory.current = createPackageDraftMemory(context);
  const store = memory.current;
  const entry = useSyncExternalStore(store.subscribe, store.getSnapshot, emptySnapshot);
  useEffect(() => {
    const leave = (event: PageTransitionEvent) => store.leaveDocument(event.persisted), expire = () => store.expire();
    window.addEventListener("pagehide", leave); document.addEventListener("visibilitychange", expire);
    return () => { window.removeEventListener("pagehide", leave); document.removeEventListener("visibilitychange", expire); store.clear(); };
  }, [store]);
  useEffect(() => {
    if (!entry?.fields) return;
    const timer = window.setTimeout(() => store.expire(), Math.max(0, entry.updatedAt + PACKAGE_DRAFT_TTL - Date.now()));
    return () => window.clearTimeout(timer);
  }, [entry, store]);
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>;
}
export function usePackageDraftMemory() {
  const store = useContext(DraftContext);
  if (!store) throw new Error("Package draft memory requires the authenticated workspace.");
  return store;
}
export function usePackageDraftEntry() {
  const store = usePackageDraftMemory();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, emptySnapshot);
}
