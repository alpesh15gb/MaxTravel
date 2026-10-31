import {Suspense} from "react";
import {requirePage} from "@/lib/guard";
import {readWork} from "@/lib/work-read";
import WorkDesk from "@/components/WorkDesk";
export const dynamic="force-dynamic";
export default async function WorkPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const u=await requirePage("task:view"),sp=await searchParams,q=new URLSearchParams();for(const [k,v] of Object.entries(sp))if(typeof v==="string")q.set(k,v);return <Suspense fallback={<p role="status">Loading your work…</p>}><WorkDesk initialData={await readWork(u,q)}/></Suspense>;}
