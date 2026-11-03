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
const max=15*1024*1024,bodyCap=max+65536;
export async function masterMultipart(req:Request){const declared=Number(req.headers.get("content-length"));if(declared>bodyCap)throw new ApiError(413,"Maximum file size is 15 MB.");if(!req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data"))throw new ApiError(400,"Choose a multipart file upload.");if(!req.body)throw new ApiError(400,"Choose a file.");const reader=req.body.getReader(),chunks:Uint8Array[]=[];let total=0;try{for(;;){const{done,value}=await reader.read();if(done)break;total+=value.length;if(total>bodyCap){await reader.cancel();throw new ApiError(413,"Maximum file size is 15 MB.");}chunks.push(value);}}finally{reader.releaseLock();}try{return await new Request(req.url,{method:"POST",headers:{"content-type":req.headers.get("content-type")??""},body:new Uint8Array(Buffer.concat(chunks))}).formData();}catch{throw new ApiError(400,"The upload could not be read. Choose the file again.");}}
export async function uploadMasterDocument(db:PrismaClient,user:SessionUser,id:string,form:FormData){
 if(!user.permissions.includes("document:upload"))throw new ApiError(403,"Document upload is not permitted.");
 const scope=async(tx:Pick<PrismaClient,"customer">)=>{const c=await tx.customer.findUnique({where:{id}});if(!c||!canTouchRecord(user,c)||c.mergedIntoId)throw new ApiError(404,"Customer master unavailable.");return c;};
 await scope(db);
 const file=form.get("file");if(!(file instanceof File)||!file.size)throw new ApiError(400,"Choose a non-empty PDF or image.");if(file.size>max)throw new ApiError(413,"Maximum file size is 15 MB.");
 const data=z.object({requestKey:z.uuid(),docType:z.string().trim().min(1).max(120),travellerId:z.string().max(200),expiryDate:dateOnly,maskedAadhaarConfirmed:z.boolean().default(false),notes:z.string().trim().max(1000)}).parse({requestKey:form.get("requestKey"),docType:form.get("docType"),travellerId:form.get("travellerId")??"",expiryDate:form.get("expiryDate")??"",notes:form.get("notes")??"",maskedAadhaarConfirmed:form.get("maskedAadhaarConfirmed")==="true"});
 if(/aadha+a?r|aadhar/i.test(data.docType)&&!data.maskedAadhaarConfirmed)throw new ApiError(400,"Confirm the first eight Aadhaar digits are hidden before uploading a masked copy.");
 const ext=path.extname(file.name).toLowerCase(),extension=ext===".jpeg"?".jpg":ext;
 if(![".pdf",".jpg",".png"].includes(extension))throw new ApiError(400,"Upload PDF, JPG or PNG files.");
 const bytes=Buffer.from(await file.arrayBuffer());const valid=extension===".pdf"?bytes.subarray(0,5).toString()==="%PDF-":extension===".jpg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(!valid)throw new ApiError(400,"The file content does not match its extension.");
 if(data.travellerId&&!await db.traveller.findFirst({where:{id:data.travellerId,customerId:id}}))throw new ApiError(400,"Choose a traveller belonging to this customer.");
 const {maskedAadhaarConfirmed,...hashData}=data;
 const bodyHash=createHash("sha256").update(JSON.stringify({customerId:id,...hashData,...(maskedAadhaarConfirmed?{maskedAadhaarConfirmed:true}:{}),fileName:file.name,size:file.size,fileHash:createHash("sha256").update(bytes).digest("hex")})).digest("hex");
 const replay=async(tx:Pick<PrismaClient,"masterMutation">)=>{const row=await tx.masterMutation.findUnique({where:{actorId_requestKey:{actorId:user.id,requestKey:data.requestKey}}});if(!row)return null;if(row.customerId!==id||row.bodyHash!==bodyHash)throw new ApiError(409,"This upload reference belongs to a different file or changes.");return JSON.parse(row.result) as {ok:boolean;documentId:string;docNo:string};};
 const existing=await replay(db);if(existing)return {...existing,replayed:true};
 await scanUpload(bytes);
 const root=path.resolve(process.env.UPLOAD_ROOT??"uploads");await mkdir(root,{recursive:true,mode:0o700});if(await realpath(root)!==root)throw new ApiError(400,"Private upload storage needs review.");
 const storageName=randomUUID()+extension,saved=path.join(root,storageName);let attempted=false;
 try{await writeFile(saved,bytes,{flag:"wx",mode:0o600});await persistPrivateFile(saved);attempted=true;
 const result=await db.$transaction(async tx=>{await scope(tx);const prior=await replay(tx);if(prior)return {...prior,replayed:true};if(data.travellerId&&!await tx.traveller.findFirst({where:{id:data.travellerId,customerId:id}}))throw new ApiError(400,"The selected traveller changed. Reload the master.");
 const doc=await tx.document.create({data:{docNo:await nextReference(tx,"DOC"),customerId:id,travellerId:data.travellerId||null,docType:data.docType,aadhaarMasked:data.maskedAadhaarConfirmed&&/aadha+a?r|aadhar/i.test(data.docType),sensitive:true,fileName:path.basename(file.name).slice(0,200),storagePath:"uploads/"+storageName,mimeType:extension===".pdf"?"application/pdf":extension===".png"?"image/png":"image/jpeg",sizeBytes:file.size,uploadSource:"STAFF",uploadedById:user.id,uploadedAt:new Date(),status:"RECEIVED",verificationStatus:"PENDING",expiryDate:data.expiryDate?new Date(data.expiryDate+"T00:00:00Z"):null,notes:data.notes||null}});
 const receipt={ok:true,documentId:doc.id,docNo:doc.docNo};
 await transactionAudit(tx,user,"MASTER_UPLOAD","Document",doc.id,JSON.stringify({customerId:id,travellerId:data.travellerId||undefined,fields:["file","docType","traveller","expiryDate",...(data.maskedAadhaarConfirmed?["maskedAadhaarConfirmed"]:[])]}));
 await tx.activity.create({data:{customerId:id,actorId:user.id,type:"DOC",summary:"Document manually uploaded; verification pending",link:"/documents?focus="+doc.id}});
 await tx.masterMutation.create({data:{actorId:user.id,requestKey:data.requestKey,bodyHash,customerId:id,result:JSON.stringify(receipt)}});return receipt;},{timeout:20000});
 if("replayed" in result)await removePrivateFile(saved).catch(()=>{});return result;
 }catch(e){if(!attempted||e instanceof ApiError)await removePrivateFile(saved).catch(()=>{});throw e;}
}
