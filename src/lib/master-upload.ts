import {randomUUID,createHash} from "node:crypto";
import {mkdir,writeFile,realpath} from "node:fs/promises";
import path from "node:path";
import type {PrismaClient} from "@prisma/client";
import type {SessionUser} from "./session";
import {ApiError,canTouchRecord} from "./guard";
import {nextReference,transactionAudit} from "./transactions";
import {scanUpload} from "./upload-scan";
import {persistPrivateFile,removePrivateFile} from "./private-storage";
import {dateOnly} from "./master-validation";
import {z} from "zod";
import {canTouchDocument} from "./record-access";
const max=15*1024*1024,bodyCap=max+65536;
export async function masterMultipart(req:Request){const declared=Number(req.headers.get("content-length"));if(declared>bodyCap)throw new ApiError(413,"Maximum file size is 15 MB.");if(!req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data"))throw new ApiError(400,"Choose a multipart file upload.");if(!req.body)throw new ApiError(400,"Choose a file.");const reader=req.body.getReader(),chunks:Uint8Array[]=[];let total=0;try{for(;;){const{done,value}=await reader.read();if(done)break;total+=value.length;if(total>bodyCap){await reader.cancel();throw new ApiError(413,"Maximum file size is 15 MB.");}chunks.push(value);}}finally{reader.releaseLock();}try{return await new Request(req.url,{method:"POST",headers:{"content-type":req.headers.get("content-type")??""},body:new Uint8Array(Buffer.concat(chunks))}).formData();}catch{throw new ApiError(400,"The upload could not be read. Choose the file again.");}}
export async function uploadMasterDocument(db:PrismaClient,user:SessionUser,id:string,form:FormData,requirementId?:string){
 if(!user.permissions.includes("document:upload"))throw new ApiError(403,"Document upload is not permitted.");
 const requirement=async(tx:Pick<PrismaClient,"document"|"checklistItem">)=>{if(!requirementId)return null;const doc=await tx.document.findUnique({where:{id:requirementId},include:{customer:true}});return doc?{...doc,checklistItem:doc.checklistItemId?await tx.checklistItem.findUnique({where:{id:doc.checklistItemId}}):null}:null;};
 const scope=async(tx:Pick<PrismaClient,"customer"|"document"|"checklistItem">)=>{const c=await tx.customer.findUnique({where:{id}});const target=await requirement(tx);if(!c||c.mergedIntoId||(requirementId?(!target||target.customerId!==id||!canTouchDocument(user,target)):!canTouchRecord(user,c)))throw new ApiError(404,"Document or customer is outside your access.");return c;};
 await scope(db);
 const target=await requirement(db);
 const file=form.get("file");if(!(file instanceof File)||!file.size)throw new ApiError(400,"Choose a non-empty PDF or image.");if(file.size>max)throw new ApiError(413,"Maximum file size is 15 MB.");
 const data=z.object({requestKey:z.uuid(),docType:z.string().trim().min(1).max(120),travellerId:z.string().max(200),expiryDate:dateOnly,maskedAadhaarConfirmed:z.boolean().default(false),notes:z.string().trim().max(1000)}).parse({requestKey:form.get("requestKey"),docType:target?.docType??form.get("docType"),travellerId:target?target.travellerId??"":form.get("travellerId")??"",expiryDate:form.get("expiryDate")??"",notes:form.get("notes")??"",maskedAadhaarConfirmed:form.get("maskedAadhaarConfirmed")==="true"});
 const expectedVersion=requirementId?z.coerce.number().int().positive().parse(form.get("version")):null;
 if(/aadha+a?r|aadhar/i.test(data.docType)&&!data.maskedAadhaarConfirmed)throw new ApiError(400,"Confirm the first eight Aadhaar digits are hidden before uploading a masked copy.");
 const ext=path.extname(file.name).toLowerCase(),extension=ext===".jpeg"?".jpg":ext;
 if(![".pdf",".jpg",".png"].includes(extension))throw new ApiError(400,"Upload PDF, JPG or PNG files.");
 const bytes=Buffer.from(await file.arrayBuffer());const valid=extension===".pdf"?bytes.subarray(0,5).toString()==="%PDF-":extension===".jpg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(!valid)throw new ApiError(400,"The file content does not match its extension.");
 if(data.travellerId&&!await db.traveller.findFirst({where:{id:data.travellerId,customerId:id}}))throw new ApiError(400,"Choose a traveller belonging to this customer.");
 const {maskedAadhaarConfirmed,...hashData}=data;
 const bodyHash=createHash("sha256").update(JSON.stringify({customerId:id,...hashData,...(requirementId?{requirementId,version:expectedVersion}:{}),...(maskedAadhaarConfirmed?{maskedAadhaarConfirmed:true}:{}),fileName:file.name,size:file.size,fileHash:createHash("sha256").update(bytes).digest("hex")})).digest("hex");
 const replay=async(tx:Pick<PrismaClient,"masterMutation">)=>{const row=await tx.masterMutation.findUnique({where:{actorId_requestKey:{actorId:user.id,requestKey:data.requestKey}}});if(!row)return null;if(row.customerId!==id||row.bodyHash!==bodyHash)throw new ApiError(409,"This upload reference belongs to a different file or changes.");return JSON.parse(row.result) as {ok:boolean;documentId:string;docNo:string};};
 const existing=await replay(db);if(existing)return {...existing,replayed:true};
 const assertUploadTarget=(current:typeof target)=>{
  if(!current||current.version!==expectedVersion||current.docType!==data.docType||(current.travellerId??"")!==data.travellerId||current.checklistItemId!==target?.checklistItemId||!["REQUIRED","REQUESTED","REJECTED","REUPLOAD_REQUESTED"].includes(current.status))throw new ApiError(409,"This document changed or already has a received file. Refresh before uploading.");
  const item=current.checklistItem;
  if(item?.needsExpiry&&!data.expiryDate)throw new ApiError(400,"Enter this document's expiry date.");
  if(data.expiryDate&&new Date(data.expiryDate+"T00:00:00Z")<=new Date())throw new ApiError(400,"Document expiry must be in the future.");
  const allowed=(item?.fileTypes??"pdf,jpg,png").split(",").map(x=>x.trim().toLowerCase().replace(/^\./,"")).map(x=>x==="jpeg"?"jpg":x);
  if(!allowed.includes(extension.slice(1)))throw new ApiError(400,`Allowed file types: ${allowed.join(", ")}.`);
  const limit=Math.min(15,item?.maxSizeMb??15);
  if(file.size>limit*1024*1024)throw new ApiError(413,`This document allows files up to ${limit} MB.`);
 };
 if(requirementId)assertUploadTarget(target);
 await scanUpload(bytes);
 const root=path.resolve(process.env.UPLOAD_ROOT??"uploads");await mkdir(root,{recursive:true,mode:0o700});if(await realpath(root)!==root)throw new ApiError(400,"Private upload storage needs review.");
 const storageName=randomUUID()+extension,saved=path.join(root,storageName);let attempted=false;
 try{await writeFile(saved,bytes,{flag:"wx",mode:0o600});await persistPrivateFile(saved);attempted=true;
 const result=await db.$transaction(async tx=>{await scope(tx);const prior=await replay(tx);if(prior)return {...prior,replayed:true};if(data.travellerId&&!await tx.traveller.findFirst({where:{id:data.travellerId,customerId:id}}))throw new ApiError(400,"The selected traveller changed. Reload the master.");
 const current=await requirement(tx);if(requirementId)assertUploadTarget(current);
 const fileData={aadhaarMasked:data.maskedAadhaarConfirmed&&/aadha+a?r|aadhar/i.test(data.docType),sensitive:true,fileName:path.basename(file.name).slice(0,200),storagePath:"uploads/"+storageName,mimeType:extension===".pdf"?"application/pdf":extension===".png"?"image/png":"image/jpeg",sizeBytes:file.size,uploadSource:"STAFF",uploadedById:user.id,uploadedAt:new Date(),status:"RECEIVED",verificationStatus:"PENDING",expiryDate:data.expiryDate?new Date(data.expiryDate+"T00:00:00Z"):null,notes:data.notes||current?.notes||null};
 const doc=current?await tx.document.update({where:{id:current.id},data:{...fileData,version:current.fileName?{increment:1}:current.version,verifiedAt:null,verifiedById:null,extractedConfirmedAt:null,extractedConfirmedById:null,rejectionReason:null,extracted:null,warnings:null}}):await tx.document.create({data:{...fileData,docNo:await nextReference(tx,"DOC"),customerId:id,travellerId:data.travellerId||null,docType:data.docType}});
 const receipt={ok:true,documentId:doc.id,docNo:doc.docNo};
 await transactionAudit(tx,user,"MASTER_UPLOAD","Document",doc.id,JSON.stringify({customerId:id,travellerId:data.travellerId||undefined,fields:["file","docType","traveller","expiryDate",...(data.maskedAadhaarConfirmed?["maskedAadhaarConfirmed"]:[])]}));
 await tx.activity.create({data:{customerId:id,actorId:user.id,type:"DOC",summary:"Document manually uploaded; verification pending",link:"/documents?focus="+doc.id}});
 await tx.masterMutation.create({data:{actorId:user.id,requestKey:data.requestKey,bodyHash,customerId:id,result:JSON.stringify(receipt)}});return receipt;},{timeout:20000});
 if("replayed" in result)await removePrivateFile(saved).catch(()=>{});return result;
 }catch(e){if(!attempted||e instanceof ApiError)await removePrivateFile(saved).catch(()=>{});throw e;}
}
