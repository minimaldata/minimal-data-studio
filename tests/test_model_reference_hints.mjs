import {test} from 'node:test';
import assert from 'node:assert/strict';
import {referencePrefix,referenceHints} from '../frontend/model-reference-hints.mjs';
const models=[{id:'a',reference:'costs',draft:{name:'Monthly costs',connection:'bq'},published:{}},{id:'b',reference:'sales',draft:{name:'Sales',connection:'bq'}},{id:'c',reference:'other',draft:{name:'Other',connection:'other'}}];
test('reference suggestions replace braces, use readable keys and distinguish drafts',()=>{
  const sql='SELECT * FROM {{ co }}';const cursor=sql.indexOf('co')+2;
  const hints=referenceHints(sql,cursor,models,'bq');
  assert.equal(hints.list[0].text,'{{ costs }}');assert.equal(hints.to,sql.length);
  assert.match(referenceHints('FROM {{ s',9,models,'bq').list[0].displayText,/publish first/);
  assert.equal(referenceHints('FROM {{',7,models,'bq','a').list.length,1);
});
test('references never suggest in comments or quoted strings',()=>{
  for(const sql of ['-- {{','# {{','/* {{',"SELECT '{{",'SELECT "{{','SELECT `{{',"SELECT '''{{",'SELECT r"{{'])assert.equal(referencePrefix(sql),null,sql);
  assert.equal(referencePrefix('SELECT 1'),null);
  assert.ok(referencePrefix('-- ignored\nFROM {{'));
  assert.equal(referencePrefix('FROM {{ costs }}'),null);
});
