// Reviewed OCR remains derived model text, not independently verified original text.
import {decodeEncryptedBlob,sha256} from './crypto.mjs';
import {getTenantKey} from './storage.mjs';
import {assert} from './errors.mjs';
const decode=(db,config,row,part,body)=>JSON.parse(decodeEncryptedBlob(Buffer.from(body),getTenantKey(db,config,row.tenant_id),`memory:${row.tenant_id}:${row.id}:${part}`).toString());
export function reviewedVisual(db,config,tenantId){
 const results=[];
 for(const row of db.prepare("SELECT m.*,d.sha256 source_hash FROM memory_requests m JOIN documents d ON d.id=m.document_id AND d.tenant_id=m.tenant_id WHERE m.tenant_id=? AND m.status='completed' AND m.output IS NOT NULL AND d.status='stored' AND d.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 200").all(tenantId)){
  const input=decode(db,config,row,'input',row.input);if(input.mode!=='vision'||input.fingerprint!==row.source_hash)continue;
  const revision=db.prepare('SELECT * FROM memory_reviews WHERE request_id=? ORDER BY version DESC LIMIT 1').get(row.id);if(!revision)continue;
  const review=decode(db,config,row,'review:'+revision.version,revision.body),outputHash=sha256(Buffer.from(row.output));if(review.status!=='approved'||review.wikiHash!==outputHash)continue;
  const output=decode(db,config,row,'output',row.output);if(!output.blocks?.length)continue;
  const authorName=db.prepare('SELECT display_name FROM users WHERE id=?').get(revision.author_id)?.display_name||'Utente';
  for(const block of output.blocks){if(block.ambiguous)continue;const reference={...block.reference,fragmentId:block.id,parserVersion:'reviewed-visual-0.1.0',fragmentHash:sha256(Buffer.from(JSON.stringify(block))),visualRequestId:row.id,visualReviewVersion:revision.version,visualOutputHash:outputHash,origin:'reviewed-model-transcription'};
   results.push({id:block.id,text:block.text,documentId:row.document_id,filename:input.filename,locator:block.reference.locator,reference,origin:'reviewed-model-transcription',independentEvidence:false,textVerified:false,review:{version:revision.version,authorId:revision.author_id,authorName,createdAt:revision.created_at,meaning:'human-review-not-measured-OCR-accuracy'}});
  }
 }
 return results;
}
export function currentVisualReference(db,config,tenantId,reference){const item=reviewedVisual(db,config,tenantId).find(x=>x.id===reference.fragmentId&&x.documentId===reference.documentId);assert(item&&JSON.stringify(item.reference)===JSON.stringify(reference),409,'advisor_evidence_changed','Reviewed visual source or review changed');return item;}
export function matchVisual(items,terms){return items.map(item=>({...item,matches:terms.filter(t=>item.text.toLowerCase().includes(t)).length})).filter(x=>x.matches>0).sort((a,b)=>b.matches-a.matches||a.id.localeCompare(b.id));}
