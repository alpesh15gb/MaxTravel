"""Populated SQLite upgrade; no application database or environment credentials."""
import sqlite3, tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
name = '20261103140000_travel_master_completion'
with tempfile.TemporaryDirectory(prefix='travel-master-upgrade-') as temporary:
    db = sqlite3.connect(str(Path(temporary) / 'fixture.db'))
    db.row_factory = sqlite3.Row
    for migration in sorted((root / 'prisma/migrations').iterdir()):
        if migration.is_dir() and migration.name < name:
            db.executescript((migration / 'migration.sql').read_text(encoding='utf-8-sig'))
    db.execute('PRAGMA foreign_keys=ON')
    def add(table, values):
        for column in db.execute(f'PRAGMA table_info("{table}")'):
            if column['name'] not in values and column['notnull'] and column['dflt_value'] is None:
                kind = column['type']
                values[column['name']] = 1 if kind in ('INTEGER', 'REAL', 'BOOLEAN') else '2026-11-03 00:00:00' if kind == 'DATETIME' else 'fixture-' + column['name']
        fields = ','.join('"' + field + '"' for field in values)
        db.execute(f'INSERT INTO "{table}" ({fields}) VALUES ({",".join("?" for _ in values)})', tuple(values.values()))
    add('Role', {'id':'role','key':'OWNER'})
    add('Branch', {'id':'branch','code':'FIXTURE'})
    add('User', {'id':'staff','roleId':'role','branchId':'branch'})
    add('Customer', {'id':'client','branchId':'branch','assignedToId':'staff'})
    add('Traveller', {'id':'person','customerId':'client'})
    add('Document', {'id':'file','customerId':'client','travellerId':'person','docNo':'DOC-FIXTURE','storagePath':'unchanged.pdf'})
    add('TravellerIdentityDocument', {'id':'identity','travellerId':'person','kind':'PASSPORT','documentNumber':'unchanged-ciphertext','numberLookup':'unchanged-digest','issuingCountry':'IN'})
    add('Booking', {'id':'booking','bookingNo':'BK-FIXTURE','customerId':'client','ownerId':'staff','branchId':'branch','sellingPrice':12345})
    add('BookingTraveller', {'id':'booking-person','bookingId':'booking','travellerId':'person'})
    tables = ['Customer','Traveller','Document','TravellerIdentityDocument','Booking','BookingTraveller']
    before = {table:dict(db.execute(f'SELECT * FROM "{table}" LIMIT 1').fetchone()) for table in tables}
    db.executescript((root / 'prisma/migrations' / name / 'migration.sql').read_text())
    for table in tables:
        after = dict(db.execute(f'SELECT * FROM "{table}" LIMIT 1').fetchone())
        assert all(after[key] == value for key,value in before[table].items()), table
    assert db.execute('SELECT aadhaarMasked FROM Document').fetchone()[0] == 0
    assert db.execute('SELECT passportValidityMonths FROM Booking').fetchone()[0] == 0
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    db.close()
print('PASS populated travel Master upgrade: identities, files, money and links preserved; defaults and foreign keys verified.')
