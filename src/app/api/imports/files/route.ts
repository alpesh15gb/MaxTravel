import {requireSession,ApiError,jsonError} from '@/lib/guard';
import {assertImportAccess} from '@/lib/data-import';
import {IMPORT_ENTITIES,parseImportFile,type ImportEntity} from '@/lib/data-import-files';

export async function POST(req:Request){try{
 assertImportAccess(await requireSession('settings:manage'));
 const reader=req.body?.getReader();if(!reader)throw new ApiError(400,'Choose a file.');const chunks:Uint8Array[]=[];let size=0;
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2*1024*1024+65536){await reader.cancel();throw new ApiError(413,'Use a file up to 2 MB.');}chunks.push(part.value);}
 const form=await new Request('http://localhost/import',{method:'POST',headers:{'Content-Type':req.headers.get('content-type')??''},body:Buffer.concat(chunks)}).formData();
 const entity=String(form.get('entity'));if(!IMPORT_ENTITIES.includes(entity as ImportEntity))throw new ApiError(400,'Choose clients, cases or travellers.');
 const file=form.get('file');if(!(file instanceof File))throw new ApiError(400,'Choose a CSV or XLSX file.');
 let table;try{table=await parseImportFile(file.name,Buffer.from(await file.arrayBuffer()),entity as ImportEntity);}catch(e){throw new ApiError(400,e instanceof Error?e.message:'Cannot read this file.');}
 return Response.json(table,{headers:{'Cache-Control':'private, no-store'}});
}catch(e){if(e instanceof ApiError)return jsonError(e);return Response.json({error:'Cannot read this file. Use an ordinary CSV or XLSX file.'},{status:400});}}
