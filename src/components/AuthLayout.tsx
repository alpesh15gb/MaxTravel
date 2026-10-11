import type { ReactNode } from "react";
import Icon from "./Icon";
import Brand from "./Brand";

/**
 * The panel beside the sign-in form. It states what the system holds and who can see it,
 * rather than advertising. Someone arriving here is at work, not being sold to.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-layout"><section className="auth-story"><div className="auth-brand"><Brand /></div><div className="auth-story-content"><span className="auth-kicker">THE AGENCY WORKSPACE</span><h1>The operations<br />record for your<br /><span>agency.</span></h1><p>Enquiries, travellers, bookings, visa files, documents and payments — one record per customer, with an audit trail behind every change.</p><div className="journey-art" aria-hidden="true"><svg viewBox="0 0 480 150"><path d="M20 100C110-35 180 160 270 65S385 20 455 55" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 8" /><circle cx="20" cy="100" r="5" fill="currentColor" /><circle cx="270" cy="65" r="5" fill="currentColor" /><circle cx="455" cy="55" r="5" fill="currentColor" /></svg><span><Icon name="plane" size={28} /></span></div><div className="auth-pill-row"><span><Icon name="customers" size={16} />Customer records</span><span><Icon name="shield" size={16} />Visa &amp; documents</span><span><Icon name="wallet" size={16} />Bookings &amp; payments</span></div></div><div className="auth-story-footer">Private to your agency. Every change is logged.</div></section><section className="auth-form-side"><div className="mb-8 lg:hidden"><Brand /></div>{children}</section></main>;
}
