import {requirePage} from "@/lib/guard";
import RequirementsClient from "./RequirementsClient";
export default async function Page({searchParams}:{searchParams:Promise<{case?:string}>}){await requirePage("visa:view");return <RequirementsClient caseId={(await searchParams).case??""}/>;}
