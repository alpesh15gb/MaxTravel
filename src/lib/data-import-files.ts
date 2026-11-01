import ExcelJS from 'exceljs';
import {inflateRawSync} from 'node:zlib';

import {IMPORT_ENTITIES,IMPORT_FIELDS,type ImportEntity,type ImportTable} from './data-import-fields';
export {IMPORT_ENTITIES,IMPORT_FIELDS,REQUIRED_IMPORT_FIELDS,type ImportEntity,type ImportTable} from './data-import-fields';
export const MAX_IMPORT_ROWS=200;

export function csvMatrix(input:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const text=input.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
  else if(c==='"'){if(cell||closed)throw Error('Invalid CSV quoting.');quoted=true;}
  else if(c===','||c==='\n'||c==='\r'){row.push(cell);cell='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x.trim()))rows.push(row);row=[];}}
  else{if(closed)throw Error('Unexpected text after a quoted CSV cell.');cell+=c;}
  if(cell.length>4000||row.length>30||rows.length>MAX_IMPORT_ROWS+1)throw Error('Use at most 200 rows, 30 columns and 4,000 characters per cell.');
 }
 if(quoted)throw Error('Unclosed CSV quote.');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
export function tableFromMatrix(matrix:string[][]):ImportTable{
 if(matrix.length<2||matrix.length>MAX_IMPORT_ROWS+1)throw Error('Provide a header and 1–200 data rows.');
 const headers=matrix[0].map(x=>x.trim());
 if(headers.length>30||headers.some(x=>!x||x.length>100)||new Set(headers).size!==headers.length)throw Error('Use 1–30 unique, non-empty column headings.');
 return{headers,rows:matrix.slice(1).map((row,index)=>{
  if(row.length!==headers.length)throw Error(`Row ${index+2} has a different column count.`);
  if(row.some(x=>x.length>4000))throw Error(`Row ${index+2} contains an oversized value.`);
  return Object.fromEntries(headers.map((h,i)=>[h,row[i].trim()]));
 })};
}
// Bound decompression before ExcelJS opens an untrusted XLSX ZIP container.
export function checkWorkbookZip(data:Buffer){
 let end=-1;for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||end+22+data.readUInt16LE(end+20)!==data.length)throw Error('Use an ordinary .xlsx workbook.');
 const entries=data.readUInt16LE(end+10),offset=data.readUInt32LE(end+16),size=data.readUInt32LE(end+12);
 if(data.readUInt16LE(end+4)||data.readUInt16LE(end+6)||entries>2000||offset+size>end)throw Error('Multipart or oversized workbooks are not supported.');
 let at=offset,total=0;
 for(let i=0;i<entries;i++){
  if(at+46>end||data.readUInt32LE(at)!==0x02014b50)throw Error('Invalid workbook directory.');
  if(data.readUInt16LE(at+8)&1)throw Error('Remove the workbook password before importing.');
  const declared=data.readUInt32LE(at+24),compressed=data.readUInt32LE(at+20),method=data.readUInt16LE(at+10),local=data.readUInt32LE(at+42),limit=16*1024*1024;
  if(declared>limit-total)throw Error('Workbook expands beyond the 16 MB import limit.');
  if(local+30>offset||data.readUInt32LE(local)!==0x04034b50||data.readUInt16LE(local+8)!==method||(data.readUInt16LE(local+6)&1))throw Error('Invalid workbook entry.');
  const start=local+30+data.readUInt16LE(local+26)+data.readUInt16LE(local+28);
  if(start+compressed>offset)throw Error('Invalid workbook entry bounds.');
  let actual:number;
  if(method===0)actual=compressed;
  else if(method===8){try{actual=inflateRawSync(data.subarray(start,start+compressed),{maxOutputLength:Math.max(1,limit-total)}).length;}catch{throw Error('Invalid compressed workbook or expansion beyond the 16 MB import limit.');}}
  else throw Error('Unsupported workbook compression.');
  if(actual!==declared||actual>limit-total)throw Error('Workbook expansion metadata is inconsistent or exceeds the 16 MB import limit.');
  total+=actual;
  at+=46+data.readUInt16LE(at+28)+data.readUInt16LE(at+30)+data.readUInt16LE(at+32);
 }
 if(at!==offset+size)throw Error('Unsupported workbook directory.');
}
export async function parseImportFile(name:string,data:Buffer,entity:ImportEntity):Promise<ImportTable>{
 if(data.length>2*1024*1024)throw Error('Use a file up to 2 MB.');
 if(name.toLowerCase().endsWith('.csv'))return tableFromMatrix(csvMatrix(data.toString('utf8')));
 if(!name.toLowerCase().endsWith('.xlsx'))throw Error('Choose a CSV or .xlsx file. Save formulas as values first.');
 checkWorkbookZip(data);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(data as unknown as Parameters<typeof workbook.xlsx.load>[0]);
 const sheet=workbook.worksheets.find(s=>s.name.toLowerCase()===entity)??(workbook.worksheets.length===1?workbook.worksheets[0]:undefined);
 if(!sheet)throw Error(`Choose a workbook containing a ${entity} sheet, or a single-sheet file.`);
 if(sheet.rowCount>MAX_IMPORT_ROWS+1||sheet.columnCount>30)throw Error('Use at most 200 rows and 30 columns per sheet.');
 const matrix:string[][]=[];
 sheet.eachRow({includeEmpty:false},row=>{
  const values:string[]=[];
  for(let i=1;i<=sheet.columnCount;i++){
   const cell=row.getCell(i),value=cell.value;
   if(value&&typeof value==='object'&&('formula'in value||'sharedFormula'in value))throw Error('Save spreadsheet formulas as plain values before importing.');
   values.push(value instanceof Date?value.toISOString().slice(0,10):cell.text);
  }
  matrix.push(values);
 });return tableFromMatrix(matrix);
}
export function importExamples(){
 const today=new Date(Date.now()+19800000).toISOString().slice(0,10);
 return{
  clients:[{externalId:'CLIENT-001',name:'Demo Client',phone:'919000000001',email:'client@example.test',city:'Hyderabad',type:'INDIVIDUAL'}],
  cases:[{externalId:'VISA-001',clientRef:'CLIENT-001',service:'VISA',title:'Visitor visa enquiry',status:'OPEN',openedOn:today,legacyReference:'OLD-001',legacyStage:'Documents pending',nextAction:'Review imported documents and confirm the next step'}],
  travellers:[{externalId:'TRAVELLER-001',clientRef:'CLIENT-001',name:'Demo Client',relation:'SELF',nationality:'India'}],
 };
}
export async function importWorkbook(){
 const book=new ExcelJS.Workbook(),examples=importExamples();
 for(const entity of IMPORT_ENTITIES){const sheet=book.addWorksheet(entity);sheet.columns=IMPORT_FIELDS[entity].map(key=>({header:key,key,width:24,style:{numFmt:'@'}}));for(const row of examples[entity])sheet.addRow(row);sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];}
 return Buffer.from(await book.xlsx.writeBuffer());
}
export function safeCsv(rows:string[][]){return rows.map(row=>row.map(s=>'"'+(/^[\s]*[=+\-@\t\r]/.test(s)?"'"+s:s).replaceAll('"','""')+'"').join(',')).join('\r\n');}
