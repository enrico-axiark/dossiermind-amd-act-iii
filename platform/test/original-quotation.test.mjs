import test from 'node:test';
import assert from 'node:assert/strict';
import {originalQuotation} from '../src/original-quotation.mjs';
test('PDF line-wrap differences recover exact original text and span without changing amounts',()=>{
 const original='Telefonia: EUR 70.00 al mese.\nPalestra: EUR 40.00 al mese.';
 const found=originalQuotation(original,'Telefonia: EUR 70.00 al mese. Palestra: EUR 40.00 al mese.');
 assert.equal(found.quote,original);assert.equal(original.slice(...found.originalSpan),found.quote);assert.equal(found.quotationMatch,'whitespace-only-original-span');assert.ok(found.modelQuote.includes('70.00'));
 assert.equal(originalQuotation(original,'Palestra: EUR 40.00 al mese.').quotationMatch,'exact-original');
});
test('whitespace matching never joins nonadjacent claims or changes symbols, numbers or word boundaries',()=>{
 const original='Alpha 10.00\nIntervening statement\nBeta 20.00';
 for(const quote of ['Alpha 10.00 Beta 20.00','Alpha 10.01','Beta 20,00','Alpha10.00'])assert.equal(originalQuotation(original,quote),null);
 assert.equal(originalQuotation('Amount 1 000','Amount 1000'),null);assert.equal(originalQuotation('Alpha\nBeta','   '),null);
 assert.equal(originalQuotation('A\n'.repeat(1000),'A '.repeat(1000),100),null);
});
