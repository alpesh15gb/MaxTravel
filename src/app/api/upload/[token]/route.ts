import {scanUpload} from "@/lib/upload-scan";
import { prisma } from "@/lib/db";
import { mkdir,writeFile,unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { ApiError,jsonError } from "@/lib/guard";
import { optionalId,nextReference,date } from "@/lib/transactions";
const ROOT=path.resolve(process.env.UPLOAD_ROOT??path.join(process.cwd(),"uploads"));
// The largest request body we will ever read, including multipart framing. The per-document cap below
// is the policy limit; this is the ceiling that stops a hostile or broken client from making the
// server buffer an unbounded body into memory before it ever gets to apply that policy.
const MAX_BODY_BYTES=16*1024*1024;

/**
 * Read the body, stopping the moment it passes the cap.
 *
 * `req.formData()` alone is not a limit: it consumes the whole stream first, so a 2 GB upload would
 * be held in memory long before the size check below could reject it. This walks the stream instead
 * and cancels it at the boundary, so the worst case really is MAX_BODY_BYTES.
 */
async function readCapped(req:Request):Promise<Buffer>{
  const declared=Number(req.headers.get("content-length"));
  if(Number.isFinite(declared)&&declared>MAX_BODY_BYTES)throw new ApiError(413,"Maximum upload size is 15 MB.");
  const stream=req.body;
  if(!stream)return Buffer.alloc(0);
  const reader=stream.getReader();const chunks:Uint8Array[]=[];let total=0;
  try{
    for(;;){
      const{done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>MAX_BODY_BYTES){await reader.cancel().catch(()=>{});throw new ApiError(413,"Maximum upload size is 15 MB.");}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  return Buffer.concat(chunks);
}
export async function GET(_req:Request,ctx:{params:Promise<{token:string}>}){const link=await prisma.uploadLink.findUnique({where:{token:(await ctx.params).token}});return !link||link.revoked||link.expiresAt<new Date()?Response.json({error:"This upload link is invalid or expired."},{status:410}):Response.json({ok:true});}
export async function POST(req:Request,ctx:{params:Promise<{token:string}>}){let saved:string|null=null;try{
 const link=await prisma.uploadLink.findUnique({where:{token:(await ctx.params).token}});if(!link||link.revoked||link.expiresAt<new Date())throw new ApiError(410,"This upload link is invalid or expired.");
 const body=await readCapped(req);
  // Re-wrapped so formData() parses bytes we have already measured. Handing it the original request
  // would hand back the unbounded stream the cap exists to avoid.
  const form=await new Request(req.url,{method:"POST",headers:{"content-type":req.headers.get("content-type")??"application/octet-stream"},body:new Uint8Array(body)}).formData();const file=form.get("file");if(!(file instanceof File)||!file.size)throw new ApiError(400,"Choose a non-empty file.");if(file.size>15*1024*1024)throw new ApiError(413,"Maximum upload size is 15 MB.");
 const documentId=optionalId(form.get("documentId")),docType=optionalId(form.get("docType")),travellerId=optionalId(form.get("travellerId"))??link.travellerId;
 if(!documentId&&!docType)throw new ApiError(400,"Choose a requested document or enter its type.");
 if(link.travellerId&&travellerId!==link.travellerId)throw new ApiError(403,"This link is for a different traveller.");
 if(travellerId&&!(await prisma.traveller.findFirst({where:{id:travellerId,customerId:link.customerId}})))throw new ApiError(400,"Traveller does not belong to this customer.");
 const existing=documentId?await prisma.document.findUnique({where:{id:documentId}}):null;
 if(documentId&&(!existing||existing.customerId!==link.customerId||(link.visaCaseId&&existing.visaCaseId!==link.visaCaseId)||(link.travellerId&&existing.travellerId!==link.travellerId)))throw new ApiError(403,"Document is outside this upload link.");
 if(existing&&!["REQUIRED","REQUESTED","REJECTED","REUPLOAD_REQUESTED"].includes(existing.status))throw new ApiError(409,"This document is already received or verified. Ask your agency for a re-upload request.");
 const item=existing?.checklistItemId?await prisma.checklistItem.findUnique({where:{id:existing.checklistItemId}}):null;
 const expiryDate=date(form.get("expiryDate"),"Document expiry");if(item?.needsExpiry&&!expiryDate)throw new ApiError(400,"Enter this document's expiry date.");if(expiryDate&&expiryDate<=new Date())throw new ApiError(400,"Document expiry must be in the future.");
 const extension=path.extname(file.name).slice(1).toLowerCase();const normalized=extension==="jpeg"?"jpg":extension;const allowed=(item?.fileTypes??"pdf,jpg,png").split(",").map(x=>x.trim().toLowerCase()).map(x=>x==="jpeg"?"jpg":x);
 if(!["pdf","jpg","png"].includes(normalized)||!allowed.includes(normalized))throw new ApiError(400,`Allowed file types: ${allowed.join(", ")}.`);
 const max=Math.min(15,item?.maxSizeMb??15);if(file.size>max*1024*1024)throw new ApiError(413,`This document allows files up to ${max} MB.`);
 const buffer=Buffer.from(await file.arrayBuffer());const valid=normalized==="pdf"?buffer.subarray(0,5).toString()==="%PDF-":normalized==="jpg"?buffer[0]===255&&buffer[1]===216&&buffer[2]===255:buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(!valid)throw new ApiError(400,"File content does not match its PDF or image extension.");
 await scanUpload(buffer);
 await mkdir(ROOT,{recursive:true});const storageName=`${randomUUID()}.${normalized}`;saved=path.join(ROOT,storageName);await writeFile(saved,buffer);
 const doc=await prisma.$transaction(async tx=>{
 const current=await tx.uploadLink.findUnique({where:{id:link.id}});if(!current||current.revoked||current.expiresAt<new Date())throw new ApiError(410,"Link expired while uploading.");
 const data={status:"RECEIVED",verificationStatus:"PENDING",fileName:file.name,storagePath:`uploads/${storageName}`,mimeType:normalized==="pdf"?"application/pdf":normalized==="jpg"?"image/jpeg":"image/png",sizeBytes:file.size,uploadSource:"PORTAL",uploadedAt:new Date(),expiryDate,verifiedAt:null,verifiedById:null,extractedConfirmedAt:null,extractedConfirmedById:null,rejectionReason:null,extracted:null,warnings:null};
 let record;
 if(existing){const latest=await tx.document.findUnique({where:{id:existing.id}});if(!latest||!["REQUIRED","REQUESTED","REJECTED","REUPLOAD_REQUESTED"].includes(latest.status))throw new ApiError(409,"Document was updated while uploading. Refresh the page.");record=await tx.document.update({where:{id:existing.id},data:{...data,version:existing.fileName?{increment:1}:existing.version,notes:optionalId(form.get("notes"))??existing.notes}});}else{record=await tx.document.create({data:{...data,docNo:await nextReference(tx, "DOC"),customerId:link.customerId,visaCaseId:link.visaCaseId,travellerId,docType:docType!,notes:optionalId(form.get("notes"))}});}
 if(record.visaCaseId){const vc=await tx.visaCase.findUnique({where:{id:record.visaCaseId},include:{stage:true}});if(vc){await tx.notification.create({data:{userId:vc.ownerId,title:`Document received · ${record.docType}`,body:"Uploaded through the client document portal.",link:`/visa/${vc.id}`,severity:"INFO"}});if(vc.stage.key==="DOCUMENTS_PENDING"&&!(await tx.document.count({where:{visaCaseId:vc.id,status:{in:["REQUIRED","REQUESTED","REJECTED","REUPLOAD_REQUESTED"]}}}))){const stage=await tx.visaStage.findUnique({where:{key:"DOCUMENTS_VERIFICATION"}});if(stage?.active){await tx.visaCase.update({where:{id:vc.id},data:{stageId:stage.id}});await tx.visaCaseStatus.create({data:{caseId:vc.id,stageId:stage.id,note:"Requested documents received via portal; awaiting manual review"}});}}}}
 await tx.uploadLink.update({where:{id:link.id},data:{usedAt:new Date()}});await tx.activity.create({data:{customerId:link.customerId,type:"DOC",summary:`${record.docType} received via client portal; review pending`,link:`/documents?focus=${record.id}`}});return record;
 },{timeout:20000});
 saved=null;return Response.json({ok:true,docNo:doc.docNo,documentId:doc.id,status:doc.status});
 }catch(e){if(saved)await unlink(saved).catch(error=>console.error("Could not remove failed upload",error));return jsonError(e);}}
