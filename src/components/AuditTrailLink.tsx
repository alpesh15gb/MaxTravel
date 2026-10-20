import Link from "next/link";
export function AuditTrailLink({ entity, entityId, allowed, compact = false }: { entity: string; entityId: string; allowed: boolean; compact?: boolean }) {
  if (!allowed) return null;
  return <Link className={compact ? "btn-secondary min-h-8 px-2 py-1 text-xs" : "btn-secondary"} href={`/audit?${new URLSearchParams({recordType:entity,entityId})}`} aria-label={`${entity} record audit history`}>{compact ? "History" : "Record audit history"}</Link>;
}
