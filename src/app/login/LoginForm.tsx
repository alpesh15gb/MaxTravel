"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { Field } from "@/components/ui";

export default function LoginForm({ agencyName, created }: { agencyName: string; created: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await res.json().catch(() => ({}));
      // A gateway or proxy can answer with an HTML error page instead of our JSON. Say that the
      // workspace is unavailable rather than blaming the password we never actually checked.
      if (!res.ok) { setError(data.error ?? (res.status >= 500 ? "Your workspace is temporarily unavailable. Try again in a moment." : "Unable to sign in.")); return; }
      router.push("/dashboard"); router.refresh();
    } catch { setError("Could not connect to your workspace. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <div className="auth-form-wrap"><div className="eyebrow">{agencyName}</div><h2>Sign in</h2><p className="auth-description">Use the work email your agency set up for you.</p>{created && <div className="form-success mb-5" role="status">Your workspace is ready. Sign in with the owner account you just created.</div>}<form className="auth-form" onSubmit={submit}><Field label="Work email"><input type="email" autoComplete="username" placeholder="you@agency.com" value={email} onChange={e => setEmail(e.target.value)} required /></Field><Field label="Password"><input type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>{error && <div role="alert" className="form-error">{error}</div>}<button className="btn-primary auth-submit" disabled={busy}>{busy ? "Signing in…" : "Sign in to workspace"}<Icon name="arrow" size={18} /></button></form><p className="mt-6 text-xs leading-6 text-slate-500">Need access or a password reset? Contact your agency owner or administrator.</p></div>;
}
