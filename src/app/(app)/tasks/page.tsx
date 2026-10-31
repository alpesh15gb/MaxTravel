import {redirect} from "next/navigation";
export default async function TasksPage({searchParams}:{searchParams:Promise<{focus?:string;action?:string}>}){const q=await searchParams;redirect(q.focus?'/work?task='+encodeURIComponent(q.focus):'/work');}
