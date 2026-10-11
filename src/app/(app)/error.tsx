"use client";
import { EmptyState } from "@/components/ui";
export default function ErrorPage({reset}:{error:Error&{digest?:string};reset:()=>void}){return <div className="workspace-page"><EmptyState icon="warning" title="We couldn’t load this workspace." description="Your saved records have not been changed. Retry this view; if the problem continues, contact your agency administrator." action="Try again" onAction={reset}/></div>;}
