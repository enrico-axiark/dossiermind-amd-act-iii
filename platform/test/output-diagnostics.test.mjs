import test from 'node:test';
import assert from 'node:assert/strict';
import {safeSchemaFailures} from '../src/output-diagnostics.mjs';
import {schemaIssues} from '../src/contracts.mjs';
const schema={type:'object',additionalProperties:false,required:['facts'],properties:{facts:{type:'array',items:{type:'object',additionalProperties:false,required:['quote'],properties:{quote:{type:'string',maxLength:4}}}}}};
test('rejection diagnostics identify server fields without retaining content or model-owned property names',()=>{
 const value={facts:[{quote:'private source text',privateCredential:'sensitive value'}],'private secret key':'private value'};
 const diagnostics=safeSchemaFailures(schemaIssues(value,schema),schema);
 assert.deepEqual(diagnostics,[{path:'$.facts[0].quote',kind:'too long'},{path:'$',kind:'additional property'},{path:'$',kind:'additional property'}]);
 assert(!JSON.stringify(diagnostics).includes('private'));
 assert.equal(safeSchemaFailures(Array(50).fill('$.facts: required'),schema).length,20);
 assert.deepEqual(safeSchemaFailures(['$.facts: private body'],schema),[{path:'$.facts',kind:'schema mismatch'}]);
});
