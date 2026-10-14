"""Offline document dossier renderer. No network, external files, or model calls."""
import io,json,sys,os
from xml.sax.saxutils import escape
from datetime import datetime
from zoneinfo import ZoneInfo
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,KeepTogether
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import reportlab

payload=json.loads(sys.stdin.buffer.read(4*1024*1024+1))
fontpath=os.path.join(os.path.dirname(reportlab.__file__),'fonts','Vera.ttf')
pdfmetrics.registerFont(TTFont('Dossier',fontpath))
font=pdfmetrics.getFont('Dossier').face.charToGlyph
unsupported=False
def safe(value):
 global unsupported
 value=str(value)
 chars=[]
 for c in value:
  if c in '\n\t' or ord(c) in font:chars.append(c)
  else:chars.append('[?]');unsupported=True
 return escape(''.join(chars)).replace('\n','<br/>')
def euro(amount):
 value=int(amount['cents']);absolute=abs(value)
 return ('-' if value<0 else '')+f'{absolute//100:,}'.replace(',','.')+','+f'{absolute%100:02d}'+' EUR'
styles=getSampleStyleSheet()
for style in styles.byName.values():style.fontName='Dossier'
styles.add(ParagraphStyle(name='Brand',fontName='Dossier',fontSize=10,textColor=colors.HexColor('#147c78'),spaceAfter=14))
styles['Title'].textColor=colors.HexColor('#173347');styles['Title'].fontSize=23;styles['Title'].leading=29
styles['BodyText'].fontSize=9;styles['BodyText'].leading=14;styles['BodyText'].spaceAfter=8
styles['Heading2'].textColor=colors.HexColor('#173347');styles['Heading2'].spaceBefore=16
story=[]
def p(text,style='BodyText'):return Paragraph(safe(text),styles[style])
status={'extracted':'Testo estratto','needs_vision':'Lettura visiva necessaria','not_processed':'Da elaborare'}
created=datetime.fromisoformat(payload['createdAt'].replace('Z','+00:00')).astimezone(ZoneInfo('Europe/Rome')).strftime('%d/%m/%Y %H:%M (ora italiana)')
missing_report=payload.get('kind','document_dossier') in ['pmi_missing_documents','private_missing_documents']
brief_report=payload.get('kind') in ['pmi_studio_brief','private_professional_brief']
story += [p('DOSSIERMIND / '+payload.get('reportTitle','Dossier documentale').upper(),'Brand'),p(payload['clientName'],'Title'),p(f"Versione {payload['version']} | Generato il {created}")]
if payload.get('generatedBy'):story.append(p('Richiesto da: '+payload['generatedBy']))
if payload.get('period'):
 period=payload['period']
 story += [p('Periodo scelto: '+period['start']+' - '+period['end']),p('Dossier delle sole fonti selezionate per questo periodo. La selezione è confermata da una persona: le date interne dei documenti non sono state automaticamente assegnate o verificate. Non attesta la completezza del periodo.'),p('Gli importi di banca, fatture e ricevute non vengono sommati insieme: possono riferirsi allo stesso evento. I calcoli dell’archivio non sono inclusi senza una verifica specifica del loro periodo.'),p('Note e osservazioni sono incluse solo se tutte le fonti collegate sono selezionate. Il loro contesto dichiarato resta visibile e può differire dal periodo del report.'),p('Stato delle fonti selezionate','Heading2')]
 excluded=payload.get('excludedContributions',{})
 if excluded.get('notes',0) or excluded.get('assertions',0):story.append(p(f"Contributi esclusi per fonti esterne alla selezione: {excluded.get('notes',0)} note e {excluded.get('assertions',0)} affermazioni."))
elif payload.get('advisor'):
 story.append(p('Analisi derivata dal dossier: citazioni, calcoli e proposte sono distinti. La revisione umana non misura l’accuratezza del modello.'))
elif missing_report:
 story.append(p('Situazione dei requisiti esplicitamente concordati per il periodo della checklist selezionata. Non è una verifica normativa o una valutazione AI. La ricezione di un documento non ne dimostra la correttezza o la completezza.'))
elif brief_report:
 story += [p('Brief operativo composto dalle richieste concordate e dai contributi presenti nell’archivio. Non contiene un parere AI o professionale. Il periodo è quello dichiarato nella checklist: note, calcoli e documenti non sono stati automaticamente assegnati a quel periodo.'),p('Stato dei documenti','Heading2')]
else:
 story += [p('Fotografia dell’archivio al momento della generazione. Contiene fonti e contributi umani; non è una valutazione AI, fiscale o di business. Le date di periodo nei documenti non sono state verificate.'),p('Stato dei documenti','Heading2')]
