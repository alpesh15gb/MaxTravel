"use client";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createWhatsAppComposerMemory, type WhatsAppComposerMemory } from "@/lib/whatsapp-composer-memory";
const Context = createContext<WhatsAppComposerMemory | null>(null);
const emptySnapshot = {};
export function WhatsAppComposerProvider({ context, children }: { context: string; children: React.ReactNode }) {
  const ref = useRef<WhatsAppComposerMemory | null>(null);
  if (!ref.current) ref.current = createWhatsAppComposerMemory(context);
  const store = ref.current;
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (store.hasUnfinished()) { event.preventDefault(); event.returnValue = ""; } };
    const hide = (event: PageTransitionEvent) => flushSync(() => store.leaveDocument(event.persisted));
    const expire = () => store.expire();
    const timer = window.setInterval(expire, 30_000);
    document.addEventListener("visibilitychange", expire);
    window.addEventListener("beforeunload", unload); window.addEventListener("pagehide", hide);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", expire); window.removeEventListener("beforeunload", unload); window.removeEventListener("pagehide", hide); store.clear(); };
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useWhatsAppComposerMemory() {
  const store = useContext(Context);
  if (!store) throw new Error("WhatsApp composer requires the authenticated workspace.");
  return store;
}
export function useWhatsAppComposer() {
  const store = useWhatsAppComposerMemory();
  useSyncExternalStore(store.subscribe, store.getSnapshot, () => emptySnapshot);
  return store;
}
