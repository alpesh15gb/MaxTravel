import {z} from "zod";
export const caseConfigSchema=z.object({referencePrefix:z.string().regex(/^[A-Z][A-Z0-9]{1,7}$/),defaultOwnerId:z.string().max(200),followUpDays:z.number().int().min(0).max(365),requireResolvedWorkToClose:z.boolean()}).strict();
export type CaseConfig=z.infer<typeof caseConfigSchema>;
export const DEFAULT_CASE_CONFIG:CaseConfig={referencePrefix:"CASE",defaultOwnerId:"",followUpDays:2,requireResolvedWorkToClose:true};
export function readCaseConfig(value?:string|null):CaseConfig {try{return caseConfigSchema.parse(JSON.parse(value??""));}catch{return {...DEFAULT_CASE_CONFIG};}}
