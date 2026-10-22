"use client";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { createSalesDraftMemory, QUOTE_DRAFT_TTL, type SalesDraftMemory } from "@/lib/sales-draft-memory";

const DraftContext = createContext<SalesDraftMemory | null>(null);
const emptySnapshot = () => null;
export function SalesDraftProvider({ context, children }: { context: string; children: React.ReactNode }) {
  const memory = useRef<SalesDraftMemory | null>(null);
  if (!memory.current) memory.current = createSalesDraftMemory(context);
  const store = memory.current;
  const entry = useSyncExternalStore(store.subscribe, store.getSnapshot, emptySnapshot);
  useEffect(() => {
    const clear = () => store.clear();
    const expire = () => store.expire();
    window.addEventListener("pagehide", clear);
    document.addEventListener("visibilitychange", expire);
    return () => { window.removeEventListener("pagehide", clear); document.removeEventListener("visibilitychange", expire); store.clear(); };
  }, [store]);
  useEffect(() => {
    if (!entry?.fields) return;
    const timer = window.setTimeout(() => store.expire(), Math.max(0, entry.updatedAt + QUOTE_DRAFT_TTL - Date.now()));
    return () => window.clearTimeout(timer);
  }, [entry, store]);
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>;
}
export function useSalesDraftMemory() {
  const store = useContext(DraftContext);
  if (!store) throw new Error("Sales draft memory requires the authenticated workspace.");
  return store;
}
export function useSalesDraftEntry() {
  const store = useSalesDraftMemory();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, emptySnapshot);
}
