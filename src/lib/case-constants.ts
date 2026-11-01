export const CASE_READ=["customer:view","visa:view","ticketing:view"] as const;
export const CASE_STATUSES=["OPEN","IN_PROGRESS","WAITING_CUSTOMER","ON_HOLD","COMPLETED","CANCELLED"] as const;
export const CASE_SERVICES=["VISA","FLIGHT","HOTEL"] as const;
export function isClosedCase(row?:{status?:string;closedAt?:unknown}|null){return Boolean(row&&(row.closedAt||row.status==='COMPLETED'||row.status==='CANCELLED'));}
