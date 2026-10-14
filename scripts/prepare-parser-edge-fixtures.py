"""Small synthetic parser edge fixtures. No malicious payload execution or networking."""
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile
import json
import hashlib

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT/'evaluation/fixtures/parser-edges'
DIRECTORY.mkdir(parents=True,exist_ok=True)

def zip_bytes(entries):
    out=BytesIO()
    with ZipFile(out,'w') as archive:
        for name,content in entries: archive.writestr(name,content)
    return out.getvalue()

cases=[
 ('pdf-truncated.pdf',b'%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n','application/pdf','reject','unreadable_document','No fabricated text or empty successful ingestion.'),
 ('pdf-wrong-magic.pdf',b'This is not a PDF.','application/pdf','reject','mime_mismatch','Declared MIME and extension cannot establish content type.'),
 ('xml-external-entity.xml',b'<!DOCTYPE invoice [<!ENTITY external SYSTEM "https://example.invalid/never-fetch">]><invoice>&external;</invoice>','application/xml','reject','unsafe_xml','No DNS, HTTP or external entity resolution.'),
 ('xml-local-entity.xml',b'<!DOCTYPE invoice [<!ENTITY external SYSTEM "file:///nonexistent-act-iii-fixture">]><invoice>&external;</invoice>','application/xml','reject','unsafe_xml','No local file lookup or entity expansion.'),
 ('xml-malformed.xml',b'<invoice><amount>12.00</invoice>','application/xml','reject','unreadable_document','XML syntax error is explicit.'),
 ('xlsx-traversal.xlsx',zip_bytes([('../outside-fixture.txt','Synthetic; must never be extracted.'),('[Content_Types].xml','<Types/>')]),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','reject','unsafe_archive','Validate every archive member before processing; no files outside scratch directory.'),
 ('xlsx-truncated.xlsx',b'PK\x03\x04truncated','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','reject','unreadable_document','ZIP magic alone is insufficient.'),
 ('eml-remote-html.eml',b'From: demo@example.test\r\nTo: studio@example.test\r\nSubject: Synthetic remote resource\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Invoice reference F-DEMO.</p><img src="https://example.invalid/never-fetch">','message/rfc822','accept-with-warning','remote_resources_ignored','Extract local text, never request remote resources or render active HTML.'),
 ('eml-path-attachment.eml',b'From: demo@example.test\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="fixture"\r\n\r\n--fixture\r\nContent-Type: text/plain\r\n\r\nSynthetic body.\r\n--fixture\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="../../outside-fixture.txt"\r\n\r\nSynthetic attachment.\r\n--fixture--\r\n','message/rfc822','accept-with-warning','unsafe_attachment_name','Preserve body, reject unsafe attachment or use generated safe identity; report explicit attachment outcome.'),
 ('csv-european-decimal.csv','data;descrizione;importo\n2026-09-01;Apertura;1.234,56\n2026-09-02;Spesa;-12,34\n'.encode(),'text/csv','accept','locale_explicit','Recognize semicolon and decimal comma; EUR 1234.56 then -12.34, if conventions explicitly supported.'),
 ('csv-ambiguous-date.csv',b'date,amount\n03/04/2026,10.00\n','text/csv','review-required','ambiguous_date','Do not silently choose 3 April or 4 March without date convention.'),
 ('csv-formula-text.csv',b'date,description,amount\n2026-09-01,"=1+1",10.00\n','text/csv','accept-with-warning','formula_text','Treat description as text; never execute formula. Escape spreadsheet export when applicable.'),
 ('jpeg-truncated.jpg',bytes([0xff,0xd8,0xff,0xe0])+b'truncated','image/jpeg','reject','unreadable_image','JPEG magic alone does not establish decodable image.'),
 ('png-wrong-magic.png',b'This is not a PNG.','image/png','reject','mime_mismatch','Reject before invoking multimodal inference.'),
]
records=[]
for name,data,mime,outcome,reason,requirement in cases:
    path=DIRECTORY/name;path.write_bytes(data)
    records.append({'id':path.stem,'path':str(path.relative_to(ROOT)),'bytes':len(data),
                    'sha256':hashlib.sha256(data).hexdigest(),'declared_mime':mime,
                    'expected_outcome':outcome,'reason_category':reason,
                    'acceptance':requirement,'runtime_result':None})
manifest={'phase':'pre-event-preparation','synthetic':True,'initial_corpus':False,
          'purpose':'Parser/security qualification after implementation. Not AI evidence or model tuning.',
          'status':'fixtures-prepared-runtime-not-tested','cases':records,
          'additional_runtime_cases':['20 MiB + 1 byte upload','51-page PDF','10001-row sheet',
              '21-sheet XLSX','Expanded archive exceeds limit','More than 20 EML attachments',
              'Nested EML beyond allowed depth','Parser timeout and worker restart']}
(ROOT/'evaluation/parser-edge-fixtures.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
assert len({x['id'] for x in records})==len(records)
assert all(x['bytes']<2048 for x in records)
print(json.dumps({'prepared':len(records),'runtime_tested':False,'max_fixture_bytes':max(x['bytes'] for x in records)}))
