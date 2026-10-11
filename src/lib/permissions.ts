export type Permission =
  | "dashboard:view"
  | "search:use"
  | "customer:view" | "customer:create" | "customer:edit" | "customer:delete"
  | "traveller:view" | "traveller:create" | "traveller:edit" | "traveller:delete"
  | "visa:view" | "visa:create" | "visa:edit" | "visa:delete" | "visa:approve"
  | "checklist:view" | "checklist:edit"
  | "ticketing:view" | "ticketing:create" | "ticketing:edit" | "ticketing:delete"
  | "reissue:manage"
  | "document:view" | "document:upload" | "document:verify" | "document:delete"
  | "sensitive:view" // passport numbers & sensitive customer docs
  | "payment:view" | "payment:record" | "payment:approve"
  | "invoice:view" | "invoice:create"
  | "refund:view" | "refund:manage" | "refund:approve"
  | "task:view" | "task:create" | "task:edit"
  | "whatsapp:view" | "whatsapp:send"
  | "supplier:view" | "supplier:manage"
  | "hr:view" // employee salary/bank details
  | "employee:view" | "employee:manage"
  | "settings:manage"
  | "audit:view"
  | "export:data";

export const ALL_PERMISSIONS: Permission[] = [
  "dashboard:view", "search:use",
  "customer:view", "customer:create", "customer:edit", "customer:delete",
  "traveller:view", "traveller:create", "traveller:edit", "traveller:delete",
  "visa:view", "visa:create", "visa:edit", "visa:delete", "visa:approve",
  "checklist:view", "checklist:edit",
  "ticketing:view", "ticketing:create", "ticketing:edit", "ticketing:delete",
  "reissue:manage",
  "document:view", "document:upload", "document:verify", "document:delete",
  "sensitive:view",
  "payment:view", "payment:record", "payment:approve",
  "invoice:view", "invoice:create",
  "refund:view", "refund:manage", "refund:approve",
  "task:view", "task:create", "task:edit",
  "whatsapp:view", "whatsapp:send",
  "supplier:view", "supplier:manage",
  "hr:view",
  "employee:view", "employee:manage",
  "settings:manage", "audit:view", "export:data",
];

export type RoleKey =
  | "SUPER_ADMIN" | "OWNER" | "BRANCH_MANAGER" | "VISA_MANAGER" | "VISA_EXECUTIVE"
  | "TICKETING_MANAGER" | "TICKETING_EXECUTIVE" | "SALES_EXECUTIVE"
  | "ACCOUNTS" | "HR" | "OPERATIONS" | "READ_ONLY";

export type AccessMode = "ALL" | "BRANCH" | "ASSIGNED";

export const ROLE_ACCESS: Record<RoleKey, AccessMode> = {
  SUPER_ADMIN: "ALL",
  OWNER: "ALL",
  BRANCH_MANAGER: "BRANCH",
  VISA_MANAGER: "BRANCH",
  VISA_EXECUTIVE: "ASSIGNED",
  TICKETING_MANAGER: "BRANCH",
  TICKETING_EXECUTIVE: "ASSIGNED",
  SALES_EXECUTIVE: "ASSIGNED",
  ACCOUNTS: "ALL",
  HR: "ALL",
  OPERATIONS: "BRANCH",
  READ_ONLY: "ALL",
};

