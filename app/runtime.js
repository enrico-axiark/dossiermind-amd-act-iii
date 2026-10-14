// Connected interface. No fixture answers, simulated timers or artificial graphs.
const $=id=>document.getElementById(id);
const labels={queued:'In coda',running:'In elaborazione',completed:'Elaborazione terminata',completed_with_errors:'Terminata con file da verificare',failed:'Elaborazione non riuscita',cancelled:'Elaborazione interrotta',extracted:'Testo estratto',needs_vision:'Lettura visiva necessaria',not_processed:'Da elaborare',rejected:'File non elaborabile'};
const label=value=>labels[value]||value;
const issueLabels={insufficient_scope:'Il consenso non include questa operazione.',needs_vision:'Serve la lettura del documento come immagine.',formula_not_recalculated:'Formula conservata: il valore non è stato ricalcolato.',formula_cache_missing:'Il risultato della formula non è disponibile: va verificato.',ambiguous_date:'La data può avere più interpretazioni: serve una verifica.',formula_text:'Il contenuto è stato conservato come testo, senza eseguirlo.',attachment_extracted:'Allegato letto e collegato al documento.',attachment_rejected:'Un allegato non è stato elaborato.',unsafe_attachment_name:'Un allegato ha un nome non valido.',remote_resources_ignored:'Le immagini e i contenuti esterni dell’email non sono stati scaricati.',parser_timeout:'Il documento ha richiesto troppo tempo. Riprova o controlla il file.',unreadable_document:'Il documento non è leggibile o è incompleto.',mime_mismatch:'Il contenuto non corrisponde al formato del file.',upload_too_large:'Il file supera il limite di 20 MB.',request_too_large:'Il file supera il limite consentito.',job_access_revoked:'Elaborazione interrotta perché i permessi sono cambiati.',tenant_access_denied:'Non hai più accesso a questo cliente.',document_not_found:'Il documento non è più disponibile.',job_type_not_implemented:'Questa funzione non è ancora disponibile.',not_found:'Questa funzione non è ancora disponibile.',local_bootstrap_required:'L’ambiente locale deve essere inizializzato.',parser_dependency_missing:'Il servizio di lettura deve essere configurato.',unsafe_xml:'Il documento contiene elementi non consentiti.',unsafe_archive:'Il documento contiene un allegato non sicuro.'};
Object.assign(issueLabels,{report_checklist_required:'Scegli una checklist disponibile nel cliente attivo.',report_type_unavailable:'Questo tipo di report è ancora in preparazione.',calculation_needs_review:'Correggi i dati prima di salvare il calcolo.',calculation_memory_limit:'È stato raggiunto il limite iniziale dei calcoli salvati.',calculation_memory_not_found:'Il calcolo salvato non è più disponibile.',memory_contract_invalid:'Questo risultato non supera i controlli di provenienza e non può essere usato.',invalid_calculation_mapping:'Verifica le colonne e il formato degli importi selezionati.',calculation_source_unavailable:'Scegli un CSV elaborato senza errori.',report_inputs_changed:'Il dossier è cambiato durante la generazione. Genera un nuovo report.',report_scope_limit:'Carica almeno un documento e verifica i limiti del dossier.',report_not_found:'Il report non è più disponibile: una sua fonte potrebbe essere stata eliminata.',report_render_failed:'Il PDF non è stato generato. Controlla lo stato dell’elaborazione.',report_timeout:'La generazione ha richiesto troppo tempo. Riprova.',note_version_conflict:'La nota è stata aggiornata da un altro utente. Riaprila prima di salvare.',invalid_note_sources:'Il passaggio scelto non è più disponibile per questo cliente.',note_not_found:'La nota non è più disponibile.',note_scope_limit:'È stato raggiunto il limite delle note.',note_revision_limit:'È stato raggiunto il limite delle revisioni.',owner_required:'Solo il cliente proprietario può decidere gli accessi.',invalid_consent_scopes:'Seleziona soltanto i permessi disponibili.',consent_transition_invalid:'Lo stato della richiesta è cambiato: aggiorna la pagina.',owner_access_protected:'L’accesso del proprietario non può essere modificato da questo pannello.'});
Object.assign(issueLabels,{ai_response_model_mismatch:'AMD ha restituito un modello diverso da quello configurato. Risposta bloccata.',ai_output_truncated:'AMD ha interrotto la risposta al limite di lunghezza. Nessun risultato parziale è stato pubblicato.',ai_output_envelope_invalid:'La risposta AMD contiene una struttura inattesa. Non è stata pubblicata.',ai_output_json_invalid:'Il contenuto restituito da AMD non è JSON valido. Non è stato pubblicato.',ai_output_schema_invalid:'La risposta AMD non rispetta i campi o i limiti richiesti. Non è stata pubblicata.'});
const friendlyIssue=code=>issueLabels[code]||'È necessaria una verifica del documento o dell’operazione.';
Object.assign(issueLabels,{ai_provider_auth_error:'AMD ha rifiutato la credenziale o l’accesso al modello. Verifica la chiave già configurata e i suoi permessi.',ai_provider_quota_error:'AMD segnala un limite di credito o quota. Verifica il saldo nella console prima di una nuova richiesta.',ai_provider_limit_error:'AMD ha raggiunto un limite di richieste o quota. Controlla la console e attendi prima di inviare una nuova domanda.',ai_provider_unavailable:'Il servizio AMD è temporaneamente indisponibile. La domanda resta salvata e non viene ripetuta automaticamente.',ai_provider_request_error:'AMD non accetta il formato della richiesta o il modello configurato. È necessaria una verifica della configurazione.'});
Object.assign(issueLabels,{ai_not_configured:'Il motore AI non è configurato. La richiesta resta salvata.',ai_vision_not_configured:'La lettura visiva non è abilitata.',ai_timeout:'La chiamata AI non ha restituito un esito in tempo. Non viene ripetuta automaticamente: va verificata.',ai_transport_error:'Il servizio AI non ha restituito un esito certo. Verifica la chiamata prima di riprovare.',ai_dispatch_uncertain:'La chiamata precedente ha un esito incerto e richiede verifica.',ai_inflight_unresolved:'Una chiamata ancora aperta o incerta blocca nuove richieste.',ai_request_cap_reached:'È stato raggiunto il limite di richieste configurato per questa demo.',ai_provider_error:'Il servizio AI ha rifiutato la richiesta. Controlla disponibilità e quota.',ai_output_invalid:'La risposta del modello non supera i controlli del formato. Non è stata pubblicata.',advisor_output_invalid:'La risposta del modello è incoerente e non è stata pubblicata.',advisor_claim_invalid:'La risposta contiene proposte prive delle fonti richieste o numeri non consentiti. Non è stata pubblicata.',advisor_citation_invalid:'Una citazione non corrisponde alla fonte: risposta bloccata.',memory_citation_invalid:'La wiki contiene una citazione non corrispondente alla fonte: proposta bloccata.',memory_output_invalid:'La proposta wiki non supera i controlli richiesti.'});
Object.assign(issueLabels,{legal_hold_active:'Cancellazione bloccata: è attivo un vincolo di conservazione.',deletion_manifest_changed:'I contenuti collegati sono cambiati. Riapri il riepilogo prima di confermare.',deletion_review_required:'Controlla il riepilogo della cancellazione prima di confermare.'});
function locationLabel(locator={},kind=null){
  const parts=[];
  if(locator.attachment)parts.push('Allegato: '+locator.attachment);
  if(locator.page!=null)parts.push('Pagina '+locator.page);
  if(locator.row!=null)parts.push('Riga '+locator.row);
  if(locator.sheet)parts.push('Foglio '+locator.sheet);
  if(locator.cell)parts.push('Cella '+locator.cell);
  if(locator.xml_path)parts.push('Campo '+locator.xml_path.split('/').at(-1).replace(/\[\d+\]/g,''));
  // A non-multipart message can use part 0 for both headers and body.
  // Only extraction metadata identifies the section; never infer it from the number.
  if(locator.part!=null&&!parts.length)parts.push(kind==='headers'?'Intestazione email':['body','html_text'].includes(kind)?'Testo email':'Passaggio email');
  return parts.join(' · ')||'Passaggio del documento';
}
function sourceText(fragment){
  if(fragment.metadata?.columns){
    const names={data:'Data',date:'Data',descrizione:'Descrizione',description:'Descrizione',amount_eur:'Importo',importo_eur:'Importo',dare_eur:'Uscite',avere_eur:'Entrate',saldo_eur:'Saldo'};
    return Object.entries(fragment.metadata.columns).filter(([key])=>key!=='id_movimento').map(([key,value])=>{
      let readable=value;
      if(key.endsWith('_eur')&&/^-?\d{1,12}(\.\d{1,2})?$/.test(String(value)))readable=new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(value));
      return `${names[key]||key.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}: ${readable}`;
    }).join('\n');
  }
  return fragment.text;
}
function technicalDetails(entries){
  const details=node('details',null,'verification-details');details.append(node('summary','Dettagli di verifica'));
  for(const [title,value] of entries)if(value!=null)details.append(node('p',title),node('code',String(value)));
  return details;
}
function citationPresentation(quote){
  let fields;try{fields=JSON.parse(quote);}catch{}
  const isRow=fields&&typeof fields==='object'&&!Array.isArray(fields)&&Object.keys(fields).length>0&&Object.values(fields).every(value=>typeof value==='string'||typeof value==='number');
  if(!isRow)return node('p',quote);
  const content=node('div',null,'runtime-citation');content.append(node('small','Contenuto citato · visualizzazione leggibile'),node('p',sourceText({metadata:{columns:fields}})));
  const literal=node('details',null,'verification-details');literal.append(node('summary','Citazione testuale originale'),node('blockquote',quote));content.append(literal);return content;
}
const session={token:null,tenants:[],tenant:null,docs:[],selected:new Set(),generation:0,controller:null,job:null,filter:'all',archiveQuery:''};
function text(id,value){if($(id))$(id).textContent=value;}
function node(tag,value,className){const el=document.createElement(tag);if(value!=null)el.textContent=value;if(className)el.className=className;return el;}
function note(id,value){$(id)?.replaceChildren(node('p',value,'runtime-note'));}
function notify(value){text('toast',value);$('toast').classList.add('visible');setTimeout(()=>$('toast').classList.remove('visible'),5000);}
async function api(path,{method='GET',body,headers={},signal=session.controller?.signal,raw=false}={}){
  const response=await fetch(path,{method,body,credentials:'same-origin',headers:{...(session.csrf?{'x-csrf-token':session.csrf}:{}),...(session.token?{authorization:'Bearer '+session.token}:{}),...headers},signal});
  if(!response.ok){let message='Operazione non riuscita. Verifica i dati inseriti.',errorCode='';try{const error=(await response.json()).error;errorCode=error.code;message=friendlyIssue(error.code);if(error.code==='financial_rows_need_review'&&error.details?.issues){message+=' '+error.details.issues.map(issue=>locationLabel(issue.locator)+': '+friendlyIssue(issue.code)).join(' · ');if(error.details.totalIssues>20)message+=' · Mostrati i primi 20 di '+error.details.totalIssues+' problemi.';}}catch{}if(response.status===401||(response.status===403&&errorCode==='tenant_access_denied')){clearContext();session.token=null;session.online=false;session.csrf=null;session.tenant=null;$('accessGate').classList.remove('is-dismissed');text('loginMessage','Accesso terminato: '+message);}throw new Error(message);}
  return raw?response:response.json();
}
function view(id){
  if(!session.token&&!session.online)return;
  if(session.tenant&&['archive','ingestion','brain','advisor','report'].includes(id)&&!session.tenant.scopes?.includes('documents:read')){notify('Il consenso non include la lettura dei documenti.');return;}
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===id));
  document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===id));
  if(id==='governance'&&session.tenant){void audit().catch(error=>notify(error.message));void consentPanel().catch(error=>notify(error.message));}
  if(id==='report'&&session.tenant)void reportsPanel().catch(error=>notify(error.message));
  if(id==='advisor'&&session.tenant)void advisorHistory().catch(error=>notify(error.message));
  if(id==='brain'&&session.tenant)void graph().catch(error=>notify(error.message));
}
function clearContext(){
  applyAiStatus(null);$('studioContributionPanel').hidden=true;text('studioContributionTenant','Cliente da selezionare');$('scenarioDock').hidden=true;closeQuickLinks();
  $('liveBrainMap')?.remove();session.generation++;session.controller?.abort();session.controller=new AbortController();session.job=null;session.docs=[];session.selected.clear();session.filter='all';session.archiveQuery='';if($('archiveSearch'))$('archiveSearch').value='';document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter==='all'));
  for(const id of ['studioContributionLedger','documentList','digestQueue','ingestionReceipts','brainStage','brainDetail','auditList','consoleFeed','consentPanel','reportPreview','exportList','bankCalculation','dossierChecklists','reportChecklist','chatStream','advisorHistory','reportAdvisor'])$(id)?.replaceChildren();
  if($('askInput'))$('askInput').value='';
  for(const id of ['advisorContext','advisorStart','advisorEnd'])if($(id))$(id).value='';
  $('advisorCalculations')?.replaceChildren();$('advisorContributions')?.replaceChildren();
  for(const id of ['sideDocs','metricArchive','sideLinks','metricQuestions','artifactLinks','markdownCount','crossLinkScanned','crossLinkRelations','crossLinkFindings'])text(id,'0');
  text('storyLinks','Collegamenti da verificare');text('crossLinkTotal','Cliente da selezionare');text('indexStatus','Indice da verificare');text('storyOutput','Dati da caricare');text('crossLinkTitle','Collegamenti da verificare');text('crossLinkNarrative','Seleziona un cliente per consultare le fonti e i contributi nel suo perimetro.');text('markdownCount','Memoria da verificare');text('ingestionStatus','In attesa');text('phaseOneMetric','In attesa');text('pipelinePercent','0%');$('progressBar').style.width='0%';
  if($('reportPeriodControls')){periodSources.replaceChildren();periodStart.value=periodEnd.value='';periodConfirm.checked=false;}
  if($('reportFinanceControls'))clearFinance();
  $('pdfModal').classList.remove('visible');$('pdfModal').setAttribute('aria-hidden','true');setModalOriginal();$('pdfPaper').replaceChildren();
}
async function selectTenant(tenant){
  clearContext();session.tenant=tenant;$('scenarioDock').hidden=!(session.token||session.online);
  $('studioContributionPanel').hidden=tenant.role!=='accountant';text('studioContributionTenant',tenant.name);text('studioContributionScope',tenant.scopes?.includes('documents:write')?'Scrittura documentale consentita · nessuna decisione automatica':'Il consenso non consente il caricamento di documenti');$('ingestionRoleNote').replaceChildren(node('strong',tenant.role==='accountant'?'Contribuisci secondo il consenso.':'Tu conferisci e controlli.'),node('span',tenant.role==='accountant'?'I documenti restano nel cliente selezionato, con autore e fonte. Il caricamento richiede il permesso di scrittura.':'DossierMind conserva gli originali e rende visibili le trasformazioni.'));
  for(const id of ['pickFiles','studioPickFiles','fileInput','simulateLoad','selectAllDocs'])if($(id))$(id).disabled=!tenant.scopes?.includes('documents:write');
  for(const id of ['quickStart','saveAdvisorRequest'])if($(id))$(id).disabled=!tenant.scopes?.includes('jobs:write');
  for(const id of ['sideWorkspace','sharedBrainBadge','archivePackageTitle'])text(id,tenant.name);
  text('tenantBadge','Archivio riservato del cliente');text('metricTenant',tenant.name);text('topContext',tenant.name);
  text('activeRoleBadge',tenant.role==='accountant'?'Studio · accesso autorizzato':'Cliente · proprietario');
  for(const id of ['brainRoleBadge','ingestionRoleBadge'])text(id,tenant.role==='accountant'?'Vista studio · accesso autorizzato':'Vista cliente · proprietario');
  text('consentStatus','Permessi verificati dal server');text('sideFocus','Dossier');
  text('scenarioTitle','Dossier documentale');text('scenarioDescription','Carica gli originali, elabora i documenti e consulta i frammenti con riferimenti alle fonti.');
  text('phaseTwoMetric','Stato wiki da verificare');text('storyNotes','Stato wiki da verificare');text('indexStatus','Indice in aggiornamento');text('storyOutput','Estrazione documentale');
  text('digestClassification','Parsing deterministico; AI non eseguita');
  await consentPanel();
  await refresh();await audit();view(tenant.scopes?.includes('documents:read')&&!session.docs.length?'tenant-empty':'sandbox');
}
async function refresh(){
  const generation=session.generation,tenant=session.tenant;
  if(!tenant.scopes?.includes('documents:read')){session.docs=[];renderArchive();text('sideDocs','—');text('metricArchive','—');note('digestQueue','Il consenso non include la lettura dei documenti.');return;}
  const [documents]=await Promise.allSettled([api(`/v1/tenants/${tenant.id}/documents`),refreshAiStatus()]);
  if(documents.status==='rejected')throw documents.reason;
  const result=documents.value;
  if(generation!==session.generation)return;
  session.docs=result.data;text('sideDocs',result.data.length);text('metricArchive',result.data.length);text('storyDocs',result.data.length+' documenti');
  const extracted=result.data.filter(doc=>doc.extractionStatus==='extracted').length,vision=result.data.filter(doc=>doc.extractionStatus==='needs_vision').length;
  text('indexStatus',extracted?`${extracted} ${extracted===1?'documento con testo consultabile':'documenti con testo consultabile'}`:'Nessun testo ancora consultabile');
  text('storyOutput',`${extracted} ${extracted===1?'documento elaborato':'documenti elaborati'}${vision?' · '+vision+' da leggere come immagini':''}`);
  text('emptyTenantCompany',tenant.name);text('emptyTenantId',tenant.id);text('emptyDocumentCount',result.data.length);text('emptyTenantAudit',tenant.scopes?.includes('audit:read')?'Disponibile':'Non incluso');text('emptyTenantMessage',tenant.scopes?.includes('documents:write')?'Questo cliente non ha ancora documenti. Apri la Inbox per caricare i suoi originali; i documenti degli altri clienti restano nei rispettivi archivi.':'Questo cliente non ha ancora documenti. Il tuo accesso consente la lettura: chiedi al proprietario di conferire i suoi originali.');
  renderArchive();renderStudioContributions();
  $('digestQueue').replaceChildren(...result.data.map(doc=>node('p',doc.filename,'runtime-note')));
  await refreshBrainSummary();
}
function renderStudioContributions(){
 const ledger=$('studioContributionLedger');ledger.replaceChildren();if(session.tenant?.role!=='accountant')return;
 const documents=session.docs.filter(doc=>doc.createdBy===session.actorId);
 if(!documents.length){ledger.append(node('p','Nessun originale conferito da questa identità nel cliente.','contribution-empty'));return;}
 for(const doc of documents){const row=node('article',null,'runtime-note'),open=node('button',doc.filename,'ghost-btn');open.onclick=()=>void showFragments(doc).catch(error=>notify(error.message));row.append(open,node('small','Conferito con la tua identità · '+new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short'}).format(new Date(doc.createdAt))),node('p',label(doc.extractionStatus)),technicalDetails([['Autore registrato',doc.createdBy],['Impronta originale',doc.sha256]]));ledger.append(row);}
}
function applyGraphSummary(graph){
 const links=graph.edges.filter(edge=>edge.type!=='authorized_source').length,count=type=>graph.nodes.filter(item=>item.type===type).length,notes=count('human_note'),reports=count('document_report');
 text('sideLinks',links);for(const id of ['artifactLinks','storyLinks'])text(id,`${links} ${links===1?'collegamento':'collegamenti'}`);
 text('crossLinkScanned',count('source'));text('crossLinkTotal','documenti del cliente');text('crossLinkRelations',links);text('crossLinkFindings',count('human_assertion'));
 text('crossLinkTitle',links?`${links} collegamenti con provenienza`:'Nessun collegamento registrato');text('crossLinkNarrative',`${notes} ${notes===1?'nota condivisa':'note condivise'} · ${reports} report. La mappa collega fonti, contributi, calcoli e proposte wiki disponibili. Collegamento e citazione non certificano una riconciliazione o la correttezza del contenuto.`);
}
async function refreshBrainSummary(){
 const tenant=session.tenant,generation=session.generation;if(!tenant?.scopes?.includes('documents:read'))return;
 const [graphResult,memoryResult]=await Promise.allSettled([api(`/v1/tenants/${tenant.id}/brain/graph`),api(`/v1/tenants/${tenant.id}/brain/memory`)]);if(generation!==session.generation)return;
 if(graphResult.status==='fulfilled')applyGraphSummary(graphResult.value);else{for(const id of ['sideLinks','artifactLinks','storyLinks','crossLinkScanned','crossLinkRelations','crossLinkFindings'])text(id,'Da verificare');text('crossLinkTotal','Stato non disponibile');text('crossLinkTitle','Mappa non disponibile');text('crossLinkNarrative','Apri Cervello per aggiornare la mappa; i collegamenti non sono stati verificati.');}
 if(memoryResult.status==='fulfilled'){const requests=memoryResult.value.data,current=requests.filter(item=>item.sourceState==='current'&&item.status==='completed'),wiki=current.filter(item=>item.wiki),approved=wiki.filter(item=>item.review?.status==='approved').length,uncertain=requests.filter(item=>item.status==='uncertain').length;text('markdownCount',`${wiki.length} proposte wiki · ${approved} riviste${uncertain?' · '+uncertain+' chiamate da verificare':''}`);}else text('markdownCount','Stato wiki non disponibile');
}
function applyAiStatus(status){
 session.aiStatus=status;
 const labels={not_configured:'AI non collegata',suspended:'AI · nuove richieste sospese',configured:'AI configurata · risultati da rivedere',queued:'AI · richieste in attesa',working:'AI · elaborazione in corso',needs_check:'AI · chiamata da verificare',limit_reached:'AI · limite richieste raggiunto'};
 const ready=status?.configured===true,state=status?.state;
 for(const id of ['aiRuntimeBadge','gateAiRuntimeBadge','advisorCapabilityStatus'])text(id,labels[state]||'Stato AI da verificare');
 text('ingestionDescription','Gli originali restano conservati. L’estrazione alimenta la ricerca; wiki e lettura visiva si richiedono nel Cervello e mantengono stato e revisione separati.');
 text('advisorIntro',ready?'Invia una domanda con le fonti e il contesto del cliente. Le risposte sono proposte da verificare con il professionista.':'Consulta le fonti del cliente. Lo stato del motore indica se le domande possono essere elaborate.');
 text('advisorCapabilityDescription',ready?'Il motore prepara analisi con citazioni, ipotesi e informazioni mancanti. Confronta le risposte con le fonti prima di usarle.':'Cerca nei documenti e apri i passaggi originali. La generazione delle risposte richiede il motore configurato.');
 text('advisorAnalysisTitle',ready?'Analisi con fonti da rivedere':'Analisi AI da configurare');
 text('advisorAnalysisDescription',ready?'Suggerimenti e scenari restano proposte soggette a revisione.':'Le domande vengono salvate anche quando il motore non è disponibile.');
 const messages={suspended:'Le nuove elaborazioni AI sono sospese. Puoi consultare le risposte già ricevute, aprire le fonti e generare i loro report.',needs_check:'Una chiamata ha un esito incerto. Le nuove richieste attendono la verifica; nessun tentativo viene ripetuto automaticamente.',limit_reached:'Il limite di richieste della demo è stato raggiunto. Le domande restano salvate.',working:'Una richiesta è in elaborazione. Aggiorna lo stato per vedere il risultato.',queued:'Ci sono richieste salvate in attesa di elaborazione.'};
 text('advisorQueueNotice',(messages[state]||(ready?'Il motore è configurato. Lo stato di ogni domanda mostra elaborazione, risultato o errore.':'Le domande restano salvate in attesa del motore.'))+' Il periodo dichiarato non certifica la completezza dei documenti.');
 text('phaseTwoMetric',ready?'Wiki · proposte da rivedere':'Wiki · motore da configurare');text('storyNotes',ready?'Wiki · proposte da rivedere':'Wiki · motore da configurare');
}
function aiHistoryNotice(){
 const s=session.aiStatus;
 if(s?.state==='suspended')return 'Nuove elaborazioni AI sospese. Risposte già ricevute, fonti e report restano consultabili.';
 if(s?.state==='needs_check')return 'Una chiamata richiede verifica. Le richieste in attesa non vengono ripetute automaticamente.';
 if(s?.state==='limit_reached')return 'Limite di richieste raggiunto: le domande restano salvate.';
 if(!s)return 'Stato del motore non disponibile. Aggiorna per verificarlo.';
 return s.configured?'Motore configurato. Ogni richiesta conserva il proprio stato e può richiedere verifica.':'Motore AI non configurato: le richieste restano salvate in attesa.';
}
async function refreshAiStatus(){
 const tenant=session.tenant,generation=session.generation;if(!tenant||!tenant.scopes?.includes('documents:read'))return;
 try{const result=await api(`/v1/tenants/${tenant.id}/ai/status`);if(generation===session.generation)applyAiStatus(result.data);}
 catch{if(generation===session.generation)applyAiStatus(null);}
}
function visibleDocuments(){
  return session.docs.filter(doc=>{
    const filename=doc.filename.toLocaleLowerCase('it-IT');
    const category=session.filter==='all'||(session.filter==='Fattura'&&filename.includes('fattura'))||(session.filter==='Banca'&&filename.includes('banca'))||(session.filter==='Da rivedere'&&(doc.extractionStatus!=='extracted'||doc.warningCount>0));
    return category&&filename.includes(session.archiveQuery.toLocaleLowerCase('it-IT'));
  });
}
function renderArchive(){
  const rows=visibleDocuments().map(doc=>{
    const row=node('article',null,'runtime-row'),box=node('input');box.type='checkbox';box.checked=session.selected.has(doc.id);box.setAttribute('aria-label','Seleziona '+doc.filename);
    box.onchange=()=>{if(box.checked)session.selected.add(doc.id);else session.selected.delete(doc.id);text('selectedCounter',session.selected.size+' selezionati');};
    const open=node('button','Leggi contenuto','ghost-btn');open.onclick=()=>void showFragments(doc).catch(error=>notify(error.message));
    const download=node('button','Originale','ghost-btn');download.onclick=()=>void downloadOriginal(doc).catch(error=>notify(error.message));
    const size=doc.sizeBytes<1024*1024?`${Math.max(1,Math.round(doc.sizeBytes/1024))} KB`:`${(doc.sizeBytes/(1024*1024)).toLocaleString('it-IT',{maximumFractionDigits:1})} MB`;
    row.append(box,node('strong',doc.filename),node('span',size,'document-size'),node('small',label(doc.extractionStatus)+(doc.warningCount?' · Avvisi da verificare':'')),open,download);
    if(session.tenant?.scopes?.includes('documents:delete')){const remove=node('button','Elimina documento','ghost-btn');remove.onclick=()=>void reviewDeletion(doc).catch(error=>notify(error.message));row.append(remove);}
    return row;
  });
  $('documentList').replaceChildren(...rows);text('selectedCounter',session.selected.size+' selezionati');
  if(!rows.length)$('documentList').append(node('p',session.docs.length?'Nessun documento corrisponde al filtro.':'Questo cliente non ha ancora documenti. Carica i suoi originali per iniziare.','runtime-note'));
}
async function reviewDeletion(doc){
 const generation=session.generation,tenantId=session.tenant.id;
 const result=await api(`/v1/tenants/${tenantId}/documents/${doc.id}/deletion-manifest`);
 if(generation!==session.generation)return;
 const content=node('div',null,'runtime-source'),a=result.affected;
 content.append(node('h3','Controlla cosa verrà eliminato'),node('p',doc.filename),node('p','La cancellazione è definitiva per questo archivio. Se un contributo usa più fonti, viene eliminato per intero, comprese le sue revisioni.','source-warning'));
 const names={originals:'Documento originale',extractions:'Estrazione documentale',fragments:'Passaggi di testo',notes:'Note condivise',noteRevisions:'Revisioni delle note',checklists:'Checklist collegate',checklistRevisions:'Revisioni delle checklist',assertions:'Affermazioni con fonte',assertionRevisions:'Revisioni delle affermazioni',calculations:'Calcoli salvati',advisorRequests:'Richieste e risposte Advisor',advisorReviews:'Revisioni Advisor',memoryRequests:'Elaborazioni wiki e lettura visiva',memoryReviews:'Revisioni wiki e lettura visiva',reports:'Report PDF'};
 for(const [key,title] of Object.entries(names)){const count=Array.isArray(a[key])?a[key].length:a[key];if(count)content.append(node('p',title+': '+count));}
 content.append(node('p','Restano la traccia tecnica delle elaborazioni, la registrazione di audit e un riferimento al documento eliminato. Copie già scaricate o presenti nei backup richiedono una gestione separata.','runtime-note'));
 if(result.blocked)content.append(node('p','Cancellazione bloccata: questo archivio ha un vincolo di conservazione attivo.','source-warning'));
 else{
  const form=node('form'),input=node('input'),caption=node('label','Per confermare, scrivi il nome completo del documento'),confirm=node('button','Conferma cancellazione definitiva','primary-btn');
  input.setAttribute('aria-label','Nome documento da eliminare');caption.append(input);confirm.type='submit';confirm.disabled=true;input.oninput=()=>{confirm.disabled=input.value!==doc.filename;};form.append(caption,confirm);
  form.onsubmit=async event=>{event.preventDefault();if(input.value!==doc.filename||generation!==session.generation)return;confirm.disabled=true;
   try{await api(`/v1/tenants/${tenantId}/documents/${doc.id}`,{method:'DELETE',headers:{'x-deletion-manifest':result.manifestSha256}});if(generation!==session.generation)return;session.selected.delete(doc.id);$('pdfModal').classList.remove('visible');$('pdfModal').setAttribute('aria-hidden','true');setModalOriginal();$('pdfPaper').replaceChildren();await refreshDocuments();notify('Documento e contenuti collegati eliminati.');}
   catch(error){notify(error.message);confirm.disabled=input.value!==doc.filename;}
  };content.append(form);
 }
 content.append(technicalDetails([['Riepilogo di cancellazione',result.manifestSha256]]));text('pdfTitle',doc.filename);text('pdfKind','Cancellazione del documento e dei contenuti collegati');setModalOriginal();$('pdfPaper').replaceChildren(content);$('pdfModal').classList.add('visible');$('pdfModal').setAttribute('aria-hidden','false');
}
async function login(role){
  if(session.authMode==='competition'){
    const password=$('competitionPassword').value;$('competitionPassword').value='';const result=await api('/v1/auth/competition',{method:'POST',headers:{'content-type':'application/json','x-demo-login':'1'},body:JSON.stringify({role,profile:$('localProfile').value,password})});
    session.online=true;session.csrf=result.csrfToken;await enterWorkspace(role);return;
  }
  if(session.authMode==='oidc'){location.assign('/v1/auth/login');return;}
  if(session.authMode!=='development')throw new Error('Accesso online non ancora configurato.');
  text('loginMessage','Verifico identità e permessi locali…');
  const result=await api('/v1/dev/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role,profile:$('localProfile').value})});
  session.token=result.token;await enterWorkspace(role);
}
async function enterWorkspace(role){
  const [identity,accessible]=await Promise.all([api('/v1/me'),api('/v1/me/tenants')]);session.actorId=identity.id;session.tenants=accessible.data;
  if(role==='auto')role=session.tenants.some(tenant=>tenant.role==='accountant')?'studio':'client';
  text('metricClients',session.tenants.length);
  $('clientGrid').replaceChildren(...session.tenants.map(tenant=>{
    const card=node('button',tenant.name,'workbench-card');card.onclick=()=>void selectTenant(tenant).catch(error=>notify(error.message));return card;
  }));
  note('studioSummary',session.tenants.length+' clienti accessibili secondo i permessi correnti.');
  if(role==='studio')await studioRequests();
  if(session.tenants.length)await selectTenant(session.tenants[0]);
  else {clearContext();session.tenant=null;text('studioSummary','Nessun accesso attivo. Puoi richiedere nuovamente l’accesso ai clienti già associati.');}
  $('accessGate').classList.add('is-dismissed');$('scenarioDock').hidden=false;
  if(role==='studio')view('studio');
}
async function upload(files){
  if(!session.tenant)throw new Error('Seleziona un cliente');
  const generation=session.generation,tenantId=session.tenant.id;
  for(const file of files){
    if(generation!==session.generation)return;
    if(file.size>20*1024*1024)throw new Error(file.name+': limite 20 MB');
    const doc=await api(`/v1/tenants/${tenantId}/documents`,{method:'POST',body:file,headers:{'content-type':file.type||mime(file.name),'x-filename':encodeURIComponent(file.name)}});
    if(generation!==session.generation)return;session.selected.add(doc.id);
  }
  await refresh();notify('Originali caricati. Avvia l’elaborazione in INGESTIONLAB.');
}
function mime(name){return name.endsWith('.eml')?'message/rfc822':name.endsWith('.xml')?'application/xml':name.endsWith('.csv')?'text/csv':name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/octet-stream';}
async function readyPackage(){
  if(session.authMode!=='development'){
    await refresh();for(const doc of session.docs)session.selected.add(doc.id);renderArchive();view('archive');notify(session.docs.length?'Documenti del cliente selezionati.':'Non ci sono documenti da selezionare.');return;
  }
  const generation=session.generation,tenantId=session.tenant.id;
  const pack=await api(`/v1/tenants/${tenantId}/dev-package`);
  for(const entry of pack.data){
    if(generation!==session.generation)return;
    const response=await api(`/v1/tenants/${tenantId}/dev-package/${encodeURIComponent(entry.filename)}`,{raw:true});
    const blob=await response.blob();await upload([new File([blob],entry.filename,{type:entry.mimeType})]);
  }
}
async function ingest(){
  if(!session.selected.size)throw new Error('Seleziona almeno un documento nell’archivio');
  const generation=session.generation,tenantId=session.tenant.id;
  const job=await api(`/v1/tenants/${tenantId}/jobs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'ingestion',input:{documentIds:[...session.selected]}})});
  if(generation!==session.generation)return;session.job=job.id;view('ingestion');
  await poll(job.id,tenantId,generation);
}
async function poll(jobId,tenantId,generation){
  if(generation!==session.generation)return;
  const job=await api(`/v1/tenants/${tenantId}/jobs/${jobId}`);
  if(generation!==session.generation)return;
  text('ingestionStatus',label(job.status));const completed=job.progress?.completed||0,total=job.progress?.total||job.input.documentIds.length;
  text('phaseOneMetric',`${completed} di ${total} documenti`);const pct=Math.round(completed/total*100);text('pipelinePercent',pct+'%');$('progressBar').style.width=pct+'%';
  $('consoleFeed').replaceChildren(node('p',job.errorCode?friendlyIssue(job.errorCode):`${label(job.status)}. Lettura dei documenti; wiki e analisi AI hanno richieste e stati separati.`,'runtime-note'));
  const outcomes=job.output?.outcomes||job.progress?.outcomes||[];
  $('ingestionReceipts').replaceChildren(...outcomes.map(item=>node('p',`${session.docs.find(x=>x.id===item.documentId)?.filename||'Documento'}: ${label(item.status)}${item.errorCode?' · '+friendlyIssue(item.errorCode):''} · ${item.fragmentCount??0} ${(item.fragmentCount??0)===1?'passaggio consultabile':'passaggi consultabili'}`,'runtime-note')));
  if(['completed','completed_with_errors','failed','cancelled'].includes(job.status)){session.job=null;await refresh();return;}
  setTimeout(()=>void poll(jobId,tenantId,generation).catch(error=>{if(generation===session.generation)notify(error.message);}),2000);
}
async function showFragments(doc,fragmentId=null){
  if(!doc||!session.tenant)throw new Error('La fonte non è più disponibile nel cliente attivo.');
  const generation=session.generation,result=await api(`/v1/tenants/${session.tenant.id}/documents/${doc.id}/fragments`);
  if(generation!==session.generation)return;
  text('pdfTitle',doc.filename);text('pdfKind','Contenuto del documento originale');
  const content=node('div',null,'runtime-source');
  content.append(node('p',label(result.status),'source-status'));
  if(fragmentId){const all=node('button','Mostra tutto il documento','ghost-btn');all.onclick=()=>void showFragments(doc).catch(error=>notify(error.message));content.append(all);if(!result.fragments.some(fragment=>fragment.id===fragmentId))content.append(node('p','Il passaggio citato non è più disponibile. Verifica la fonte aggiornata.','source-warning'));}
  for(const fragment of result.fragments.filter(fragment=>!fragmentId||fragment.id===fragmentId)){
    content.append(node('h3',locationLabel(fragment.locator,fragment.metadata?.kind)),node('p',sourceText(fragment)));
    if(session.tenant.scopes?.includes('documents:write')){
      const annotate=node('button','Aggiungi una nota a questo passaggio','ghost-btn');
      annotate.onclick=()=>editNote(null,[{documentId:doc.id,fragmentId:fragment.id,filename:doc.filename,locator:fragment.locator}]);content.append(annotate);
      const assertion=node('button','Registra un’affermazione con questa fonte','ghost-btn');assertion.onclick=()=>editAssertion(null,[{documentId:doc.id,fragmentId:fragment.id,filename:doc.filename,locator:fragment.locator}]);content.append(assertion);
    }
  }
  if(!result.fragments.length)content.append(node('p',result.status==='needs_vision'?'Serve la lettura visiva. Apri Cervello e scegli “Leggi immagine o pagina scansionata”; il suo stato indica se il motore può elaborarla.':'Nessun frammento disponibile: consulta l’esito dell’elaborazione.'));
  for(const warning of result.warnings)content.append(node('p',friendlyIssue(warning.code),'source-warning'));
  content.append(technicalDetails([['Impronta del documento',result.sourceHash||doc.sha256]]));
  setModalOriginal();$('pdfPaper').replaceChildren(content);setModalOriginal(doc);$('pdfModal').classList.add('visible');$('pdfModal').setAttribute('aria-hidden','false');
}
function setModalOriginal(doc=null){
 const button=$('downloadPdf');if(!button)return;const generation=session.generation,tenantId=session.tenant?.id,modalRevision=session.modalRevision=(session.modalRevision||0)+1;
 button.disabled=!doc||!session.tenant?.scopes?.includes('documents:read');button.textContent=doc?'Scarica originale':'Scarica';button.title=doc?'Recupera il file originale, senza modifiche.':'Apri una fonte per scaricare il suo originale. I report si scaricano dalla vista Report.';
 button.onclick=doc?()=>{if(generation!==session.generation||tenantId!==session.tenant?.id||modalRevision!==session.modalRevision)return;button.disabled=true;void downloadOriginal(doc).catch(error=>{if(generation===session.generation)notify(error.message);}).finally(()=>{if(generation===session.generation&&tenantId===session.tenant?.id&&modalRevision===session.modalRevision)button.disabled=false;});}:null;
}
async function downloadOriginal(doc){
  const generation=session.generation,response=await api(`/v1/tenants/${session.tenant.id}/documents/${doc.id}`,{raw:true});const blob=await response.blob();
  if(generation!==session.generation)return;const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=doc.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function audit(){
  if(!session.tenant?.scopes?.includes('audit:read')){note('auditList','Il consenso non include la consultazione delle attività.');text('metricQuestions','—');return;}
  const generation=session.generation,result=await api(`/v1/tenants/${session.tenant.id}/audit`);
  if(generation!==session.generation)return;
  text('metricQuestions',result.events.length);text('auditIntegrity',result.validChain?'Catena degli eventi presenti verificata; non attesta la completezza storica.':'Catena non valida');
  const actions={'assertion.created':'Affermazione registrata con fonte','assertion.revised':'Affermazione sottoposta a revisione','checklist.created':'Checklist concordata creata','checklist.revised':'Checklist aggiornata','calculation.saved':'Calcolo salvato con fonti','calculation.generated':'Calcolo documentale eseguito','report.generated':'Dossier PDF generato','report.read':'Dossier PDF scaricato','note.created':'Nota aggiunta con fonte','note.revised':'Nota aggiornata','document.stored':'Documento caricato','document.extracted':'Contenuto letto','document.read':'Originale consultato','document.deleted':'Documento eliminato','document.deletion.started':'Cancellazione avviata','job.queued':'Elaborazione avviata','job.completed':'Elaborazione completata','membership.upserted':'Permessi aggiornati','membership.revoked':'Accesso revocato','tenant.created':'Archivio creato','consent.requested':'Accesso richiesto dallo studio','consent.approved':'Accesso approvato dal cliente','consent.revoked':'Consenso revocato dal cliente','consent.rejected':'Richiesta di accesso rifiutata'};
  const actors={owner_pmi:'Cliente PMI',owner_privato:'Cliente privato',studio_demo:'Studio', 'local-admin':'Configurazione iniziale'};
  $('auditList').replaceChildren(...result.events.map(event=>{
    const row=node('article',null,'audit-entry');row.append(node('strong',actions[event.action]||'Attività registrata'),node('p',`${new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'medium'}).format(new Date(event.createdAt))} · ${actors[event.actorId]||'Utente'}`),technicalDetails([['Operazione',event.action],['Identificativo autore',event.actorId]]));return row;
  }));
}
function action(id,fn){if($(id))$(id).onclick=()=>Promise.resolve().then(fn).catch(error=>{if(error.name!=='AbortError')notify(error.message);});}
document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>view(el.dataset.view));
document.querySelectorAll('[data-studio-action]').forEach(el=>el.onclick=()=>view(el.dataset.studioAction));
action('gateClientLogin',()=>login('client').catch(error=>text('loginMessage',error.message)));
action('gateAccountantLogin',()=>login('studio').catch(error=>text('loginMessage',error.message)));
action('switchIdentity',()=>{void (async()=>{if(session.online)await api('/v1/auth/logout',{method:'POST'});clearContext();session.token=null;session.actorId=null;session.online=false;session.csrf=null;session.tenant=null;session.tenants=[];$('clientGrid').replaceChildren();$('accessGate').classList.remove('is-dismissed');})().catch(error=>notify(error.message));});
action('resetDemo',()=>{session.selected.clear();session.filter='all';session.archiveQuery='';if($('archiveSearch'))$('archiveSearch').value='';document.querySelectorAll('[data-filter]').forEach(button=>button.classList.toggle('active',button.dataset.filter==='all'));return refresh();});
for(const id of ['pickFiles','studioPickFiles'])action(id,()=>$('fileInput').click());
$('fileInput').onchange=event=>void upload([...event.target.files]).catch(error=>notify(error.message)).finally(()=>{event.target.value='';});
for(const id of ['simulateLoad','selectAllDocs'])action(id,readyPackage);
action('emptyTenantUpload',()=>view('archive'));action('emptyTenantBackStudio',()=>view('studio'));action('emptyTenantGovernance',()=>view('governance'));action('openArchive',()=>view('archive'));action('openIngestionLab',()=>view('ingestion'));action('jumpBrain',()=>view('brain'));action('quickStart',ingest);
const drop=$('dropPanel');drop.ondragover=event=>event.preventDefault();drop.ondrop=event=>{event.preventDefault();void upload([...event.dataTransfer.files]).catch(error=>notify(error.message));};
for(const id of ['closePdf','closePdfBackdrop'])action(id,()=>{$('pdfModal').classList.remove('visible');$('pdfModal').setAttribute('aria-hidden','true');setModalOriginal();$('pdfPaper').replaceChildren();});
for(const id of ['sharePdf','mailPdf','copyPdfLink'])if($(id))$(id).disabled=true;
let advisorSequence=0;
$('askForm').onsubmit=event=>{event.preventDefault();void previewAdvisorSources().catch(error=>{if(error.name!=='AbortError')notify(error.message);});};
async function previewAdvisorSources(){
 if(!session.tenant)return;
 const generation=session.generation,sequence=++advisorSequence,question=$('askInput').value.trim();
 if(question.length<2||question.length>500){notify('Inserisci una domanda da 2 a 500 caratteri.');return;}
 note('chatStream','Cerco i passaggi nei documenti del cliente…');
 const result=await api(`/v1/tenants/${session.tenant.id}/advisor/evidence`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question})});
 if(generation!==session.generation||sequence!==advisorSequence)return;
 const panel=$('chatStream');panel.replaceChildren(node('h3','Fonti per la tua domanda'),node('p',question),node('p','Questi sono passaggi trovati per parole chiave, da confrontare con gli originali. Per ottenere un’analisi, invia la domanda all’Advisor e controlla il suo stato.','source-warning'));
 if(!result.evidence.length)panel.append(node('p','Non ho trovato passaggi pertinenti con queste parole. Prova termini presenti nei documenti; questo esito non dimostra che l’informazione sia assente.','runtime-note'));
 for(const item of result.evidence){
  const card=node('article',null,'runtime-note');if(item.reference.origin==='reviewed-model-transcription')card.append(node('p','Trascrizione del modello rivista da una persona: confrontare con l’immagine originale.','source-warning'));card.append(node('strong',item.reference.filename),node('p',locationLabel(item.reference.locator)));
  if(item.displayColumns)card.append(node('p',sourceText({text:item.text,metadata:{columns:item.displayColumns}})));
  else if(item.text.trim().startsWith('{'))card.append(node('p','Contenuto strutturato: apri il passaggio per consultare i campi.'),technicalDetails([['Testo originale',item.text]]));
  else card.append(node('p',item.text));
  if(item.truncated)card.append(node('p','Anteprima parziale: apri il passaggio completo.','source-warning'));
  const open=node('button','Apri il passaggio originale','ghost-btn');open.onclick=()=>void showEvidenceReference(item.reference).catch(error=>notify(error.message));card.append(open,technicalDetails([['Impronta della fonte',item.reference.sourceHash]]));panel.append(card);
 }
 panel.append(node('p','La ricerca può omettere fonti rilevanti. Nessun consiglio o calcolo è stato generato dall’AI.','runtime-note'));
}
for(const [id,value] of Object.entries({brainStage:'Grafo e memoria AI ancora da collegare.',brainDetail:'I frammenti originali sono consultabili nell’archivio.',chatStream:'Scrivi una domanda per cercare i passaggi originali. La risposta AI attende il collegamento AMD.',questionBank:'Parti dall’obiettivo e usa parole presenti nei documenti. Prima di una conclusione servono fonti pertinenti, periodo e dati completi.',reportPreview:'Scegli il report e le sue fonti.',exportList:'Nessun report generato.'}))note(id,value);
$('scenarioDock').hidden=true;setModalOriginal();
function closeQuickLinks(){ $('scenarioDock').classList.remove('open');$('scenarioToggle').setAttribute('aria-expanded','false'); }
action('scenarioToggle',()=>{if(!session.token&&!session.online)return;const open=$('scenarioDock').classList.toggle('open');$('scenarioToggle').setAttribute('aria-expanded',String(open));});
action('completeBrain',()=>{closeQuickLinks();view('brain');});
for(const [id,title] of [['archive','Dossier Inbox'],['ingestion','INGESTIONLAB'],['advisor','Advisor'],['report','Report'],['governance','Consensi & Audit']]){const button=node('button',title,'ghost-btn');button.onclick=()=>{closeQuickLinks();view(id);};$('scenarioGrid').append(button);}
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeQuickLinks();});

function renderGraphConnections(stage,result){
 const nodes=new Map(result.nodes.map(item=>[item.id,item]));
 const section=node('section',null,'runtime-connections');section.append(node('h3','Collegamenti del cervello'));
 const titles={cites_source:'Nota con fonte',includes_source:'Documento incluso nel report',derived_from:'Calcolo dalla fonte',requirement_evidence:'Requisito collegato',human_claim_cites_source:'Affermazione con fonte',model_derived_from:'Wiki derivata dalla fonte',possible_value_difference:'Valori diversi da confrontare'};
 let count=0;
 for(const edge of result.edges){
  if(edge.type==='authorized_source')continue;
  const from=nodes.get(edge.from),to=nodes.get(edge.to);if(!from||!to)continue;
  const card=node('article',null,'runtime-connection-card');
  if(edge.type==='proposed_relation'){
   card.append(node('small','Relazione proposta dal modello · da verificare'),node('h4',from.label+' → '+edge.label+' → '+to.label));
   const wiki=nodes.get(edge.wikiId);if(wiki)card.append(node('p',wiki.label+' · '+(edge.wikiReviewStatus==='approved'?'Wiki rivista da una persona':edge.wikiReviewStatus==='needs_review'?'Wiki da riesaminare':'Wiki in attesa di revisione')));
   card.append(node('p','La citazione e la revisione della wiki non dimostrano la correttezza di questa relazione.','source-warning'));
   if(edge.quote)card.append(citationPresentation(edge.quote));
   if(edge.reference){const source=node('button',edge.reference.filename+' · '+locationLabel(edge.reference.locator),'ghost-btn');source.onclick=()=>void showEvidenceReference(edge.reference).catch(error=>notify(error.message));card.append(source);}
  }else{
   card.append(node('small',titles[edge.type]||'Collegamento alla fonte'),node('h4',from.label+' → '+to.label));
   if(edge.type==='possible_value_difference')card.append(node('p','Segnale tra contributi umani: confrontare contesto e revisioni, senza assumere una contraddizione automatica.'));
   if(edge.type==='model_derived_from')card.append(node('p','Proposta derivata dal documento; la fonte resta distinta dalla wiki.','source-warning'));
   if(to.type==='source'){const source=node('button','Apri '+to.label,'ghost-btn');source.onclick=()=>void showFragments(session.docs.find(doc=>doc.id===to.id)).catch(error=>notify(error.message));card.append(source);}
  }
  section.append(card);count++;
 }
 if(!count)section.append(node('p','Non ci sono ancora collegamenti. Aggiungi un contributo con una fonte o prepara una wiki dal documento.'));
 section.append(node('p','Entità omonime di documenti o wiki diversi restano distinte. Nessuna fusione automatica o misura di verità.','runtime-note'));
 stage.append(section);
}

function renderLiveBrainMap(host,result,generation){
 const tenant=session.tenant,kindLabels={tenant:'Cervello del cliente',source:'Documento',wiki_proposal:'Wiki AI',entity_proposal:'Entità proposta',human_note:'Nota',human_assertion:'Affermazione',explicit_checklist:'Checklist',calculation:'Calcolo',document_report:'Report PDF'};
 const all=new Map(result.nodes.map(item=>[item.id,item])),root=result.nodes.find(item=>item.type==='tenant');
 host.append(node('h3','La mappa del tuo cervello digitale'),node('p','Ogni nodo rappresenta un contenuto del cliente. Clicca per leggere dettagli, wiki e fonti. Le linee tratteggiate sono relazioni proposte dall’AI, da verificare.','runtime-note'));
 const toolbar=node('div',null,'live-map-toolbar'),filter=node('select'),search=node('input'),minus=node('button','−','ghost-btn'),plus=node('button','+','ghost-btn'),fit=node('button','Adatta mappa','ghost-btn'),counter=node('span');
 filter.setAttribute('aria-label','Tipi di contenuti nella mappa');search.setAttribute('aria-label','Trova un nodo nella mappa');search.placeholder='Trova un contenuto nella mappa';minus.setAttribute('aria-label','Riduci mappa');plus.setAttribute('aria-label','Ingrandisci mappa');
 const option=node('option','Tutti i contenuti');option.value='all';filter.append(option);
 for(const [type,labelText] of Object.entries(kindLabels)){if(type==='tenant'||!result.nodes.some(n=>n.type===type))continue;const opt=node('option',labelText);opt.value=type;filter.append(opt);}
 toolbar.append(filter,search,minus,plus,fit,counter);host.append(toolbar);
 const viewport=node('div',null,'live-map-viewport'),space=node('div',null,'live-map-space'),scene=node('div',null,'live-map-scene'),detail=node('section',null,'live-map-detail');viewport.setAttribute('aria-label','Mappa grafica navigabile del cervello');viewport.tabIndex=0;detail.setAttribute('aria-label','Contenuto selezionato nella mappa');detail.setAttribute('aria-live','polite');space.append(scene);viewport.append(space);host.append(viewport,detail);
 const sorted=result.nodes.filter(n=>n!==root).sort((a,b)=>Object.keys(kindLabels).indexOf(a.type)-Object.keys(kindLabels).indexOf(b.type)||a.label.localeCompare(b.label,'it')||a.id.localeCompare(b.id));
 const positions=new Map();let cursor=0,ring=1;
 while(cursor<sorted.length){const count=Math.min(8+6*(ring-1),sorted.length-cursor),rx=160*ring,ry=115*ring;
  for(let i=0;i<count;i++){const angle=-Math.PI/2+(i/count)*Math.PI*2+(ring%2?0:.13);positions.set(sorted[cursor+i].id,{x:rx*Math.cos(angle),y:ry*Math.sin(angle)});}cursor+=count;ring++;
 }
 const rings=Math.max(1,ring-1),width=320*rings+220,height=230*rings+200,cx=width/2,cy=height/2;
 if(root)positions.set(root.id,{x:0,y:0});scene.style.width=width+'px';scene.style.height=height+'px';
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('aria-hidden','true');svg.classList.add('live-map-edges');scene.append(svg);
 const lines=[];
 for(const edge of result.edges){const a=positions.get(edge.from),b=positions.get(edge.to);if(!a||!b)continue;const line=document.createElementNS(svg.namespaceURI,'line');for(const [key,value] of Object.entries({x1:a.x+cx,y1:a.y+cy,x2:b.x+cx,y2:b.y+cy}))line.setAttribute(key,String(value));if(edge.type==='proposed_relation')line.classList.add('proposed');svg.append(line);lines.push({edge,line});}
 const buttons=new Map();let selected=null,selection=0,zoom=1;
 const edgeTitle=edge=>edge.type==='proposed_relation'?(edge.label+' · proposta AI'):({authorized_source:'Documento del cliente',model_derived_from:'Wiki dalla fonte',cites_source:'Nota con fonte',includes_source:'Fonte del report',derived_from:'Calcolo dalla fonte',human_claim_cites_source:'Affermazione con fonte',requirement_evidence:'Requisito con fonte',possible_value_difference:'Valori da confrontare'})[edge.type]||'Collegamento documentale';
 function refresh(){
  const query=search.value.trim().toLocaleLowerCase('it'),visible=new Set();
  for(const item of result.nodes){const button=buttons.get(item.id),show=item.type==='tenant'||((filter.value==='all'||item.type===filter.value)&&(!query||item.label.toLocaleLowerCase('it').includes(query)));button.hidden=!show;if(show)visible.add(item.id);button.classList.toggle('active',selected?.id===item.id);button.setAttribute('aria-pressed',String(selected?.id===item.id));button.classList.toggle('related',!!selected&&result.edges.some(e=>(e.from===selected.id&&e.to===item.id)||(e.to===selected.id&&e.from===item.id)));}
  for(const {edge,line} of lines){line.style.display=visible.has(edge.from)&&visible.has(edge.to)?'':'none';line.classList.toggle('selected',selected?.id===edge.from||selected?.id===edge.to);}
  counter.textContent=`${visible.size} di ${result.nodes.length} contenuti · ${lines.filter(({line})=>line.style.display!=='none').length} collegamenti`;
 }
 async function select(item){
  if(generation!==session.generation)return;selected=item;const request=++selection;refresh();detail.replaceChildren(node('small',kindLabels[item.type]||'Contenuto'),node('h4',item.type==='tenant'?tenant.name:item.label));
  const body=node('div');detail.append(body);
  const open=(title,action)=>{const button=node('button',title,'ghost-btn');button.onclick=()=>void Promise.resolve().then(action).catch(error=>notify(error.message));body.append(button);};
  const reference=ref=>open('Apri '+(ref.filename||'fonte originale')+' · '+locationLabel(ref.locator),()=>showEvidenceReference(ref));
  if(['wiki_proposal','entity_proposal'].includes(item.type))body.append(node('p','Proposta derivata dall’AI. La citazione e la revisione non certificano la correttezza del contenuto.','source-warning'));
  if(item.type==='tenant')body.append(node('p',`${result.nodes.length-1} contenuti nel cervello di ${tenant.name}. Originali, wiki, contributi e report rimangono distinti.`));
  if(item.type==='source'){body.append(node('p',label(item.extractionStatus)+' · '+item.fragmentCount+' passaggi consultabili'));open('Apri documento originale e passaggi',()=>showFragments(session.docs.find(doc=>doc.id===item.id)));}
  if(item.type==='entity_proposal'){body.append(citationPresentation(item.quote));if(item.reference)reference(item.reference);}
  const related=node('div',null,'live-map-related');detail.append(related);related.append(node('strong','Contenuti collegati'));
  const edges=result.edges.filter(e=>e.from===item.id||e.to===item.id);
  for(const edge of edges){const target=all.get(edge.from===item.id?edge.to:edge.from);if(!target)continue;const button=node('button',target.type==='tenant'?tenant.name:target.label,'ghost-btn');button.title=edgeTitle(edge);button.onclick=()=>void select(target).catch(e=>notify(e.message));related.append(button);}
  if(!edges.length)related.append(node('p','Nessun collegamento registrato per questo nodo.'));
  try{
   let data;
   const id=item.id.slice(item.id.indexOf(':')+1);
   if(item.type==='wiki_proposal'){
    data=await api(`/v1/tenants/${tenant.id}/brain/memory/${id}`);if(request!==selection||generation!==session.generation)return;
    body.append(node('p','Revisione: '+({approved:'rivista da una persona',rejected:'respinta',needs_review:'da riesaminare',pending:'in attesa'})[data.review?.status||'pending']));
    for(const fact of data.wiki?.facts||[]){body.append(node('p',fact.text),citationPresentation(fact.evidence.quote));reference(fact.evidence.reference);}
   }else if(item.type==='human_note'){
    data=await api(`/v1/tenants/${tenant.id}/brain/notes/${id}`);if(request!==selection||generation!==session.generation)return;const current=data.data?.[0]||data;
    body.append(node('p',current.text||data.text||''));open('Consulta nota e revisioni',()=>showNoteHistory({id}));
   }else if(item.type==='document_report'){
    open('Scarica questo PDF',async()=>{const reports=await api(`/v1/tenants/${tenant.id}/reports`);if(generation!==session.generation)return;const report=reports.data.find(r=>r.id===id);if(!report)throw new Error('Report non più disponibile. Aggiorna la mappa.');await downloadDossier(report);});
   }else if(item.type==='human_assertion'||item.type==='explicit_checklist'||item.type==='calculation'){
    const resource={human_assertion:'assertions',explicit_checklist:'checklists',calculation:'calculations'}[item.type];data=await api(`/v1/tenants/${tenant.id}/brain/${resource}/${id}`);if(request!==selection||generation!==session.generation)return;
    if(item.type!=='calculation')data=data.data?.[0]||data;
    if(item.type==='human_assertion'){body.append(node('p',data.assertion?.value||''),node('p',data.context||''));for(const ref of data.references||[])body.append(assertionSourceButton(ref));}
    if(item.type==='explicit_checklist')for(const requirement of data.items||[])body.append(node('p',requirement.requirement+' · '+(({missing:'Mancante',present:'Presente',needs_review:'Da verificare',not_applicable:'Non applicabile'})[requirement.status]||'Da verificare')));
    if(item.type==='calculation'){body.append(node('p','Calcolo derivato dalla fonte, con criteri e limiti da consultare.'),node('p',data.result?.source?.filename||''));if(data.result?.totals)for(const [key,title] of [['credit','Entrate'],['debit','Uscite'],['closingObserved','Saldo osservato']])body.append(node('p',title+': '+exactEuro(data.result.totals[key])));if(data.result?.source?.documentId)open('Apri fonte del calcolo',()=>showFragments(session.docs.find(doc=>doc.id===data.result.source.documentId)));}
   }
  }catch(error){if(request===selection&&generation===session.generation)body.append(node('p',error.message,'source-warning'));}
 }
 for(const item of result.nodes){const p=positions.get(item.id),button=node('button',null,'live-map-node');button.dataset.kind=item.type;button.setAttribute('aria-label',(kindLabels[item.type]||'Contenuto')+': '+(item.type==='tenant'?tenant.name:item.label));button.title=item.label;button.style.left=(cx+p.x)+'px';button.style.top=(cy+p.y)+'px';button.append(node('small',kindLabels[item.type]||'Contenuto'),node('strong',item.type==='tenant'?tenant.name:item.label));button.onclick=()=>void select(item).catch(e=>notify(e.message));buttons.set(item.id,button);scene.append(button);}
 function setZoom(value){zoom=Math.max(.45,Math.min(1.6,value));scene.style.transform=`scale(${zoom})`;space.style.width=(width*zoom)+'px';space.style.height=(height*zoom)+'px';minus.disabled=zoom<=.45;plus.disabled=zoom>=1.6;}
 filter.onchange=refresh;search.oninput=refresh;minus.onclick=()=>setZoom(zoom-.15);plus.onclick=()=>setZoom(zoom+.15);fit.onclick=()=>{setZoom(Math.min(viewport.clientWidth/width,viewport.clientHeight/height));viewport.scrollTo(0,0);};
 setZoom(Math.max(.65,Math.min(1,viewport.clientWidth/width)));refresh();if(root)void select(root);
}

async function graph(){
  const generation=session.generation;
  const result=await api(`/v1/tenants/${session.tenant.id}/brain/graph`);
  if(generation!==session.generation)return;
  $('liveBrainMap')?.remove();const map=node('section',null,'live-brain-map');map.id='liveBrainMap';$('brain').insertBefore(map,$('brain').querySelector('.brain-layout'));renderLiveBrainMap(map,result,generation);
  const stage=$('brainStage');stage.replaceChildren();
  const wikiArea=node('section',null,'runtime-note memory-workbench');stage.append(wikiArea);void renderDocumentMemory(wikiArea,generation).catch(error=>notify(error.message));
  const title=node('p','Mappa delle fonti e dei contributi · relazioni del modello sempre da verificare','runtime-note');stage.append(title);const updateMap=node('button','Aggiorna mappa','ghost-btn');updateMap.onclick=()=>void graph().catch(error=>notify(error.message));stage.append(updateMap);
  applyGraphSummary(result);
  stage.append(node('p',`${result.nodes.filter(n=>n.type==='source').length} documenti · ${result.nodes.filter(n=>n.type==='human_note').length} ${result.nodes.filter(n=>n.type==='human_note').length===1?'nota':'note'} · ${result.nodes.filter(n=>n.type==='document_report').length} dossier PDF`,'runtime-note'));
  const rows=node('div',null,'runtime-graph-sources');
  for(const source of result.nodes.filter(x=>x.type==='source')){
    const button=node('button',null,'source-card');button.append(node('strong',source.label),node('span',label(source.extractionStatus),'source-card-status'),node('small',source.fragmentCount===1?'1 passaggio consultabile':`${source.fragmentCount} passaggi consultabili`));
    button.onclick=()=>void showFragments(session.docs.find(x=>x.id===source.id)).catch(error=>notify(error.message));rows.append(button);
  }
  stage.append(rows);renderGraphConnections(stage,result);
  const form=node('form',null,'runtime-toolbar'),input=node('input'),button=node('button','Cerca nelle fonti','primary-btn');
  input.placeholder='Cerca testo nei documenti';input.setAttribute('aria-label','Cerca nelle fonti');button.type='submit';form.append(input,button);
  const results=node('div');$('brainDetail').replaceChildren(form,results);
  const notesArea=node('section',null,'runtime-notes');$('brainDetail').append(notesArea);
  await renderNotes(notesArea,generation);
  if(generation!==session.generation)return;
  const assertionsArea=node('section',null,'runtime-notes');$('brainDetail').append(assertionsArea);await renderAssertions(assertionsArea,generation);if(generation!==session.generation)return;
  $('dossierChecklists')?.remove();const checklistArea=node('section',null,'runtime-notes bank-calculation-area');checklistArea.id='dossierChecklists';$('brain').append(checklistArea);await renderChecklists(checklistArea,generation);if(generation!==session.generation)return;
  $('bankCalculation')?.remove();const calculationArea=node('section',null,'runtime-notes bank-calculation-area');calculationArea.id='bankCalculation';$('brain').append(calculationArea);bankCalculator(calculationArea,generation);
  form.onsubmit=async event=>{
    event.preventDefault();const current=session.generation;
    try{
      const response=await api(`/v1/tenants/${session.tenant.id}/brain/search?q=${encodeURIComponent(input.value)}`);
      if(current!==session.generation)return;
      results.replaceChildren(node('p',`${response.totalMatches} passaggi trovati nei tuoi documenti.`,'runtime-note'));
      for(const fragment of response.data){const row=node('article',null,'search-result');const link=node('button',fragment.filename,'ghost-btn');link.onclick=()=>void showFragments(session.docs.find(x=>x.id===fragment.documentId)).catch(error=>notify(error.message));row.append(link,node('small',locationLabel(fragment.locator),'source-location'),node('p',sourceText(fragment)));results.append(row);}
      if(response.derived?.length){results.append(node('h4','Calcoli derivati · ipotesi da verificare'));for(const derived of response.derived){const row=node('article',null,'search-result');row.append(node('p',derived.summary?`${derived.filename} · Entrate ${exactEuro(derived.summary.credit)} · Uscite ${exactEuro(derived.summary.debit)} · Saldo riportato ${exactEuro(derived.summary.closing)}`:derived.text),node('small','Deriva dalla stessa fonte: non aggiunge una prova indipendente.'));const open=node('button','Consulta fonte originale','ghost-btn');open.onclick=()=>void showFragments(session.docs.find(doc=>doc.id===derived.documentId)).catch(error=>notify(error.message));row.append(open);results.append(row);}}
      if(response.reviewedTranscriptions?.length){results.append(node('h4','Trascrizioni visive riviste'));for(const item of response.reviewedTranscriptions){const row=node('article',null,'search-result'),open=node('button','Confronta con l’originale','ghost-btn');row.append(node('strong',item.filename+' · '+locationLabel(item.locator)),node('p',item.text),node('small','Revisione: '+item.review.authorName),node('p','Testo derivato dal modello: non è una prova indipendente e può contenere errori.','source-warning'));open.onclick=()=>void showEvidenceReference(item.reference).catch(error=>notify(error.message));row.append(open);results.append(row);}}
      if(response.wikiContributions?.length){results.append(node('h4','Wiki derivate riviste'));for(const item of response.wikiContributions){const row=node('article',null,'search-result');row.append(node('strong',item.title),node('small','Revisione: '+item.review.authorName),node('p','Proposta derivata dal modello, rivista da una persona. Non aggiunge una fonte indipendente.','source-warning'));const open=node('button','Apri fonte originale','ghost-btn');open.onclick=()=>void showFragments(session.docs.find(d=>d.id===item.documentId)).catch(error=>notify(error.message));row.append(open);results.append(row);}}
      if(response.sharedNotes?.length){results.append(node('h4','Note condivise trovate'));for(const item of response.sharedNotes){const row=node('article',null,'search-result');row.append(node('strong',item.title),node('p',item.text),node('small',`Versione ${item.version} · ${item.authorName}`),node('p','Contributo dell’autore da verificare: non aggiunge una prova indipendente.','source-warning'));for(const ref of item.references)row.append(assertionSourceButton(ref));results.append(row);}}
      if(response.humanContributions?.length){results.append(node('h4','Osservazioni umane collegate alle fonti'));for(const item of response.humanContributions){const row=node('article',null,'search-result');row.append(node('strong',item.subject+' · '+item.predicate),node('p',item.value),node('small',item.context+' · '+item.authorName),node('span',assertionLabels[item.status],'source-card-status'),node('small','Contributo umano: non aggiunge una prova indipendente.'));if(item.possibleConflictCount)row.append(node('p','Sono presenti valori diversi: confronta le revisioni nella sezione Affermazioni e verifiche.','source-warning'));for(const ref of item.references)row.append(assertionSourceButton(ref));results.append(row);}}
    }catch(error){if(error.name!=='AbortError')notify(error.message);}
  };
}

const consentStatusLabel={pending:'In attesa della tua decisione',active:'Accesso approvato',preconfigured:'Accesso della configurazione iniziale',revoked:'Accesso revocato',rejected:'Richiesta rifiutata'};
const consentScopeLabels={'tenant:read':'Consultare il dossier','documents:read':'Leggere documenti e fonti','documents:write':'Contribuire con documenti','jobs:read':'Seguire le elaborazioni','jobs:write':'Avviare elaborazioni','audit:read':'Consultare le attività'};
async function consentPanel(){
  const generation=session.generation,tenant=session.tenant;
  if(!tenant)return;
  if(tenant.role!=='owner'){note('consentPanel','L’accesso dello studio dipende dai permessi correnti. Il cliente proprietario può revocarlo.');return;}
  const result=await api(`/v1/tenants/${tenant.id}/consents`);
  if(generation!==session.generation)return;
  const panel=$('consentPanel');panel.replaceChildren(node('h3','Accessi dello studio'));
  if(!result.data.length)panel.append(node('p','Non ci sono richieste o accessi dello studio.'));
  for(const consent of result.data){
    const row=node('article',null,'runtime-row');row.append(node('strong',consent.name),node('p',consentStatusLabel[consent.status]));
    if(consent.status==='preconfigured')row.append(node('p','Questo accesso proviene dalla configurazione iniziale; non è registrato come approvazione del cliente.'));
    const permissions=[];
    if(consent.status==='pending')for(const [scope,title] of Object.entries(consentScopeLabels)){
      const label=node('label'),box=node('input');box.type='checkbox';box.checked=consent.scopes.includes(scope);label.append(box,node('span',title));row.append(label);permissions.push([scope,box]);
    }
    const available=consent.status==='pending'?[['approve','Approva accesso'],['reject','Rifiuta richiesta']]:['active','preconfigured'].includes(consent.status)?[['revoke','Revoca accesso']]:[];
    for(const [operation,title] of available){
      const button=node('button',title,'ghost-btn');let awaitingRevocation=false;let cancelButton;button.onclick=async()=>{
        if(operation==='revoke'&&!awaitingRevocation){awaitingRevocation=true;button.textContent='Conferma revoca';cancelButton=node('button','Annulla','ghost-btn');cancelButton.onclick=()=>{awaitingRevocation=false;button.textContent=title;cancelButton.remove();};row.append(node('p','La revoca interrompe subito l’accesso dello studio a questo dossier.'),cancelButton);return;}
        button.disabled=true;
        try{await api(`/v1/tenants/${tenant.id}/consents/${consent.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({action:operation,...(operation==='approve'?{scopes:permissions.filter(([,box])=>box.checked).map(([scope])=>scope)}:{})})});if(generation===session.generation){await consentPanel();await audit();notify(operation==='revoke'?'Accesso dello studio revocato.':operation==='approve'?'Accesso dello studio approvato.':'Richiesta rifiutata.');}}
        catch(error){if(error.name!=='AbortError')notify(error.message);}finally{button.disabled=false;}
      };row.append(button);
    }
    panel.append(row);
  }
}
async function studioRequests(){
  const result=await api('/v1/me/consents');
  for(const consent of result.data.filter(c=>!session.tenants.some(t=>t.id===c.tenantId))){
    const card=node('article',null,'workbench-card');card.append(node('strong',consent.tenantName),node('p',consent.status==='pending'?'Richiesta in attesa del cliente':'Accesso non attivo'));
    if(consent.status!=='pending'){
      const button=node('button','Richiedi accesso','ghost-btn');button.onclick=async()=>{button.disabled=true;try{await api(`/v1/tenants/${consent.tenantId}/consents`,{method:'POST'});card.replaceChildren(node('strong',consent.tenantName),node('p','Richiesta inviata. Il cliente deve approvarla.'));}catch(error){notify(error.message);button.disabled=false;}};card.append(button);
    }
    $('clientGrid').append(card);
  }
}

