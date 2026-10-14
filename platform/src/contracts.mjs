import {readFileSync} from 'node:fs';
export const derivedArtifactSchema=JSON.parse(readFileSync(new URL('../brain/schemas/derived-artifact.schema.json',import.meta.url)));
// Validate the schema keywords used by the versioned Brain Contract. Unknown
// keywords fail closed rather than claiming general JSON Schema compliance.
export function schemaIssues(value,schema,path='$'){
 const issues=[],supported=new Set(['$schema','$id','title','description','type','additionalProperties','required','properties','enum','const','minLength','maxLength','pattern','format','minimum','maximum','minItems','maxItems','uniqueItems','items']);
 for(const key of Object.keys(schema))if(!supported.has(key))issues.push(`${path}: unsupported schema keyword ${key}`);
 const type=v=>v===null?'null':Array.isArray(v)?'array':typeof v==='object'?'object':typeof v;
 const matches=t=>t==='integer'?typeof value==='number'&&Number.isInteger(value):t==='number'?typeof value==='number'&&Number.isFinite(value):type(value)===t;
 if(schema.type&&!(Array.isArray(schema.type)?schema.type:[schema.type]).some(matches))return [...issues,`${path}: type mismatch`];
 if(Object.hasOwn(schema,'const')&&JSON.stringify(value)!==JSON.stringify(schema.const))issues.push(`${path}: const mismatch`);
 if(schema.enum&&!schema.enum.some(v=>JSON.stringify(v)===JSON.stringify(value)))issues.push(`${path}: enum mismatch`);
 if(typeof value==='string'){
  if(schema.minLength!=null&&value.length<schema.minLength)issues.push(`${path}: too short`);
  if(schema.maxLength!=null&&value.length>schema.maxLength)issues.push(`${path}: too long`);
  if(schema.pattern&&!new RegExp(schema.pattern).test(value))issues.push(`${path}: pattern mismatch`);
  if(schema.format==='date-time'&&(!/^\d{4}-\d{2}-\d{2}T/.test(value)||Number.isNaN(Date.parse(value))))issues.push(`${path}: invalid date-time`);
  if(schema.format&&schema.format!=='date-time')issues.push(`${path}: unsupported format`);
 }
 if(typeof value==='number'){
  if(schema.minimum!=null&&value<schema.minimum)issues.push(`${path}: below minimum`);
  if(schema.maximum!=null&&value>schema.maximum)issues.push(`${path}: above maximum`);
 }
 if(Array.isArray(value)){
  if(schema.minItems!=null&&value.length<schema.minItems)issues.push(`${path}: too few items`);
  if(schema.maxItems!=null&&value.length>schema.maxItems)issues.push(`${path}: too many items`);
  if(schema.uniqueItems&&new Set(value.map(v=>JSON.stringify(v))).size!==value.length)issues.push(`${path}: duplicate items`);
  if(schema.items)value.forEach((v,i)=>issues.push(...schemaIssues(v,schema.items,`${path}[${i}]`)));
 }
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  for(const key of schema.required||[])if(!Object.hasOwn(value,key))issues.push(`${path}.${key}: required`);
  for(const [key,v] of Object.entries(value)){
   if(schema.properties?.[key])issues.push(...schemaIssues(v,schema.properties[key],`${path}.${key}`));
   else if(schema.additionalProperties===false)issues.push(`${path}.${key}: additional property`);
   else if(schema.additionalProperties&&typeof schema.additionalProperties==='object')issues.push(...schemaIssues(v,schema.additionalProperties,`${path}.${key}`));
  }
 }
 return issues;
}

export const knowledgeAssertionSchema=JSON.parse(readFileSync(new URL('../brain/schemas/knowledge-assertion.v1.1.schema.json',import.meta.url)));
export function assertionIssues(value){
 const issues=schemaIssues(value,knowledgeAssertionSchema);
 if(value?.confidence_basis==='not_measured'&&value.confidence!==null)issues.push('confidence must be null when not measured');
 if(value?.confidence_basis==='evaluated'&&(typeof value.confidence!=='number'||!Number.isFinite(value.confidence)))issues.push('evaluated confidence must be numeric');
 return issues;
}
