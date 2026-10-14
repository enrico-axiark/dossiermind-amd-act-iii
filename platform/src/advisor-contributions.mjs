import {currentVisualReference} from './reviewed-visual.mjs';
import {DocumentMemory} from './document-memory.mjs';
import {NoteService} from './notes.mjs';
import {AssertionService} from './assertions.mjs';
import {ChecklistService} from './checklists.mjs';
import {readExtraction} from './ingestion.mjs';
import {authorizeTenant} from './auth.mjs';
import {assert} from './errors.mjs';
import {sha256} from './crypto.mjs';
export function contributionOptions(db,config,tenantId,principal){
 authorizeTenant(db,principal,tenantId,'documents:read');
 return [
 ...new DocumentMemory(db,config).list(tenantId,principal).filter(x=>x.status==='completed'&&x.sourceState==='current'&&x.wiki?.status==='proposed'&&x.review?.status==='approved').map(x=>({kind:'wiki',id:x.id,version:x.review.version,label:x.wiki.title})),
 ...new NoteService(db,config).list(tenantId,principal).map(x=>({kind:'note',id:x.id,version:x.version,label:x.title})),
 ...new AssertionService(db,config).list(tenantId,principal).filter(x=>x.sourceState==='current'&&x.assertion.status!=='rejected').map(x=>({kind:'assertion',id:x.id,version:x.version,label:x.assertion.subject_ref+': '+x.assertion.predicate})),
 ...new ChecklistService(db,config).list(tenantId,principal).map(x=>({kind:'checklist',id:x.id,version:x.version,label:x.title}))];
}
export function contributionSnapshot(db,config,tenantId,selection,principal){
 authorizeTenant(db,principal,tenantId,'documents:read');let item,references,content;
 if(selection.kind==='wiki'){
  const wiki=new DocumentMemory(db,config).get(tenantId,selection.id,principal);assert(wiki.sourceState==='current'&&wiki.wiki?.status==='proposed'&&wiki.review?.status==='approved',409,'advisor_contribution_stale','Use a current human-reviewed wiki');item={id:wiki.id,version:wiki.review.version};
  references=[...wiki.wiki.facts.map(x=>x.evidence.reference),...wiki.wiki.entities.map(x=>x.evidence.reference),...wiki.wiki.relations.map(x=>x.evidence.reference)];references=[...new Map(references.map(x=>[x.documentId+':'+x.fragmentId,x])).values()];
  content={title:wiki.wiki.title,classification:wiki.wiki.classification,facts:wiki.wiki.facts,entities:wiki.wiki.entities,relations:wiki.wiki.relations,review:wiki.review,coverage:wiki.coverage,origin:'reviewed-model-proposal',truthVerified:false};
 }
 if(selection.kind==='note'){item=new NoteService(db,config).list(tenantId,principal).find(x=>x.id===selection.id);references=item?.references;content=item&&{title:item.title,text:item.text,authorId:item.authorId,authorName:item.authorName};}
 if(selection.kind==='assertion'){item=new AssertionService(db,config).list(tenantId,principal).find(x=>x.id===selection.id);assert(item?.sourceState==='current'&&item.assertion.status!=='rejected',409,'advisor_contribution_stale','Use a current non-rejected assertion');references=item.references;content={subject:item.assertion.subject_ref,predicate:item.assertion.predicate,value:item.assertion.value,context:item.context,status:item.effectiveStatus,authorId:item.authorId,authorName:item.authorName,possibleConflicts:item.possibleConflicts};}
 if(selection.kind==='checklist'){item=new ChecklistService(db,config).list(tenantId,principal).find(x=>x.id===selection.id);references=item?.items.flatMap(x=>x.references);content=item&&{title:item.title,periodStart:item.periodStart,periodEnd:item.periodEnd,items:item.items};}
 assert(item&&content&&Array.isArray(references),404,'advisor_contribution_unavailable','Client contribution unavailable');
 const verified=references.map(ref=>{if(ref.origin==='reviewed-model-transcription')return currentVisualReference(db,config,tenantId,ref).reference;const doc=db.prepare("SELECT sha256 FROM documents WHERE id=? AND tenant_id=? AND status='stored' AND deleted_at IS NULL").get(ref.documentId,tenantId),bundle=doc&&readExtraction(db,config,tenantId,ref.documentId),fragment=bundle?.fragments.find(x=>x.id===ref.fragmentId);assert(doc&&doc.sha256===ref.sourceHash&&bundle.sourceHash===doc.sha256&&fragment&&(!ref.parserVersion||ref.parserVersion===bundle.parserVersion)&&(!ref.fragmentHash||ref.fragmentHash===sha256(Buffer.from(JSON.stringify(fragment)))),409,'advisor_contribution_stale','Contribution source changed');return {...ref,parserVersion:bundle.parserVersion,fragmentHash:sha256(Buffer.from(JSON.stringify(fragment)))};});
 const snapshot={kind:selection.kind,id:item.id,version:item.version,origin:selection.kind==='wiki'?'reviewed-model-proposal':'human-contribution',independentEvidence:false,truthVerified:false,content,references:verified};assert(JSON.stringify(snapshot).length<=8000,413,'advisor_contribution_limit','Selected contribution exceeds context limit');
 return {...snapshot,fingerprint:sha256(Buffer.from(JSON.stringify(snapshot)))};
}
export function validateContributions(db,config,tenantId,prepared,principal){for(const snapshot of prepared.contributions||[]){const current=contributionSnapshot(db,config,tenantId,snapshot,principal);assert(current.fingerprint===snapshot.fingerprint,409,'advisor_contribution_stale','Contribution revision or sources changed');}}

export function appendContributionEvidence(db,config,tenantId,prepared){
 let chars=prepared.evidence.reduce((n,e)=>n+e.text.length,0);const seen=new Set(prepared.evidence.map(e=>e.reference.documentId+':'+e.reference.fragmentId));
 for(const contribution of prepared.contributions||[])for(const ref of contribution.references){
  const key=ref.documentId+':'+ref.fragmentId;if(seen.has(key)||prepared.evidence.length>=8)continue;
  if(ref.origin==='reviewed-model-transcription'){const visual=currentVisualReference(db,config,tenantId,ref),text=visual.text.slice(0,2400);if(chars+text.length>16000)continue;prepared.evidence.push({evidenceId:'E'+(prepared.evidence.length+1),text,reference:ref,truncated:text.length<visual.text.length,origin:visual.origin,relation:'reviewed-visual-transcription',independentEvidence:false});chars+=text.length;seen.add(key);continue;}
  const bundle=readExtraction(db,config,tenantId,ref.documentId),fragment=bundle?.fragments.find(f=>f.id===ref.fragmentId);assert(fragment&&bundle.sourceHash===ref.sourceHash,409,'advisor_contribution_stale','Selected contribution original unavailable');const text=fragment.text.slice(0,2400);if(chars+text.length>16000)continue;
  prepared.evidence.push({evidenceId:'E'+(prepared.evidence.length+1),text,reference:ref,displayColumns:fragment.metadata?.columns||null,truncated:text.length<fragment.text.length,relation:'selected-contribution-original'});chars+=text.length;seen.add(key);
 }
}
