/** Stable, readable list shared by automatic and manual document requests. */
export function documentList(docs:{docType:string}[]) {
 const names=Array.from(new Set(docs.map(d=>d.docType.replace(/[\r\n]+/g," ").trim()).filter(Boolean)));
 const lines:string[]=[];let length=0;
 for(const [i,name] of names.entries()){
  const line=`${i+1}. ${name}`;
  if(length+line.length>1600){lines.push(`Additional requirements are listed on the private upload page (${names.length-i} more).`);break;}
  lines.push(line);length+=line.length+1;
 }
 return lines.join("\n");
}

export function documentRequestMessage({customer,caseNo,docs,url,expires,agency}:{customer:string;caseNo:string;docs:{docType:string}[];url:string;expires:string;agency:string}){
 return `Hello ${customer},\n\n*Documents required*\nVisa case: *${caseNo}*\n\nPlease upload the following outstanding documents:\n\n${documentList(docs)}\n\n*Private upload link*\n${url}\n\n*Link expires:* ${expires} IST\n\nPlease keep this link private.\nFor help, contact ${agency}.`;
}
