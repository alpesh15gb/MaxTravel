import Link from "next/link";
export default function CaseReference({record}:{record?:{id:string;caseNo:string}|null}){return record?<div className="case-reference no-print"><span>Client case</span><Link href={`/cases/${record.id}`}>{record.caseNo}</Link><span>Track the complete journey →</span></div>:null;}
