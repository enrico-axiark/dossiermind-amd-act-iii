import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createPlatformApp} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {IngestionWorker} from '../src/ingestion.mjs';
import {financialTable} from '../src/financial-table.mjs';
import {CalculationMemory} from '../src/calculation-memory.mjs';
import {reportSnapshot,downloadReport,listReports,renderReport} from '../src/reports.mjs';
const admin={id:'admin',type:'user',scopes:new Set(['platform:admin'])},user={id:'owner',type:'user',scopes:new Set(),claimedTenantIds:new Set()};
async function setup(rows='A;First receipt;10.01\nB;Second receipt;20.02\n'){
 const dir=mkdtempSync(join(tmpdir(),'dm-financial-')),config=loadConfig({nodeEnv:'test',baseDir:dir,dbPath:'db.sqlite',storageRoot:join(dir,'objects'),allowInsecureDevAuth:true,masterKey:randomBytes(32),auditKey:randomBytes(32),pythonExecutable:process.env.PYTHON_EXECUTABLE||'python3'}),app=createPlatformApp(config),org=app.service.createOrganization({name:'Synthetic',type:'pmi'},admin),tenant=app.service.createTenant({organizationId:org.id,name:'Synthetic financial client'},admin);
 app.service.createUser({id:user.id,email:'owner@example.test',displayName:'Synthetic owner'},admin);app.service.addMembership(tenant.id,{userId:user.id,role:'owner',scopes:['documents:read','documents:write','jobs:write','jobs:read']},admin);
 const doc=app.service.uploadDocument(tenant.id,{filename:'register.csv',mimeType:'text/csv',bytes:Buffer.from('id;description;amount\n'+rows)},user);app.service.createJob(tenant.id,{type:'ingestion',input:{documentIds:[doc.id]}},user);await new IngestionWorker(app.db,config).tick();
 const table={documentId:doc.id,columns:{id:'id',description:'description',amount:'amount'},firstRow:2,lastRow:3,currency:'EUR',numberFormat:'decimal-dot',confirmTableScope:true},input={kind:'private_spend_receipts',periodStart:'2026-09-01',periodEnd:'2026-09-30',confirmPeriodSelection:true,table};
 return {...app,dir,config,tenant,doc,table,input,close(){app.db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('financial CSV totals are exact cents with original row citations and an explicit single source',async()=>{
 const x=await setup();try{const result=financialTable(x.db,x.config,x.tenant.id,x.table);assert.equal(result.status,'computed');assert.equal(result.total.cents,'3003');assert.equal(result.entries[1].references.find(ref=>ref.field==='amount').locator.row,3);assert.equal(result.receiptVerification,'not-performed');assert.equal(result.periodBasis,'human-declared-table-scope');assert.equal(result.entries[0].references[0].sourceHash,x.doc.sha256);
 assert.throws(()=>financialTable(x.db,x.config,x.tenant.id,{...x.table,confirmTableScope:false}),e=>e.code==='financial_mapping_invalid');assert.throws(()=>financialTable(x.db,x.config,x.tenant.id,{...x.table,columns:{...x.table.columns,amount:'id'}}),e=>e.code==='financial_mapping_invalid');assert.throws(()=>financialTable(x.db,x.config,'other-client',x.table),e=>e.code==='financial_source_unavailable');
  assert.throws(()=>financialTable(x.db,x.config,x.tenant.id,{...x.table,lastRow:999}),e=>e.code==='financial_mapping_invalid');
 }finally{x.close();}
});
test('duplicate identifiers, missing fields, negative amounts and wrong decimal convention block financial totals',async()=>{
 for(const [rows,code] of [['A;First;10\nA;Second;20\n','duplicate_financial_id'],['A;;10\nB;Second;20\n','incomplete_financial_row'],['A;First;-10\nB;Second;20\n','negative_financial_amount'],['A;First;1.234,56\nB;Second;20,00\n','invalid_amount']]){const x=await setup(rows);try{const result=financialTable(x.db,x.config,x.tenant.id,x.table);assert.equal(result.total,null);assert.ok(result.issues.some(issue=>issue.code===code));assert.throws(()=>reportSnapshot(x.db,x.config,x.tenant.id,x.input),e=>e.code==='financial_rows_need_review');if(code==='invalid_amount')assert.equal(financialTable(x.db,x.config,x.tenant.id,{...x.table,numberFormat:'decimal-comma'}).total.cents,'125456');}finally{x.close();}}
});
test('XLSX explicit worksheet/columns/rows cite cells, exclude totals only by declared range, and reject formulas or empty selected rows',async()=>{
 const x=await setup();try{
  const script='import sys,io;from openpyxl import Workbook;w=Workbook();s=w.active;s.title="Spese";s.append(["Synthetic"]);s.append([]);s.append([]);s.append(["ID","Description","EUR"]);s.append(["X","Expense",10.01]);s.append(["Y","Expense2",20.02]);s.append(["T","Total","=SUM(C5:C6)"]);s.append([]);b=io.BytesIO();w.save(b);sys.stdout.buffer.write(b.getvalue())',generated=spawnSync(x.config.pythonExecutable,['-c',script]);assert.equal(generated.status,0,generated.stderr.toString());
  const doc=x.service.uploadDocument(x.tenant.id,{filename:'expense.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes:generated.stdout},user);x.service.createJob(x.tenant.id,{type:'ingestion',input:{documentIds:[doc.id]}},user);await new IngestionWorker(x.db,x.config).tick();
  const mapping={...x.table,documentId:doc.id,sheet:'Spese',firstRow:5,lastRow:6,columns:{id:'A',description:'B',amount:'C'}},result=financialTable(x.db,x.config,x.tenant.id,mapping);assert.equal(result.total.cents,'3003');assert.equal(result.entries[0].references.find(ref=>ref.field==='amount').locator.cell,'C5');
  for(const patch of [{lastRow:7},{lastRow:8}]){const bad=financialTable(x.db,x.config,x.tenant.id,{...mapping,...patch});assert.equal(bad.total,null);assert.ok(bad.issues.some(issue=>issue.code==='financial_formula_requires_review'));}
  assert.throws(()=>financialTable(x.db,x.config,x.tenant.id,{...mapping,sheet:'Other'}),e=>e.code==='financial_mapping_invalid');
  if(process.env.FINANCIAL_XLSX_PROOF_PATH)writeFileSync(process.env.FINANCIAL_XLSX_PROOF_PATH,generated.stdout);
 }finally{x.close();}
});
async function addBank(x){
 const doc=x.service.uploadDocument(x.tenant.id,{filename:'bank.csv',mimeType:'text/csv',bytes:Buffer.from('date;id;description;debit;credit;balance\n2026-08-31;OLD;Older expense;5;0;995\n2026-09-01;A;First;10.01;0;984.99\n2026-09-02;B;Second;21.02;0;963.97\n2026-09-03;Z;Income;0;100;1063.97\n')},user);x.service.createJob(x.tenant.id,{type:'ingestion',input:{documentIds:[doc.id]}},user);await new IngestionWorker(x.db,x.config).tick();
 const saved=new CalculationMemory(x.db,x.config).save(x.tenant.id,{documentId:doc.id,columns:{date:'date',id:'id',description:'description',debit:'debit',credit:'credit',balance:'balance'},currency:'EUR',numberFormat:'decimal-dot',balancePosition:'after_transaction'},user);return {doc,saved};
}
test('reconciliation compares common identifiers and debit amounts, keeps discrepancies and unmatched rows, and never sums bank and register',async()=>{
 const x=await setup();try{const bank=await addBank(x),input={...x.input,kind:'pmi_bank_reconciliation',bankCalculationId:bank.saved.id},{snapshot}=reportSnapshot(x.db,x.config,x.tenant.id,input),result=snapshot.reconciliation;
 assert.equal(result.candidateCount,1);assert.equal(result.entries[0].match,'identifier_amount_candidate');assert.equal(result.entries[1].match,'amount_or_direction_difference');assert.equal(result.unmatchedBank.length,1);assert.equal(result.unmatchedBank[0].id,'Z');assert.equal(result.entries[0].bankReference.locator.row,3);assert.equal(result.notProofOfPayment,true);assert.equal(snapshot.financial.total.cents,'3003');assert.equal(snapshot.totals,undefined);assert.equal(snapshot.documents.length,2);
 x.db.prepare("UPDATE document_extractions SET parser_version='changed' WHERE document_id=?").run(bank.doc.id);assert.throws(()=>reportSnapshot(x.db,x.config,x.tenant.id,input),e=>e.code==='financial_bank_required');
 }finally{x.close();}
});
test('actual financial PDFs preserve evidence and qualifiers; bank deletion erases the reconciliation and revoke blocks publishing',async()=>{
 const x=await setup();try{
  const bank=await addBank(x),input={...x.input,kind:'pmi_bank_reconciliation',bankCalculationId:bank.saved.id},job=x.service.createJob(x.tenant.id,{type:'report',input},user);await new IngestionWorker(x.db,x.config).tick();const result=x.service.getJob(x.tenant.id,job.id);assert.equal(result.status,'completed');
  const pdf=downloadReport(x.db,x.config,x.tenant.id,result.output.reportId,user).bytes,read=spawnSync(x.config.pythonExecutable,['-c','import io,sys;from pypdf import PdfReader;print("\\n".join(p.extract_text() for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))'],{input:pdf,encoding:'utf8'});assert.equal(read.status,0);assert.match(read.stdout,/30,03 EUR/);assert.match(read.stdout,/non sono una prova di pagamento/);assert.match(read.stdout,/Differenza di importo/);assert.match(read.stdout,/bank.csv/);assert.equal(read.stdout.includes(x.doc.sha256),false);
  if(process.env.FINANCIAL_REPORT_PROOF_PATH)writeFileSync(process.env.FINANCIAL_REPORT_PROOF_PATH,pdf);
  x.service.deleteDocument(x.tenant.id,bank.doc.id,admin);assert.equal(listReports(x.db,x.tenant.id).length,0);
  const second=x.service.createJob(x.tenant.id,{type:'report',input:x.input},user),renderer=async(...args)=>{const bytes=await renderReport(...args);x.service.revokeMembership(x.tenant.id,user.id,admin);return bytes;};await new IngestionWorker(x.db,x.config,{reportRenderer:renderer}).tick();assert.equal(x.service.getJob(x.tenant.id,second.id).status,'cancelled');assert.equal(listReports(x.db,x.tenant.id).length,0);
 }finally{x.close();}
});
test('financial report HTTP requires live client permissions and rejects another-client register',async()=>{
 const x=await setup();try{await new Promise(resolve=>x.server.listen(0,'127.0.0.1',resolve));const path='http://127.0.0.1:'+x.server.address().port+'/v1/tenants/'+x.tenant.id+'/jobs',headers={authorization:'Bearer dev.'+Buffer.from(JSON.stringify({sub:user.id,scope:''})).toString('base64url'),'content-type':'application/json'};
 let response=await fetch(path,{method:'POST',headers,body:JSON.stringify({type:'report',input:x.input})});assert.equal(response.status,202);
 response=await fetch(path,{method:'POST',headers,body:JSON.stringify({type:'report',input:{...x.input,table:{...x.table,documentId:'outside'}}})});assert.equal(response.status,400);
 x.service.revokeMembership(x.tenant.id,user.id,admin);response=await fetch(path,{method:'POST',headers,body:JSON.stringify({type:'report',input:x.input})});assert.equal(response.status,403);
 }finally{if(x.server.listening)await new Promise(resolve=>x.server.close(resolve));x.close();}
});
test('financial table source changed during rendering prevents publishing; deletion removes the private report and its selected lineage',async()=>{
 const x=await setup();try{
  const job=x.service.createJob(x.tenant.id,{type:'report',input:x.input},user),renderer=async(...args)=>{const pdf=await renderReport(...args);x.db.prepare("UPDATE document_extractions SET parser_version='changed' WHERE document_id=?").run(x.doc.id);return pdf;};await new IngestionWorker(x.db,x.config,{reportRenderer:renderer}).tick();assert.equal(listReports(x.db,x.tenant.id).length,0);assert.equal(x.service.getJob(x.tenant.id,job.id).errorCode,'financial_source_unavailable');
 }finally{x.close();}
 const y=await setup();try{const job=y.service.createJob(y.tenant.id,{type:'report',input:y.input},user);await new IngestionWorker(y.db,y.config).tick();assert.equal(y.service.getJob(y.tenant.id,job.id).status,'completed');y.service.deleteDocument(y.tenant.id,y.doc.id,admin);assert.equal(listReports(y.db,y.tenant.id).length,0);assert.equal(y.db.prepare('SELECT COUNT(*) n FROM report_sources').get().n,0);}finally{y.close();}
});
