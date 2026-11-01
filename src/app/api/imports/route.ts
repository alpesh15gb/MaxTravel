import {prisma} from '@/lib/db';
import {requireSession,jsonError,ApiError} from '@/lib/guard';
import {boundedJson} from '@/lib/bounded-json';
import {assertImportAccess,importDraftSchema,prepareImport,commitImport,undoImport} from '@/lib/data-import';
import {encryptionConfigured} from '@/lib/sensitive-encryption';
import {unseal} from '@/lib/staff-security';
import {roleCanOwnCase} from '@/lib/service-cases';
import {z} from 'zod';
import {ROLE_ACCESS,type RoleKey} from '@/lib/permissions';

export const dynamic='force-dynamic';
export const maxDuration=120;
const headers={'Cache-Control':'private, no-store'};
async function actor(){const u=await requireSession('settings:manage');assertImportAccess(u);return u;}
function failure(e:unknown){if(e instanceof z.ZodError)return Response.json({error:'Check the import fields and row limits.'},{status:400,headers});if(e instanceof ApiError)return jsonError(e);if(e&&typeof e==='object'&&'code'in e&&['P2002','P2034'].includes(String(e.code)))return Response.json({error:'Another import or record changed concurrently. Check batch status and validate again.'},{status:409,headers});console.error('Data import failed',{type:e instanceof Error?e.name:'Unknown'});return Response.json({error:'The import could not complete. Check its status before retrying the same batch.'},{status:500,headers});}
export async function GET(req:Request){try{
 const user=await actor(),id=new URL(req.url).searchParams.get('id');
 await prisma.dataImportBatch.updateMany({where:{status:{in:['DRAFT','READY']},expiresAt:{lt:new Date()}},data:{status:'EXPIRED',payload:'',preview:''}});
 if(id){const batch=await prisma.dataImportBatch.findUnique({where:{id}});if(!batch||batch.actorId!==user.id)throw new ApiError(404,'Import batch unavailable.');const draft=batch.payload?JSON.parse(unseal(batch.payload,'import-payload:'+id)):null;return Response.json({id:batch.id,status:batch.status,source:batch.source,branchId:batch.branchId,ownerId:draft?.ownerId,plan:batch.preview?JSON.parse(unseal(batch.preview,'import-preview:'+id)):null,result:batch.result?JSON.parse(batch.result):null},{headers});}
 const[batches,branches,staff]=await Promise.all([
  prisma.dataImportBatch.findMany({where:{actorId:user.id},select:{id:true,source:true,status:true,createdAt:true,committedAt:true,result:true},orderBy:{createdAt:'desc'},take:30}),
  prisma.branch.findMany({select:{id:true,name:true,code:true},orderBy:{name:'asc'}}),
  prisma.user.findMany({where:{active:true},select:{id:true,name:true,email:true,branchId:true,role:{select:{key:true}}},orderBy:{name:'asc'}}),
 ]);
 return Response.json({encryptionReady:encryptionConfigured(),batches:batches.map(b=>({...b,result:b.result?JSON.parse(b.result):null})),branches,owners:staff.filter(s=>roleCanOwnCase(s.role.key)).map(({role,...s})=>({...s,allBranches:ROLE_ACCESS[role.key as RoleKey]==='ALL'})),defaultBranchId:user.branchId,defaultOwnerId:user.id},{headers});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
 const user=await actor(),body=await boundedJson(req,2*1024*1024);
 if(body.action==='prepare'){const{action,...draft}=body;void action;return Response.json(await prepareImport(prisma,importDraftSchema.parse(draft),user),{headers});}
 const input=z.object({action:z.enum(['commit','undo']),id:z.string().uuid(),confirm:z.string().optional()}).strict().parse(body);
 if(input.action==='undo'){if(input.confirm!=='UNDO '+input.id)throw new ApiError(400,'Type the exact undo confirmation.');return Response.json(await undoImport(prisma,input.id,user),{headers});}
 return Response.json(await commitImport(prisma,input.id,user),{headers});
}catch(e){return failure(e);}}
