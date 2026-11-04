import {requirePage} from '@/lib/guard';
import {assertImportAccess} from '@/lib/data-import';
import {redirect} from 'next/navigation';
import ImportCentre from './ImportCentre';
export const dynamic='force-dynamic';
export default async function Page(){const user=await requirePage('settings:manage');try{assertImportAccess(user);}catch{redirect('/today?denied=imports');}return <ImportCentre/>;}
