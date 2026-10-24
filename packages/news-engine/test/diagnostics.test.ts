import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validate} from '../src/model.ts';
import {validateReview} from '../src/quality.ts';
import {errorCode,requestConstraints} from '../src/diagnostics.ts';
const cases=JSON.parse(readFileSync(new URL('./fixtures/validation-20261024.json',import.meta.url),'utf8'));
test('40 saved invalid responses reproduce first validation error using minimized public evidence excerpts',()=>{
 assert.equal(cases.length,40);
 for(const row of cases)assert.throws(()=>row.article.task_kind==='review'?validateReview(structuredClone(row.result),row.article):validate(structuredClone(row.result),row.article),e=>e instanceof Error&&e.message===row.expected,'call '+row.case);
});
test('controlled diagnostics never expose arbitrary exception text; both summaries and strict body provenance are explicit',()=>{
 assert.equal(errorCode(new Error('secret-token-value')),'response_validation_failed');
 assert.equal(errorCode(new SyntaxError('secret')),'invalid_json_response');
 assert.equal(errorCode(new Error('unsupported evidence')),'unsupported_evidence');
 const c=requestConstraints({},'unsupported_evidence');assert.match(c.summary,/150/);assert.match(c.short_summary,/80/);assert.match(c.evidence,/text/);assert.equal(c.previous_error,'unsupported_evidence');
});
