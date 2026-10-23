"use client";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { createSalesDraftMemory, QUOTE_DRAFT_TTL, type SalesDraftMemory } from "@/lib/sales-draft-memory";
import { createCustomerCreateMemory, type CustomerCreateMemory } from "@/lib/customer-create-memory";
import { createSalesActionMemory, type SalesActionMemory } from "@/lib/sales-action-memory";

const DraftContext = createContext<SalesDraftMemory | null>(null);
const CustomerCreateContext = createContext<CustomerCreateMemory | null>(null);
const SalesActionContext = createContext<SalesActionMemory | null>(null);
const emptySnapshot = () => null;
export function SalesDraftProvider({ context, children }: { context: string; children: React.ReactNode }) {
  const memory = useRef<SalesDraftMemory | null>(null);
  if (!memory.current) memory.current = createSalesDraftMemory(context);
  const store = memory.current;
  const customerMemory = useRef<CustomerCreateMemory | null>(null);
  if (!customerMemory.current) customerMemory.current = createCustomerCreateMemory(context);
  const customerStore = customerMemory.current;
  const actionMemory = useRef<SalesActionMemory | null>(null);
  if (!actionMemory.current) actionMemory.current = createSalesActionMemory(context);
  const actionStore = actionMemory.current;
  const entry = useSyncExternalStore(store.subscribe, store.getSnapshot, emptySnapshot);
  useEffect(() => {
    const clear = () => { store.clear(); customerStore.reset(); actionStore.reset(); };
    const hide = (event: PageTransitionEvent) => { store.clear(); customerStore.reset(); actionStore.pageHide(event.persisted); };
    const show = (event: PageTransitionEvent) => actionStore.pageShow(event.persisted);
    const expire = () => store.expire();
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    document.addEventListener("visibilitychange", expire);
    return () => { window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); document.removeEventListener("visibilitychange", expire); clear(); };
  }, [store, customerStore, actionStore]);
  useEffect(() => {
    if (!entry?.fields) return;
    const timer = window.setTimeout(() => store.expire(), Math.max(0, entry.updatedAt + QUOTE_DRAFT_TTL - Date.now()));
    return () => window.clearTimeout(timer);
  }, [entry, store]);
  return <DraftContext.Provider value={store}><CustomerCreateContext.Provider value={customerStore}><SalesActionContext.Provider value={actionStore}>{children}</SalesActionContext.Provider></CustomerCreateContext.Provider></DraftContext.Provider>;
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
export function useCustomerCreateMemory() {
  const store = useContext(CustomerCreateContext);
  if (!store) throw new Error("Customer creation memory requires the authenticated workspace.");
  return store;
}
export function useCustomerCreateEntry() {
  const store = useCustomerCreateMemory();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, emptySnapshot);
}

export function useSalesActionMemory() {
  const store = useContext(SalesActionContext);
  if (!store) throw new Error("Sales action memory requires the authenticated workspace.");
  return store;
}
export function useSalesActionEntry() {
  const store = useSalesActionMemory();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, emptySnapshot);
}
