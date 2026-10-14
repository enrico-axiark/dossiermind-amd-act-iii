// Recover an ORIGINAL contiguous span. Only whitespace runs may differ; never
// alter words, punctuation, digits, ordering, or skip intervening source content.
export function originalQuotation(source,proposed,maxLength=1600){
 if(typeof source!=='string'||typeof proposed!=='string'||!proposed.trim()||proposed.length>maxLength||source.length>32000)return null;
 const exact=source.indexOf(proposed);
 if(exact>=0)return {quote:proposed,quotationMatch:'exact-original',originalSpan:[exact,exact+proposed.length]};
 const chars=[],spans=[];
 for(let i=0;i<source.length;){const start=i;if(/\s/u.test(source[i])){while(i<source.length&&/\s/u.test(source[i]))i++;chars.push(' ');spans.push([start,i]);}else{chars.push(source[i]);spans.push([i,i+1]);i++;}}
 const needle=proposed.replace(/\s+/gu,' ').trim(),index=chars.join('').indexOf(needle);
 if(index<0)return null;
 const start=spans[index][0],end=spans[index+needle.length-1][1],quote=source.slice(start,end);
 if(quote.length>maxLength)return null;
 return {quote,modelQuote:proposed,quotationMatch:'whitespace-only-original-span',originalSpan:[start,end]};
}
