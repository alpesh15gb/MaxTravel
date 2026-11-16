import {z} from 'zod';

const requestedBudgetSchema=z.object({amountRupees:z.number().positive().max(100000000),basis:z.enum(['TOTAL','PER_PERSON'])}).strict();
/** Structured budgets never pass through generic notes or unrestricted API spreads. */
export function projectSalesBudget(lead:{requestedBudgetJson:string|null;budgetMinor:number;source:string},canViewFinance:boolean){
  let requestedBudget:z.infer<typeof requestedBudgetSchema>|null=null;
  if(canViewFinance&&lead.requestedBudgetJson){
    try{const parsed=requestedBudgetSchema.safeParse(JSON.parse(lead.requestedBudgetJson));if(parsed.success)requestedBudget=parsed.data;}catch{/* An invalid saved budget requires staff review, never a guessed amount. */}
  }
  return {requestedBudgetJson:undefined,requestedBudget,budgetMinor:canViewFinance&&lead.source!=='MAX_AI_WEBSITE'?lead.budgetMinor:null};
}
