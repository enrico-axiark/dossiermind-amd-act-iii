import {assert} from './errors.mjs';
import {readExtraction} from './ingestion.mjs';
import {cents,money} from './calculations.mjs';
import {sha256} from './crypto.mjs';
const fields=['id','description','amount'];
const columnNumber=value=>[...value].reduce((result,char)=>result*26+char.charCodeAt(0)-64,0);
export function financialTable(db,config,tenantId,input){
 assert(input&&typeof input.documentId==='string'&&input.currency==='EUR'&&['decimal-dot','decimal-comma'].includes(input.numberFormat)&&input.confirmTableScope===true,400,'financial_mapping_invalid','Confirm source, currency and numeric convention');
 assert(input.columns&&fields.every(field=>typeof input.columns[field]==='string'&&input.columns[field].length>0)&&new Set(fields.map(field=>input.columns[field])).size===3,400,'financial_mapping_invalid','Select three distinct columns');
 assert(Number.isInteger(input.firstRow)&&Number.isInteger(input.lastRow)&&input.firstRow>=1&&input.lastRow>=input.firstRow&&input.lastRow<=10000,400,'financial_mapping_invalid','Choose explicit source row bounds');
 const doc=db.prepare("SELECT * FROM documents WHERE id=? AND tenant_id=? AND status='stored' AND deleted_at IS NULL").get(input.documentId,tenantId),bundle=doc&&readExtraction(db,config,tenantId,doc.id),meta=doc&&db.prepare('SELECT source_sha256,parser_version FROM document_extractions WHERE document_id=? AND tenant_id=?').get(doc.id,tenantId);
 assert(bundle?.status==='extracted'&&bundle.sourceHash===doc.sha256&&meta?.source_sha256===doc.sha256&&meta.parser_version===bundle.parserVersion,400,'financial_source_unavailable','Use a current extracted table');
 const isCsv=doc.mime_type==='text/csv',isXlsx=doc.mime_type==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';assert(isCsv||isXlsx,400,'financial_mapping_invalid','CSV or XLSX table required');
 const rows=new Map();
 if(isCsv){
  assert(bundle.fragments.every(fragment=>fragment.metadata?.columns&&fields.every(field=>Object.hasOwn(fragment.metadata.columns,input.columns[field]))),400,'financial_mapping_invalid','CSV columns unavailable');
  for(const fragment of bundle.fragments)if(fragment.locator.row>=input.firstRow&&fragment.locator.row<=input.lastRow)rows.set(fragment.locator.row,Object.fromEntries(fields.map(field=>[field,{text:fragment.metadata.columns[input.columns[field]],fragment}])));
  assert(rows.has(input.firstRow)&&rows.has(input.lastRow),400,'financial_mapping_invalid','CSV range must start and end on actual data-row starting lines');
 }else{
  assert(typeof input.sheet==='string'&&bundle.fragments.some(fragment=>fragment.locator.sheet===input.sheet)&&fields.every(field=>/^[A-Z]{1,2}$/.test(input.columns[field])&&columnNumber(input.columns[field])<=200),400,'financial_mapping_invalid','Select a valid worksheet and columns');
  for(const fragment of bundle.fragments){if(fragment.locator.sheet!==input.sheet)continue;const cell=/^([A-Z]+)(\d+)$/.exec(fragment.locator.cell||'');if(!cell)continue;const row=Number(cell[2]);if(row<input.firstRow||row>input.lastRow)continue;const field=fields.find(field=>input.columns[field]===cell[1]);if(!field)continue;if(!rows.has(row))rows.set(row,{});rows.get(row)[field]={text:fragment.text,fragment};}
  // Do not silently skip empty or incomplete rows inside the explicitly selected range.
  for(let row=input.firstRow;row<=input.lastRow;row++)if(!rows.has(row))rows.set(row,{});
 }
 assert(rows.size>0&&rows.size<=10000,400,'financial_mapping_invalid','No table rows in selected range');
 const issues=[],entries=[],identities=new Set();
 for(const [row,values] of [...rows].sort((a,b)=>a[0]-b[0])){
  const locator=isCsv?{row}:{sheet:input.sheet,row};
  if(fields.some(field=>!values[field]||!String(values[field].text).trim())){issues.push({code:'incomplete_financial_row',locator});continue;}
  if(fields.some(field=>values[field].fragment.metadata?.formula)){issues.push({code:'financial_formula_requires_review',locator});continue;}
  const id=String(values.id.text).trim(),description=String(values.description.text).trim();
  if(identities.has(id)){issues.push({code:'duplicate_financial_id',locator});continue;}identities.add(id);
  let amount;try{amount=cents(String(values.amount.text),input.numberFormat);if(amount<0n)throw new Error('negative_financial_amount');}catch(error){issues.push({code:error.message,locator});continue;}
  const references=fields.map(field=>{const fragment=values[field].fragment;return {field,documentId:doc.id,filename:doc.original_filename,sourceHash:doc.sha256,fragmentId:fragment.id,fragmentHash:sha256(Buffer.from(JSON.stringify(fragment))),locator:fragment.locator};});
  entries.push({id,description,amount:money(amount),references});
 }
 return {status:issues.length?'needs_review':'computed',method:'exact-integer-cents',source:{documentId:doc.id,filename:doc.original_filename,sourceHash:doc.sha256,parserVersion:bundle.parserVersion},columns:input.columns,firstRow:input.firstRow,lastRow:input.lastRow,sheet:input.sheet||null,currency:'EUR',numberFormat:input.numberFormat,issues,entries,total:issues.length?null:money(entries.reduce((sum,entry)=>sum+BigInt(entry.amount.cents),0n)),periodBasis:'human-declared-table-scope',receiptVerification:'not-performed',independentEvidence:false};
}
export function reconcileTables(table,bank){
 assert(table.status==='computed'&&bank?.movements?.length,400,'financial_rows_need_review','Review all table and bank rows');
 const bankById=new Map(bank.movements.map(row=>[row.id,row])),used=new Set();
 const entries=table.entries.map(entry=>{const movement=bankById.get(entry.id);if(!movement)return {...entry,match:'no_matching_identifier',bankReference:null};used.add(entry.id);const debit=BigInt(movement.debit.cents),credit=BigInt(movement.credit.cents),amount=BigInt(entry.amount.cents);return {...entry,match:debit===amount&&credit===0n?'identifier_amount_candidate':'amount_or_direction_difference',bankDate:movement.date,bankDebit:movement.debit,bankCredit:movement.credit,bankReference:movement.reference};});
 return {method:'exact-common-identifier-and-debit-amount',entries,unmatchedBank:bank.movements.filter(row=>!used.has(row.id)),candidateCount:entries.filter(row=>row.match==='identifier_amount_candidate').length,notProofOfPayment:true,bankStatus:bank.status};
}
