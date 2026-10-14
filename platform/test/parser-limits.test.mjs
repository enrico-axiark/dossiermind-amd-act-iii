import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseDocument} from '../src/ingestion.mjs';
const python=process.env.PYTHON_EXECUTABLE||'python3',config={pythonExecutable:python,parserTimeoutMs:20000};
test('PDF, CSV, XLSX, archive and email limits reject before returning successful fragments',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dm-parser-limits-'));
 try{
 execFileSync(python,['-c',String.raw`
import sys,io,zipfile
from pathlib import Path
from pypdf import PdfWriter
from openpyxl import Workbook
from email.message import EmailMessage
root=Path(sys.argv[1])
w=PdfWriter()
for _ in range(51):w.add_blank_page(width=100,height=100)
w.write(root/'51-pages.pdf')
(root/'10001-rows.csv').write_text('a,b\n'+'x,1\n'*10001)
w=Workbook(write_only=True);s=w.create_sheet('Rows')
for _ in range(10001):s.append([1])
w.save(root/'10001-rows.xlsx')
with zipfile.ZipFile(root/'10001-rows.xlsx') as source,zipfile.ZipFile(root/'understated.xlsx','w',zipfile.ZIP_DEFLATED) as target:
 for info in source.infolist():
  data=source.read(info.filename)
  if info.filename=='xl/worksheets/sheet1.xml':data=data.replace(b'<sheetData>',b'<dimension ref="A1:A1"/><sheetData>',1)
  target.writestr(info.filename,data)
w=Workbook(write_only=True);w.create_sheet('Columns').append([1]*201);w.save(root/'201-columns.xlsx')
w=Workbook();w.remove(w.active)
for i in range(21):w.create_sheet(str(i))
w.save(root/'21-sheets.xlsx')
with zipfile.ZipFile(root/'expanded.xlsx','w',zipfile.ZIP_DEFLATED) as z:z.writestr('oversized.bin',b'0'*(100*1024*1024+1))
m=EmailMessage();m['Subject']='Synthetic limits';m.set_content('Body')
for i in range(21):m.add_attachment(b'local text',maintype='text',subtype='plain',filename=str(i)+'.txt')
(root/'21-attachments.eml').write_bytes(m.as_bytes())
inner=EmailMessage();inner['Subject']='Nested synthetic';inner.set_content('Inner')
m=EmailMessage();m['Subject']='Outer';m.set_content('Outer');m.add_attachment(inner)
(root/'nested.eml').write_bytes(m.as_bytes())
`,dir],{timeout:20000,stdio:['ignore','pipe','pipe']});
 const cases=[['51-pages.pdf','application/pdf','page_limit_exceeded'],['10001-rows.csv','text/csv','row_limit_exceeded'],['10001-rows.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','sheet_size_limit_exceeded'],['understated.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','sheet_size_limit_exceeded'],['201-columns.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','sheet_size_limit_exceeded'],['21-sheets.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','sheet_limit_exceeded'],['expanded.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','archive_limit_exceeded'],['21-attachments.eml','message/rfc822','attachment_limit_exceeded'],['nested.eml','message/rfc822','nested_email_not_supported']];
 for(const [file,mime,code] of cases)await assert.rejects(parseDocument(readFileSync(join(dir,file)),mime,file,config),e=>e.code===code,`${file} should fail explicitly`);
 await assert.rejects(parseDocument(Buffer.alloc(20*1024*1024+1),'text/csv','over-limit.csv',config),e=>e.code==='upload_too_large');
 await assert.rejects(parseDocument(Buffer.from('a,b\nx,1\n'),'text/csv','timeout.csv',{...config,parserTimeoutMs:1}),e=>e.code==='parser_timeout');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
