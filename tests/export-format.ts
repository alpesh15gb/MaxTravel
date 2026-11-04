/** Synthetic workbook round-trip checks. No application database, credentials, or browser. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { accountWorkbook, accountCsv, accountPdf } from "../src/lib/report-export";
import { csvCell, csvDocument } from "../src/lib/csv-export";
import { indiaDay } from "../src/lib/report-workspace";
import type { AccountReport } from "../src/lib/account-reports";

const fixture: AccountReport = {
 agency: "Synthetic Travel Agency", title: "Customer statement", description: "Positive balance is owed by the customer. Negative balance is customer credit held by the agency.",
 period: {from:"2026-10-01",to:"2026-10-24"}, generatedAt:"2026-10-24T18:30:00.000Z",
 metadata: {dateBasis:"Journal effective date · opening balance brought forward", currency:"INR", account:"Synthetic customer · C-001", scope:"Agency-wide", filters:[]},
 columns:[{key:"date",label:"Date"},{key:"reference",label:"Reference"},{key:"description",label:"Description"},{key:"debit",label:"Charge / cash returned",money:true},{key:"credit",label:"Receipt / charge credit",money:true},{key:"balance",label:"Running balance",money:true}],
 rows:Array.from({length:101},(_,i)=>({date:"2026-10-24",reference:`RCP-${String(i+1).padStart(6,"0")}`,description:i===1?'  =HYPERLINK("https://example.test","unsafe")':i===2?'Multiline, quoted "description"\nSecond line':"Synthetic recorded receipt",debit:0,credit:10.25,balance:500-(i+1)*10.25})),
 summary:[{label:"Opening balance",value:500,money:true},{label:"Period debits",value:0,money:true},{label:"Period credits",value:1035.25,money:true},{label:"Closing balance",value:-535.25,money:true}],
 warnings:["Opening plus debits minus credits equals closing. Earlier records are represented by the opening balance. This is a synthetic export fixture, not a client account."],
 totalRows:101,page:1,pages:3,cutover:"2026-10-01",party:{name:"Synthetic customer",code:"C-001",address:null},
};

async function main(){
 for(const value of ["=1+1"," +SUM(A1)","\t@SUM(A1)","\r\n-HYPERLINK()","\u0000=1"]){assert(csvCell(value).startsWith('"\''),JSON.stringify(value));}
 assert.equal(csvCell(-12.34),'"-12.34"');assert.equal(csvCell(0),'"0"');assert.equal(csvCell(null),'""');
 assert.equal(csvCell('A,"B"\rC'),'"A,""B""\rC"');assert(csvDocument([["Name"],["München"]]).startsWith("\uFEFF"));
 assert.equal(indiaDay(new Date("2026-10-24T18:29:59.999Z")),"2026-10-24");
 assert.equal(indiaDay(new Date("2026-10-24T18:30:00.000Z")),"2026-10-25");
 const buffer=await accountWorkbook(fixture),book=new ExcelJS.Workbook();await book.xlsx.load(buffer as never);
 const sheet=book.getWorksheet("Transactions")!,summary=book.getWorksheet("Report details")!;
 assert.equal(sheet.rowCount,102);assert.equal(summary.getCell("B7").value,"Synthetic customer · C-001");assert.deepEqual(sheet.getCell("G1").fill,{type:"pattern",pattern:"none"});assert(sheet.getCell("A2").value instanceof Date);assert.equal(sheet.getCell("A2").numFmt,"dd mmm yyyy");
 assert.equal(sheet.getCell("B2").value,"RCP-000001");assert.equal(sheet.getCell("C3").type,ExcelJS.ValueType.String);
 assert.equal(sheet.getCell("F102").value,-535.25);assert.equal(sheet.getCell("E2").value,10.25);assert.match(sheet.getCell("F102").numFmt,/0\.00/);
 assert.equal(sheet.autoFilter,"A1:F102");assert.equal(sheet.views[0].state,"frozen");assert.equal((sheet.views[0] as ExcelJS.WorksheetViewFrozen).ySplit,1);assert.equal((sheet.views[0] as ExcelJS.WorksheetViewFrozen).xSplit,2);
 assert.equal(sheet.pageSetup.printTitlesRow,"1:1");assert.equal(sheet.getRow(1).height,44);assert.equal(sheet.views[0].showGridLines,false);
 let closing=false,coverage=false;
 summary.eachRow(row=>{if(row.getCell(1).value==="Closing balance"){closing=true;assert.equal(row.getCell(2).value,-535.25);assert.match(row.getCell(2).numFmt,/INR/);}if(row.getCell(1).value==="Exported rows"){coverage=true;assert.equal(row.getCell(2).value,101);}});
 assert(closing&&coverage);assert.equal(summary.getCell("B5").numFmt,"dd mmm yyyy");
 for(const tab of book.worksheets)tab.eachRow(row=>row.eachCell(cell=>assert.notEqual(cell.type,ExcelJS.ValueType.Formula)));
 const csv=accountCsv(fixture);assert(csv.includes('"-535.25"'));assert(!csv.includes('"\'-535.25"'));assert(csv.includes('"\'  =HYPERLINK'));
 const partial={...fixture,rows:fixture.rows.slice(0,50)};await assert.rejects(()=>accountWorkbook(partial),/full report/);assert.throws(()=>accountCsv(partial),/full report/);await assert.rejects(()=>accountPdf(partial),/full report/);
 const empty={...fixture,rows:[],totalRows:0};const emptyBook=new ExcelJS.Workbook();await emptyBook.xlsx.load(await accountWorkbook(empty) as never);assert.equal(emptyBook.getWorksheet("Transactions")!.rowCount,1);assert.equal(emptyBook.getWorksheet("Transactions")!.autoFilter,"A1:F1");
 const unknown={...fixture,rows:[{...fixture.rows[0],debit:null,credit:0,description:"Missing cost is not a zero cost"}],totalRows:1};const unknownBook=new ExcelJS.Workbook();await unknownBook.xlsx.load(await accountWorkbook(unknown) as never);assert.equal(unknownBook.getWorksheet("Transactions")!.getCell("D2").value,null);assert.equal(unknownBook.getWorksheet("Transactions")!.getCell("E2").value,0);
 const large={...fixture,rows:[{...fixture.rows[0],credit:30000000.01,balance:-29999500.01}],totalRows:1};
 const largeBook=new ExcelJS.Workbook();await largeBook.xlsx.load(await accountWorkbook(large) as never);assert.equal(largeBook.getWorksheet("Transactions")!.getCell("E2").value,30000000.01);assert.equal(largeBook.getWorksheet("Transactions")!.getCell("F2").value,-29999500.01);
 const status={...fixture,columns:[{key:"status",label:"Status"},{key:"reference",label:"Reference"}],rows:[{status:"PNR_CREATED",reference:"00123456789012345678"}],totalRows:1};
 const statusBook=new ExcelJS.Workbook();await statusBook.xlsx.load(await accountWorkbook(status) as never);assert.equal(statusBook.getWorksheet("Transactions")!.getCell("A2").value,"PNR created");assert.equal(statusBook.getWorksheet("Transactions")!.getCell("B2").value,"00123456789012345678");assert(accountCsv(status).includes('"PNR created"'));
 const foreign={...fixture,title:"Max ID financial summary",metadata:{...fixture.metadata,currency:"USD"},columns:[{key:"reference",label:"Booking"},{key:"margin",label:"Expected profit",money:true}],rows:[{reference:"SYNTHETIC-PROFIT",margin:1000},{reference:"SYNTHETIC-LOSS",margin:-200}],totalRows:2,summary:[{label:"Expected gross profit",value:800,money:true}]};const foreignBook=new ExcelJS.Workbook();await foreignBook.xlsx.load(await accountWorkbook(foreign) as never);assert(foreignBook.getWorksheet("Transactions")!.getCell("B2").numFmt.includes("USD"));assert.equal(foreignBook.getWorksheet("Transactions")!.getCell("B2").font.color?.argb,"FF15803D");assert.equal(foreignBook.getWorksheet("Transactions")!.getCell("B3").font.color?.argb,"FFB42323");const register=await accountPdf(foreign);assert(register.subarray(0,4).toString()==="%PDF");
 // Registers print as a landscape table: 100 rows of an 11-column sales register fit on a few pages, not one card per row.
 const salesColumns=["date","reference","customer","service","status","owner","supplier"].map(key=>({key,label:key[0].toUpperCase()+key.slice(1)})).concat([{key:"sales",label:"Sales value",money:true},{key:"cost",label:"Supplier cost",money:true},{key:"margin",label:"Gross margin",money:true}] as never,[{key:"coverage",label:"Coverage"}] as never);
 const salesRegister:AccountReport={...fixture,title:"Sales and cost coverage",party:undefined,columns:salesColumns,rows:Array.from({length:100},(_,i)=>({date:"2026-10-24",reference:`BK-${i}`,customer:"Synthetic customer with a long name",service:"Flight",status:"TICKETED",owner:"Asha Verma",supplier:"Synthetic Air Supplier",sales:40000,cost:i%3?null:36000,margin:i%3?null:4000,coverage:i%3?"Missing cost":"Costed"})),totalRows:100,summary:[{label:"Confirmed booking value",value:4000000,money:true}],warnings:["A long definition sentence that must wrap on word boundaries and never split a word across two lines. ".repeat(12)]};
 const salesPdf=(await accountPdf(salesRegister)).toString("latin1");
 const pageCount=Number(/\/Type \/Pages\s+\/Count (\d+)/.exec(salesPdf)?.[1]??0);
 assert(pageCount>=1&&pageCount<=8,`register PDF should be a compact table, got ${pageCount} pages`);
 assert.match(salesPdf,/\/MediaBox \[0 0 841\.89 595\.28\]/,"register PDF is A4 landscape");
 const output=path.join(process.cwd(),"tests/.runtime/export-format");await mkdir(output,{recursive:true});await writeFile(path.join(output,"register.pdf"),register);await writeFile(path.join(output,"statement.xlsx"),buffer);await writeFile(path.join(output,"statement.csv"),csv);await writeFile(path.join(output,"statement.pdf"),await accountPdf(fixture));
 await writeFile(path.join(output,"fixture.json"),JSON.stringify(fixture));
 console.log("Export format: numeric money, typed dates, full rows, null/zero, safe CSV, literal XLSX text, headers, filter, freeze panes, print settings, empty and partial exports passed.");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