for d in ([] if missing_report else sorted(payload['documents'],key=lambda d:d['filename'])):
 state=status.get(d['extractionStatus'] or 'not_processed','Esito da verificare')
 count=d['fragmentCount'] or 0
 block=[p(d['filename'],'Heading3'),p(f"{state} | {count} "+('passaggio disponibile' if count==1 else 'passaggi disponibili'))]
 if d['warnings']:block.append(p('Sono presenti avvisi di elaborazione: consultarli nell’app prima di usare il contenuto.'))
 story.append(KeepTogether(block))
if not missing_report and not payload.get('financial') and not payload.get('advisor'):
 story.append(p('Note condivise e fonti','Heading2'))
 if not payload['notes']:story.append(p('Nessuna nota condivisa disponibile.'))
for note in ([] if missing_report else payload['notes']):
 story += [p(note['title'],'Heading3'),p(f"Versione {note['version']} | Autore: {note['authorName']} | Contributo da verificare"),p(note['text'])]
 for ref in note['references']:
  loc=ref['locator'];parts=[]
  for key,label in [('attachment','Allegato'),('page','Pagina'),('row','Riga'),('sheet','Foglio'),('cell','Cella'),('part','Parte email'),('xml_path','Campo XML')]:
   if key in loc:parts.append(f"{label} {loc[key]}")
  story.append(p('Fonte: '+ref['filename']+' | '+' | '.join(parts)))
if payload.get('assertions') and not missing_report:
 story.append(p('Affermazioni e revisioni umane','Heading2'))
 story.append(p('Contributi attribuiti, non prove indipendenti rispetto agli originali citati. Una conferma umana non misura l’accuratezza AI e non sostituisce un parere professionale. Le possibili differenze sono segnalate solo nel medesimo contesto dichiarato.'))
 labels={'proposed':'Da verificare','verified':'Confermata da una persona','rejected':'Rifiutata nella revisione','needs_review':'Fonte cambiata, da rivedere','conflicted':'Possibile differenza da verificare'}
 for item in payload['assertions']:
  a=item['assertion']
  story += [p(a['subject_ref']+' | '+a['predicate'],'Heading3'),p(a['value']),p('Contesto dichiarato: '+item['context']),p(f"Versione {item['version']} | Autore: {item['authorName']} | "+labels[item['effectiveStatus']])]
  if item['effectiveStatus']!=a['status']:story.append(p('Esito registrato nella revisione: '+labels[a['status']]))
  if item['sourceState']=='stale':story.append(p('La fonte è cambiata: la conferma precedente richiede una nuova revisione.'))
  for other_id in item['possibleConflicts']:
   other=next((entry for entry in payload['assertions'] if entry['id']==other_id),None)
   if other:story.append(p('Valore da confrontare: '+other['assertion']['value']+' | Autore: '+other['authorName']))
  for ref in item['references']:
   loc=ref['locator'];parts=[]
   for key,label in [('attachment','Allegato'),('page','Pagina'),('row','Riga'),('sheet','Foglio'),('cell','Cella'),('part','Parte email'),('xml_path','Campo XML')]:
    if key in loc:parts.append(f"{label} {loc[key]}")
   story.append(p('Fonte: '+ref['filename']+' | '+' | '.join(parts)))
