import {requireSession,jsonError,ApiError} from "@/lib/guard";
import {prisma} from "@/lib/db";
import {legacyTaskStatus} from "@/lib/work-engine";
import {TASK_STATUSES} from "@/lib/task-status";
export async function POST(req:Request){try{const user=await requireSession("task:edit"),b=await req.json();if(typeof b.taskId!=="string"||!TASK_STATUSES.includes(b.status))throw new ApiError(400,"Choose a task and valid status.");const task=await prisma.$transaction(tx=>legacyTaskStatus(tx,user,b.taskId,b.status));return Response.json({ok:true,task});}catch(e){return jsonError(e);}}
