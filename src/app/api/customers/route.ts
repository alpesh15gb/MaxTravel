import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { optionalId, nextReference, transactionAudit, text } from "@/lib/transactions";
export async function POST(req:Request){
  try{
    const user=await requireSession("customer:create");const b=await req.json();
    const name=optionalId(b.name),phone=optionalId(b.phone);if(!name||!phone)throw new ApiError(400,"Enter the customer's name and phone.");
    if(name.length>150||phone.length>40)throw new ApiError(400,"Name or phone is too long.");
    const type=String(b.type??"INDIVIDUAL");if(!["INDIVIDUAL","CORPORATE","SUB_AGENT"].includes(type))throw new ApiError(400,"Invalid customer type.");
    const email=optionalId(b.email);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ApiError(400,"Enter a valid email address.");
    // Bounded here rather than left to the column, so an address pasted in full or a company name that
    // grew into a paragraph is refused with a message instead of overflowing the field unnoticed.
    const city=text(b.city,"City",150)??"",address=text(b.address,"Address",1000),companyName=text(b.companyName,"Company name",200);
    const customer=await prisma.$transaction(async tx=>{
      const branchId=optionalId(b.branchId)??user.branchId??(await tx.branch.findFirst())?.id;
      if(!branchId||!(await tx.branch.findUnique({where:{id:branchId}})))throw new ApiError(400,"Choose a valid branch.");
      if(user.accessMode!=="ALL"&&branchId!==user.branchId)throw new ApiError(403,"Cannot create a customer in another branch.");
      const assignedToId=optionalId(b.assignedToId)??user.id;
      const manager=await tx.user.findUnique({where:{id:assignedToId}});
      if(!manager?.active||(user.accessMode==="ASSIGNED"&&assignedToId!==user.id)||(user.accessMode==="BRANCH"&&manager.branchId!==user.branchId))throw new ApiError(403,"Choose an active manager within your access.");
      const record=await tx.customer.create({data:{code:await nextReference(tx, "C"),name,phone,email,city,address,companyName,type,branchId,assignedToId,travellers:{create:{fullName:name,relation:"SELF",primary:true}}}});
      await transactionAudit(tx,user,"CREATE","Customer",record.id,record.code);return record;
    });
    return Response.json({ok:true,id:customer.id,code:customer.code});
  }catch(e){return jsonError(e);}
}