const R = (...ps: Permission[]): Permission[] => ps;

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  OWNER: R(
    "dashboard:view", "search:use",
    "customer:view", "customer:create", "customer:edit", "customer:delete",
    "traveller:view", "traveller:create", "traveller:edit", "traveller:delete",
    "visa:view", "visa:create", "visa:edit", "visa:delete", "visa:approve",
    "checklist:view", "checklist:edit",
    "ticketing:view", "ticketing:create", "ticketing:edit", "ticketing:delete",
    "reissue:manage",
    "document:view", "document:upload", "document:verify", "document:delete", "sensitive:view",
    "payment:view", "payment:record", "payment:approve",
    "invoice:view", "invoice:create",
    "refund:view", "refund:manage", "refund:approve",
    "task:view", "task:create", "task:edit",
    "whatsapp:view", "whatsapp:send",
    "supplier:view", "supplier:manage",
    "employee:view", "employee:manage", "hr:view",
    "settings:manage", "audit:view", "export:data",
  ),
  BRANCH_MANAGER: R(
    "dashboard:view", "search:use",
    "customer:view", "customer:create", "customer:edit",
    "traveller:view", "traveller:create", "traveller:edit",
    "visa:view", "visa:create", "visa:edit", "visa:approve",
    "checklist:view",
    "ticketing:view", "ticketing:create", "ticketing:edit",
    "reissue:manage",
    "document:view", "document:upload", "document:verify", "sensitive:view",
    "payment:view", "payment:record",
    "invoice:view", "invoice:create",
    "refund:view", "refund:manage",
    "task:view", "task:create", "task:edit",
    "whatsapp:view", "whatsapp:send",
    "supplier:view",
    "employee:view",
    "export:data",
  ),
  VISA_MANAGER: R(
    "dashboard:view", "search:use",
    "customer:view", "customer:edit",
    "traveller:view", "traveller:edit",
    "visa:view", "visa:create", "visa:edit", "visa:approve",
    "checklist:view", "checklist:edit",
    "document:view", "document:upload", "document:verify", "sensitive:view",
    "payment:view",
    "invoice:view",
    "task:view", "task:create", "task:edit",
    "whatsapp:view", "whatsapp:send",
    "supplier:view",
    "employee:view",
    "export:data",
  ),
  VISA_EXECUTIVE: R(
    "dashboard:view", "search:use",
    "customer:view", "customer:edit",
    "traveller:view", "traveller:edit",
    "visa:view", "visa:create", "visa:edit",
    "checklist:view",
    "document:view", "document:upload", "document:verify", "sensitive:view",
    "task:view", "task:create", "task:edit",
    "whatsapp:view", "whatsapp:send",
    "supplier:view",
  ),
  TICKETING_MANAGER: R(
    "dashboard:view", "search:use",
    "customer:view", "customer:edit",
    "traveller:view", "traveller:edit",
    "ticketing:view", "ticketing:create", "ticketing:edit",
    "reissue:manage",
    "document:view", "document:upload", "sensitive:view",
    "payment:view",
    "invoice:view",
    "refund:view", "refund:manage",
    "task:view", "task:create", "task:edit",
    "whatsapp:view", "whatsapp:send",
    "supplier:view",
    "employee:view",
    "export:data",
  ),
  TICKETING_EXECUTIVE: R(
    "dashboard:view", "search:use",
    "customer:view",
    "traveller:view", "traveller:create", "traveller:edit",
    "ticketing:view", "ticketing:create", "ticketing:edit",
    "reissue:manage",
    "document:view", "document:upload",
    "task:view", "task:create", "task:edit",
    "whatsapp:view", "whatsapp:send",
    "supplier:view",
  ),
  SALES_EXECUTIVE: R(
    "dashboard:view", "search:use",
    "customer:view", "customer:create", "customer:edit",
    "traveller:view", "traveller:create", "traveller:edit",
    "visa:view", "visa:create",
    "ticketing:view", "ticketing:create",
    "document:view", "document:upload",
    "payment:view",
    "task:view", "task:create", "task:edit",
    "whatsapp:view", "whatsapp:send",
  ),
  ACCOUNTS: R(
    "dashboard:view", "search:use",
    "customer:view",
    "traveller:view",
    "visa:view",
    "ticketing:view",
    "document:view",
    "payment:view", "payment:record", "payment:approve",
    "invoice:view", "invoice:create",
    "refund:view", "refund:manage", "refund:approve",
    "supplier:view", "supplier:manage",
    "task:view",
    "export:data",
  ),
  HR: R(
    "dashboard:view", "search:use",
    "customer:view",
    "employee:view", "employee:manage", "hr:view",
    "task:view", "task:create", "task:edit",
    "whatsapp:view",
  ),
  OPERATIONS: R(
    "dashboard:view", "search:use",
    "customer:view", "customer:edit",
    "traveller:view", "traveller:edit",
    "visa:view", "visa:edit",
    "ticketing:view",
    "document:view", "document:upload", "document:verify", "sensitive:view",
    "task:view", "task:create", "task:edit",
    "whatsapp:view", "whatsapp:send",
    "supplier:view",
  ),
  READ_ONLY: R(
    "dashboard:view", "search:use",
    "customer:view", "traveller:view", "visa:view", "checklist:view",
    "ticketing:view", "document:view", "payment:view", "invoice:view",
    "refund:view", "task:view", "whatsapp:view", "supplier:view", "employee:view", "audit:view",
  ),
};
