export const IMPORT_ENTITIES=['clients','cases','travellers'] as const;
export type ImportEntity=typeof IMPORT_ENTITIES[number];
export type ImportTable={headers:string[];rows:Record<string,string>[]};
export const IMPORT_FIELDS={
 clients:['externalId','name','phone','email','city','address','type','companyName','gstNumber','crmClientCode'],
 cases:['externalId','clientRef','service','title','status','openedOn','legacyReference','legacyStage','ownerEmail','nextFollowUpAt','nextAction','notes'],
 travellers:['externalId','clientRef','name','relation','dateOfBirth','nationality','passportNumber','passportExpiry'],
} as const;
export const REQUIRED_IMPORT_FIELDS={clients:['externalId','name','phone'],cases:['externalId','clientRef','service','title','openedOn'],travellers:['externalId','clientRef','name']} as const;
