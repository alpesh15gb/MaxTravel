import Link from 'next/link';

export default function ClientWorkspaceLinks({permissions}:{permissions:readonly string[]}){
 if(!permissions.includes('customer:view'))return null;
 return <nav className="mb-5 flex flex-wrap gap-2" aria-label="Related client workspaces"><Link className="btn-secondary" href="/customers">Customers</Link><Link className="btn-secondary" href="/sales">Enquiries &amp; quotes</Link></nav>;
}
