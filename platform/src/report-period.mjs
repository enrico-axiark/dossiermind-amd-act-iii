import {assert} from './errors.mjs';
export const periodReportKinds=new Set(['pmi_period_dossier','private_period_summary']);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
// The reporting period is an attributed human selection, not inferred chronology.
export function periodSelection(input,documents){
 assert(validDate(input.periodStart)&&validDate(input.periodEnd)&&input.periodStart<=input.periodEnd,400,'report_period_invalid','Choose a valid explicit period');
 assert(input.confirmPeriodSelection===true,400,'report_period_confirmation_required','Confirm the period and document selection');
 assert(Array.isArray(input.documentIds)&&input.documentIds.length>=1&&input.documentIds.length<=200&&input.documentIds.every(id=>typeof id==='string')&&new Set(input.documentIds).size===input.documentIds.length,400,'report_documents_required','Select distinct documents');
 const selected=new Set(input.documentIds);assert(input.documentIds.every(id=>documents.some(doc=>doc.id===id)),400,'report_source_unavailable','Selected source unavailable in this client');
 return {period:{start:input.periodStart,end:input.periodEnd,basis:'human-selected-document-scope',datesAutomaticallyVerified:false},documents:documents.filter(doc=>selected.has(doc.id)),selected};
}
