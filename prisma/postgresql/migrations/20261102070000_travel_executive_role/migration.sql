-- Add an available role only. Existing staff permissions and branches are unchanged.
INSERT INTO "Role" ("id", "key", "name", "desc")
VALUES ('sys-role-travel-executive', 'TRAVEL_EXECUTIVE', 'Visa & Ticketing Executive',
        'Assigned visa applications and flight/hotel bookings')
ON CONFLICT ("key") DO NOTHING;
