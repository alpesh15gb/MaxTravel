/** Preserve SQLite LIKE search behavior when the same model runs on PostgreSQL. */
export function normalizeTextSearch(value:unknown):unknown {
 if(Array.isArray(value))return value.map(normalizeTextSearch);
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return value;
 const filter=value as Record<string,unknown>;
 const hasPattern=(f:Record<string,unknown>):boolean=>['contains','startsWith','endsWith'].some(k=>typeof f[k]==='string')||!!(f.not&&typeof f.not==='object'&&hasPattern(f.not as Record<string,unknown>));
 // Nested StringFilter.not inherits its parent's mode; Prisma rejects a nested mode.
 if(hasPattern(filter))return {...filter,mode:filter.mode??'insensitive'};
 return Object.fromEntries(Object.entries(filter).map(([k,v])=>[k,normalizeTextSearch(v)]));
}
