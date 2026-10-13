import type { AccountReport } from "./account-reports";
import path from "node:path";

const PDF_COLORS:Record<"ink"|"muted"|"surface"|"line",[number,number,number]>={ink:[24,45,59],muted:[83,100,116],surface:[237,243,245],line:[220,229,232]};
const money=(v:number)=>`INR ${v.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const csvCell=(value:unknown)=>{let text=String(value??"");if(typeof value==="string"&&/^\s*[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
export function accountCsv(r:AccountReport){
 const rows:unknown[][]=[[r.agency,r.title],["Period",r.period.from,r.period.to],["Account",r.party?.name??"All permitted accounts"],["Currency","INR"],["Generated",r.generatedAt],...[...r.summary].map(s=>[s.label,s.value]),[],r.columns.map(c=>c.label),...r.rows.map(row=>r.columns.map(c=>row[c.key])),[],["Definitions"],...r.warnings.map(w=>[w])];
 return "\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n");
}
export async function accountWorkbook(r:AccountReport){
 const {default:ExcelJS}=await import("exceljs");const book=new ExcelJS.Workbook();book.creator=r.agency;
 const summary=book.addWorksheet("Report details");
 summary.columns=[{width:38},{width:95}];summary.addRows([[r.agency,r.title],["From",r.period.from],["Through",r.period.to],["Account",r.party?.name??"All permitted accounts"],["Currency","INR"],["Generated",r.generatedAt],...r.summary.map(s=>[s.label,s.value]),[],...r.warnings.map(w=>["Definition",w])]);
 summary.eachRow(row=>{row.alignment={vertical:"top",wrapText:true};});
 const sheet=book.addWorksheet("Transactions",{views:[{state:"frozen",ySplit:1}]});
 sheet.columns=r.columns.map(c=>({header:c.label,key:c.key,width:c.money?22:c.key==="description"?65:28}));
 for(const row of r.rows)sheet.addRow(r.columns.map(c=>row[c.key]??null));
 sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:r.columns.length}};
 sheet.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};sheet.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF123647"}};
 r.columns.forEach((c,i)=>{if(c.money)sheet.getColumn(i+1).numFmt='"INR "#,##0.00;[Red]-"INR "#,##0.00';});
 sheet.eachRow(row=>{row.alignment={vertical:"top",wrapText:true};});
 return Buffer.from(await book.xlsx.writeBuffer());
}

/** A4 statement with measured rows, repeated headings, page numbers and carried balance. */
export async function accountPdf(r:AccountReport):Promise<Buffer>{
 const {default:PDFDocument}=await import("pdfkit");
 const doc=new PDFDocument({size:"A4",margin:38,bufferPages:true,info:{Title:r.title,Author:r.agency}});
 const chunks:Buffer[]=[];const done=new Promise<Buffer>((resolve,reject)=>{doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
 doc.font(path.join(process.cwd(),"node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff"));
 const left=38,right=557,width=519;let y=38;
 const text=(s:string,size=10,color:[number,number,number]=PDF_COLORS.ink)=>{doc.fillColor(color).fontSize(size);const h=doc.heightOfString(s,{width});if(y+h>770){doc.addPage();y=38;}doc.text(s,left,y,{width});y+=h+7;};
 text(r.agency,20);text(r.title,15);text(`${r.party?.name??""} · ${r.party?.code??""}`,11);if(r.party?.address)text(r.party.address);
 text(`${r.period.from} to ${r.period.to} · INR · India calendar`,9,PDF_COLORS.muted);text(r.description,9,PDF_COLORS.muted);
 for(const s of r.summary)text(`${s.label}: ${s.money?money(s.value):s.value}`,10);
 // Single-party statements always have six fixed columns, independent of registers.
 const widths=[55,85,160,73,73,73];const xs=widths.map((_,i)=>left+widths.slice(0,i).reduce((a,b)=>a+b,0));
 function tableHead(){doc.fillColor(PDF_COLORS.surface).rect(left,y,width,35).fill();doc.fillColor(PDF_COLORS.ink).fontSize(8);r.columns.forEach((c,i)=>doc.text(c.label,xs[i]+4,y+5,{width:widths[i]-8,height:29}));y+=39;}
 tableHead();let running=r.summary.find(s=>s.label==="Opening balance")?.value??0;
 const physicalRows=r.rows.flatMap(row=>{
  const parts=r.columns.map(c=>c.money?[row[c.key]]:String(row[c.key]??"").match(/[\s\S]{1,240}/g)||[""]);
  const count=Math.max(...parts.map(p=>p.length));
  return Array.from({length:count},(_,n)=>Object.fromEntries(r.columns.map((c,i)=>[c.key,c.money?(n===count-1?row[c.key]:null):parts[i][n]??""])));
 });
 for(const row of physicalRows){
  const cells=r.columns.map(c=>c.money?(row[c.key]===null?"":Number(row[c.key]??0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})):String(row[c.key]??""));
  doc.fontSize(8);const height=Math.max(24,...cells.map((s,i)=>doc.heightOfString(s,{width:widths[i]-8})+12));
  if(y+height>735){doc.fillColor(PDF_COLORS.muted).text(`Carried forward: ${money(running)}`,left,y+4,{width,align:"right"});doc.addPage();y=38;text(`${r.agency} · ${r.title} · ${r.party?.name??""}`,10);text(`Brought forward: ${money(running)}`,9);tableHead();}
  doc.fillColor(PDF_COLORS.ink).fontSize(8);cells.forEach((s,i)=>doc.text(s,xs[i]+4,y+5,{width:widths[i]-8,align:r.columns[i].money?"right":"left"}));
  y+=height;doc.strokeColor(PDF_COLORS.line).moveTo(left,y).lineTo(right,y).stroke();running=Number(row.balance??running);
 }
 if(!r.rows.length)text("No movements in this period. The opening balance is carried forward.",10);
 y+=12;text(`Closing balance: ${money(r.summary.find(s=>s.label==="Closing balance")?.value??0)}`,12);
 for(const warning of r.warnings)text(warning,8,PDF_COLORS.muted);
 const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(pages.start+i);doc.fontSize(8).fillColor(PDF_COLORS.muted).text(`Generated ${r.generatedAt.slice(0,19).replace("T"," ")} UTC · Page ${i+1} of ${pages.count}`,left,785,{width,align:"center",lineBreak:false});}
 doc.end();return done;
}
