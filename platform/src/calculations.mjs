import {appendAudit} from "./audit.mjs";
import {assert} from './errors.mjs';
import {authorizeTenant} from './auth.mjs';
import {readExtraction} from './ingestion.mjs';
const fields=['date','id','description','debit','credit','balance'];
export function cents(value,format){
 if(typeof value!=='string')throw new Error('invalid_amount');
 value=value.trim();let normalized;
 if(format==='decimal-dot'){
  if(!/^-?\d{1,12}(?:\.\d{1,2})?$/.test(value))throw new Error('invalid_amount');normalized=value;
 }else{
  if(!/^-?(?:\d{1,12}|\d{1,3}(?:\.\d{3}){1,3})(?:,\d{1,2})?$/.test(value))throw new Error('invalid_amount');normalized=value.replaceAll('.','').replace(',','.');
 }
 const negative=normalized.startsWith('-'),[integer,fraction='']=normalized.replace(/^-/,'').split('.');
 return (BigInt(integer)*100n+BigInt(fraction.padEnd(2,'0')))*(negative?-1n:1n);
}
export const money=value=>{const absolute=value<0n?-value:value;return {cents:value.toString(),eur:(value<0n?'-':'')+(absolute/100n).toString()+'.'+(absolute%100n).toString().padStart(2,'0')};};
function isoDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const parsed=new Date(value+'T00:00:00Z');return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;
}
export function bankSummary(db,config,tenantId,input,principal){
 authorizeTenant(db,principal,tenantId,'documents:read');
 assert(input&&typeof input.documentId==='string'&&input.columns&&fields.every(f=>typeof input.columns[f]==='string'&&input.columns[f].length>0)&&new Set(fields.map(f=>input.columns[f])).size===fields.length,400,'invalid_calculation_mapping','Select distinct source columns');
 assert(input.currency==='EUR'&&['decimal-dot','decimal-comma'].includes(input.numberFormat)&&input.balancePosition==='after_transaction',400,'invalid_calculation_mapping','Explicit numeric and balance conventions required');
 const doc=db.prepare("SELECT * FROM documents WHERE id=? AND tenant_id=? AND status='stored' AND deleted_at IS NULL").get(input.documentId,tenantId);
 assert(doc,404,'document_not_found','Source unavailable');const bundle=readExtraction(db,config,tenantId,doc.id);
 assert(bundle?.status==='extracted'&&bundle.fragments.length>0&&bundle.fragments.length<=10000,409,'calculation_source_unavailable','Use an extracted CSV table within limits');
 const issues=[],records=[],identities=new Set();let previousDate=null;
 for(const fragment of bundle.fragments){
  const row=fragment.metadata?.columns;
  assert(row&&fields.every(f=>Object.hasOwn(row,input.columns[f])),400,'invalid_calculation_mapping','Mapping must refer to actual CSV columns');
  const date=row[input.columns.date],id=row[input.columns.id]?.trim();
  if(!isoDate(date))issues.push({code:'invalid_iso_date',locator:fragment.locator,field:input.columns.date});
  else if(previousDate&&date<previousDate)issues.push({code:'date_order',locator:fragment.locator});
  if(isoDate(date))previousDate=date;
  if(!id||identities.has(id))issues.push({code:!id?'missing_movement_id':'duplicate_movement_id',locator:fragment.locator});identities.add(id);
  let debit,credit,balance;
  try{debit=cents(row[input.columns.debit],input.numberFormat);credit=cents(row[input.columns.credit],input.numberFormat);balance=cents(row[input.columns.balance],input.numberFormat);
   if(debit<0n||credit<0n)throw new Error('negative_debit_credit');
  }catch(error){issues.push({code:error.message,locator:fragment.locator});continue;}
  records.push({date,id,description:row[input.columns.description],debit,credit,balance,reference:{documentId:doc.id,sourceHash:doc.sha256,fragmentId:fragment.id,locator:fragment.locator}});
 }
 const finish=result=>{appendAudit(db,config.auditKey,{tenantId,actorId:principal.id,actorType:principal.type,action:'calculation.generated',targetType:'document',targetId:doc.id,metadata:{method:'exact-integer-cents',status:result.status,rowCount:bundle.fragments.length}});return result;};
 const basis={method:'exact-integer-cents',currency:'EUR',source:{documentId:doc.id,filename:doc.original_filename,sourceHash:doc.sha256},columns:input.columns,numberFormat:input.numberFormat,
  limitations:['EUR is explicitly declared; no currency conversion is performed. Only the selected CSV is included; invoices, receipts and other tables are not matched or summed.','Dates describe observed rows, not proof of complete period coverage.','Balance column is interpreted as the balance after each transaction, as explicitly selected.']};
 if(issues.length)return finish({...basis,status:'needs_review',issues,totals:null});
 const opening=records[0].balance-records[0].credit+records[0].debit;let expected=opening,totalDebit=0n,totalCredit=0n;
 const discrepancies=[];
 for(const row of records){expected+=row.credit-row.debit;totalDebit+=row.debit;totalCredit+=row.credit;
  if(expected!==row.balance)discrepancies.push({reference:row.reference,expected:money(expected),observed:money(row.balance),difference:money(row.balance-expected)});
 }
 return finish({...basis,status:discrepancies.length?'balance_discrepancies':'consistent_rows',issues:[],dateRange:{first:records[0].date,last:records.at(-1).date},
  opening:{...money(opening),kind:'reconstructed-from-first-row',reference:records[0].reference},
  totals:{debit:money(totalDebit),credit:money(totalCredit),net:money(totalCredit-totalDebit),closingObserved:money(records.at(-1).balance),closingCalculated:money(expected)},
  movements:records.map(row=>({...row,debit:money(row.debit),credit:money(row.credit),balance:money(row.balance)})),discrepancies});
}
