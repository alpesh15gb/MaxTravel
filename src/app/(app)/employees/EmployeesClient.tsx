"use client";

import { inrAmount } from "@/lib/money";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader, EmptyState, Field, SearchInput, Status } from "@/components/ui";
import Modal from "@/components/Modal";
import { useToast } from "@/lib/useToast";
import { acknowledgeEmployeeAttempt, createEmployeeOperationGuard, employeeMatches, employeeOutcome, employeeRetryAllowed, isEmployeeRecord, type EmployeeAttempt, type EmployeeRecord } from "@/lib/employee-recovery";

type E = {
  revision: string;
  id: string; employeeCode: string; name: string; email: string; phone: string;
  roleId: string; role: string; roleKey: string; branchId: string | null; branch: string;
  active: boolean; joinedOn: string | null;
  salary: number | null; bankAccount: string | null; hrVisible: boolean;
  workload: { tasks: number; visaCases: number; bookings: number };
};

const money = (n: number | null) => (n == null ? "—" : inrAmount(Math.round(n)));

export default function EmployeesClient({ employees, roles, branches, canManage, canResetPassword, recoveryContext }: {
  recoveryContext: string; employees: E[]; roles: { id: string; name: string }[]; branches: { id: string; name: string }[]; canManage: boolean; canResetPassword: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; emp: E } | null>(null);
  const { show, toast } = useToast();
  const [rows, setRows] = useState(employees);
  const [action, setAction] = useState<StaffAction | null>(null);
  const actionRef = useRef<StaffAction | null>(null);
  const [guard] = useState(createEmployeeOperationGuard);
  const mounted = useRef(true);
  const [accessChanged, setAccessChanged] = useState(false);
  const snapshot = useRef(employees);
  snapshot.current = employees;
  const setOperation = (next: StaffAction | null) => { actionRef.current = next; setAction(next); };
  useEffect(() => {
    setRows(employees);
    guard.invalidate();
    if (actionRef.current) {
      const next: StaffAction = { ...actionRef.current, phase: "unknown", current: undefined, message: "The team list changed. Check the current record again before continuing." };
      actionRef.current = next; setAction(next);
    }
  }, [employees, guard]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; guard.invalidate(); }; }, [guard]);
  const showHr = rows.some((e) => e.hrVisible);
  const filtered = rows.filter((e) =>
    !q || [e.name, e.email, e.employeeCode, e.role].some((v) => v.toLowerCase().includes(q.toLowerCase()))
  );
  const blocked = !!action || accessChanged;
  function sessionChanged() {
    setAccessChanged(true); setModal(null); setOperation(null); guard.invalidate();
    // The keyed server page drops drafts at an authenticated actor/scope boundary.
    router.refresh();
  }
  function applyCurrent(attempt: EmployeeAttempt, current: EmployeeRecord | null) {
    if (!attempt.id) return; // Creation appears through the server page, never a guessed client row.
    setRows(previous => current ? previous.map(row => row.id === attempt.id ? { ...row, ...current } : row) : previous.filter(row => row.id !== attempt.id));
  }
  async function readCurrent(attempt: EmployeeAttempt) {
    const query = attempt.id ? `employeeId=${encodeURIComponent(attempt.id)}` : `email=${encodeURIComponent(attempt.email ?? "")}`;
    const response = await fetch(`/api/employees?${query}`, { cache: "no-store", signal: AbortSignal.timeout(30000), headers: { "X-Employee-Recovery-Context": recoveryContext } });
    const data = await response.json().catch(() => null);
    if ([401, 403, 409].includes(response.status) || (data?.recoveryContext && data.recoveryContext !== recoveryContext)) throw new StaffContextChanged();
    if (!response.ok || data?.recoveryContext !== recoveryContext || !(data.employee === null ||
        (isEmployeeRecord(data.employee) &&
        (attempt.id ? data.employee.id === attempt.id : data.employee.email === attempt.email)))) throw new Error("Current record could not be verified.");
    return data.employee as EmployeeRecord | null;
  }
  async function writeEmployee(body: Record<string, unknown>, attempt: EmployeeAttempt): Promise<string | null> {
    if (actionRef.current || accessChanged) return "Check the outstanding employee action before submitting another change.";
    const token = guard.begin(); if (token === null) return "An employee action is already in progress.";
    const source = snapshot.current;
    const current = () => mounted.current && guard.current(token) && snapshot.current === source;
    let recoveryAttempt = attempt;
    setOperation({ attempt, phase: "saving", message: "Saving employee…" });
    try {
      const response = await fetch("/api/employees", { method: "POST", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json", "X-Employee-Recovery-Context": recoveryContext }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => null);
      if (!current()) return "The team changed. Check the current record before continuing.";
      const outcome = employeeOutcome(response.status, data, recoveryContext, attempt.id);
      if (data?.code === "EMPLOYEE_CONTEXT_CHANGED" || response.status === 401 || (response.status === 403 && data?.recoveryContext !== recoveryContext)) { sessionChanged(); return "Staff session or access changed."; }
      if (outcome === "rejected" && response.status !== 409) {
        setOperation(null); return `Save rejected: ${data.error} Your typed changes are still here.`;
      }
      if (outcome === "acknowledged") {
        // Do not close a form or update a row from an acknowledgement belonging to an old actor.
        recoveryAttempt = acknowledgeEmployeeAttempt(attempt, data.employeeId);
        // Persist the stable identity before the read: a failed or superseded GET must not
        // downgrade a known creation into an email-only, potentially repeatable attempt.
        setOperation({ attempt: recoveryAttempt, phase: "saving", message: "Save acknowledged. Checking the current employee record…" });
        const record = await readCurrent(recoveryAttempt);
        if (!current()) return "The team changed. Check the current record before continuing.";
        applyCurrent(recoveryAttempt, record); setOperation(null); show("Employee saved"); router.refresh(); return null;
      }
      setOperation({ attempt, phase: "unknown", message: outcome === "rejected"
        ? `Save rejected: ${data.error} Check the current record before trying again.`
        : "Save outcome unknown. The server may have saved this change. Do not submit again until you check the current record." });
      return "Check the current record before trying again.";
    } catch (error) {
      if (!current()) return "The team changed. Check the current record before continuing.";
      if (error instanceof StaffContextChanged) { sessionChanged(); return "Staff session or access changed."; }
      setOperation({ attempt: recoveryAttempt, phase: "unknown", message: recoveryAttempt.acknowledgedId
        ? "Save was acknowledged, but its current record could not be checked. Do not submit it again. Your typed changes are still here; check the saved employee by its record ID."
        : "Save outcome unknown. The response could not be verified; the server may have saved this change. Your typed changes are still here. Check the current record before trying again." });
      return "Check the current record before trying again.";
    } finally { guard.finish(token); }
  }
  async function checkCurrent() {
    const previous = actionRef.current;
    if (!previous || !["unknown", "review"].includes(previous.phase)) return;
    const token = guard.begin(); if (token === null) return;
    const source = snapshot.current;
    const current = () => mounted.current && guard.current(token) && snapshot.current === source;
    setOperation({ ...previous, phase: "checking", current: undefined, message: "Checking the current employee record…" });
    try {
      const record = await readCurrent(previous.attempt);
      if (!current()) return;
      applyCurrent(previous.attempt, record);
      setOperation({ ...previous, phase: "review", current: record, message: employeeMatches(previous.attempt, record)
        ? "Current record matches the submitted profile/status. This confirms the current values, not which request saved them."
        : record ? "Current record differs from your submitted changes. Review it before choosing whether to save again."
        : previous.attempt.acknowledgedId ? "The saved employee is not visible in your current scope. Its save was acknowledged; do not create it again."
        : previous.attempt.id ? "This employee is no longer visible in your current scope. This does not prove that the earlier save failed. Check access before making further changes."
        : "No matching employee is visible in your current scope. This does not prove that the earlier save failed. Do not repeat employee creation based on this search; review the staff audit with an administrator." });
    } catch (error) {
      if (!current()) return;
      if (error instanceof StaffContextChanged) { sessionChanged(); return; }
      setOperation({ ...previous, phase: "unknown", current: undefined, message: previous.attempt.acknowledgedId
        ? "Save was acknowledged, but its current record could not be checked. Do not submit again. Retry the check when the connection is available."
        : "Current record could not be checked. Save outcome unknown; do not submit again. Retry the check when the connection is available." });
    } finally { guard.finish(token); }
  }
  function closeForm() {
    if (["saving", "checking"].includes(actionRef.current?.phase ?? "")) return;
    setModal(null);
  }
  function finishReview(refresh = true) { if (actionRef.current?.phase !== "review") return; setOperation(null); if (refresh) router.refresh(); }
  async function toggleActive(e: E) {
    const result = await writeEmployee({ id: e.id, active: !e.active, baseRevision: e.revision }, {
      id: e.id, name: e.name, passwordIncluded: false, desired: { active: !e.active },
    });
    if (result && !actionRef.current && !accessChanged) show(result, "error");
  }

  return (
    <div className="workspace-page">
      <PageHeader
        title="Your team"
        description="Roles, access and current workloads. Salary and bank details are permission-restricted."
        actions={canManage ? <button disabled={blocked} onClick={() => { if (!actionRef.current && !accessChanged) setModal({ mode: "create" }); }} className="btn-primary">+ New employee</button> : undefined}
      />

      {accessChanged && <p role="alert" className="form-error mb-5">Staff session or access changed. Reload the team page before continuing.</p>}
      {action && !modal && <div className="panel mb-5 p-4"><StaffRecovery action={action} checkCurrent={checkCurrent} />{action.phase === "review" && <button type="button" className="btn-secondary mt-3" onClick={() => finishReview()}>Done reviewing</button>}</div>}
      <div className="panel mb-5 flex flex-wrap items-center gap-3 p-3">
        <p className="px-2 text-sm text-slate-500">
          {rows.length} staff members
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
                    <button disabled={blocked} onClick={() => { if (!actionRef.current && !accessChanged) setModal({ mode: "edit", emp: e }); }} className="mr-3 text-xs font-semibold text-teal-700 hover:underline">Edit</button>
                    <button disabled={blocked} aria-busy={action?.attempt.id === e.id && action.phase === "saving"} onClick={() => toggleActive(e)} className="text-xs text-slate-500 hover:text-slate-900">{action?.attempt.id === e.id && action.phase === "saving" ? "Saving…" : e.active ? "Deactivate" : "Activate"}</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && <div className="mt-5"><EmptyState icon="customers" title="No matching team members" description="Try another name, email or role." /></div>}
      {modal && <EmployeeForm key={modal.mode === "edit" ? modal.emp.id : "create"} modal={modal} roles={roles} branches={branches} hrVisible={modal.mode === "edit" ? modal.emp.hrVisible : showHr} canResetPassword={canResetPassword} onClose={closeForm} action={action} checkCurrent={checkCurrent} writeEmployee={writeEmployee} finishReview={finishReview} />}
      {toast}
    </div>
  );
}

