export type PassportProfile={fullName:string;passportNumber?:string|null;passportExpiry?:Date|string|null;passportIssueDate?:Date|string|null};
const dateOnly=(value:Date|string|null|undefined)=>value instanceof Date?value.toISOString().slice(0,10):typeof value==="string"&&/^\d{4}-\d{2}-\d{2}/.test(value)?value.slice(0,10):null;
/** Intake stays possible without a passport; run this at confirmation/issue boundaries. */
export function passportReadiness(travellers:PassportProfile[],scope:string,service:string,until:Date|string|null,day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(new Date())){
 if(service!=="VISA"&&!["DOMESTIC","INTERNATIONAL"].includes(scope))return ["Choose domestic or international travel before confirmation."];
 if(scope!=="INTERNATIONAL"&&service!=="VISA")return [];
 if(!travellers.length)return ["Select at least one traveller before confirmation."];
 const through=dateOnly(until)??day;
 return travellers.flatMap(person=>{const name=person.fullName||"Traveller",expiry=dateOnly(person.passportExpiry),issue=dateOnly(person.passportIssueDate);const issues:string[]=[];
 if(!person.passportNumber?.trim()||/^(?:enc:)?v1\./.test(person.passportNumber))issues.push(`${name}: passport number is required before international or visa confirmation.`);
 if(!expiry)issues.push(`${name}: enter the passport expiry date.`);else if(expiry<through||expiry<day)issues.push(`${name}: passport expires before the required travel date.`);
 if(issue&&issue>day)issues.push(`${name}: review the future passport issue date.`);return issues;});
}