async function renderNotes(area,generation){
  const result=await api(`/v1/tenants/${session.tenant.id}/brain/notes`);
  if(generation!==session.generation)return;
  area.replaceChildren(node('h3','Note condivise con fonti'),node('p','Contributi del cliente e dello studio. Collegare una fonte non verifica automaticamente quanto scritto.','runtime-note'));
  if(!result.data.length)area.append(node('p','Apri un documento elaborato e scegli un passaggio per aggiungere la prima nota.'));
  for(const item of result.data){
    const card=node('article',null,'source-note-card');card.append(node('h4',item.title),node('p',item.text),node('small',`Versione ${item.version} · ${item.authorName} · Contributo da verificare`));
    for(const ref of item.references){const source=node('button',`${ref.filename} · ${locationLabel(ref.locator)}`,'ghost-btn');source.onclick=()=>void showFragments(session.docs.find(d=>d.id===ref.documentId)).catch(e=>notify(e.message));card.append(source);}
    const history=node('button','Vedi revisioni','ghost-btn');history.onclick=()=>void showNoteHistory(item).catch(e=>notify(e.message));card.append(history);
    if(session.tenant.scopes?.includes('documents:write')){const edit=node('button','Aggiorna nota','ghost-btn');edit.onclick=()=>editNote(item,item.references);card.append(edit);}
    area.append(card);
  }
}
function editNote(item,references){
  const generation=session.generation,tenantId=session.tenant.id;
  text('pdfTitle',item?'Aggiorna nota':'Nuova nota con fonte');text('pdfKind','Contributo documentale');
  const form=node('form',null,'note-editor'),title=node('input'),body=node('textarea'),save=node('button','Salva nota','primary-btn'),cancel=node('button','Annulla','ghost-btn');
  title.required=true;title.maxLength=160;title.value=item?.title||'';title.setAttribute('aria-label','Titolo della nota');title.placeholder='Titolo della nota';
  body.required=true;body.maxLength=10000;body.rows=7;body.value=item?.text||'';body.setAttribute('aria-label','Contenuto della nota');body.placeholder='Osservazione, dubbio o correzione da condividere';
  form.append(node('p','La nota è un contributo attribuito al suo autore. Le fonti restano consultabili.'),node('label','Titolo'),title,node('label','Contenuto'),body);
  for(const ref of references)form.append(node('small',`${ref.filename} · ${locationLabel(ref.locator)}`));
  cancel.type='button';cancel.onclick=()=>{$('pdfModal').classList.remove('visible');$('pdfModal').setAttribute('aria-hidden','true');};save.type='submit';form.append(save,cancel);
  form.onsubmit=async event=>{
    event.preventDefault();save.disabled=true;
    try{
      await api(`/v1/tenants/${tenantId}/brain/notes${item?'/'+item.id:''}`,{method:item?'PUT':'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:title.value,text:body.value,references:references.map(r=>({documentId:r.documentId,fragmentId:r.fragmentId})),...(item?{expectedVersion:item.version}:{})})});
      if(generation!==session.generation)return;
      $('pdfModal').classList.remove('visible');$('pdfModal').setAttribute('aria-hidden','true');view('brain');notify('Nota salvata con autore, versione e fonte.');
    }catch(error){if(generation===session.generation)notify(error.message);}finally{save.disabled=false;}
  };
  setModalOriginal();$('pdfPaper').replaceChildren(form);$('pdfModal').classList.add('visible');$('pdfModal').setAttribute('aria-hidden','false');
}
async function showNoteHistory(item){
  const generation=session.generation,result=await api(`/v1/tenants/${session.tenant.id}/brain/notes/${item.id}`);
  if(generation!==session.generation)return;
  text('pdfTitle','Revisioni della nota');text('pdfKind','Storia del contributo');
  const content=node('div',null,'runtime-source');
  for(const revision of result.data){const card=node('article',null,'source-note-card');card.append(node('h3',`Versione ${revision.version} · ${revision.authorName}`),node('strong',revision.title),node('p',revision.text),node('small',new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'}).format(new Date(revision.createdAt))));for(const ref of revision.references)card.append(node('small',`${ref.filename} · ${locationLabel(ref.locator)}`));content.append(card);}
  setModalOriginal();$('pdfPaper').replaceChildren(content);$('pdfModal').classList.add('visible');$('pdfModal').setAttribute('aria-hidden','false');
}

const assertionLabels={proposed:'Da verificare',verified:'Confermata da una persona',rejected:'Rifiutata nella revisione',needs_review:'Fonte cambiata · da rivedere',conflicted:'Possibile differenza da verificare'};
Object.assign(issueLabels,{invalid_assertion:'Inserisci soggetto, informazione, valore, contesto e almeno una fonte.',invalid_assertion_sources:'Il passaggio scelto non è più disponibile nel cliente attivo.',assertion_version_conflict:'Un’altra persona ha aggiornato l’affermazione. Riaprila prima di salvare.',assertion_review_confirmation_required:'Conferma di aver svolto personalmente la revisione.',assertion_not_found:'L’affermazione non è più disponibile.',assertion_scope_limit:'È stato raggiunto il limite delle affermazioni o delle revisioni.',human_membership_required:'Questa revisione richiede un utente autorizzato del cliente.'});
function assertionSourceButton(ref){
  const open=node('button',`${ref.filename} · ${locationLabel(ref.locator)}`,'ghost-btn');open.onclick=()=>void showFragments(session.docs.find(doc=>doc.id===ref.documentId),ref.fragmentId).catch(error=>notify(error.message));return open;
}
async function renderAssertions(area,generation){
  const response=await api(`/v1/tenants/${session.tenant.id}/brain/assertions`);if(generation!==session.generation)return;
  area.replaceChildren(node('h3','Affermazioni e verifiche'),node('p','Osservazioni attribuite a una persona, collegate agli originali. La conferma umana non misura l’accuratezza AI e non sostituisce un parere professionale.','runtime-note'));
  if(session.tenant.scopes?.includes('documents:write')){const add=node('button','Nuova affermazione','primary-btn');add.onclick=()=>editAssertion(null,[]);area.append(add);}
  if(!response.data.length)area.append(node('p','Nessuna affermazione registrata. Scegli una fonte per documentare un’osservazione.'));
  for(const item of response.data){
    const a=item.assertion,card=node('article',null,'source-note-card assertion-card');card.append(node('h4',a.subject_ref+' · '+a.predicate),node('p',a.value),node('small','Contesto: '+item.context),node('span',assertionLabels[item.effectiveStatus],'source-card-status'),node('small',`Versione ${item.version} · ${item.authorName}`));
    if(item.effectiveStatus!==a.status)card.append(node('small','Esito registrato nella revisione: '+assertionLabels[a.status]));
    if(item.effectiveStatus==='conflicted')card.append(node('p','Nel medesimo contesto sono stati registrati valori diversi. Confronta le fonti prima di scegliere una conclusione.','source-warning'));
    if(item.sourceState==='stale')card.append(node('p','La fonte è cambiata: la precedente conferma richiede una nuova revisione.','source-warning'));
    for(const otherId of item.possibleConflicts){const other=response.data.find(value=>value.id===otherId);if(other)card.append(node('p',`Valore da confrontare: ${other.assertion.value} · ${other.authorName}`));}
    for(const ref of item.references)card.append(assertionSourceButton(ref));
    if(session.tenant.scopes?.includes('documents:write')){const edit=node('button','Rivedi affermazione','ghost-btn');edit.onclick=()=>editAssertion(item,item.references);card.append(edit);}
    const history=node('button','Storia delle revisioni','ghost-btn');history.onclick=()=>void assertionHistory(item).catch(error=>notify(error.message));card.append(history);area.append(card);
  }
}
async function assertionHistory(item){
  const generation=session.generation,response=await api(`/v1/tenants/${session.tenant.id}/brain/assertions/${item.id}`);if(generation!==session.generation)return;
  text('pdfTitle','Revisioni dell’affermazione');text('pdfKind','Contributi attribuiti');const content=node('div',null,'runtime-source');
  for(const revision of response.data){const a=revision.assertion,card=node('article',null,'source-note-card');card.append(node('h3',`Versione ${revision.version} · ${revision.authorName}`),node('strong',a.subject_ref+' · '+a.predicate),node('p',a.value),node('small','Contesto: '+revision.context),node('span',assertionLabels[a.status],'source-card-status'),node('small',new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'}).format(new Date(a.created_at))));for(const ref of revision.references)card.append(assertionSourceButton(ref));content.append(card);}
  setModalOriginal();$('pdfPaper').replaceChildren(content);$('pdfModal').classList.add('visible');$('pdfModal').setAttribute('aria-hidden','false');
}
function editAssertion(item,initialReferences){
  const generation=session.generation,tenantId=session.tenant.id,references=initialReferences.map(ref=>({...ref}));
  text('pdfTitle',item?'Revisione dell’affermazione':'Nuova affermazione');text('pdfKind','Osservazione con fonti');
  const form=node('form',null,'note-editor'),fields={},save=node('button','Salva affermazione','primary-btn'),cancel=node('button','Annulla','ghost-btn');
  for(const [key,title,max] of [['subject','Soggetto',160],['predicate','Informazione osservata',160],['value','Valore o osservazione',2000],['context','Contesto o periodo',160]]){const control=node(key==='value'?'textarea':'input');control.required=true;control.maxLength=max;control.setAttribute('aria-label',title);control.value=item?(key==='subject'?item.assertion.subject_ref:key==='context'?item.context:item.assertion[key]):'';if(key==='value')control.rows=4;fields[key]=control;form.append(node('label',title),control);}
  form.prepend(node('p','Registra ciò che hai osservato e indica il contesto: per esempio periodo e tipo di importo. La fonte deve sostenere l’affermazione.','runtime-note'));
  const status=node('select');status.setAttribute('aria-label','Esito della revisione');for(const value of ['proposed','verified','rejected'])status.append(Object.assign(node('option',assertionLabels[value]),{value}));status.value=item?.assertion.status||'proposed';form.append(node('label','Esito della revisione'),status);
  const sources=node('fieldset'),linked=node('div'),docSelect=node('select'),query=node('input'),passage=node('select'),preview=node('p',null,'assertion-preview'),count=node('small'),previous=node('button','Passaggi precedenti','ghost-btn'),next=node('button','Passaggi successivi','ghost-btn'),link=node('button','Collega passaggio','ghost-btn');
  docSelect.setAttribute('aria-label','Documento dell’affermazione');query.setAttribute('aria-label','Cerca un passaggio nella fonte');query.placeholder='Cerca testo nel documento';passage.setAttribute('aria-label','Passaggio dell’affermazione');
  docSelect.append(Object.assign(node('option','Scegli un documento elaborato'),{value:''}));for(const doc of session.docs.filter(doc=>doc.extractionStatus==='extracted'))docSelect.append(Object.assign(node('option',doc.filename),{value:doc.id}));
  let fragments=[],filtered=[],page=0,sequence=0;
  function drawReferences(){linked.replaceChildren();for(const ref of references){const row=node('div',null,'checklist-entry'),remove=node('button','Scollega passaggio','ghost-btn');remove.type='button';remove.onclick=()=>{references.splice(references.indexOf(ref),1);drawReferences();};row.append(node('small',ref.filename+' · '+locationLabel(ref.locator)),remove);linked.append(row);}if(!references.length)linked.append(node('p','Collega almeno un passaggio originale.'));}
  function drawPreview(){const fragment=filtered.find(fragment=>fragment.id===passage.value);preview.textContent=fragment?sourceText(fragment):'';link.disabled=!fragment||references.length>=10;}
  function drawPassages(){filtered=fragments.filter(fragment=>sourceText(fragment).toLocaleLowerCase('it-IT').includes(query.value.toLocaleLowerCase('it-IT')));page=Math.min(page,Math.max(0,Math.ceil(filtered.length/50)-1));passage.replaceChildren(...filtered.slice(page*50,page*50+50).map(fragment=>Object.assign(node('option',locationLabel(fragment.locator)+' · '+sourceText(fragment).slice(0,100)),{value:fragment.id})));previous.disabled=page===0;next.disabled=(page+1)*50>=filtered.length;count.textContent=filtered.length?`${page*50+1}–${Math.min((page+1)*50,filtered.length)} di ${filtered.length} passaggi`:'Nessun passaggio disponibile';drawPreview();}
  docSelect.onchange=async()=>{const current=++sequence;fragments=[];page=0;drawPassages();if(!docSelect.value)return;try{const result=await api(`/v1/tenants/${tenantId}/documents/${docSelect.value}/fragments`);if(generation!==session.generation||current!==sequence||!form.isConnected)return;fragments=result.fragments;drawPassages();}catch(error){if(generation===session.generation)notify(error.message);}};
  query.oninput=()=>{page=0;drawPassages();};passage.onchange=drawPreview;previous.onclick=()=>{page--;drawPassages();};next.onclick=()=>{page++;drawPassages();};for(const button of [previous,next,link])button.type='button';
  link.onclick=()=>{const fragment=filtered.find(fragment=>fragment.id===passage.value),doc=session.docs.find(doc=>doc.id===docSelect.value);if(!fragment||!doc||references.length>=10)return;if(!references.some(ref=>ref.documentId===doc.id&&ref.fragmentId===fragment.id))references.push({documentId:doc.id,fragmentId:fragment.id,filename:doc.filename,locator:fragment.locator});drawReferences();drawPreview();};
  sources.append(node('legend','Fonti originali'),linked,docSelect,query,passage,count,previous,next,preview,link);form.append(sources);
  const confirmation=node('input');confirmation.type='checkbox';const confirmationLabel=node('label','Confermo di aver verificato personalmente le fonti e questo esito della revisione.','bank-confirmation');confirmationLabel.prepend(confirmation);confirmationLabel.hidden=status.value==='proposed';status.onchange=()=>{confirmation.checked=false;confirmationLabel.hidden=status.value==='proposed';};form.append(confirmationLabel,node('p','Ogni nuova conferma o rifiuto viene attribuito a chi salva. La fonte collegata non è una prova indipendente aggiuntiva.','runtime-note'),save,cancel);
  cancel.type='button';cancel.onclick=()=>{$('pdfModal').classList.remove('visible');$('pdfModal').setAttribute('aria-hidden','true');setModalOriginal();$('pdfPaper').replaceChildren();};
  form.onsubmit=async event=>{event.preventDefault();if(!references.length){notify('Collega almeno un passaggio originale.');return;}save.disabled=true;try{await api(`/v1/tenants/${tenantId}/brain/assertions${item?'/'+item.id:''}`,{method:item?'PUT':'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...Object.fromEntries(Object.entries(fields).map(([key,control])=>[key,control.value])),status:status.value,confirmHumanReview:confirmation.checked,references:references.map(ref=>({documentId:ref.documentId,fragmentId:ref.fragmentId})),...(item?{expectedVersion:item.version}:{})})});if(generation!==session.generation)return;cancel.click();view('brain');notify('Affermazione salvata con fonti, autore e versione.');}catch(error){if(generation===session.generation)notify(error.message);}finally{save.disabled=false;}};
  drawReferences();drawPassages();setModalOriginal();$('pdfPaper').replaceChildren(form);$('pdfModal').classList.add('visible');$('pdfModal').setAttribute('aria-hidden','false');
}

const reportKindLabels={advisor_analysis:'Analisi Advisor con fonti e revisione',document_dossier:'Dossier documentale',pmi_bank_reconciliation:'PMI · Riconciliazione banca e registro',private_spend_receipts:'Privato · Spese e ricevute',pmi_period_dossier:'PMI · Dossier di periodo',private_period_summary:'Privato · Riepilogo documentale di periodo',pmi_missing_documents:'PMI · Documenti mancanti',private_missing_documents:'Privato · Documenti mancanti',pmi_studio_brief:'PMI · Brief per lo studio',private_professional_brief:'Privato · Brief per il professionista'};
const periodKinds=new Set(['pmi_period_dossier','private_period_summary']);
const financeKinds=new Set(['pmi_bank_reconciliation','private_spend_receipts']);
Object.assign(issueLabels,{financial_mapping_invalid:'Verifica colonne distinte, foglio, intervallo di righe, euro e formato importi.',financial_source_unavailable:'Il registro deve essere elaborato e aggiornato nel cliente attivo.',financial_rows_need_review:'Il registro contiene righe incomplete, identificativi duplicati, importi non validi o formule: verifica le fonti e l’intervallo selezionato.',financial_bank_required:'Salva un calcolo bancario aggiornato nel Cervello e selezionalo; deve contenere movimenti nel periodo scelto.'});
Object.assign(issueLabels,{incomplete_financial_row:'Mancano campi richiesti.',financial_formula_requires_review:'Formula da verificare: esclusa dal calcolo.',duplicate_financial_id:'Identificativo ripetuto: possibile doppio conteggio.',negative_financial_amount:'Importo negativo: rimborsi e storni richiedono un trattamento esplicito.',invalid_amount:'Importo non valido nel formato scelto.'});
Object.assign(issueLabels,{report_period_invalid:'Scegli date valide, con inizio precedente o uguale alla fine.',report_period_confirmation_required:'Conferma il periodo e le fonti scelte per il dossier.',report_documents_required:'Seleziona almeno un documento per il report.',report_source_unavailable:'Una fonte scelta non è più disponibile nel cliente attivo.'});
const dossierOption=node('option','Dossier documentale con note');dossierOption.value='document_dossier';
for(const option of [...$('reportType').options])option.remove();
$('reportType').prepend(dossierOption);for(const kind of Object.keys(reportKindLabels).filter(kind=>kind!=='document_dossier'))$('reportType').append(Object.assign(node('option',reportKindLabels[kind]),{value:kind}));$('reportType').value='document_dossier';
const reportChecklist=node('select');reportChecklist.id='reportChecklist';reportChecklist.setAttribute('aria-label','Checklist del report');reportChecklist.hidden=true;$('reportType').after(reportChecklist);
const reportAdvisor=node('select');reportAdvisor.id='reportAdvisor';reportAdvisor.setAttribute('aria-label','Risposta Advisor del report');reportAdvisor.hidden=true;reportChecklist.after(reportAdvisor);
const periodControls=node('fieldset',null,'note-editor report-period-controls'),periodStart=node('input'),periodEnd=node('input'),periodSources=node('div'),periodConfirm=node('input');periodControls.id='reportPeriodControls';periodControls.hidden=true;periodStart.type=periodEnd.type='date';periodStart.setAttribute('aria-label','Inizio periodo del report');periodEnd.setAttribute('aria-label','Fine periodo del report');periodConfirm.type='checkbox';const periodConfirmation=node('label','Confermo che periodo e documenti selezionati corrispondono al dossier che voglio preparare.','bank-confirmation');periodConfirmation.prepend(periodConfirm);periodControls.append(node('legend','Periodo e fonti'),node('label','Inizio periodo'),periodStart,node('label','Fine periodo'),periodEnd,node('p','Scegli esplicitamente le fonti: le date dei documenti non vengono assegnate automaticamente. Nessuna somma tra banca, fatture e ricevute.','runtime-note'),periodSources,periodConfirmation);document.querySelector('#report .report-layout').before(periodControls);
const financeArea=node('fieldset',null,'note-editor report-period-controls'),financeDoc=node('select'),financeSheet=node('select'),financeColumns={},financeFirst=node('input'),financeLast=node('input'),financeFormat=node('select'),financeBank=node('select'),financeConfirm=node('input'),financePreview=node('p',null,'assertion-preview');financeArea.id='reportFinanceControls';financeArea.hidden=true;financeArea.append(node('legend','Registro e calcoli verificabili'),node('p','Scegli un solo registro. Dichiara colonne e righe da includere, escludendo intestazioni, note e totali. Gli altri documenti non vengono sommati. Le ricevute originali e il pagamento restano da verificare.','runtime-note'));
financeDoc.setAttribute('aria-label','Registro del report finanziario');financeSheet.setAttribute('aria-label','Foglio del registro');financeArea.append(node('label','Registro CSV o Excel'),financeDoc,node('label','Foglio Excel'),financeSheet);
for(const [field,title] of [['id','Colonna identificativo comune'],['description','Colonna descrizione'],['amount','Colonna importo']]){const control=node('select');control.setAttribute('aria-label',title);financeColumns[field]=control;financeArea.append(node('label',title),control);}
for(const [control,title] of [[financeFirst,'Prima riga del registro'],[financeLast,'Ultima riga del registro']]){control.type='number';control.min='1';control.max='10000';control.setAttribute('aria-label',title);financeArea.append(node('label',title),control);}
financeFormat.setAttribute('aria-label','Formato importi del registro');for(const [value,title] of [['decimal-dot','1234.56 · punto decimale'],['decimal-comma','1.234,56 · virgola decimale']])financeFormat.append(Object.assign(node('option',title),{value}));financeArea.append(node('label','Formato importi'),financeFormat);
financeBank.setAttribute('aria-label','Calcolo bancario per riconciliazione');financeArea.append(node('label','Calcolo bancario salvato · solo per riconciliazione PMI'),financeBank,financePreview);financeConfirm.type='checkbox';const financeConfirmation=node('label','Confermo il registro, le colonne e le righe scelte, gli importi positivi in euro e il periodo dichiarato.','bank-confirmation');financeConfirmation.prepend(financeConfirm);financeArea.append(financeConfirmation);periodControls.after(financeArea);
let financeFragments=[],financeSequence=0;
function clearFinance(){financeSequence++;financeFragments=[];financeDoc.replaceChildren();financeSheet.replaceChildren();financeBank.replaceChildren();for(const control of Object.values(financeColumns))control.replaceChildren();financeFirst.value=financeLast.value='';financeConfirm.checked=false;financePreview.textContent='';}
function drawFinanceColumns(){const doc=session.docs.find(doc=>doc.id===financeDoc.value),xlsx=doc?.mimeType==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';const fragments=xlsx?financeFragments.filter(fragment=>fragment.locator.sheet===financeSheet.value):financeFragments;const columns=xlsx?[...new Set(fragments.map(fragment=>/^([A-Z]+)\d+$/.exec(fragment.locator.cell||'')?.[1]).filter(Boolean))]:Object.keys(fragments[0]?.metadata?.columns||{});for(const control of Object.values(financeColumns)){control.replaceChildren(Object.assign(node('option','Scegli la colonna'),{value:''}),...columns.map(column=>Object.assign(node('option',xlsx?'Colonna '+column:column),{value:column})));}financeSheet.disabled=!xlsx;financePreview.textContent='Anteprima: primi '+Math.min(12,fragments.length)+' di '+fragments.length+' passaggi. Apri l’originale nel Cervello per consultarli tutti.\n'+fragments.slice(0,12).map(fragment=>locationLabel(fragment.locator)+' · '+sourceText(fragment)).join('\n');financeConfirm.checked=false;}
financeDoc.onchange=async()=>{const sequence=++financeSequence,generation=session.generation;financeFragments=[];financeSheet.replaceChildren();drawFinanceColumns();financeFirst.value=financeLast.value='';if(!financeDoc.value)return;try{const result=await api(`/v1/tenants/${session.tenant.id}/documents/${financeDoc.value}/fragments`);if(sequence!==financeSequence||generation!==session.generation)return;financeFragments=result.fragments;for(const sheet of new Set(financeFragments.map(fragment=>fragment.locator.sheet).filter(Boolean)))financeSheet.append(Object.assign(node('option',sheet),{value:sheet}));drawFinanceColumns();}catch(error){if(generation===session.generation)notify(error.message);}};
financeSheet.onchange=drawFinanceColumns;for(const control of [financeFirst,financeLast,financeFormat,financeBank,...Object.values(financeColumns)])control.onchange=()=>{financeConfirm.checked=false;};
function reportSelectionMode(){const kind=$('reportType').value;reportAdvisor.hidden=kind!=='advisor_analysis';reportChecklist.hidden=kind==='advisor_analysis'||kind==='document_dossier'||periodKinds.has(kind)||financeKinds.has(kind);periodControls.hidden=!periodKinds.has(kind)&&!financeKinds.has(kind);periodSources.hidden=financeKinds.has(kind);financeArea.hidden=!financeKinds.has(kind);financeBank.disabled=kind!=='pmi_bank_reconciliation';}
$('reportType').onchange=reportSelectionMode;
for(const control of [periodStart,periodEnd])control.onchange=()=>{periodConfirm.checked=false;};
action('generateReport',generateDocumentReport);
async function reportsPanel(){
  const generation=session.generation,[result,requirements,bankCalculations,advisorRequests]=await Promise.all([api(`/v1/tenants/${session.tenant.id}/reports`),api(`/v1/tenants/${session.tenant.id}/brain/checklists`),api(`/v1/tenants/${session.tenant.id}/brain/calculations`),api(`/v1/tenants/${session.tenant.id}/advisor/requests`)]);
  if(generation!==session.generation)return;
  const previousAdvisor=reportAdvisor.value;reportAdvisor.replaceChildren(Object.assign(node('option','Scegli una risposta Advisor corrente'),{value:''}),...advisorRequests.data.filter(j=>j.status==='completed'&&j.answer&&!j.answer.stale).map(j=>Object.assign(node('option',j.question),{value:j.id})));if([...reportAdvisor.options].some(o=>o.value===previousAdvisor))reportAdvisor.value=previousAdvisor;
  const selectedRegister=financeDoc.value,selectedBank=financeBank.value;financeDoc.replaceChildren(Object.assign(node('option','Scegli un registro elaborato'),{value:''}),...session.docs.filter(doc=>doc.extractionStatus==='extracted'&&['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(doc.mimeType)).map(doc=>Object.assign(node('option',doc.filename),{value:doc.id})));if(session.docs.some(doc=>doc.id===selectedRegister))financeDoc.value=selectedRegister;financeBank.replaceChildren(Object.assign(node('option','Scegli un calcolo salvato nel Cervello'),{value:''}),...bankCalculations.data.filter(item=>item.state==='current').map(item=>Object.assign(node('option',item.result.source.filename+' · Versione '+item.version),{value:item.id})));if(bankCalculations.data.some(item=>item.id===selectedBank&&item.state==='current'))financeBank.value=selectedBank;
  const selectedPeriodSources=new Set([...periodSources.querySelectorAll('input:checked')].map(control=>control.value));periodSources.replaceChildren();for(const doc of session.docs){const box=node('input');box.type='checkbox';box.value=doc.id;box.checked=selectedPeriodSources.has(doc.id);box.setAttribute('aria-label','Includi nel periodo '+doc.filename);box.onchange=()=>{periodConfirm.checked=false;};const row=node('label',null,'bank-confirmation');row.append(box,node('span',doc.filename+' · '+label(doc.extractionStatus)));periodSources.append(row);}reportSelectionMode();
  const selectedChecklist=reportChecklist.value;reportChecklist.replaceChildren(Object.assign(node('option','Scegli la checklist concordata'),{value:''}));for(const item of requirements.data)reportChecklist.append(Object.assign(node('option',item.title+' · '+item.periodStart+' – '+item.periodEnd),{value:item.id}));if(requirements.data.some(item=>item.id===selectedChecklist))reportChecklist.value=selectedChecklist;
  $('generateReport').disabled=!session.tenant.scopes?.includes('jobs:write');
  note('reportPreview','Il dossier PDF include i documenti presenti, il loro stato di elaborazione, le note con fonti, i calcoli salvati e le checklist concordate. Sono disponibili anche report dei mancanti e brief per PMI e privati, basati su una checklist scelta. I dossier di periodo usano date e fonti esplicitamente selezionate. I report finanziari richiedono un registro con colonne e righe confermate. Gli abbinamenti alla banca restano da verificare; pagamento e ricevute originali non sono certificati.');
  const list=$('exportList');list.replaceChildren();
  if(!result.data.length)list.append(node('p','Nessun dossier generato.'));
  for(const report of result.data){
    const card=node('article',null,'source-note-card');card.append(node('strong',`${reportKindLabels[report.kind]||'Dossier documentale'} · Versione ${report.version}`),node('small',new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'}).format(new Date(report.createdAt))));
    const download=node('button','Scarica PDF','ghost-btn');download.onclick=()=>void downloadDossier(report).catch(error=>notify(error.message));card.append(download);list.append(card);
  }
}
async function generateDocumentReport(){
  const generation=session.generation,tenantId=session.tenant.id,kind=$('reportType').value,isPeriod=periodKinds.has(kind),isFinancial=financeKinds.has(kind),isAdvisor=kind==='advisor_analysis';if(isAdvisor&&!reportAdvisor.value){notify('Scegli una risposta Advisor corrente.');return;}if(!isAdvisor&&kind!=='document_dossier'&&!isPeriod&&!isFinancial&&!reportChecklist.value){notify('Scegli una checklist concordata per definire requisiti e periodo del report.');return;}
  const scope=isAdvisor?{advisorId:reportAdvisor.value}:isPeriod||isFinancial?{periodStart:periodStart.value,periodEnd:periodEnd.value,confirmPeriodSelection:periodConfirm.checked,...(isPeriod?{documentIds:[...periodSources.querySelectorAll('input:checked')].map(control=>control.value)}:{})}:{};
  if((isPeriod||isFinancial)&&(!scope.periodStart||!scope.periodEnd||(isPeriod&&!scope.documentIds.length)||!scope.confirmPeriodSelection)){notify('Scegli date, fonti e conferma la selezione del periodo.');return;}
  if(isFinancial){scope.table={documentId:financeDoc.value,sheet:financeSheet.value,columns:Object.fromEntries(Object.entries(financeColumns).map(([key,control])=>[key,control.value])),firstRow:Number(financeFirst.value),lastRow:Number(financeLast.value),currency:'EUR',numberFormat:financeFormat.value,confirmTableScope:financeConfirm.checked};if(!financeConfirm.checked||!financeDoc.value||Object.values(scope.table.columns).some(value=>!value)){notify('Scegli registro, colonne e righe, poi conferma i criteri del calcolo.');return;}if(kind==='pmi_bank_reconciliation')scope.bankCalculationId=financeBank.value;}$('generateReport').disabled=true;
  try{
    const job=await api(`/v1/tenants/${tenantId}/jobs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'report',input:{kind,...scope,...(!isAdvisor&&kind!=='document_dossier'&&!isPeriod&&!isFinancial?{checklistId:reportChecklist.value}:{})}})});
    if(generation!==session.generation)return;
    note('reportPreview','Dossier in coda. La generazione usa i documenti e le note di questo cliente.');
    await pollReport(job.id,tenantId,generation);
  }catch(error){if(generation===session.generation){note('reportPreview',error.message);notify(error.message);$('generateReport').disabled=false;}}
}
async function pollReport(id,tenantId,generation){
  if(generation!==session.generation)return;
  const job=await api(`/v1/tenants/${tenantId}/jobs/${id}`);if(generation!==session.generation)return;
  if(['completed','failed','cancelled'].includes(job.status)){
    await reportsPanel();$('generateReport').disabled=!session.tenant.scopes?.includes('jobs:write');
    if(job.status==='completed'){note('reportPreview',`${reportKindLabels[job.output.stage]||'Report PDF'} generato · Versione ${job.output.version}. Fonti documentali collegate: ${job.output.sourceCount}. Consulta requisiti e riferimenti nell’app.`);notify('Il dossier PDF è pronto.');}
    else note('reportPreview',friendlyIssue(job.errorCode));return;
  }
  note('reportPreview',job.status==='running'?'Impaginazione del dossier in corso…':'Generazione in coda…');
  setTimeout(()=>void pollReport(id,tenantId,generation).catch(error=>{if(generation===session.generation){notify(error.message);$('generateReport').disabled=false;}}),1000);
}
async function downloadDossier(report){
  const generation=session.generation,response=await api(`/v1/tenants/${session.tenant.id}/reports/${report.id}`,{raw:true}),blob=await response.blob();if(generation!==session.generation)return;
  const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=`${report.kind&&report.kind!=='document_dossier'?report.kind.replaceAll('_','-'):'dossier-documentale'}-v${report.version}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

const archiveToolbar=document.querySelector('.doc-toolbar'),archiveSearch=node('input');archiveSearch.id='archiveSearch';archiveSearch.placeholder='Cerca un documento per nome';archiveSearch.setAttribute('aria-label','Cerca documenti per nome');archiveSearch.oninput=()=>{session.archiveQuery=archiveSearch.value;renderArchive();};
archiveToolbar.before(archiveSearch);archiveToolbar.after(node('p','Fatture e banca: filtro per nome del file. Da rivedere: lettura mancante o con avvisi.','runtime-note'));
for(const button of document.querySelectorAll('[data-filter]'))button.onclick=()=>{session.filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b===button));renderArchive();};
const selectVisible=node('button','Seleziona visibili','ghost-btn');selectVisible.onclick=()=>{for(const doc of visibleDocuments())session.selected.add(doc.id);renderArchive();};archiveToolbar.append(selectVisible);

function exactEuro(amount){
  const value=BigInt(amount.cents),absolute=value<0n?-value:value;
  return `${value<0n?'-':''}${new Intl.NumberFormat('it-IT',{useGrouping:'always'}).format(absolute/100n)},${(absolute%100n).toString().padStart(2,'0')} €`;
}
function bankCalculator(area,generation){
  area.append(node('h3','Controlla i movimenti bancari'),node('p','Calcoli sul solo CSV scelto. Conferma quali colonne indicano entrate, uscite e saldo. Le altre fonti non vengono sommate.','runtime-note'));
  const docs=session.docs.filter(doc=>doc.filename.toLowerCase().endsWith('.csv')&&doc.extractionStatus==='extracted');
  if(!docs.length){area.append(node('p','Elabora un CSV per controllare entrate, uscite e saldi.'));return;}
  const form=node('form',null,'note-editor'),source=node('select'),format=node('select'),mapping=node('div',null,'bank-mapping-grid'),results=node('div'),submit=node('button','Controlla il CSV','primary-btn'),confirm=node('input'),confirmation=node('label',null,'bank-confirmation');
  source.setAttribute('aria-label','CSV dei movimenti');source.append(node('option','Scegli il CSV'));source.options[0].value='';source.required=true;
  for(const doc of docs){const option=node('option',doc.filename);option.value=doc.id;source.append(option);}
  for(const [value,label] of [['decimal-dot','1234.56 · punto decimale'],['decimal-comma','1.234,56 · virgola decimale']]){const option=node('option',label);option.value=value;format.append(option);}format.setAttribute('aria-label','Formato degli importi');
  const labels={date:'Data del movimento',id:'Identificativo del movimento',description:'Descrizione',debit:'Uscite',credit:'Entrate',balance:'Saldo dopo il movimento'},controls={};
  const suggested={date:['data','date'],id:['id_movimento','id'],description:['descrizione','description'],debit:['dare_eur','debit'],credit:['avere_eur','credit'],balance:['saldo_eur','balance']};
  confirm.type='checkbox';confirm.required=true;confirmation.append(confirm,node('span','Confermo importi in euro, colonne corrispondenti ai movimenti, uscite/entrate positive e saldo successivo a ciascun movimento.'));
  submit.type='submit';submit.disabled=true;form.append(node('label','Documento'),source,node('label','Come sono scritti gli importi'),format,mapping,confirmation,submit);area.append(form,results);
  const savedArea=node('section',null,'runtime-notes');area.append(savedArea);void renderSavedCalculations(savedArea,generation).catch(error=>{if(generation===session.generation)notify(error.message);});
  source.onchange=async()=>{
    mapping.replaceChildren();results.replaceChildren();confirm.checked=false;submit.disabled=true;
    const documentId=source.value;if(!documentId)return;
    try{
      const extraction=await api(`/v1/tenants/${session.tenant.id}/documents/${documentId}/fragments`);if(generation!==session.generation||source.value!==documentId)return;
      const columns=Object.keys(extraction.fragments[0]?.metadata?.columns||{});if(!columns.length){results.append(node('p','Questa fonte non contiene colonne CSV utilizzabili.'));return;}
      for(const [field,label] of Object.entries(labels)){
        const wrap=node('label',label),select=node('select');select.required=true;select.setAttribute('aria-label',label);select.append(node('option','Scegli colonna'));select.options[0].value='';
        for(const key of columns){const option=node('option',key);option.value=key;select.append(option);}
        const candidate=suggested[field].find(key=>columns.includes(key));if(candidate)select.value=candidate;controls[field]=select;wrap.append(select);mapping.append(wrap);
      }submit.disabled=false;
    }catch(error){if(generation===session.generation)notify(error.message);}
  };
  form.onsubmit=async event=>{
    event.preventDefault();submit.disabled=true;results.replaceChildren();
    const documentId=source.value,doc=docs.find(d=>d.id===documentId);
    const locked=[source,format,confirm,...Object.values(controls)];for(const control of locked)control.disabled=true;
    try{
      const parameters={documentId,columns:Object.fromEntries(Object.entries(controls).map(([key,select])=>[key,select.value])),currency:'EUR',numberFormat:format.value,balancePosition:'after_transaction'};
      const result=await api(`/v1/tenants/${session.tenant.id}/brain/calculations/bank-summary`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(parameters)});
      if(generation!==session.generation)return;
      const labels={invalid_iso_date:'Data non interpretabile in formato anno-mese-giorno',date_order:'Ordine delle date da verificare',duplicate_movement_id:'Movimento con identificativo ripetuto',missing_movement_id:'Identificativo del movimento mancante',invalid_amount:'Importo non valido nel formato scelto',negative_debit_credit:'Entrate e uscite devono essere positive'};
      if(result.status==='needs_review'){
        results.append(node('h4','Dati da verificare prima del calcolo'),node('p','Non sono stati prodotti totali. Correggi i dati o il formato degli importi scelto.'));
        for(const issue of result.issues.slice(0,30))results.append(node('p',`${locationLabel(issue.locator)} · ${labels[issue.code]||'Dato da verificare'}`));
        if(result.issues.length>30)results.append(node('p',`${result.issues.length} problemi rilevati; qui sono mostrati i primi 30.`));return;
      }
      results.append(node('h4',result.status==='consistent_rows'?'I saldi delle righe sono coerenti':'Differenze nei saldi da verificare'),node('p',`${result.movements.length} movimenti · Date presenti: ${result.dateRange.first} - ${result.dateRange.last}`));
      const metrics=node('div',null,'bank-result-grid');
      for(const [title,amount] of [['Entrate',result.totals.credit],['Uscite',result.totals.debit],['Differenza entrate - uscite',result.totals.net],['Saldo finale riportato',result.totals.closingObserved]]){const card=node('article',null,'source-note-card');card.append(node('small',title),node('strong',exactEuro(amount)));metrics.append(card);}results.append(metrics);
      results.append(node('p',`Saldo iniziale ricostruito: ${exactEuro(result.opening)}. È calcolato dalla prima riga, secondo la convenzione confermata; non proviene da un documento distinto.`));
      results.append(node('p','La coerenza del CSV non dimostra che il periodo sia completo o che fatture e pagamenti siano riconciliati.','runtime-note'));
      for(const item of result.discrepancies.slice(0,30))results.append(node('p',`${locationLabel(item.reference.locator)} · saldo riportato ${exactEuro(item.observed)}, saldo calcolato ${exactEuro(item.expected)}.`));
      const sourceLink=node('button',`Consulta fonte: ${doc.filename}`,'ghost-btn');sourceLink.onclick=()=>void showFragments(doc).catch(error=>notify(error.message));results.append(sourceLink,technicalDetails([['Impronta della fonte',result.source.sourceHash]]));
      if(session.tenant.scopes?.includes('documents:write')){
        const save=node('button','Salva calcolo nel dossier','primary-btn');save.onclick=async()=>{save.disabled=true;try{const stored=await api(`/v1/tenants/${session.tenant.id}/brain/calculations`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(parameters)});if(generation!==session.generation)return;await renderSavedCalculations(savedArea,generation);notify(stored.reused?'Questo calcolo è già salvato.':`Calcolo salvato · Versione ${stored.version}.`);}catch(error){if(generation===session.generation)notify(error.message);}finally{save.disabled=false;}};results.append(save);
      }
    }catch(error){if(generation===session.generation)notify(error.message);}finally{if(generation===session.generation){submit.disabled=false;for(const control of locked)control.disabled=false;}}
  };
}

async function renderSavedCalculations(area,generation){
  const response=await api(`/v1/tenants/${session.tenant.id}/brain/calculations`);if(generation!==session.generation)return;
  area.replaceChildren(node('h4','Calcoli salvati nel dossier'),node('p','Risultati derivati dal CSV, con ipotesi da verificare. I calcoli aggiornati vengono inclusi nel prossimo dossier PDF.','runtime-note'));
  if(!response.data.length)area.append(node('p','Nessun calcolo salvato.'));
  for(const item of response.data){
    const card=node('article',null,'source-note-card');card.append(node('strong',item.result.source.filename),node('small',`Versione ${item.version} · ${item.authorName} · ${item.state==='current'?'Fonte corrente':'Da ricalcolare: fonte aggiornata'}`));
    card.append(node('p',`Entrate ${exactEuro(item.result.totals.credit)} · Uscite ${exactEuro(item.result.totals.debit)} · Saldo riportato ${exactEuro(item.result.totals.closingObserved)}`),node('small','Ipotesi da verificare · Non è una prova indipendente rispetto al CSV.'));
    const source=node('button','Consulta fonte','ghost-btn');source.onclick=()=>void showFragments(session.docs.find(doc=>doc.id===item.result.source.documentId)).catch(error=>notify(error.message));card.append(source);area.append(card);
  }
}

const checklistLabels={missing:'Mancante',received:'Ricevuto · da verificare',reviewed:'Verificato da un utente',needs_review:'Fonte cambiata · da verificare'};
Object.assign(issueLabels,{invalid_checklist:'Inserisci titolo, periodo valido e almeno un requisito.',invalid_checklist_sources:'Collega un passaggio originale del cliente per i requisiti ricevuti o verificati.',checklist_review_confirmation_required:'Conferma la verifica umana dei requisiti prima di salvare.',checklist_version_conflict:'La checklist è stata aggiornata: riaprila prima di modificare.',checklist_not_found:'La checklist non è più disponibile: una fonte collegata potrebbe essere stata eliminata.',checklist_scope_limit:'Hai raggiunto il limite iniziale delle checklist o delle revisioni.'});
async function renderChecklists(area,generation){
 const response=await api(`/v1/tenants/${session.tenant.id}/brain/checklists`);if(generation!==session.generation)return;
 area.replaceChildren(node('h3','Requisiti e documenti mancanti'),node('p','Requisiti concordati per un periodo. Il caricamento non verifica automaticamente un requisito. Le checklist collegate a un originale vengono eliminate, con le loro revisioni, se quell’originale viene cancellato.','runtime-note'));
 if(session.tenant.scopes?.includes('documents:write')){const create=node('button','Nuova checklist','primary-btn');create.onclick=()=>editChecklist(null);area.append(create);}
 if(!response.data.length)area.append(node('p','Nessuna checklist concordata. Definisci ciò che serve prima di dichiarare completo il dossier.'));
 for(const item of response.data){
  const card=node('article',null,'source-note-card');card.append(node('h4',item.title),node('p',`Periodo ${item.periodStart} – ${item.periodEnd}`),node('small',`Versione ${item.version} · ${item.authorName}`),node('p',`Mancanti: ${item.counts.missing} · Ricevuti: ${item.counts.received} · Verificati: ${item.counts.reviewed} · Fonti da rivedere: ${item.counts.needs_review}`));
  for(const entry of item.items){const row=node('div',null,'checklist-entry');row.append(node('strong',entry.requirement),node('span',checklistLabels[entry.status],'source-card-status'));if(entry.reviewerName)row.append(node('small','Verifica attribuita a '+entry.reviewerName));for(const ref of entry.references){const open=node('button',`${ref.filename} · ${locationLabel(ref.locator)}`,'ghost-btn');open.onclick=()=>void showFragments(session.docs.find(doc=>doc.id===ref.documentId)).catch(error=>notify(error.message));row.append(open);}card.append(row);}
  if(session.tenant.scopes?.includes('documents:write')){const edit=node('button','Aggiorna requisiti e verifiche','ghost-btn');edit.onclick=()=>editChecklist(item);card.append(edit);}
  const history=node('button','Vedi revisioni','ghost-btn');history.onclick=()=>void checklistHistory(item).catch(error=>notify(error.message));card.append(history);area.append(card);
 }
}
async function checklistHistory(item){
 const generation=session.generation,response=await api(`/v1/tenants/${session.tenant.id}/brain/checklists/${item.id}`);if(generation!==session.generation)return;
 text('pdfTitle','Revisioni della checklist');text('pdfKind','Requisiti concordati');const content=node('div',null,'runtime-source');
 for(const revision of response.data){const card=node('article',null,'source-note-card');card.append(node('h3',`${revision.title} · Versione ${revision.version}`),node('small',revision.authorName+' · '+new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short'}).format(new Date(revision.createdAt))));for(const entry of revision.items)card.append(node('p',entry.requirement+' · '+checklistLabels[entry.status]));content.append(card);}
 setModalOriginal();$('pdfPaper').replaceChildren(content);$('pdfModal').classList.add('visible');$('pdfModal').setAttribute('aria-hidden','false');
}
function editChecklist(item){
 const generation=session.generation,tenantId=session.tenant.id,entries=(item?.items||[{requirement:'',status:'missing',references:[]}]).map(entry=>({...entry,references:[...entry.references],status:entry.status==='needs_review'?'received':entry.status}));
 text('pdfTitle',item?'Aggiorna checklist':'Nuova checklist');text('pdfKind','Requisiti e verifiche umane');
 const form=node('form',null,'note-editor'),title=node('input'),start=node('input'),end=node('input'),rows=node('div'),add=node('button','Aggiungi requisito','ghost-btn'),save=node('button','Salva checklist','primary-btn'),cancel=node('button','Annulla','ghost-btn');
 title.required=true;title.maxLength=160;title.value=item?.title||'';title.setAttribute('aria-label','Titolo checklist');title.placeholder='Es. Documenti per il dossier di settembre';
 start.type=end.type='date';start.required=end.required=true;start.value=item?.periodStart||'';end.value=item?.periodEnd||'';start.setAttribute('aria-label','Inizio periodo');end.setAttribute('aria-label','Fine periodo');
 form.append(node('p','Definisci richieste esplicite. Ricevuto richiede una fonte; verificato richiede una conferma umana. Questa checklist non certifica la completezza normativa.'),node('label','Titolo'),title,node('label','Inizio periodo'),start,node('label','Fine periodo'),end,rows);
 const target=node('select'),docSelect=node('select'),passage=node('select'),link=node('button','Collega passaggio al requisito','ghost-btn'),sourceArea=node('fieldset');sourceArea.append(node('legend','Collega una fonte originale'),target,docSelect,passage,link);
 target.setAttribute('aria-label','Requisito a cui collegare la fonte');docSelect.setAttribute('aria-label','Documento della checklist');passage.setAttribute('aria-label','Passaggio della checklist');
 docSelect.append(Object.assign(node('option','Scegli un documento elaborato'),{value:''}));for(const doc of session.docs.filter(doc=>doc.extractionStatus==='extracted'))docSelect.append(Object.assign(node('option',doc.filename),{value:doc.id}));
 let fragments=[],loadingSequence=0;
 docSelect.onchange=async()=>{const sequence=++loadingSequence;passage.replaceChildren();fragments=[];link.disabled=true;if(!docSelect.value)return;try{const result=await api(`/v1/tenants/${tenantId}/documents/${docSelect.value}/fragments`);if(generation!==session.generation||sequence!==loadingSequence)return;fragments=result.fragments;for(const fragment of fragments)passage.append(Object.assign(node('option',locationLabel(fragment.locator)+' · '+sourceText(fragment).slice(0,100)),{value:fragment.id}));link.disabled=!fragments.length;}catch(error){if(generation===session.generation)notify(error.message);}};
 function draw(){rows.replaceChildren();target.replaceChildren();entries.forEach((entry,index)=>{
  const card=node('div',null,'checklist-entry'),requirement=node('input'),status=node('select'),remove=node('button','Rimuovi requisito','ghost-btn');requirement.required=true;requirement.maxLength=500;requirement.value=entry.requirement;requirement.setAttribute('aria-label','Requisito '+(index+1));requirement.placeholder='Documento o evidenza richiesta';requirement.oninput=()=>{entry.requirement=requirement.value;target.options[index].textContent=(index+1)+'. '+(entry.requirement||'Requisito');};
  for(const state of ['missing','received','reviewed'])status.append(Object.assign(node('option',checklistLabels[state]),{value:state}));status.value=entry.status;status.setAttribute('aria-label','Stato requisito '+(index+1));status.onchange=()=>{entry.status=status.value;if(entry.status==='missing'){entry.references=[];draw();}};
  remove.type='button';remove.onclick=()=>{entries.splice(index,1);draw();};card.append(requirement,status,remove);
  for(const ref of entry.references){const line=node('div'),unlink=node('button','Scollega fonte','ghost-btn');unlink.type='button';unlink.onclick=()=>{entry.references=entry.references.filter(r=>r!==ref);if(!entry.references.length)entry.status='missing';draw();};line.append(node('small',ref.filename+' · '+locationLabel(ref.locator)),unlink);card.append(line);}
  rows.append(card);target.append(Object.assign(node('option',(index+1)+'. '+(entry.requirement||'Requisito')),{value:String(index)}));
 });add.disabled=entries.length>=100;save.disabled=entries.length===0;}
 add.type='button';add.onclick=()=>{entries.push({requirement:'',status:'missing',references:[]});draw();};link.type='button';link.disabled=true;link.onclick=()=>{const entry=entries[Number(target.value)],fragment=fragments.find(f=>f.id===passage.value),doc=session.docs.find(d=>d.id===docSelect.value);if(!entry||!fragment||!doc)return;if(entry.references.length>=10){notify('Puoi collegare fino a dieci passaggi per requisito.');return;}if(!entry.references.some(r=>r.documentId===doc.id&&r.fragmentId===fragment.id))entry.references.push({documentId:doc.id,fragmentId:fragment.id,filename:doc.filename,locator:fragment.locator});entry.status='received';draw();};
 const confirmation=node('input');confirmation.type='checkbox';const confirmationLabel=node('label','Confermo di avere verificato personalmente i requisiti indicati come verificati.');confirmationLabel.prepend(confirmation);
 form.append(add,sourceArea,confirmationLabel,node('p','Se scegli Mancante, le fonti del requisito vengono scollegate. Le revisioni precedenti restano attribuite fino alla cancellazione della fonte.','runtime-note'),save,cancel);cancel.type='button';cancel.onclick=()=>{$('pdfModal').classList.remove('visible');$('pdfModal').setAttribute('aria-hidden','true');};
 form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await api(`/v1/tenants/${tenantId}/brain/checklists${item?'/'+item.id:''}`,{method:item?'PUT':'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:title.value,periodStart:start.value,periodEnd:end.value,confirmHumanReview:confirmation.checked,items:entries.map(entry=>({id:entry.id,requirement:entry.requirement,status:entry.status,references:entry.references.map(ref=>({documentId:ref.documentId,fragmentId:ref.fragmentId}))})),...(item?{expectedVersion:item.version}:{})})});if(generation!==session.generation)return;cancel.click();view('brain');notify('Checklist salvata con fonti, autore e versione.');}catch(error){if(generation===session.generation)notify(error.message);}finally{save.disabled=false;}};
 draw();setModalOriginal();$('pdfPaper').replaceChildren(form);$('pdfModal').classList.add('visible');$('pdfModal').setAttribute('aria-hidden','false');
}

action('saveAdvisorRequest',async()=>{
 const tenant=session.tenant,generation=session.generation;if(!tenant)return;
 const input={question:$('askInput').value.trim(),context:$('advisorContext').value.trim(),calculationIds:[...$('advisorCalculations').selectedOptions].map(o=>o.value),contributions:[...$('advisorContributions').selectedOptions].map(o=>({kind:o.dataset.kind,id:o.value}))},start=$('advisorStart').value,end=$('advisorEnd').value;
 if(start||end){if(!start||!end){notify('Indica entrambe le date del periodo.');return;}input.period={start,end};}
 await api(`/v1/tenants/${tenant.id}/advisor/requests`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
 if(generation!==session.generation)return;await advisorHistory();notify('Domanda salvata. Lo stato mostra se il motore è disponibile.');
});
async function advisorHistory(){
 const generation=session.generation,tenant=session.tenant;if(!tenant)return;
 const [result,calcs,contributions]=await Promise.all([api(`/v1/tenants/${tenant.id}/advisor/requests`),api(`/v1/tenants/${tenant.id}/brain/calculations`),api(`/v1/tenants/${tenant.id}/advisor/contributions`),refreshAiStatus()]);if(generation!==session.generation)return;
 if(!$('chatStream').children.length)note('chatStream','Cerca le fonti originali o invia una domanda con il suo contesto. Consulta lo stato AI e quello della domanda per verificare l’elaborazione.');
 const selected=new Set([...$('advisorCalculations').selectedOptions].map(o=>o.value));$('advisorCalculations').replaceChildren();for(const c of calcs.data||[]){if(c.state!=='current')continue;const option=node('option',c.result.source.filename+' · calcolo salvato v'+c.version);option.value=c.id;option.selected=selected.has(c.id);$('advisorCalculations').append(option);}
 const selectedContributions=new Set([...$('advisorContributions').selectedOptions].map(o=>o.dataset.kind+':'+o.value));$('advisorContributions').replaceChildren();for(const c of contributions.data){const option=node('option',({note:'Nota',assertion:'Affermazione',checklist:'Checklist',wiki:'Wiki rivista'})[c.kind]+' · '+c.label+' · v'+c.version);option.value=c.id;option.dataset.kind=c.kind;option.selected=selectedContributions.has(c.kind+':'+c.id);$('advisorContributions').append(option);}
 const area=$('advisorHistory');area.replaceChildren(node('h3','Domande salvate'),node('p',aiHistoryNotice(),'runtime-note'));
 const reload=node('button','Aggiorna stato','ghost-btn');reload.onclick=()=>void advisorHistory().catch(error=>notify(error.message));area.append(reload);
 const states={queued:'In attesa',running:'Elaborazione in corso',completed:'Risposta disponibile',failed:'Elaborazione non riuscita',cancelled:'Annullata',uncertain:'Esito della chiamata da verificare'};
 for(const job of result.data){const card=node('article',null,'runtime-note');card.append(node('strong',job.question),node('p',job.status==='completed'&&job.answer?.status==='abstain'?'Il modello si è astenuto: informazioni insufficienti':states[job.status]||'Da verificare'));
 if(job.period)card.append(node('p','Periodo dichiarato: '+job.period.start+' – '+job.period.end));if(job.context)card.append(node('p',job.context));
 if(['queued','running'].includes(job.status)&&session.tenant.scopes?.includes('jobs:write')){const cancel=node('button','Annulla domanda','ghost-btn');cancel.onclick=async()=>{try{await api(`/v1/tenants/${tenant.id}/advisor/requests/${job.id}`,{method:'DELETE'});if(generation===session.generation)await advisorHistory();}catch(error){notify(error.message);}};card.append(cancel);}
 for(const c of job.contributions||[])card.append(node('p',(c.kind==='wiki'?'Wiki derivata rivista inclusa: ':'Contributo attribuito incluso: ')+(c.content.title||c.content.subject)+' · versione '+c.version+' · da verificare, non fonte indipendente.'));
 for(const calculation of job.calculations||[]){const c=calculation.summary,block=node('div',null,'runtime-note');block.append(node('strong','Calcolo deterministico · '+c.source.filename),node('p',calculation.state==='stale'?'Calcolo storico da riesaminare: fonte o versione cambiate.':'Versione corrente del calcolo selezionato.','source-warning'),node('p','Entrate: '+exactEuro(c.totals.credit)+' · Uscite: '+exactEuro(c.totals.debit)+' · Saldo osservato: '+exactEuro(c.totals.closingObserved)),node('p','Una sola fonte, mapping dichiarato. Non certifica copertura del periodo, pagamento o deducibilità.'));card.append(block);}
 if(job.answer){const answer=job.answer;if(answer.metadata?.localRevalidation)card.append(node('p','Risposta AMD già ricevuta e ricontrollata localmente dopo una correzione dei controlli. Nessuna nuova chiamata al modello.','source-warning'));if(answer.stale)card.append(node('p','Fonti o autorizzazione cambiate: questa risposta storica deve essere riesaminata.','source-warning'));card.append(node('p',answer.aiExecuted?'Proposta AI da rivedere con il professionista. Citazioni esatte non garantiscono la correttezza delle conclusioni.':'Astensione: nessuna fonte pertinente recuperata.','source-warning'));
 if(answer.discardedProposals?.length)card.append(node('p',answer.discardedProposals.length+' proposte numeriche del modello sono state escluse. Gli importi si consultano nelle citazioni originali; non sono stati calcolati risparmi o benefici.','source-warning'),technicalDetails([['Proposte escluse',JSON.stringify(answer.discardedProposals)]]));
 for(const fact of answer.facts||[]){const source=node('button',fact.reference.filename+' · '+locationLabel(fact.reference.locator),'ghost-btn');source.onclick=()=>void showEvidenceReference(fact.reference).catch(error=>notify(error.message));if(fact.reference.origin==='reviewed-model-transcription')card.append(node('p','Citazione da una lettura visiva rivista: testo derivato, da confrontare con l’originale.','source-warning'));card.append(citationPresentation(fact.quote),source);}
 for(const [key,title] of [['interpretations','Interpretazioni da verificare'],['recommendations','Suggerimenti da verificare'],['scenarios','Scenari ipotetici'],['missingInformation','Informazioni mancanti']])if(answer[key]?.length){card.append(node('h4',title));for(const item of answer[key]){card.append(node('p',typeof item==='string'?item:item.text));if(key==='recommendations'){if(!item.observedProblem){card.append(node('p','Suggerimento storico senza dettagli strutturati: riesaminare prima dell’uso.','source-warning'));continue;}for(const [field,title] of [['observedProblem','Problema da verificare'],['action','Azione proposta'],['expectedBenefit','Beneficio atteso · non quantificato'],['assumptions','Ipotesi'],['risks','Rischi'],['firstVerification','Prima verifica']])card.append(node('p',title+': '+(Array.isArray(item[field])?item[field].join(' · '):item[field])));}}}
 }
 if(job.answer){
  const review=job.review,statuses={approved:'Approvata dalla persona',rejected:'Respinta dalla persona',needs_review:'Da riesaminare'};
  card.append(node('h4','Revisione umana'),node('p',review?(statuses[review.status]+' · '+review.authorName):'Nessuna revisione registrata.'));
  if(review)card.append(node('p',review.comment));
  if(!job.answer.stale&&session.tenant.scopes?.includes('documents:write')){const form=node('form',null,'runtime-note'),status=node('select'),comment=node('textarea'),confirm=node('input'),submit=node('button','Registra revisione','ghost-btn');status.setAttribute('aria-label','Esito della revisione');for(const [value,title] of Object.entries(statuses)){const option=node('option',title);option.value=value;status.append(option);}comment.maxLength=2000;comment.required=true;comment.placeholder='Che cosa hai controllato e quali limiti rimangono?';comment.setAttribute('aria-label','Osservazioni della revisione');confirm.type='checkbox';confirm.required=true;const label=node('label','Confermo di aver controllato questa risposta e le sue fonti.');label.prepend(confirm);submit.type='submit';form.append(status,comment,label,submit);form.onsubmit=async event=>{event.preventDefault();try{await api(`/v1/tenants/${tenant.id}/advisor/requests/${job.id}/review`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({status:status.value,comment:comment.value,confirmHumanReview:confirm.checked,expectedVersion:review?.version||0})});if(generation===session.generation)await advisorHistory();}catch(error){notify(error.message);}};card.append(form);}
  if(!job.answer.stale&&session.tenant.scopes?.includes('jobs:write')){const pdf=node('button','Genera PDF dell’analisi','ghost-btn');pdf.onclick=async()=>{pdf.disabled=true;try{const reportJob=await api(`/v1/tenants/${tenant.id}/jobs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'report',input:{kind:'advisor_analysis',advisorId:job.id}})});if(generation!==session.generation)return;view('report');note('reportPreview','Analisi Advisor in coda per l’impaginazione.');await pollReport(reportJob.id,tenant.id,generation);}catch(error){notify(error.message);}finally{pdf.disabled=false;}};card.append(pdf);}
  if(job.reviewHistory?.length)card.append(technicalDetails([['Storico revisioni',JSON.stringify(job.reviewHistory)]]));
 }
 if(job.errorCode)card.append(node('p',friendlyIssue(job.errorCode)),technicalDetails([['Diagnostica',job.errorCode]]));area.append(card);}
 if(!result.data.length)area.append(node('p','Nessuna domanda salvata per questo cliente.'));
}

async function renderDocumentMemory(area,generation){
 const tenant=session.tenant;if(!tenant)return;const result=await api(`/v1/tenants/${tenant.id}/brain/memory`);await refreshAiStatus();if(generation!==session.generation)return;
 area.replaceChildren(node('h3','Wiki documentale'),node('p',aiHistoryNotice(),'runtime-note'));
 const select=node('select');select.setAttribute('aria-label','Documento da trasformare in wiki');
 const mode=node('select');mode.setAttribute('aria-label','Tipo elaborazione documento');for(const [value,title] of [['wiki','Crea wiki da testo estratto'],['vision','Leggi immagine o pagina scansionata']]){const option=node('option',title);option.value=value;mode.append(option);}const page=node('input');page.type='number';page.min='1';page.max='50';page.value='1';page.disabled=true;page.setAttribute('aria-label','Pagina da leggere');
 const create=node('button','Prepara elaborazione del documento','primary-btn'),reload=node('button','Aggiorna wiki','ghost-btn'),eligibility=node('p',null,'runtime-note');let submitting=false;
 const updateEligibility=()=>{const previous=select.value;page.disabled=mode.value!=='vision';select.replaceChildren();const eligible=session.docs.filter(doc=>mode.value==='vision'?['application/pdf','image/png','image/jpeg'].includes(doc.mimeType):doc.extractionStatus==='extracted');for(const doc of eligible){const option=node('option',doc.filename);option.value=doc.id;select.append(option);}if(eligible.some(doc=>doc.id===previous))select.value=previous;create.disabled=submitting||!tenant.scopes?.includes('jobs:write')||!eligible.length;eligibility.textContent=mode.value==='vision'?'Scegli una fotografia o una pagina PDF. La lettura proposta dovrà essere confrontata con l’originale.':eligible.length?'Sono disponibili i documenti con testo già estratto. Per fotografie e scansioni scegli la lettura visiva.':'Non ci sono documenti con testo estratto. Completa l’ingestione oppure scegli la lettura visiva per fotografie e scansioni.';};
 mode.onchange=updateEligibility;if(area.dataset.mode)mode.value=area.dataset.mode;updateEligibility();if([...select.options].some(o=>o.value===area.dataset.document))select.value=area.dataset.document;page.value=area.dataset.page||'1';
 create.onclick=async()=>{submitting=true;create.disabled=true;area.dataset.mode=mode.value;area.dataset.document=select.value;area.dataset.page=page.value;try{await api(`/v1/tenants/${tenant.id}/brain/memory`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({documentId:select.value,...(mode.value==='vision'?{kind:'vision',page:Number(page.value)}:{})})});if(generation===session.generation)await renderDocumentMemory(area,generation);}catch(error){notify(error.message);}finally{submitting=false;updateEligibility();}};reload.onclick=()=>void renderDocumentMemory(area,generation).catch(error=>notify(error.message));area.append(mode,select,page,create,reload,eligibility);
 const states={queued:'In attesa del motore',running:'Elaborazione in corso',completed:'Proposta disponibile',cancelled:'Annullata',uncertain:'Chiamata da verificare',failed:'Elaborazione non riuscita'};
 for(const request of result.data){const card=node('article',null,'source-note-card');card.append(node('strong',request.filename),node('p',states[request.status]||'Da verificare'));if(request.sourceState==='stale')card.append(node('p','Fonte cambiata: proposta storica da riesaminare.','source-warning'));
 if(['queued','running'].includes(request.status)){const cancel=node('button',request.mode==='vision'?'Annulla lettura visiva':'Annulla creazione wiki','ghost-btn');cancel.onclick=async()=>{try{await api(`/v1/tenants/${tenant.id}/brain/memory/${request.id}`,{method:'DELETE'});if(generation===session.generation)await renderDocumentMemory(area,generation);}catch(error){notify(error.message);}};card.append(cancel);}
 if(request.wiki?.metadata?.localRevalidation)card.append(node('p','Risposta AMD già ricevuta e ricontrollata localmente dopo una correzione dei controlli. Nessuna nuova chiamata al modello.','source-warning'));
 if(request.wiki){const w=request.wiki;card.append(node('h4',w.title),node('p','Proposta AI da verificare. Le citazioni non dimostrano la correttezza delle conclusioni.','source-warning'),node('p','Copertura: '+request.coverage.includedFragments+' passaggi su '+request.coverage.totalFragments+'.'));
 const types={invoice:'Fattura',receipt:'Ricevuta',bank_statement:'Estratto conto',contract:'Contratto',correspondence:'Corrispondenza',expense_register:'Registro spese',other:'Altro',unknown:'Da chiarire'};card.append(node('p','Classificazione proposta: '+types[w.classification]));for(const fact of w.facts){const open=node('button','Apri '+fact.evidence.reference.filename+' · '+locationLabel(fact.evidence.reference.locator),'ghost-btn');open.onclick=()=>void showEvidenceReference(fact.evidence.reference).catch(error=>notify(error.message));if(fact.evidence.reference.origin==='reviewed-model-transcription')card.append(node('p','Fonte: lettura visiva rivista, da confrontare con l’originale.','source-warning'));card.append(node('p',fact.text),citationPresentation(fact.evidence.quote),open);}
 if(w.discardedRelations?.length)card.append(node('p',w.discardedRelations.length+' collegamenti proposti dal modello sono stati esclusi: la citazione non supera i controlli. Non sono nella mappa né nel contesto Advisor.','source-warning'),technicalDetails([['Proposte escluse',JSON.stringify(w.discardedRelations)]]));
 if(w.relations.length){card.append(node('h4','Relazioni proposte'));for(const relation of w.relations){const from=w.entities.find(e=>e.id===relation.from),to=w.entities.find(e=>e.id===relation.to);card.append(node('p',from.label+' → '+relation.label+' → '+to.label+' · da verificare'));}}
 }
 if(request.mode==='vision'){const preview=node('button','Confronta con la pagina originale','ghost-btn'),previewArea=node('figure',null,'memory-page-preview');preview.onclick=async()=>{preview.disabled=true;try{const response=await api(`/v1/tenants/${tenant.id}/brain/memory/${request.id}/page`,{raw:true}),blob=await response.blob(),data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});if(generation!==session.generation)return;const image=node('img');image.src=data;image.alt='Pagina originale normalizzata per confronto';image.style.maxWidth='100%';previewArea.replaceChildren(image);card.append(previewArea);}catch(error){notify(error.message);}finally{preview.disabled=false;}};card.append(preview);}
 if(request.visual){card.append(node('h4','Lettura visiva proposta'),node('p','Testo e posizioni proposti dal modello: confrontali con la pagina originale.','source-warning'));for(const block of request.visual.blocks)card.append(node('p',block.text),node('small','Pagina '+block.reference.locator.page+' · '+(block.ambiguous?'Lettura ambigua':'Da verificare')+' · posizione proposta '+block.bbox.map(n=>Math.round(n*100)+'%').join(', ')));for(const warning of request.visual.warnings)card.append(node('p',warning,'source-warning'));}
 if(request.visual&&request.review?.status==='approved'&&request.sourceState==='current'&&tenant.scopes?.includes('jobs:write')){const wiki=node('button','Crea wiki dalla lettura rivista','primary-btn');wiki.onclick=async()=>{wiki.disabled=true;try{await api(`/v1/tenants/${tenant.id}/brain/memory`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'wiki_from_vision',transcriptionId:request.id})});if(generation===session.generation)await renderDocumentMemory(area,generation);}catch(error){notify(error.message);}finally{wiki.disabled=false;}};card.append(wiki);}
 if(request.wiki||request.visual){const review=request.review,labels={approved:'Approvata dalla persona',rejected:'Respinta dalla persona',needs_review:'Da riesaminare'};card.append(node('h4',request.visual?'Revisione della lettura visiva':'Revisione della wiki'),node('p',review?labels[review.status]+' · '+review.authorName:'Nessuna revisione registrata.'));if(review)card.append(node('p',review.comment));
 if(request.sourceState==='current'&&tenant.scopes?.includes('documents:write')){const form=node('form',null,'runtime-note'),status=node('select'),comment=node('textarea'),confirm=node('input'),submit=node('button','Registra verifica del documento','ghost-btn');status.setAttribute('aria-label',request.visual?'Esito revisione lettura visiva':'Esito revisione wiki');for(const [value,title] of Object.entries(labels)){const option=node('option',title);option.value=value;status.append(option);}comment.maxLength=2000;comment.required=true;comment.placeholder='Indica cosa hai verificato e i limiti rimasti';comment.setAttribute('aria-label',request.visual?'Osservazioni revisione lettura visiva':'Osservazioni revisione wiki');confirm.type='checkbox';confirm.required=true;const label=node('label','Confermo di aver confrontato questa proposta con le fonti.');label.prepend(confirm);submit.type='submit';form.append(status,comment,label,submit);form.onsubmit=async event=>{event.preventDefault();try{await api(`/v1/tenants/${tenant.id}/brain/memory/${request.id}/review`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({status:status.value,comment:comment.value,confirmHumanReview:confirm.checked,expectedVersion:review?.version||0})});if(generation===session.generation)await renderDocumentMemory(area,generation);}catch(error){notify(error.message);}};card.append(form);}
 if(request.reviewHistory?.length)card.append(technicalDetails([['Storico revisioni',JSON.stringify(request.reviewHistory)]]));}
 if(request.errorCode)card.append(node('p',friendlyIssue(request.errorCode)),technicalDetails([['Diagnostica',request.errorCode]]));area.append(card);}
}

async function showEvidenceReference(ref){
 if(ref.origin!=='reviewed-model-transcription')return showFragments(session.docs.find(d=>d.id===ref.documentId),ref.fragmentId);
 const tenant=session.tenant,generation=session.generation;if(!tenant)return;
 const request=await api(`/v1/tenants/${tenant.id}/brain/memory/${ref.visualRequestId}`);if(generation!==session.generation)return;
 if(request.sourceState!=='current'||request.review?.status!=='approved'||request.review.version!==ref.visualReviewVersion)throw new Error('La trascrizione o la sua revisione è cambiata. Aggiorna i risultati.');
 const response=await api(`/v1/tenants/${tenant.id}/brain/memory/${ref.visualRequestId}/page`,{raw:true}),blob=await response.blob(),data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});if(generation!==session.generation)return;
 const block=request.visual.blocks.find(b=>b.id===ref.fragmentId),content=node('div',null,'runtime-source'),image=node('img');image.src=data;image.alt='Pagina originale per confronto con la trascrizione';image.style.maxWidth='100%';content.append(node('h3',ref.filename+' · '+locationLabel(ref.locator)),node('p','Trascrizione del modello rivista da una persona. Testo e posizione devono essere confrontati con l’originale.','source-warning'));if(block)content.append(node('p',block.text));content.append(image);text('pdfTitle',ref.filename);text('pdfKind','Confronto della trascrizione con l’originale');setModalOriginal();$('pdfPaper').replaceChildren(content);$('pdfModal').classList.add('visible');$('pdfModal').setAttribute('aria-hidden','false');
}


async function prepareLogin(){
 for(const id of ['gateClientLogin','gateAccountantLogin'])$(id).disabled=true;
 const response=await fetch('/v1/auth/config',{credentials:'same-origin'});if(!response.ok)throw new Error('Servizio di accesso non disponibile.');
 const config=await response.json();session.authMode=config.mode;
 text('accessModeLabel',config.mode==='development'?'Accesso locale di sviluppo':config.mode==='competition'?'Demo competizione · accesso protetto':'Accesso protetto');
 if(config.mode==='development'){for(const id of ['gateClientLogin','gateAccountantLogin'])$(id).disabled=false;text('loginMessage','Accesso locale di sviluppo; identità sintetiche.');return;}
 $('localProfile').hidden=config.mode!=='competition';document.querySelector('label[for="localProfile"]').hidden=config.mode!=='competition';
 $('competitionPasswordField').hidden=config.mode!=='competition';
 for(const id of ['simulateLoad','selectAllDocs'])text(id,'Seleziona tutti i documenti');
 for(const id of ['gateClientLogin','gateAccountantLogin'])$(id).disabled=!['oidc','competition'].includes(config.mode);
 text('loginMessage',config.mode==='competition'?'Demo della competizione: usa la password del profilo scelto. Solo documenti sintetici.':config.mode==='oidc'?'Accedi con la tua identità. I permessi sono verificati dal server.':'Accesso online non ancora configurato.');
 if(!['oidc','competition'].includes(config.mode))return;
 text('switchIdentity','Esci');
 const status=await fetch('/v1/auth/session',{credentials:'same-origin'});if(status.status===401)return;if(!status.ok)throw new Error('Sessione di accesso non disponibile.');
 const login=await status.json();session.online=true;session.csrf=login.csrfToken;
 await enterWorkspace('auto');
}
void prepareLogin().catch(error=>text('loginMessage',error.message));