if payload.get('financial'):
 table=payload['financial']
 story.append(p('Registro selezionato e calcoli','Heading2'))
 story.append(p('Fonte: '+table['source']['filename']+' | Righe '+str(table['firstRow'])+' - '+str(table['lastRow'])+((' | Foglio '+table['sheet']) if table.get('sheet') else '')))
 story.append(p('Somma delle sole righe selezionate: '+euro(table['total'])))
 story.append(p('Importi positivi in euro e convenzione numerica confermati. Il periodo del registro è dichiarato dall’utente, non ricavato da date di riga. Ricevute originali, pagamento, deducibilità e completezza non sono verificati automaticamente. Non sommare nuovamente questi importi ai movimenti bancari.'))
 for entry in table['entries']:
  block=[p(entry['description'],'Heading3'),p('Riferimento dichiarato: '+entry['id']+' | Importo: '+euro(entry['amount']))]
  for ref in entry['references']:
   loc=ref['locator'];location=('Foglio '+str(loc.get('sheet'))+' | Cella '+str(loc.get('cell'))) if 'cell' in loc else 'Riga '+str(loc.get('row'))
   label={'id':'Riferimento','description':'Descrizione','amount':'Importo'}[ref['field']]
   block.append(p(label+': '+ref['filename']+' | '+location))
  story.append(KeepTogether(block))
 if payload.get('reconciliation'):
  result=payload['reconciliation'];labels={'identifier_amount_candidate':'Identificativo e importo corrispondenti, da verificare','amount_or_direction_difference':'Differenza di importo o direzione, da verificare','no_matching_identifier':'Nessun identificativo corrispondente nel periodo'}
  story.append(p('Confronto con i movimenti bancari','Heading2'))
  story.append(p('Criterio: stesso identificativo dichiarato e importo uguale all’uscita bancaria, senza entrata nella stessa riga. Questi abbinamenti non sono una prova di pagamento e non riconciliano automaticamente controparti o numeri fattura. Le due fonti non vengono sommate.'))
  story.append(p('Abbinamenti candidati: '+str(result['candidateCount'])))
  if result['bankStatus']=='balance_discrepancies':story.append(p('Il CSV bancario presenta differenze nei saldi: verificarle prima di usare il confronto.'))
  for entry in result['entries']:
   block=[p(entry['description'],'Heading3'),p(labels[entry['match']])]
   if entry['bankReference']:
    block.append(p('Data bancaria: '+entry['bankDate']+' | Uscita: '+euro(entry['bankDebit'])+' | Entrata: '+euro(entry['bankCredit'])))
    block.append(p('Fonte bancaria: '+next(d['filename'] for d in payload['documents'] if d['id']==entry['bankReference']['documentId'])+' | Riga '+str(entry['bankReference']['locator'].get('row'))))
   story.append(KeepTogether(block))
  if result['unmatchedBank']:
   story.append(p('Movimenti bancari senza corrispondenza nel registro selezionato','Heading3'))
   for entry in result['unmatchedBank']:story.append(p(entry['date']+' | '+entry['description']+' | Uscita '+euro(entry['debit'])+' | Entrata '+euro(entry['credit'])+' | Riga '+str(entry['reference']['locator'].get('row'))))
if payload.get('checklists'):
 story.append(p('Requisiti espliciti e documenti mancanti','Heading2'))
 story.append(p('Checklist definita dal cliente o dallo studio. Non implica completezza fiscale o normativa. Ricevuto significa evidenza collegata; verificato indica una conferma umana attribuita.'))
 labels={'missing':'Mancante','received':'Ricevuto, da verificare','reviewed':'Verificato da un utente','needs_review':'Fonte cambiata, da verificare'}
 for checklist in payload['checklists']:
  story += [p(checklist['title'],'Heading3'),p('Periodo richiesto: '+checklist['periodStart']+' - '+checklist['periodEnd']),p(f"Versione {checklist['version']} | Autore: {checklist['authorName']}")]
  counts=checklist['counts'];story.append(p(f"Mancanti: {counts['missing']} | Ricevuti da verificare: {counts['received']} | Verificati da utenti: {counts['reviewed']} | Fonti cambiate: {counts['needs_review']}"))
  for item in sorted(checklist['items'],key=lambda item:['missing','needs_review','received','reviewed'].index(item['status'])):
   story.append(p(item['requirement']+' | '+labels[item['status']]))
   if item.get('reviewedBy'):story.append(p('Verifica registrata dall’utente: '+item.get('reviewerName','Utente autorizzato')))
   for ref in item['references']:
    loc=ref['locator'];parts=[]
    for key,label in [('attachment','Allegato'),('page','Pagina'),('row','Riga'),('sheet','Foglio'),('cell','Cella'),('part','Parte email'),('xml_path','Campo XML')]:
     if key in loc:parts.append(f"{label} {loc[key]}")
    story.append(p('Fonte: '+ref['filename']+' | '+(' | '.join(parts) or 'Passaggio originale collegato')))
if brief_report:
 story.append(p('Primi passi di verifica','Heading2'))
 for checklist in payload['checklists']:
  for item in checklist['items']:
   if item['status']=='missing':action='Richiedere il documento o l’evidenza concordata.'
   elif item['status']=='received':action='Esaminare i passaggi collegati e registrare l’esito della verifica umana.'
   elif item['status']=='needs_review':action='Riaprire l’originale aggiornato e ripetere la verifica.'
   else:action='Consultare la verifica attribuita e la sua fonte; non estenderla a requisiti diversi.'
   story.append(p(item['requirement']+': '+action))
 story.append(p('Non sono stati calcolati benefici economici per queste azioni. Eventuali vantaggi richiedono ipotesi esplicite e verifiche aggiuntive.'))
