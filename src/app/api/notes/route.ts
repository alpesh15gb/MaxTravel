import { prisma } from "@/lib/db";
import { requireSession,jsonError,ApiError } from "@/lib/guard";
import { customerFor,optionalId,transactionAudit } from "@/lib/transactions";
export async function POST(req:Request){try{const user=await requireSession("customer:edit");const b=await req.json(),customerId=optionalId(b.customerId),body=optionalId(b.body);if(!customerId||!body||body.length>5000)throw new ApiError(400,"Write a note of 1–5000 characters.");const note=await prisma.$transaction(async tx=>{await customerFor(tx,user,customerId);const n=await tx.note.create({data:{customerId,body,authorId:user.id,pinned:b.pinned===true}});await transactionAudit(tx,user,"CREATE","Note",n.id,"Customer note added");return n;});return Response.json({ok:true,note});}catch(e){return jsonError(e);}}
