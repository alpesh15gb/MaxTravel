import type {Prisma} from "@prisma/client";
import type {SessionUser} from "./session";
import {CASE_STATUSES,CASE_SERVICES} from "./case-constants";
import {serviceCaseScope} from "./service-cases";
export function caseFilters(input:Record<string,unknown>){const value=(key:string)=>typeof input[key]==="string"?(input[key] as string).trim().slice(0,200):"";return {q:value("q").slice(0,100),status:CASE_STATUSES.includes(value("status") as typeof CASE_STATUSES[number])?value("status"):"",service:CASE_SERVICES.includes(value("service") as typeof CASE_SERVICES[number])?value("service"):"",customer:value("customer"),owner:value("owner")};}
export function caseListWhere(user:SessionUser,f:ReturnType<typeof caseFilters>):Prisma.ServiceCaseWhereInput{return {AND:[serviceCaseScope(user),f.q?{OR:[{caseNo:{contains:f.q}},{title:{contains:f.q}},{customer:{name:{contains:f.q}}},{customer:{code:{contains:f.q}}}]}:{},f.status?{status:f.status}:{},f.service?{service:f.service}:{},f.customer?{customerId:f.customer}:{},f.owner?{ownerId:f.owner}:{}]};}
