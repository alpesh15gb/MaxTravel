"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import UniversalSearch from "./UniversalSearch";
import Icon, { type IconName } from "./Icon";
import { Field } from "./ui";
import Modal from "./Modal";
import DensityControl from "./DensityControl";
import Brand from "./Brand";
export interface ShellUser { name: string; roleName: string; branchName: string | null; employeeCode: string; permissions: string[]; }
const NAV: { href: string; label: string; icon: IconName; perm: string; group: string }[] = [
  { href:"/dashboard",label:"Today",icon:"dashboard",perm:"dashboard:view",group:"Daily work" },
  { href:"/sales",label:"Enquiries & quotes",icon:"customers",perm:"customer:view",group:"Sales" },
  { href:"/customers",label:"Customers",icon:"customers",perm:"customer:view",group:"Sales" },
  { href:"/tasks",label:"Tasks & follow-ups",icon:"tasks",perm:"task:view",group:"Sales" },
  { href:"/visa",label:"Visa cases",icon:"visa",perm:"visa:view",group:"Travel desk" },
  { href:"/ticketing",label:"Ticketing",icon:"plane",perm:"ticketing:view",group:"Travel desk" },
  { href:"/online-bookings",label:"Online bookings",icon:"plane",perm:"ticketing:view",group:"Travel desk" },
  { href:"/documents",label:"Documents",icon:"documents",perm:"document:view",group:"Travel desk" },
  { href:"/payments",label:"Money & invoices",icon:"wallet",perm:"payment:view",group:"Finance" },
  { href:"/advances",label:"Customer advances",icon:"wallet",perm:"payment:view",group:"Finance" },
  { href:"/reports",label:"Reports & insights",icon:"dashboard",perm:"payment:view",group:"Finance" },
  { href:"/refunds",label:"Refunds",icon:"refund",perm:"refund:view",group:"Finance" },
  { href:"/suppliers",label:"Suppliers",icon:"suppliers",perm:"supplier:view",group:"Finance" },
  { href:"/incoming-documents",label:"Incoming documents",icon:"documents",perm:"whatsapp:view",group:"Travel desk" },
  { href:"/whatsapp",label:"WhatsApp desk",icon:"message",perm:"whatsapp:view",group:"Travel desk" },
  { href:"/employees",label:"Team",icon:"customers",perm:"employee:view",group:"Administration" },
  { href:"/customer-tools",label:"Customer import",icon:"customers",perm:"customer:create",group:"Administration" },
  { href:"/checklists",label:"Visa checklists",icon:"check",perm:"checklist:view",group:"Administration" },
  { href:"/audit",label:"Audit trail",icon:"audit",perm:"audit:view",group:"Administration" },
  { href:"/travel-packages",label:"Travel packages",icon:"compass",perm:"settings:manage",group:"Catalogue" },
  { href:"/settings",label:"Agency settings",icon:"settings",perm:"settings:manage",group:"Administration" },
];
const QUICK: { href: string; label: string; icon: IconName; perm: string }[] = [
  { href:"/visa/new",label:"New visa case",icon:"visa",perm:"visa:create" },
  { href:"/ticketing/new",label:"New booking",icon:"plane",perm:"ticketing:create" },
  { href:"/sales",label:"Enquiries & quotes",icon:"customers",perm:"customer:view" },
  { href:"/customers",label:"Find a customer",icon:"customers",perm:"customer:view" },
  { href:"/tasks",label:"Add a follow-up task",icon:"tasks",perm:"task:create" },
];
function initials(name: string) { return name.split(" ").filter(Boolean).map(n => n[0]).slice(0, 2).join("").toUpperCase(); }
function useDismiss(ref: React.RefObject<HTMLDivElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, ref, close]);
}
export default function Shell({ user, agencyName, children }: { user: ShellUser; agencyName: string; children: React.ReactNode }) {
  const path = usePathname(); const router = useRouter();
  const [mobile, setMobile] = useState(false); const [pwOpen, setPwOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false); const [userOpen, setUserOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => {
    const active = NAV.find(n => path === n.href || path.startsWith(n.href + "/"))?.group;
    return [...new Set(NAV.map(n => n.group))].filter(group => group !== "Daily work" && group !== "Sales" && group !== active);
  });
  useEffect(() => {
    const currentGroup = NAV.find(n => path === n.href || path.startsWith(n.href + "/"))?.group;
    if (currentGroup) setCollapsedGroups(previous => previous.filter(group => group !== currentGroup));
  }, [path]);
  const [count, setCount] = useState(0); const [error, setError] = useState("");
  const drawerRef = useRef<HTMLElement>(null); const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const quickRef = useRef<HTMLDivElement>(null); const userRef = useRef<HTMLDivElement>(null);
  const closeQuick = () => setQuickOpen(false); const closeUser = () => setUserOpen(false);
  useDismiss(quickRef, quickOpen, closeQuick); useDismiss(userRef, userOpen, closeUser);
  useEffect(() => { let alive = true; const refresh = () => { fetch("/api/notifications").then(r => r.ok ? r.json() : null).then(d => { if (alive && d?.notifications) setCount(d.notifications.filter((n: { read: boolean }) => !n.read).length); }).catch(() => { if(alive)setCount(0); }); }; refresh(); window.addEventListener("notifications:changed", refresh); return () => { alive = false; window.removeEventListener("notifications:changed", refresh); }; }, [path]);
  useEffect(() => {
    if (!mobile && !pwOpen && !quickOpen && !userOpen) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setMobile(false); setPwOpen(false); setQuickOpen(false); setUserOpen(false); } };
    document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc);
  }, [mobile, pwOpen, quickOpen, userOpen]);
  useEffect(() => {
    if (!mobile) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const menuTrigger = menuTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = [document.querySelector(".app-header"), document.getElementById("workspace-content")?.parentElement].filter((el): el is HTMLElement => el instanceof HTMLElement);
    background.forEach(el => { el.inert = true; });
    const stops = () => [...drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter(el => el.getClientRects().length > 0);
    stops()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = stops(); const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const resize = () => { if (desktop.matches) setMobile(false); };
    document.addEventListener("keydown", trap); desktop.addEventListener("change", resize);
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach(el => { el.inert = false; });
      document.removeEventListener("keydown", trap); desktop.removeEventListener("change", resize);
      menuTrigger?.focus();
    };
  }, [mobile]);
  async function logout() { try { const r = await fetch("/api/auth/logout", { method: "POST" }); if (!r.ok) throw new Error(); router.push("/login"); router.refresh(); } catch { setError("Could not sign out. Please try again."); } }
  const nav = NAV.filter(n => user.permissions.includes(n.perm));
  const quick = QUICK.filter(q => user.permissions.includes(q.perm));
  const activeModule = nav.find(n => path === n.href || path.startsWith(n.href + "/"));
  const groups = ["Daily work", "Sales", "Travel desk", "Finance", "Catalogue", "Administration"].filter(group => nav.some(n => n.group === group));
  return <div className="operations-studio flex min-h-screen flex-col">
    <a href="#workspace-content" className="skip-link">Skip to workspace</a>
    {mobile && <button aria-label="Close navigation" className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm lg:hidden" onClick={() => setMobile(false)} />}
    <header className="app-header no-print gap-2 sm:gap-3">
      <button ref={menuTriggerRef} className="icon-button lg:hidden" aria-controls="workspace-navigation" aria-label="Open navigation" aria-expanded={mobile} onClick={() => setMobile(true)}><Icon name="menu" /></button>
      <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5 pr-2 lg:hidden">
        <Brand compact />
      </Link>
      <div className="workspace-context hidden xl:flex"><span>{activeModule?.group ?? "Workspace"}</span><Icon name="arrow" size={13}/><strong>{activeModule?.label ?? "Your workspace"}</strong></div>
      <div className="min-w-0 flex-1 justify-center sm:px-2 flex">{user.permissions.includes("search:use") && <UniversalSearch />}</div>
      <div className="ml-auto flex items-center gap-2">
        {quick.length > 0 && <div ref={quickRef} className="relative hidden sm:block">
          <button className="btn-quick rounded-lg" aria-haspopup="menu" aria-expanded={quickOpen} onClick={() => setQuickOpen(o => !o)}><Icon name="sparkles" size={16} />Quick actions<Icon name="chevronDown" size={14} /></button>
          {quickOpen && <div role="menu" className="menu-panel">{quick.map(q => <Link key={q.href} role="menuitem" href={q.href} onClick={closeQuick} className="menu-item"><Icon name={q.icon} size={16} className="text-teal-600" />{q.label}</Link>)}</div>}
        </div>}
        <Link href="/notifications" className="icon-button" aria-label={`Notifications${count ? `, ${count} unread` : ""}`}><Icon name="bell" />{count > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-micro font-semibold tracking-normal text-white">{count}</span>}</Link>
        <div ref={userRef} className="relative">
          <button className="flex h-10 items-center gap-2.5 rounded-lg px-2 text-left transition hover:bg-slate-50" aria-haspopup="menu" aria-expanded={userOpen} aria-label="Account menu" onClick={() => setUserOpen(o => !o)}>
            <span className="avatar h-8 w-8 bg-teal-600">{initials(user.name)}</span>
            <span className="hidden min-w-0 md:block"><span className="block max-w-[140px] truncate text-xs font-medium text-slate-700">{user.name}</span></span>
            <Icon name="chevronDown" size={14} className="hidden text-slate-400 sm:block" />
          </button>
          {userOpen && <div role="menu" className="menu-panel w-64">
            <div className="border-b border-slate-100 px-3.5 pb-3 pt-2"><div className="truncate text-sm font-semibold">{user.name}</div><div className="truncate text-xs text-slate-500">{user.roleName} · {user.branchName ?? "All branches"}</div><div className="mt-1 text-small text-slate-500">{agencyName}</div></div>
            {/* Density lives in the account menu rather than a module toolbar: it applies to every
                screen, and this is the one control reachable from all of them at every width. */}
            <DensityControl mode="menu" />
            <Link role="menuitem" className="menu-item" href="/account-security" onClick={()=>setUserOpen(false)}>Account security</Link>
            <button role="menuitem" className="menu-item" onClick={() => { setUserOpen(false); setPwOpen(true); }}><Icon name="shield" size={16} className="text-slate-500" />Change password</button>
            <button role="menuitem" className="menu-item text-rose-700" onClick={() => { setUserOpen(false); logout(); }}><Icon name="logout" size={16} />Sign out</button>
          </div>}
        </div>
      </div>
    </header>
    <div className="workspace-shell-body flex min-h-0 flex-1">
      <aside ref={drawerRef} id="workspace-navigation" role={mobile ? "dialog" : undefined} aria-modal={mobile ? true : undefined} aria-label="Workspace navigation" data-drawer={mobile ? "open" : "closed"} className={`app-sidebar no-print ${mobile ? "translate-x-0 top-0" : "-translate-x-full"}`}>
        <div className="studio-brand-row"><Link href="/dashboard" aria-label="Max Travel Today" onClick={() => setMobile(false)}><Brand compact /></Link><button className="icon-button lg:hidden" aria-label="Close navigation" onClick={() => setMobile(false)}><Icon name="close" /></button></div>
        <div className="studio-workspace-label"><span className="studio-agency-monogram" aria-hidden="true">{initials(agencyName)}</span><span><strong title={agencyName}>{agencyName}</strong><small>Travel clearly · CRM</small></span></div>
        <nav aria-label="Main navigation" className="tos-scroll flex-1 overflow-y-auto px-3 pb-5 pt-1">
          {groups.map(group => {
            const expanded = !collapsedGroups.includes(group);
            const id = `navigation-${group.replaceAll(" ", "-").toLowerCase()}`;
            return <section key={group} className="studio-nav-group"><button className="nav-section" aria-expanded={expanded} aria-controls={id} onClick={() => setCollapsedGroups(previous => expanded ? [...previous, group] : previous.filter(value => value !== group))}>{group}<Icon name={expanded ? "chevronDown" : "arrow"} size={13}/></button>
              <div id={id} hidden={!expanded}>{nav.filter(n => n.group === group).map(n => {
                const active = path === n.href || path.startsWith(n.href + "/");
                return <Link key={n.href} onClick={() => setMobile(false)} href={n.href} aria-current={active ? "page" : undefined} className={`nav-link ${active ? "active" : ""}`}><Icon name={n.icon} size={18}/><span>{n.label}</span>{active && <span className="studio-active-dot" aria-hidden="true"/>}</Link>;
              })}</div>
            </section>;
          })}
        </nav>
        <div className="studio-rail-footer">
          <div className="truncate text-xs font-semibold" title={agencyName}>{agencyName}</div>
          <div className="mt-1 flex items-center gap-1.5 text-small"><Icon name="customers" size={13}/>{user.branchName ?? "All branches"}</div>
          {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
        </div>
      </aside>
      <div className="workspace-main-shell flex min-w-0 flex-1 flex-col">
        <main id="workspace-content" tabIndex={-1} className="min-w-0 flex-1">{children}</main>
        <footer className="no-print flex justify-between gap-3 border-t border-slate-200 px-6 py-3 text-small text-slate-600"><span>{agencyName} · Private agency workspace</span><span>Max Travel CRM</span></footer>
      </div>
    </div>
    {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
  </div>;
}
function ChangePassword({onClose}:{onClose:()=>void}) {
  const [current,setCurrent]=useState(""); const [next,setNext]=useState(""); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{const r=await fetch("/api/auth/change-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({currentPassword:current,newPassword:next})});const d=await r.json();if(!r.ok){setError(d.error??"Unable to change password.");return;}await fetch("/api/auth/logout",{method:"POST"});location.assign("/login");}catch{setError("Connection failed. Please try again.");}finally{setBusy(false);}}
  return <Modal labelledBy="password-title" onClose={onClose} width="max-w-md" busy={busy}><form onSubmit={submit} className="space-y-5"><div className="flex justify-between"><h2 id="password-title" className="text-xl font-semibold">Change password</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close"/></button></div><Field label="Current password"><input autoFocus type="password" autoComplete="current-password" value={current} onChange={e=>setCurrent(e.target.value)} required/></Field><Field label="New password" hint="At least 12 characters, with a letter and a number or symbol."><input type="password" minLength={12} maxLength={72} autoComplete="new-password" value={next} onChange={e=>setNext(e.target.value)} required/></Field>{error&&<div role="alert" className="form-error">{error}</div>}<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy?"Saving…":"Change & sign out"}</button></div></form></Modal>;
}