type StaffAction = { attempt: EmployeeAttempt; phase: "saving" | "unknown" | "checking" | "review"; message: string; current?: EmployeeRecord | null };
class StaffContextChanged extends Error {}
function StaffRecovery({ action, checkCurrent }: { action: StaffAction; checkCurrent: () => void }) {
  return <section aria-label="Employee save recovery" className="space-y-3 text-sm">
    <p role="alert">{action.message}</p>
    <p className="text-xs text-slate-500">Employee: {action.attempt.name}{action.attempt.email ? ` · ${action.attempt.email}` : ""}</p>
    {action.current && <div className="rounded-lg border p-3" aria-label="Current employee record">
      <p className="font-semibold">{action.current.name} · {action.current.employeeCode}</p>
      <p>{action.current.email} · {action.current.phone || "No phone"}</p>
      <p>{action.current.role} · {action.current.branch} · {action.current.active ? "Active" : "Inactive"}</p>
      {action.current.hrVisible && <p>Salary: {money(action.current.salary)} · Bank: {action.current.bankAccount || "—"}</p>}
    </div>}
    {action.phase === "review" && action.attempt.passwordIncluded && <p className="text-amber-800">A password cannot be verified from this record. Do not repeat a password reset based on this check. Confirm account access separately with the employee.</p>}
    {action.phase !== "saving" && <button type="button" className="btn-secondary" disabled={action.phase === "checking"} onClick={checkCurrent}>{action.phase === "checking" ? "Checking…" : "Check current record"}</button>}
  </section>;
}