if payload.get('calculations') and not missing_report:
 story.append(p('Calcoli salvati con fonti','Heading2'))
 for item in payload['calculations']:
  result=item['result'];totals=result['totals']
  story += [p(result['source']['filename'],'Heading3'),p(f"Versione {item['version']} | Autore: {item['authorName']} | Ipotesi da verificare"),p('Calcolo condizionato sulle sole righe del CSV. Non riconcilia fatture e non dimostra la completezza del periodo.')]
  for label,key in [('Entrate','credit'),('Uscite','debit'),('Differenza entrate - uscite','net'),('Saldo finale riportato','closingObserved')]:
   story.append(p(label+': '+euro(totals[key])))
  story.append(p('Saldo iniziale ricostruito dalla prima riga: '+euro(result['opening'])))
  story.append(p('Date osservate: '+result['dateRange']['first']+' - '+result['dateRange']['last']))
  story.append(p('Colonne confermate: '+', '.join(result['columns'].values())+'. Importi in euro, saldo successivo al movimento.'))
  loc=result['opening']['reference']['locator'];story.append(p('Fonte del saldo iniziale ricostruito: '+result['source']['filename']+' | Riga '+str(loc.get('row','da consultare'))))
  if result['discrepancyCount']:
   story.append(p(str(result['discrepancyCount'])+' differenze di saldo da verificare.'))
   for difference in result['discrepancies']:story.append(p('Riga '+str(difference['reference']['locator'].get('row'))+': saldo riportato '+euro(difference['observed'])+', calcolato '+euro(difference['expected'])))
  story.append(p('Il calcolo non è una prova indipendente rispetto al CSV da cui deriva. Consulta le righe originali nell’app.'))
