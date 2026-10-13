import templates from "../data/visa-tourist-india.mjs";

// Default is an offline preview. Writes use the existing authenticated, audited API.
const apply = process.argv.includes("--apply");
const origin = process.env.CRM_IMPORT_ORIGIN;
const cookie = process.env.CRM_IMPORT_COOKIE;
const keys = new Set();
for (const t of templates) {
  const key = `${t.country}|${t.visaType}|${t.applicantType}`;
  if (keys.has(key) || !t.items.length || t.items.length > 100) throw new Error(`Invalid template: ${key}`);
  keys.add(key);
  for (const i of t.items) {
    if (!i.name || i.name.length > 120 || !i.instructions || !["ALL","ADULT","MINOR"].includes(i.travellerType)) throw new Error(`Invalid item: ${key}`);
  }
}
if (!apply) {
  console.log("PREVIEW ONLY — no database or network writes.");
  for (const t of templates) console.log(`${t.country}: ${t.items.length} items (${t.visaType}/${t.applicantType})`);
  console.log(`${templates.length} templates validated. To import, set CRM_IMPORT_ORIGIN and CRM_IMPORT_COOKIE in a private terminal, then pass --apply.`);
} else {
  if (!origin || !cookie) throw new Error("CRM_IMPORT_ORIGIN and an authorized administrator CRM_IMPORT_COOKIE are required. Never commit session credentials.");
  const url = new URL(origin);
  if (url.origin !== origin || !["http:","https:"].includes(url.protocol)) throw new Error("CRM_IMPORT_ORIGIN must be a bare HTTP(S) origin.");
  async function request(method, body) {
    const r = await fetch(`${origin}/api/checklists`,{method,redirect:"error",signal:AbortSignal.timeout(30000),headers:{Cookie:cookie,Origin:origin,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if (!r.ok) throw new Error(`Checklist API ${method}: HTTP ${r.status}. Import stopped; rerun safely after resolving access or validation.`);
    return r.json();
  }
  const {checklists} = await request("GET");
  if (!Array.isArray(checklists)) throw new Error("Unexpected checklist response.");
  let imported = 0;
  for (const t of templates) {
    // Never supersede an agency's own template or reactivate a superseded pack.
    if (checklists.some(c=>c.country.toLowerCase()===t.country.toLowerCase() && c.visaType.toUpperCase()===t.visaType && c.applicantType===t.applicantType)) {
      console.log(`SKIPPED existing: ${t.country}`); continue;
    }
    await request("POST",t);
    imported++;
    console.log(`IMPORTED: ${t.country}`);
  }
  const {checklists: saved} = await request("GET");
  for (const t of templates) {
    if (!saved.some(c=>c.country.toLowerCase()===t.country.toLowerCase() && c.visaType.toUpperCase()===t.visaType && c.applicantType===t.applicantType)) throw new Error(`Read-back missing ${t.country}`);
  }
  console.log(`Verified all ${templates.length} destination keys; created ${imported}. Existing cases and templates preserved.`);
}