function EmployeeForm({ modal, roles, branches, hrVisible, canResetPassword, onClose, action, checkCurrent, writeEmployee, finishReview }: {
  action: StaffAction | null; checkCurrent: () => void; finishReview: (refresh?: boolean) => void;
  writeEmployee: (body: Record<string, unknown>, attempt: EmployeeAttempt) => Promise<string | null>;
  modal: { mode: "create" } | { mode: "edit"; emp: E };
  roles: { id: string; name: string }[]; branches: { id: string; name: string }[]; hrVisible: boolean; canResetPassword: boolean; onClose: () => void;
}) {
  const emp = modal.mode === "edit" ? modal.emp : null;
  const [form, setForm] = useState({
    name: emp?.name ?? "", email: emp?.email ?? "", phone: emp?.phone ?? "",
    roleId: emp?.roleId ?? "", branchId: emp?.branchId ?? "",
    password: "", salary: emp?.salary?.toString() ?? "", bankAccount: emp?.bankAccount ?? "",
  });
  const [baseRevision, setBaseRevision] = useState(emp?.revision);
  const busy = action?.phase === "saving" || action?.phase === "checking";
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (action) return;
    setErr(null);
    const desired = { name: form.name.trim(), email: form.email.trim().toLowerCase(), phone: form.phone, roleId: form.roleId, branchId: form.branchId || null,
      ...(hrVisible ? { salary: form.salary ? Number(form.salary) : null, bankAccount: form.bankAccount.trim() || null } : {}) };
    const body = { ...(emp ? { id: emp.id, baseRevision } : {}), ...desired, ...(form.password ? { password: form.password } : {}) };
    const error = await writeEmployee(body, { ...(emp ? { id: emp.id } : {}), name: desired.name, email: desired.email, desired, passwordIncluded: !!form.password });
    if (!error) onClose(); else setErr(error);
  }
  const canRetry = action?.phase === "review" && employeeRetryAllowed(action.attempt, action.current, !!emp);

  return (
    <Modal label={emp ? `Edit ${emp.name}` : "New employee"} onClose={onClose} width="max-w-md" busy={busy}>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-semibold">{emp ? `Edit ${emp.name}` : "New employee"}</h2>
        {emp && <p className="-mt-2 text-xs text-slate-500">{emp.employeeCode}</p>}
        <fieldset disabled={!!action} className="space-y-4">
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
        </fieldset>
        {action && <StaffRecovery action={action} checkCurrent={checkCurrent} />}
        {!action && err && <div role="alert" className="form-error">{err}</div>}
        {canRetry && <button type="button" className="btn-secondary" onClick={() => { setBaseRevision(action?.current?.revision); setErr(null); finishReview(false); }}>Review and allow another save</button>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" disabled={busy} onClick={() => { if (action?.phase === "review") finishReview(); onClose(); }} className="btn-secondary">{action ? "Close" : "Cancel"}</button>
          <button className="btn-primary" disabled={!!action}>{busy ? "Saving…" : emp ? "Save changes" : "Create employee"}</button>
        </div>
      </form>
    </Modal>
  );
}
