import {requireSession,jsonError} from '@/lib/guard';
import {assertImportAccess} from '@/lib/data-import';
import {importWorkbook} from '@/lib/data-import-files';
export async function GET(){try{assertImportAccess(await requireSession('settings:manage'));return new Response(new Uint8Array(await importWorkbook()),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="maxtravel-client-case-import.xlsx"','Cache-Control':'private, no-store'}});}catch(e){return jsonError(e);}}
