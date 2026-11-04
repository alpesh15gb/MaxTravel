import type { AccountReport } from "./account-reports";
import path from "node:path";
import { enumLabel } from "./labels";
import { csvDocument } from "./csv-export";
import { dateLabel, dateTimeLabel } from "./dates";

/** Report generation time in India time, e.g. "05 Nov 2026, 1:09 am IST". */
export const generatedLabel=(iso:string)=>`${dateTimeLabel(iso)} IST`;

const PDF_COLORS:Record<"ink"|"muted"|"surface"|"line",[number,number,number]>={ink:[24,45,59],muted:[83,100,116],surface:[237,243,245],line:[220,229,232]};
const exportValue=(row:AccountReport["rows"][number],key:string)=>{
 const value=row[key];
 return key==="status"&&typeof value==="string"&&/^[A-Z]+(?:_[A-Z]+)*$/.test(value)?enumLabel(value):value;
};
const currencyMoney=(v:number,currency="INR")=>`${currency} ${v.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export function accountCsv(r:AccountReport){
 completeReport(r);
 const rows:unknown[][]=[[r.agency,r.title],["Basis",r.description],["Date basis",r.metadata.dateBasis],["Calendar","Asia/Kolkata (UTC+05:30); inclusive end day"],["Period",r.period.from,r.period.to],["Account",r.metadata.account],["Currency",r.metadata.currency],["Scope",r.metadata.scope],...r.metadata.filters.map(f=>[f.label,f.value]),["Generated (India time)",generatedLabel(r.generatedAt)],["Exported rows",r.rows.length],...[...r.summary].map(s=>[s.label,s.value]),[],r.columns.map(c=>c.label),...r.rows.map(row=>r.columns.map(c=>exportValue(row,c.key))),[],["Definitions"],...r.warnings.map(w=>[w])];
 return csvDocument(rows);
}
const DEFAULT_EXCEL_MONEY = '"INR "#,##0.00;[Red]-"INR "#,##0.00';
const DATE_KEYS = new Set(["date", "due", "booked", "travel", "deadline", "supplierReceived"]);
// Report dates are already India-calendar days. Excel stores a calendar date without a timezone.
function excelDay(value: unknown): Date | null {
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const date=new Date(`${value}T00:00:00.000Z`);
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?date:null;
}
function completeReport(r:AccountReport){
 if(r.rows.length!==r.totalRows)throw new Error("Export requires the full report, not a preview page. Reload the report and try again.");
}

export async function accountWorkbook(r:AccountReport){
 completeReport(r);
 const currency=/^[A-Z]{3}$/.test(r.metadata.currency)?r.metadata.currency:"INR";const EXCEL_MONEY=currency==="INR"?DEFAULT_EXCEL_MONEY:`"${currency} "#,##0.00;[Red]-"${currency} "#,##0.00`;
 const {default:ExcelJS}=await import("exceljs");
 const book=new ExcelJS.Workbook();book.creator=r.agency;book.title=r.title;
 book.created=new Date(r.generatedAt);book.modified=new Date(r.generatedAt);
 const summary=book.addWorksheet("Report details",{views:[{state:"normal",showGridLines:false}]});
 summary.columns=[{width:42},{width:95}];
 summary.addRows([[r.agency,r.title],["Basis",r.description],["Date basis",r.metadata.dateBasis],["Calendar","Asia/Kolkata (UTC+05:30); inclusive end day"],["From",excelDay(r.period.from)??r.period.from],["Through",excelDay(r.period.to)??r.period.to],["Account",r.metadata.account],["Currency",r.metadata.currency],["Scope",r.metadata.scope],...r.metadata.filters.map(f=>[f.label,f.value]),["Generated (India time)",generatedLabel(r.generatedAt)],["Exported rows",r.rows.length],["Coverage",r.rows.length?"All matching rows in the permitted scope, not only the screen page.":"No matching rows in the permitted scope."],...(r.columns.some(c=>c.money)?[["Blank monetary cells","Not recorded or not applicable; not zero. See coverage and definitions."]]:[]),[],["Summary","Value"]]);
 for(const item of r.summary){const row=summary.addRow([item.label,item.value]);row.getCell(2).numFmt=item.money?EXCEL_MONEY:"#,##0";}
 summary.addRow([]);
 for(const warning of r.warnings)summary.addRow(["Definition",warning]);
 summary.eachRow(row=>{
  row.font={name:"Arial",size:10,color:{argb:"FF182D3B"}};
  row.alignment={vertical:"top",wrapText:true};
  row.getCell(1).font={...row.font,bold:true};
  row.height=Math.max(24,...(Array.isArray(row.values)?row.values.map((v,i)=>Math.ceil(String(v??"").length/(i===1?37:88))*15+10):[24]));
  row.eachCell(cell=>{if(cell.value instanceof Date)cell.numFmt=String(row.getCell(1).value).startsWith("Generated")?'yyyy-mm-dd hh:mm:ss "UTC"':"dd mmm yyyy";});
  if(row.getCell(1).value==="Summary"){row.eachCell(cell=>{cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFEDF3F5"}};});row.font={name:"Arial",size:10,bold:true};}
 });
 summary.getRow(1).font={name:"Arial",size:14,bold:true,color:{argb:"FF123647"}};summary.getRow(1).height=32;
 summary.pageSetup={paperSize:9,orientation:"portrait",fitToPage:true,fitToWidth:1,fitToHeight:0};
 const sheet=book.addWorksheet("Transactions",{views:[{state:"frozen",ySplit:1,xSplit:Math.min(2,r.columns.length),showGridLines:false}]});
 sheet.columns=r.columns.map(c=>({header:c.label,key:c.key,width:c.money?24:c.key==="description"?65:DATE_KEYS.has(c.key)?19:30}));
 for(const row of r.rows)sheet.addRow(r.columns.map(c=>DATE_KEYS.has(c.key)?excelDay(row[c.key])??row[c.key]??null:exportValue(row,c.key)??null));
 sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:r.columns.length}};
 r.columns.forEach((c,i)=>{sheet.getColumn(i+1).numFmt=c.money?EXCEL_MONEY:DATE_KEYS.has(c.key)?"dd mmm yyyy":"General";});

 sheet.eachRow((row,n)=>{
  row.font={name:"Arial",size:10,color:{argb:"FF182D3B"}};
  row.alignment={vertical:"top",wrapText:true};
  let lines=1;
  row.eachCell((cell,i)=>{
   if(r.columns[i-1].key==="margin"&&typeof cell.value==="number")cell.font={...cell.font,color:{argb:cell.value<0?"FFB42323":cell.value>0?"FF15803D":"FF334155"}};
   cell.alignment={vertical:"top",wrapText:true,horizontal:r.columns[i-1].money?"right":"left",indent:1};
   if(typeof cell.value==="string")lines=Math.max(lines,...cell.value.split(/\r?\n/).map(line=>Math.ceil(line.length/((sheet.getColumn(i).width??28)-3))));
  });
  row.height=Math.min(409,Math.max(26,lines*15+10));
  if(n>1&&n%2===0)row.eachCell({includeEmpty:true},cell=>{cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF3F6F8"}};});
 });
 const header=sheet.getRow(1);header.height=44;
 header.font={name:"Arial",size:10,bold:true,color:{argb:"FFFFFFFF"}};
 header.eachCell(cell=>{cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF123647"}};cell.alignment={vertical:"middle",horizontal:"center",wrapText:true};});
 sheet.pageSetup={paperSize:9,orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:"1:1"};
 sheet.headerFooter={oddFooter:"&L"+r.title.replaceAll("&","&&")+"&RPage &P of &N"};
 return Buffer.from(await book.xlsx.writeBuffer());
}

/** A4 statement with measured rows, repeated headings, page numbers and carried balance. */
export async function accountPdf(r:AccountReport):Promise<Buffer>{
 completeReport(r);
 if(r.columns.length!==6||!r.summary.some(s=>s.label==="Closing balance"))return registerPdf(r);
 const money=(v:number)=>currencyMoney(v,r.metadata.currency);
 const {default:PDFDocument}=await import("pdfkit");
 const doc=new PDFDocument({size:"A4",margin:38,bufferPages:true,info:{Title:r.title,Author:r.agency}});
 const chunks:Buffer[]=[];const done=new Promise<Buffer>((resolve,reject)=>{doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
 doc.font(path.join(process.cwd(),"node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff"));
 const left=38,right=557,width=519;let y=38;
 const text=(s:string,size=10,color:[number,number,number]=PDF_COLORS.ink)=>{doc.fillColor(color).fontSize(size);const h=doc.heightOfString(s,{width});if(y+h>770){doc.addPage();y=38;}doc.text(s,left,y,{width});y+=h+7;};
 text(r.agency,20);text(r.title,15);text(`${r.party?.name??""} · ${r.party?.code??""}`,11);if(r.party?.address)text(r.party.address);
 text(`${dateLabel(r.period.from)} to ${dateLabel(r.period.to)} · ${r.metadata.currency} · India calendar`,9,PDF_COLORS.muted);text(r.metadata.dateBasis,9,PDF_COLORS.muted);text(r.description,9,PDF_COLORS.muted);
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
 const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(pages.start+i);doc.fontSize(8).fillColor(PDF_COLORS.muted).text(`Generated ${generatedLabel(r.generatedAt)} · Page ${i+1} of ${pages.count}`,left,785,{width,align:"center",lineBreak:false});}
 doc.end();return done;
}

/** Registers print as an A4 landscape table: repeated header row, measured rows, money right-aligned, India-time footer. */
async function registerPdf(r:AccountReport):Promise<Buffer>{
 const {default:PDFDocument}=await import("pdfkit");
 const doc=new PDFDocument({size:"A4",layout:"landscape",margin:30,bufferPages:true,info:{Title:r.title,Author:r.agency}}),chunks:Buffer[]=[];
 const done=new Promise<Buffer>((resolve,reject)=>{doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
 doc.font(path.join(process.cwd(),"node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff"));
 const left=30,width=782,bottom=545;let y=30;
 const block=(value:string,size=9,color:[number,number,number]=PDF_COLORS.ink)=>{doc.fontSize(size).fillColor(color);const h=doc.heightOfString(value,{width});if(y+h>bottom){doc.addPage();y=30;}doc.text(value,left,y,{width});y+=h+5;};
 block(r.agency,16);block(r.title,13);
 block(`${dateLabel(r.period.from)} to ${dateLabel(r.period.to)} · ${r.metadata.currency} · ${r.metadata.dateBasis}`,8.5,PDF_COLORS.muted);
 block(`${r.metadata.account} · ${r.metadata.scope} · ${r.totalRows} ${r.totalRows===1?"record":"records"}${r.metadata.filters.length?" · "+r.metadata.filters.map(f=>`${f.label}: ${f.displayValue??f.value}`).join(" · "):""}`,8.5,PDF_COLORS.muted);
 // Summary as a grid of label/value tiles, four per row.
 if(r.summary.length){
  y+=3;const per=4,tileW=(width-(per-1)*8)/per,tileH=34;
  r.summary.forEach((s,i)=>{const col=i%per;if(col===0&&i>0)y+=tileH+6;if(col===0&&y+tileH>bottom){doc.addPage();y=30;}const x=left+col*(tileW+8);
   doc.fillColor(PDF_COLORS.surface).rect(x,y,tileW,tileH).fill();
   doc.fillColor(PDF_COLORS.muted).fontSize(7).text(s.label,x+6,y+4,{width:tileW-12,height:11,ellipsis:true,lineBreak:false});
   const negative=s.money&&s.value<0,label=/margin|profit/i.test(s.label);
   doc.fillColor(label&&s.value>0?[21,128,61]:negative?[180,35,35]:PDF_COLORS.ink).fontSize(11).text(s.money?currencyMoney(s.value,r.metadata.currency):String(s.value),x+6,y+16,{width:tileW-12,lineBreak:false});});
  y+=tileH+10;
 }
 // Column widths: weight by kind, then scale to the page.
 const weight=(c:AccountReport["columns"][number])=>c.money?1.15:DATE_KEYS.has(c.key)?0.85:c.key==="description"?2.2:["customer","supplier","allocation","coverage","title"].includes(c.key)?1.45:1;
 const total=r.columns.reduce((n,c)=>n+weight(c),0),widths=r.columns.map(c=>weight(c)/total*width),xs=widths.map((_,i)=>left+widths.slice(0,i).reduce((a,b)=>a+b,0));
 const size=r.columns.length>11?6.5:7.5;
 const head=()=>{doc.fontSize(size);const h=Math.max(...r.columns.map((c,i)=>doc.heightOfString(c.label,{width:widths[i]-6})))+8;if(y+h+20>bottom){doc.addPage();y=30;}
  doc.fillColor([18,54,71]).rect(left,y,width,h).fill();doc.fillColor([255,255,255]);r.columns.forEach((c,i)=>doc.text(c.label,xs[i]+3,y+4,{width:widths[i]-6,align:c.money?"right":"left"}));y+=h;};
 const cell=(row:AccountReport["rows"][number],c:AccountReport["columns"][number])=>{const v=exportValue(row,c.key);if(v===null||v===undefined||v==="")return "—";if(c.money)return Number(v).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});if(DATE_KEYS.has(c.key)&&typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v))return dateLabel(v);return String(v);};
 head();
 if(!r.rows.length){y+=6;block("No records match these filters.",9,PDF_COLORS.muted);}
 r.rows.forEach((row,n)=>{
  const texts=r.columns.map(c=>cell(row,c));doc.fontSize(size);
  const h=Math.max(...texts.map((t,i)=>doc.heightOfString(t,{width:widths[i]-6})))+7;
  if(y+h>bottom){doc.addPage();y=30;head();}
  if(n%2===1){doc.fillColor([243,246,248]).rect(left,y,width,h).fill();}
  texts.forEach((t,i)=>{const c=r.columns[i],v=row[c.key];doc.fillColor(c.key==="margin"&&typeof v==="number"?(v<0?[180,35,35]:v>0?[21,128,61]:PDF_COLORS.ink):PDF_COLORS.ink).fontSize(size).text(t,xs[i]+3,y+3.5,{width:widths[i]-6,align:c.money?"right":"left"});});
  y+=h;
 });
 doc.strokeColor(PDF_COLORS.line).moveTo(left,y).lineTo(left+width,y).stroke();y+=10;
 for(const warning of r.warnings)block(warning,7.5,PDF_COLORS.muted);
 const pages=doc.bufferedPageRange(),stamp=generatedLabel(r.generatedAt);
 for(let i=0;i<pages.count;i++){doc.switchToPage(pages.start+i);doc.page.margins.bottom=0;doc.fontSize(7.5).fillColor(PDF_COLORS.muted).text(`${r.agency} · ${r.title} · Generated ${stamp} · Page ${i+1} of ${pages.count}`,left,566,{width,align:"center",lineBreak:false});}
 doc.end();return done;
}
