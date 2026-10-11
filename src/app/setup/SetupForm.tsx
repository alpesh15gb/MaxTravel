"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { Field } from "@/components/ui";

export default function SetupForm() {
  const [form, setForm] = useState({ agencyName: "", city: "", name: "", email: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const res = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? (res.status >= 500 ? "The workspace could not be created right now. Your information is still here—try again in a moment." : "Could not create your workspace.")); return; }
      location.assign("/login?created=1");
    } catch { setError("Unable to connect. Your information is still here—please try again."); }
    finally { setBusy(false); }
  }
  return <div className="auth-form-wrap"><h2>Set up your agency</h2><p className="auth-description">Create the agency and its first owner account.</p><form onSubmit={submit} className="auth-form"><div className="form-section-label">01 / Agency details</div><div className="form-grid"><Field label="Agency name"><input autoComplete="organization" maxLength={120} value={form.agencyName} onChange={e => update("agencyName", e.target.value)} required placeholder="Your agency name" /></Field><Field label="Head-office city"><input maxLength={120} value={form.city} onChange={e => update("city", e.target.value)} required placeholder="City" /></Field></div><div className="form-section-label">02 / Owner account</div><Field label="Full name"><input autoComplete="name" maxLength={120} value={form.name} onChange={e => update("name", e.target.value)} required placeholder="Your full name" /></Field><div className="form-grid"><Field label="Work email"><input type="email" autoComplete="email" value={form.email} onChange={e => update("email", e.target.value)} required placeholder="you@agency.com" /></Field><Field label="Phone (optional)"><input type="tel" autoComplete="tel" value={form.phone} onChange={e => update("phone", e.target.value)} placeholder="Phone number" /></Field></div><Field label="Create password" hint="At least 12 characters, including a letter and a number or symbol."><input type="password" minLength={12} maxLength={72} autoComplete="new-password" value={form.password} onChange={e => update("password", e.target.value)} required placeholder="Choose a strong password" /></Field>{error && <div role="alert" className="form-error">{error}</div>}<button className="btn-primary auth-submit" disabled={busy}>{busy ? "Creating your workspace…" : "Create my workspace"}<Icon name="arrow" size={18} /></button><p className="field-hint">The owner can add employees, configure checklists and manage permissions after signing in.</p></form></div>;
}
