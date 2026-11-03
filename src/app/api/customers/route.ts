import {createHash} from "node:crypto";
import {boundedJson} from "@/lib/bounded-json";
import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { optionalId, nextReference, transactionAudit, text } from "@/lib/transactions";
import { salesRecoveryContext } from "@/lib/sales-recovery-context";
export async function POST(req:Request){
  try{
    const user=await requireSession("customer:create");
    // Inline enquiry forms must bind their write to the staff session/scope that collected the fields.
    // Check before parsing private input or opening a transaction; normal Customers callers remain compatible.
    const expectedContext=req.headers.get("x-sales-recovery-context");
    if(expectedContext!==null&&expectedContext!==salesRecoveryContext(user))return Response.json({error:"Staff session or access changed. Reload this workspace before continuing.",code:"SALES_CONTEXT_CHANGED"},{status:409,headers:{"Cache-Control":"private, no-store"}});
    const b=await boundedJson(req);
    const requestKey=b.requestKey===undefined?null:String(b.requestKey);if(requestKey&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestKey))throw new ApiError(400,"Invalid save reference.");
    const bodyHash=createHash("sha256").update(JSON.stringify({action:"CUSTOMER_CREATE",body:b})).digest("hex");
    if(b.createPrimaryTraveller!==undefined&&typeof b.createPrimaryTraveller!=="boolean")throw new ApiError(400,"Invalid primary traveller choice.");
    const name=optionalId(b.name),phone=optionalId(b.phone);if(!name||!phone)throw new ApiError(400,"Enter the customer's name and phone.");
    if(name.length>150||phone.length>40)throw new ApiError(400,"Name or phone is too long.");
    const type=String(b.type??"INDIVIDUAL");if(!["INDIVIDUAL","CORPORATE","SUB_AGENT"].includes(type))throw new ApiError(400,"Invalid customer type.");
    const email=optionalId(b.email);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ApiError(400,"Enter a valid email address.");
    // Bounded here rather than left to the column, so an address pasted in full or a company name that
    // grew into a paragraph is refused with a message instead of overflowing the field unnoticed.
    const city=text(b.city,"City",150)??"",address=text(b.address,"Address",1000),companyName=text(b.companyName,"Company name",200);
    const gstNumber=String(b.gstNumber??"").trim().toUpperCase();if(gstNumber&&!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstNumber))throw new ApiError(400,"Enter a valid GSTIN format.");
    const customer=await prisma.$transaction(async tx=>{
      if(requestKey){const replay=await tx.masterMutation.findUnique({where:{actorId_requestKey:{actorId:user.id,requestKey}}});if(replay){if(replay.bodyHash!==bodyHash)throw new ApiError(409,"This save reference belongs to different changes.");const original=await tx.customer.findUnique({where:{id:replay.customerId}});if(!original||!canTouchRecord(user,original))throw new ApiError(404,"Customer unavailable.");return original;}}
      const branchId=optionalId(b.branchId)??user.branchId??(await tx.branch.findFirst())?.id;
      if(!branchId||!(await tx.branch.findUnique({where:{id:branchId}})))throw new ApiError(400,"Choose a valid branch.");
      if(user.accessMode!=="ALL"&&branchId!==user.branchId)throw new ApiError(403,"Cannot create a customer in another branch.");
      const assignedToId=optionalId(b.assignedToId)??user.id;
      const manager=await tx.user.findUnique({where:{id:assignedToId}});
      if(!manager?.active||(user.accessMode==="ASSIGNED"&&assignedToId!==user.id)||(user.accessMode==="BRANCH"&&manager.branchId!==user.branchId))throw new ApiError(403,"Choose an active manager within your access.");
      const record=await tx.customer.create({data:{code:await nextReference(tx, "C"),name,phone,email,city,address,companyName,gstNumber:gstNumber||null,type,branchId,assignedToId,...(b.createPrimaryTraveller===false?{}:{travellers:{create:{fullName:name,relation:"SELF",primary:true}}})}});
      await transactionAudit(tx,user,"CREATE","Customer",record.id,record.code);if(requestKey)await tx.masterMutation.create({data:{actorId:user.id,requestKey,bodyHash,customerId:record.id,result:JSON.stringify({ok:true,id:record.id,code:record.code})}});return record;
    });
    return Response.json({ok:true,id:customer.id,code:customer.code});
  }catch(e){return jsonError(e);}
}
