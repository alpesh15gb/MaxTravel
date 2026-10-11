"use client";

import { inrAmount } from "@/lib/money";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader, EmptyState, Field, SearchInput, Status } from "@/components/ui";
import Modal from "@/components/Modal";
import { useToast } from "@/lib/useToast";

type E = {
  id: string; employeeCode: string; name: string; email: string; phone: string;
  roleId: string; role: string; roleKey: string; branchId: string | null; branch: string;
  active: boolean; joinedOn: string | null;
  salary: number | null; bankAccount: string | null; hrVisible: boolean;
  workload: { tasks: number; visaCases: number; bookings: number };
};

const money = (n: number | null) => (n == null ? "—" : inrAmount(Math.round(n)));

export default function EmployeesClient({ employees, roles, branches, canManage, canResetPassword }: {
  employees: E[]; roles: { id: string; name: string }[]; branches: { id: string; name: string }[]; canManage: boolean; canResetPassword: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; emp: E } | null>(null);
  const { show, toast } = useToast();
  const showHr = employees.some((e) => e.hrVisible);

  const filtered = employees.filter((e) =>
    !q || [e.name, e.email, e.employeeCode, e.role].some((v) => v.toLowerCase().includes(q.toLowerCase()))
  );

  async function toggleActive(e: E) {
    try {
      const r = await fetch("/api/employees", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e.id, active: !e.active }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        show(e.active ? "Employee deactivated" : "Employee activated");
        router.refresh();
      } else {
        show(d.error ?? "Could not update this employee. Nothing was changed.", "error");
      }
    } catch {      show("Connection failed. Nothing was changed — please try again.", "error");
    }
  }

  return (
    <div className="workspace-page">
      <PageHeader
        title="Your team"
        description="Roles, access and current workloads. Salary and bank details are permission-restricted."
        actions={canManage ? <button onClick={() => setModal({ mode: "create" })} className="btn-primary">+ New employee</button> : undefined}
      />

      <div className="panel mb-5 flex flex-wrap items-center gap-3 p-3">
        <p className="px-2 text-sm text-slate-500">
          {employees.length} staff members
          {showHr ? " · HR fields visible to your role" : " · salary/bank hidden for your role"}
        </p>
        <SearchInput label="Filter team" placeholder="Name, email, code or role…" value={q} onChange={setQ} className="ml-auto" />
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr>
              <th className="px-4">Employee</th>
              <th className="px-4">Role</th>
              <th className="px-4">Branch</th>
              <th className="px-4">Contact</th>
              <th className="px-4 text-center">Tasks</th>
              <th className="px-4 text-center">Cases</th>
              <th className="px-4 text-center">Bookings</th>
              {showHr && <th className="px-4 text-right">Salary</th>}
              {showHr && <th className="px-4">Bank</th>}
              <th className="px-4">Status</th>
              {canManage && <th className="px-4 text-right">Manage</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-t border-slate-200">
                <td className="px-4">
                  <Link href={`/employees/${e.id}`} className="font-semibold hover:text-teal-700">{e.name}</Link>
                  <div className="text-xs text-slate-500">{e.employeeCode}</div>
                </td>
                <td className="px-4 text-xs text-slate-700">{e.role}</td>
                <td className="px-4 text-xs text-slate-500">{e.branch}</td>
                <td className="px-4 text-xs text-slate-500">{e.phone}<div>{e.email}</div></td>
                <td className="px-4 text-center text-xs tabular-nums">{e.workload.tasks}</td>
                <td className="px-4 text-center text-xs tabular-nums">{e.workload.visaCases}</td>
                <td className="px-4 text-center text-xs tabular-nums">{e.workload.bookings}</td>
                {showHr && <td className="px-4 text-right text-xs tabular-nums">{e.hrVisible ? money(e.salary) : "•••"}</td>}
                {showHr && <td className="px-4 font-mono text-xs text-slate-500">{e.hrVisible ? (e.bankAccount ?? "—") : "••••"}</td>}
                <td className="px-4">
                  <Status tone={e.active ? "success" : "neutral"}>{e.active ? "Active" : "Inactive"}</Status>
                </td>
                {canManage && (
                  <td className="whitespace-nowrap px-4 text-right">
                    <button onClick={() => setModal({ mode: "edit", emp: e })} className="mr-3 text-xs font-semibold text-teal-700 hover:underline">Edit</button>
                    <button onClick={() => toggleActive(e)} className="text-xs text-slate-500 hover:text-slate-900">{e.active ? "Deactivate" : "Activate"}</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && <div className="mt-5"><EmptyState icon="customers" title="No matching team members" description="Try another name, email or role." /></div>}
      {modal && <EmployeeForm modal={modal} roles={roles} branches={branches} hrVisible={showHr} canResetPassword={canResetPassword} onClose={() => setModal(null)} />}
      {toast}
    </div>
  );
}

function EmployeeForm({ modal, roles, branches, hrVisible, canResetPassword, onClose }: {
  modal: { mode: "create" } | { mode: "edit"; emp: E };
  roles: { id: string; name: string }[]; branches: { id: string; name: string }[]; hrVisible: boolean; canResetPassword: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const emp = modal.mode === "edit" ? modal.emp : null;
  const [form, setForm] = useState({
    name: emp?.name ?? "", email: emp?.email ?? "", phone: emp?.phone ?? "",
    roleId: emp?.roleId ?? "", branchId: emp?.branchId ?? "",
    password: "", salary: emp?.salary?.toString() ?? "", bankAccount: emp?.bankAccount ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = emp
      ? { id: emp.id, name: form.name, email: form.email, phone: form.phone, roleId: form.roleId, branchId: form.branchId || null, salary: form.salary || null, bankAccount: form.bankAccount || null, ...(form.password ? { password: form.password } : {}) }
      : form;
    try {
      const r = await fetch("/api/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { onClose(); router.refresh(); }
      else setErr(d.error ?? "Could not save this employee. Your changes are still here.");
    } catch {
      setErr("Connection failed. Nothing was saved — please try again.");
    } finally { setBusy(false); }
  }

  return (
    <Modal label={emp ? `Edit ${emp.name}` : "New employee"} onClose={onClose} width="max-w-md" busy={busy}>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-semibold">{emp ? `Edit ${emp.name}` : "New employee"}</h2>
        {emp && <p className="-mt-2 text-xs text-slate-500">{emp.employeeCode}</p>}
        <Field label="Full name *"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Email *"><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <div className="form-grid">
          <Field label="Role *">
            <select required value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="">Choose a role</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Branch">
            <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
              <option value="">No branch</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        {!emp && (
          <Field label="Initial password *" hint="At least 12 characters.">
            <input type="password" minLength={12} maxLength={72} autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        )}
        {emp && canResetPassword && (
          <Field label="Reset password" hint="Leave blank to keep the current password.">
            <input type="password" minLength={12} maxLength={72} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        )}
        {emp && !canResetPassword && (
          <p className="text-xs leading-6 text-slate-500">
            Profile details only. Changing another person&rsquo;s password is an owner or super administrator task — ask
            one of them, or use your own change-password screen for your own account.
          </p>
        )}
        {hrVisible && (
          <div className="form-grid">
            <Field label="Annual salary (INR)"><input type="number" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} /></Field>
            <Field label="Bank account"><input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} /></Field>
          </div>
        )}
        {err && <div role="alert" className="form-error">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : emp ? "Save changes" : "Create employee"}</button>
        </div>
      </form>
    </Modal>
  );
}
