"""Exercise retirement against the full SQLite migration chain, never an application database."""
from pathlib import Path
import json,sqlite3,tempfile
from contextlib import closing
ROOT=Path(__file__).resolve().parents[1]
NAME='20261103110000_retire_whatsapp'
removed={'CaseMessage','WhatsAppMessage','WhatsAppThread','WhatsAppInbound','IncomingMedia','QuickReply','WhatsAppAttachment'}
with tempfile.TemporaryDirectory(prefix='maxtravel-retire-messaging-') as directory, closing(sqlite3.connect(Path(directory)/'retirement-test.db')) as db:
 data=Path(directory);db.row_factory=sqlite3.Row
 for migration in sorted((ROOT/'prisma/migrations').glob('*/migration.sql')):
  if migration.parent.name==NAME:break
  db.executescript(migration.read_text(encoding='utf-8-sig'))
 db.execute('PRAGMA foreign_keys=ON')
 def add(table,values):
  # Supply required fields unrelated to these assertions without coupling the test to defaults.
  for col in db.execute(f'PRAGMA table_info("{table}")').fetchall():
   if col['name'] not in values and col['notnull'] and col['dflt_value'] is None:
    values[col['name']]=1 if col['type'] in ('INTEGER','REAL','BIGINT','BOOLEAN') else '2026-11-03 00:00:00' if col['type']=='DATETIME' else f'test-{table}-{col["name"]}'
  db.execute(f'INSERT INTO "{table}" ({",".join(chr(34)+k+chr(34) for k in values)}) VALUES ({",".join("?" for _ in values)})',tuple(values.values()))
 add('Role',{'id':'role','key':'OWNER','name':'Owner','desc':'Test'})
 add('Branch',{'id':'branch','code':'TEST'})
 add('User',{'id':'staff','roleId':'role','branchId':'branch'})
 add('Customer',{'id':'client','branchId':'branch','assignedToId':'staff','whatsappOptIn':1,'email':'fixture@example.test'})
 add('ServiceCase',{'id':'case','customerId':'client','ownerId':'staff','branchId':'branch'})
 add('Document',{'id':'passport','customerId':'client','docNo':'DOC-TEST','docType':'Passport','uploadSource':'WHATSAPP','storagePath':'passport.pdf'})
 add('WhatsAppAttachment',{'id':'pdf','customerId':'client','filename':'ticket.pdf','storageKey':'00000000-0000-4000-8000-000000000001.pdf','sha256':'test-hash','size':18,'createdBy':'staff'})
 add('WhatsAppThread',{'id':'thread','customerId':'client','phone':'+910000000001'})
 add('WhatsAppMessage',{'id':'message','threadId':'thread','direction':'OUT','body':'queued test','status':'QUEUED','attachmentId':'pdf','staffId':'staff'})
 add('CaseMessage',{'id':'link','caseId':'case','messageId':'message','linkedById':'staff'})
 add('IncomingMedia',{'id':'incoming','documentId':'passport'})
 add('WhatsAppInbound',{'id':'inbound'})
 add('QuickReply',{'id':'quick'})
 add('AuditLog',{'id':'audit','userId':'staff','action':'CREATE','entity':'Document','entityId':'passport'})
 add('Activity',{'id':'activity','customerId':'client','type':'WHATSAPP','summary':'Historical customer activity','link':'/whatsapp?thread=thread'})
 add('Notification',{'id':'obsolete','userId':'staff','link':'/whatsapp?thread=thread'})
 add('Notification',{'id':'keep','userId':'staff','link':'/cases/case'})
 add('Task',{'id':'followup','ownerId':'staff','branchId':'branch','customerId':'client','sourceKey':'inbound-review:test','title':'Review unreadable message'})
 add('StaffChatThread',{'id':'chat','caseId':'case'})
 add('StaffChatMember',{'id':'member','threadId':'chat','userId':'staff'})
 add('StaffChatMessage',{'id':'staff-message','threadId':'chat','authorId':'staff','body':'Internal team message','sequence':1})
 add('ClientEmail',{'id':'email','customerId':'client','body':'Email queue remains intact','status':'QUEUED'})
 package=json.dumps({'title':'Test package','contactEmail':'test@example.test','contactWhatsapp':'+910000000000'})
 add('TravelPackage',{'id':'package','draftJson':package,'publishedJson':package})
 for index,key in enumerate(['wa.meta.token','whatsapp.worker.lease','evo.api','evolution.instance','work.inbound.cursor','agency.name','counter.C']):add('Settings',{'id':str(index),'key':key,'value':'preserved-private-value'})
 kept_settings={r[0]for r in db.execute('SELECT "key" FROM "Settings"') if not r[0].startswith(('wa.','whatsapp.','evo.','evolution.')) and r[0]!='work.inbound.cursor'}
 preserved=['User','ServiceCase','AuditLog','StaffChatThread','StaffChatMember','StaffChatMessage','ClientEmail']
 originals={table:[dict(r)for r in db.execute(f'SELECT * FROM "{table}"')]for table in preserved}
 customer=dict(db.execute('SELECT * FROM "Customer"').fetchone());customer.pop('whatsappOptIn')
 uploads=data/'uploads';(uploads/'whatsapp-pdf').mkdir(parents=True)
 files={uploads/'passport.pdf':b'private passport fixture',uploads/'whatsapp-pdf/00000000-0000-4000-8000-000000000001.pdf':b'%PDF-1.7 test %%EOF'}
 for file,content in files.items():file.write_bytes(content)
 sql=(ROOT/'prisma/migrations'/NAME/'migration.sql').read_text();db.commit();db.executescript(sql)
 assert not db.execute('PRAGMA foreign_key_check').fetchall()
 tables={r[0]for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")};assert not removed&tables,removed&tables
 assert dict(db.execute('SELECT * FROM "Customer"').fetchone())==customer
 for table,rows in originals.items():assert[dict(r)for r in db.execute(f'SELECT * FROM "{table}"')]==rows,table
 assert db.execute('SELECT "uploadSource" FROM "Document"').fetchone()[0]=='IMPORTED'
 assert db.execute('SELECT "storageKey" FROM "PrivatePdfAttachment"').fetchone()[0]=='whatsapp-pdf/00000000-0000-4000-8000-000000000001.pdf'
 assert db.execute('SELECT count(*) FROM "PrivatePdfAttachment"').fetchone()[0]==1
 assert {r[0]for r in db.execute('SELECT "key" FROM "Settings"')}==kept_settings
 assert {r[0]for r in db.execute('SELECT "id" FROM "Notification"')}=={'keep'}
 activity=db.execute('SELECT "type","link" FROM "Activity"').fetchone();assert tuple(activity)==('MESSAGE',None)
 assert db.execute('SELECT "sourceKey" FROM "Task"').fetchone()[0]is None
 for row in db.execute('SELECT "draftJson","publishedJson" FROM "TravelPackage"'):
  for value in row:assert json.loads(value)=={'title':'Test package','contactEmail':'test@example.test'}
 for file,content in files.items():assert file.read_bytes()==content
 # PostgreSQL must perform exactly the same data retirement/preservation before provider-specific index/JSON syntax.
 pg=(ROOT/'prisma/postgresql/migrations'/NAME/'migration.sql').read_text()
 assert sql.split('DROP INDEX')[0]==pg.split('ALTER TABLE "PrivatePdfAttachment" RENAME CONSTRAINT')[0]
 assert '"draftJson"::jsonb' in pg and '"publishedJson"::jsonb' in pg
 db.close()
print('PASS full SQLite upgrade: provider tables/settings retired; customer identity, documents and file bytes, PDF metadata, internal chat, email queue, audit, staff and case history preserved; PostgreSQL retirement data parity.')
