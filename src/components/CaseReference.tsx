import Link from "next/link";
export default function CaseReference({record}:{record?:{id:string;caseNo:string}|null}){return record?<div className="case-reference no-print"><span>Max ID</span><Link href={`/trips/${record.id}`}>{record.caseNo}</Link><span>Open the trip →</span></div>:null;}
