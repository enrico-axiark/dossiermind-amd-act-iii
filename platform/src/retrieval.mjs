import {reviewedVisual,matchVisual} from './reviewed-visual.mjs';
import {DocumentMemory} from './document-memory.mjs';
import {AssertionService} from './assertions.mjs';
import {ChecklistService} from './checklists.mjs';
import {reportTitles} from './reports.mjs';
import {CalculationMemory} from "./calculation-memory.mjs";
import {NoteService} from "./notes.mjs";
import {readExtraction} from './ingestion.mjs';
import {assert} from './errors.mjs';
const tokenize=value=>String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
export function searchFragments(db,config,tenantId,query) {
  assert(typeof query==='string'&&query.trim().length>=2&&query.length<=500,400,'validation_error','Query must contain 2 to 500 characters');
  const terms=[...new Set(tokenize(query))];assert(terms.length>=1&&terms.length<=30,400,'validation_error','Use 1 to 30 search terms');
  const sources=db.prepare("SELECT id,original_filename,sha256 FROM documents WHERE tenant_id=? AND status='stored' AND deleted_at IS NULL").all(tenantId);
  assert(sources.length<=200,413,'search_scope_limit','Search scope exceeds the initial document limit');
  const records=[];
  for(const source of sources){
    const bundle=readExtraction(db,config,tenantId,source.id);if(!bundle)continue;
    for(const fragment of bundle.fragments){
      const tokens=tokenize(fragment.text),frequency=new Map();
      for(const token of tokens)frequency.set(token,(frequency.get(token)||0)+1);
      records.push({fragment,filename:source.original_filename,frequency,length:tokens.length});
      assert(records.length<=10000,413,'search_fragment_limit','Search scope exceeds the initial fragment limit');
    }
  }
  const count=records.length,average=records.reduce((sum,row)=>sum+row.length,0)/Math.max(count,1)||1;
  const frequencies=new Map(terms.map(term=>[term,records.filter(row=>row.frequency.has(term)).length]));
  const ranked=records.map(row=>{
    let score=0;
    for(const term of terms){const tf=row.frequency.get(term)||0;if(!tf)continue;const df=frequencies.get(term);const idf=Math.log(1+(count-df+0.5)/(df+0.5));score+=idf*(tf*2.2)/(tf+1.2*(0.25+0.75*row.length/average));}
    return {row,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.row.fragment.id.localeCompare(b.row.fragment.id));
  const derived=new CalculationMemory(db,config).summaries(tenantId).filter(item=>item.state==='current').map(item=>{
    const r=item.result;const text=`${r.source.filename} Entrate ${r.totals.credit.eur} Uscite ${r.totals.debit.eur} Saldo finale ${r.totals.closingObserved.eur} Calcolo condizionato, ipotesi da verificare`;
    const words=new Set(tokenize(text));return {id:item.id,text,filename:r.source.filename,documentId:r.source.documentId,sourceHash:r.source.sourceHash,lineageId:item.lineageId,independentEvidence:false,reviewStatus:item.reviewStatus,summary:{credit:r.totals.credit,debit:r.totals.debit,closing:r.totals.closingObserved},kind:'derived-calculation-summary',matches:terms.filter(term=>words.has(term)).length};
  }).filter(item=>item.matches>0).sort((a,b)=>b.matches-a.matches).slice(0,10);
  const humanContributions=new AssertionService(db,config).current(tenantId).filter(item=>item.sourceState==='current'&&item.assertion.status!=='rejected').map(item=>{
    const words=new Set(tokenize([item.assertion.subject_ref,item.assertion.predicate,item.assertion.value,item.context].join(' ')));
    return {id:item.id,version:item.version,subject:item.assertion.subject_ref,predicate:item.assertion.predicate,value:item.assertion.value,context:item.context,authorName:item.authorName,status:item.effectiveStatus,recordedStatus:item.assertion.status,references:item.references,origin:'human',independentEvidence:false,possibleConflictCount:item.possibleConflicts.length,matches:terms.filter(term=>words.has(term)).length};
  }).filter(item=>item.matches>0).sort((a,b)=>b.matches-a.matches||a.id.localeCompare(b.id)).slice(0,20);
  const currentFragments=new Set(records.map(row=>row.fragment.documentId+':'+row.fragment.id));
  const sourceHashes=new Map(sources.map(source=>[source.id,source.sha256]));
  const sharedNotes=new NoteService(db,config).exportLatest(tenantId).filter(note=>note.references.every(ref=>sourceHashes.get(ref.documentId)===ref.sourceHash&&currentFragments.has(ref.documentId+':'+ref.fragmentId))).map(note=>{
    const words=new Set(tokenize(note.title+' '+note.text));return {id:note.id,version:note.version,title:note.title,text:note.text,authorId:note.authorId,authorName:note.authorName,createdAt:note.createdAt,references:note.references,origin:'human',support:'author-contribution-not-verified-fact',independentEvidence:false,truthVerified:false,matches:terms.filter(term=>words.has(term)).length};
  }).filter(note=>note.matches>0).sort((a,b)=>b.matches-a.matches||a.id.localeCompare(b.id)).slice(0,20);
  const wikiContributions=new DocumentMemory(db,config).export(tenantId).filter(m=>m.status==='completed'&&m.sourceState==='current'&&m.review?.status==='approved'&&m.wiki?.status==='proposed').map(m=>{const words=new Set(tokenize(m.wiki.title+' '+m.wiki.facts.map(f=>f.text).join(' ')));return {id:m.id,title:m.wiki.title,review:m.review,classification:m.wiki.classification,origin:'reviewed-model-proposal',independentEvidence:false,truthVerified:false,documentId:m.documentId,matches:terms.filter(t=>words.has(t)).length};}).filter(m=>m.matches>0).slice(0,10);
  return {query,derived,humanContributions,sharedNotes,wikiContributions,reviewedTranscriptions:matchVisual(reviewedVisual(db,config,tenantId),terms).slice(0,20),method:'lexical-bm25',scoreMeaning:'ranking-not-confidence',totalMatches:ranked.length,
    data:ranked.slice(0,20).map(({row,score})=>({...row.fragment,filename:row.filename,score:Number(score.toFixed(6))}))};
}
export function sourceGraph(db,tenantId,config=null){
  const documents=db.prepare(`SELECT d.id,d.original_filename,d.sha256,e.fragment_count,e.status FROM documents d
    LEFT JOIN document_extractions e ON e.document_id=d.id
    WHERE d.tenant_id=? AND d.status='stored' AND d.deleted_at IS NULL ORDER BY d.created_at`).all(tenantId);
  assert(documents.length<=200,413,'graph_scope_limit','Graph scope exceeds the initial document limit');
  const root='tenant:'+tenantId;
  const notes=config?new NoteService(db,config).exportLatest(tenantId):[];
  const reports=db.prepare('SELECT id,version,kind FROM generated_reports WHERE tenant_id=? ORDER BY version DESC LIMIT 100').all(tenantId);
  const noteNodes=notes.map(note=>({id:'note:'+note.id,type:'human_note',label:note.title,version:note.version,origin:'human',support:'author-contribution-not-verified-fact'}));
  const calculations=config?new CalculationMemory(db,config).summaries(tenantId):[];
  const calculationNodes=calculations.map(item=>({id:'calculation:'+item.id,type:'calculation',label:`Controllo CSV - Versione ${item.version}`,state:item.state,independentEvidence:false}));
  const calculationEdges=calculations.map(item=>({from:'calculation:'+item.id,to:item.result.source.documentId,type:'derived_from',sourceHash:item.result.source.sourceHash,lineageId:item.lineageId,independentEvidence:false}));
  const reportNodes=reports.map(report=>({id:'report:'+report.id,type:'document_report',label:`${reportTitles[report.kind]||'Dossier documentale'} - Versione ${report.version}`,version:report.version,aiExecuted:report.kind==='advisor_analysis'?null:false}));
  const noteEdges=notes.flatMap(note=>note.references.map(ref=>({from:'note:'+note.id,to:ref.documentId,type:'cites_source',documentId:ref.documentId,sourceHash:ref.sourceHash,locator:ref.locator})));
  const reportEdges=reports.flatMap(report=>db.prepare('SELECT document_id FROM report_sources WHERE report_id=?').all(report.id).map(ref=>({from:'report:'+report.id,to:ref.document_id,type:'includes_source',documentId:ref.document_id})));

  const checklists=config?new ChecklistService(db,config).current(tenantId):[];
  const checklistNodes=checklists.map(item=>({id:'checklist:'+item.id,type:'explicit_checklist',label:item.title,version:item.version,counts:item.counts,independentEvidence:false}));
  const checklistEdges=checklists.flatMap(item=>item.items.flatMap(requirement=>requirement.references.map(ref=>({from:'checklist:'+item.id,to:ref.documentId,type:'requirement_evidence',requirementId:requirement.id,status:requirement.status,documentId:ref.documentId,fragmentId:ref.fragmentId,sourceHash:ref.sourceHash,locator:ref.locator,independentEvidence:false}))));
  const assertions=config?new AssertionService(db,config).current(tenantId):[];
  const assertionNodes=assertions.map(item=>({id:'assertion:'+item.id,type:'human_assertion',label:`${item.assertion.subject_ref}: ${item.assertion.predicate}`,status:item.effectiveStatus,sourceState:item.sourceState,version:item.version,confidence:null,independentEvidence:false}));
  const assertionEdges=assertions.flatMap(item=>item.references.map(ref=>({from:'assertion:'+item.id,to:ref.documentId,type:'human_claim_cites_source',documentId:ref.documentId,fragmentId:ref.fragmentId,sourceHash:ref.sourceHash,locator:ref.locator,sourceState:item.sourceState,independentEvidence:false})));
  const conflictEdges=assertions.flatMap(item=>item.possibleConflicts.filter(id=>item.id<id).map(id=>({from:'assertion:'+item.id,to:'assertion:'+id,type:'possible_value_difference',meaning:'human-review-signal-not-semantic-proof',independentEvidence:false})));
  const memory=config?new DocumentMemory(db,config).export(tenantId).filter(m=>m.status==='completed'&&m.sourceState==='current'&&m.wiki?.status==='proposed'&&m.review?.status!=='rejected'):[];
  const wikiNodes=memory.map(m=>({id:'wiki:'+m.id,type:'wiki_proposal',label:m.wiki.title,origin:'model-proposal',reviewStatus:m.review?.status||'pending',reviewVersion:m.review?.version||null,documentId:m.documentId,truthVerified:false,classification:m.wiki.classification}));
  const entityNodes=memory.flatMap(m=>m.wiki.entities.map(e=>({id:'memory:'+m.id+':'+e.id,type:'entity_proposal',label:e.label,entityKind:e.kind,wikiId:'wiki:'+m.id,wikiReviewStatus:m.review?.status||'pending',reference:e.evidence.reference,quote:e.evidence.quote,reviewStatus:'pending',truthVerified:false})));
  const memoryEdges=memory.flatMap(m=>[{from:'wiki:'+m.id,to:m.documentId,type:'model_derived_from',documentId:m.documentId,wikiReviewStatus:m.review?.status||'pending',reviewStatus:'pending'},...m.wiki.relations.map(r=>({from:'memory:'+m.id+':'+r.from,to:'memory:'+m.id+':'+r.to,type:'proposed_relation',label:r.label,reference:r.evidence.reference,quote:r.evidence.quote,wikiId:'wiki:'+m.id,wikiReviewStatus:m.review?.status||'pending',reviewVersion:m.review?.version||null,semanticsVerified:false,reviewStatus:'pending'}))]);
  return {kind:'source-provenance',knowledgeGraphReady:false,
    nodes:[{id:root,type:'tenant',label:'Archivio del cliente'},...documents.map(row=>({id:row.id,type:'source',label:row.original_filename,sourceHash:row.sha256,extractionStatus:row.status||'not_processed',fragmentCount:row.fragment_count||0})),...noteNodes,...reportNodes,...calculationNodes,...checklistNodes,...assertionNodes,...wikiNodes,...entityNodes],
    edges:documents.map(row=>({from:root,to:row.id,type:'authorized_source',documentId:row.id,sourceHash:row.sha256})).concat(noteEdges,reportEdges,calculationEdges,checklistEdges,assertionEdges,conflictEdges,memoryEdges),
    limitations:['Edges describe actual document, human citation and report provenance; they do not validate human claims or infer business relations.']};
}
