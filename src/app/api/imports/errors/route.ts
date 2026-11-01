import {prisma} from '@/lib/db';
import {requireSession,ApiError,jsonError} from '@/lib/guard';
import {assertImportAccess,type ImportPlan} from '@/lib/data-import';
import {unseal} from '@/lib/staff-security';
import {safeCsv} from '@/lib/data-import-files';
export async function GET(req:Request){try{const user=await requireSession('settings:manage');assertImportAccess(user);const id=new URL(req.url).searchParams.get('id')??'';const b=await prisma.dataImportBatch.findUnique({where:{id}});if(!b||b.actorId!==user.id||!b.preview||b.expiresAt<new Date())throw new ApiError(404,'Preview unavailable. Validate the file again.');const p=JSON.parse(unseal(b.preview,'import-preview:'+b.id)) as ImportPlan;return new Response('\uFEFF'+safeCsv([['entity','row','field','issue'],...p.issues.map(x=>[x.entity,String(x.row),x.field,x.message])]),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="maxtravel-import-issues.csv"','Cache-Control':'private, no-store'}});}catch(e){return jsonError(e);}}