if payload.get('advisor'):
 advisor=payload['advisor'];answer=advisor['answer']
 story += [p('Domanda e contesto','Heading2'),p(advisor['question']),p(advisor.get('context') or 'Nessun contesto aggiuntivo dichiarato.')]
 if advisor.get('period'):story.append(p('Periodo dichiarato: '+advisor['period']['start']+' - '+advisor['period']['end']+'. Copertura dei documenti non certificata.'))
 story.append(p('RISPOSTA DI FIXTURE PER COLLAUDO: nessuna inferenza AMD o AI reale.' if answer.get('metadata',{}).get('fixture') else 'Proposta prodotta tramite modello configurato; prova hardware AMD distinta.' if answer.get('aiExecuted') else 'Astensione senza inferenza: nessuna fonte pertinente recuperata.'))
 if answer.get('metadata',{}).get('localRevalidation'):
  story.append(p('Risposta AMD gia ricevuta e ricontrollata localmente dopo una correzione dei controlli. Nessuna nuova chiamata al modello.'))
 if answer.get('discardedProposals'):
  story.append(p(str(len(answer['discardedProposals']))+' proposte numeriche del modello escluse: importi consultabili nelle citazioni originali, nessun beneficio calcolato.'))
 story.append(p('Citazioni e fonti','Heading2'))
 def reference(ref):
  loc=ref.get('locator',{});parts=[]
  for key,label in [('attachment','Allegato'),('page','Pagina'),('row','Riga'),('sheet','Foglio'),('cell','Cella'),('part','Parte email'),('xml_path','Campo XML')]:
   if key in loc:parts.append(label+' '+str(loc[key]))
  return 'Fonte: '+ref['filename']+' | '+' | '.join(parts)
 if not answer.get('facts'):story.append(p('Nessuna citazione proposta.'))
 for fact in answer.get('facts',[]):
  quote=fact['quote']
  try:
   fields=json.loads(quote)
   if isinstance(fields,dict) and all(isinstance(v,(str,int,float,bool)) or v is None for v in fields.values()):
    labels={'description':'Descrizione','amount':'Importo','date':'Data','id':'Identificativo','debit':'Uscita','credit':'Entrata','balance':'Saldo'}
    quote=' | '.join(labels.get(k,k)+': '+str(v) for k,v in fields.items())
  except (ValueError,TypeError):pass
  story.append(KeepTogether(([p('Trascrizione del modello rivista: testo e posizione possono contenere errori.')] if fact['reference'].get('origin')=='reviewed-model-transcription' else [])+[p(quote),p(reference(fact['reference']))]))
 for key,title in [('interpretations','Interpretazioni da verificare'),('recommendations','Suggerimenti da verificare'),('scenarios','Scenari ipotetici'),('missingInformation','Informazioni mancanti')]:
  if answer.get(key):
   story.append(p(title,'Heading2'))
   for item in answer[key]:
    if isinstance(item,str):story.append(p(item))
    else:
     refs=[reference(f['reference']) for f in answer.get('facts',[]) if f['evidenceId'] in item['evidenceIds']]
     story.append(p(item['text']))
     if key=='recommendations':
      if not item.get('observedProblem'):story.append(p('Suggerimento storico senza dettagli strutturati: riesaminare prima dell’uso.'))
      else:
       for field,label in [('observedProblem','Problema da verificare'),('action','Azione proposta'),('expectedBenefit','Beneficio atteso - non quantificato'),('assumptions','Ipotesi'),('risks','Rischi'),('firstVerification','Prima verifica')]:
        value=item[field];story.append(p(label+': '+(' | '.join(value) if isinstance(value,list) else value)))
     story += [p(ref) for ref in dict.fromkeys(refs)]
 for calc in advisor.get('calculations',[]):
  result=calc['summary'];totals=result['totals'];story += [p('Calcolo deterministico - '+result['source']['filename'],'Heading2'),p('Versione '+str(calc['version'])+'. Una sola fonte, colonne e convenzioni dichiarate. Non certifica completezza del periodo, pagamento o deducibilità.')]
  for label,key in [('Entrate','credit'),('Uscite','debit'),('Saldo osservato','closingObserved')]:story.append(p(label+': '+euro(totals[key])))
  story.append(p('Date osservate: '+result['dateRange']['first']+' - '+result['dateRange']['last']))
  for ref in result.get('sourceReferences',[]):story.append(p(reference(ref)))
  if result.get('referencesTruncated'):story.append(p('Elenco riferimenti parziale; consulta il calcolo completo nell’app.'))
 for contribution in advisor.get('contributions',[]):
  content=contribution['content'];story += [p(('Wiki derivata rivista - ' if contribution['kind']=='wiki' else 'Contributo attribuito - ')+(content.get('title') or content.get('subject','Affermazione')),'Heading2'),p('Versione '+str(contribution['version'])+' - contesto attribuito, non fonte indipendente.')]
  if contribution['kind']=='note':story += [p('Autore: '+content['authorName']),p(content['text'])]
  elif contribution['kind']=='assertion':story += [p('Autore: '+content['authorName']),p(content['predicate']+': '+content['value']),p('Contesto: '+content['context'])]
  elif contribution['kind']=='wiki':
   story.append(p('Proposta del modello rivista da '+content['review']['authorName']+'. Non è una fonte indipendente o una misura di verità.'))
   for fact in content['facts']:story.append(p(fact['text']))
  else:
   for item in content['items']:story.append(p(item['requirement']+' - '+item['status']))
  for ref in contribution['references']:story.append(p(reference(ref)))
 review_block=[p('Revisione umana','Heading2')]
 review=advisor.get('review')
 if not review:review_block.append(p('Nessuna revisione registrata. Le proposte richiedono controllo umano.'))
 else:
  label={'approved':'Approvata dalla persona','rejected':'Respinta dalla persona','needs_review':'Da riesaminare'}[review['status']]
  review_block += [p(label+' - '+review['authorName']+' - versione '+str(review['version'])),p('Registrata il '+datetime.fromisoformat(review['createdAt'].replace('Z','+00:00')).astimezone(ZoneInfo('Europe/Rome')).strftime('%d/%m/%Y %H:%M (ora italiana)')),p(review['comment'])]
 review_block.append(p('Le citazioni corrispondono al testo estratto o alla trascrizione rivista indicata. Ciò non verifica la lettura visiva, la verità dei documenti o il sostegno delle conclusioni.'))
 story.append(KeepTogether(review_block))
if unsupported:story.append(p('I simboli non rappresentabili nel carattere del PDF sono indicati con [?]. Il testo originale resta nell’app.'))
output=io.BytesIO()
def footer(canvas,doc):
 canvas.setStrokeColor(colors.HexColor('#dce6eb'));canvas.line(42,40,A4[0]-42,40)
 canvas.setFont('Dossier',8);canvas.setFillColor(colors.HexColor('#536777'));canvas.drawString(42,26,'DossierMind | Documento derivato, fonti conservate nell’app');canvas.drawRightString(A4[0]-42,26,str(doc.page))
SimpleDocTemplate(output,pagesize=A4,rightMargin=42,leftMargin=42,topMargin=42,bottomMargin=54,title=payload.get('reportTitle','Dossier documentale'),author='DossierMind').build(story,onFirstPage=footer,onLaterPages=footer)
sys.stdout.buffer.write(output.getvalue())
