import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sqlLiteral,sqlValues} from '../frontend/table-copy.mjs';
test('SQL values quote text and dates, preserve numeric precision and NULL',()=>{
 assert.equal(sqlLiteral("O'Brien"),"'O''Brien'");assert.equal(sqlLiteral('001'),"'001'");assert.equal(sqlLiteral('2026-11-21'),"'2026-11-21'");
 assert.equal(sqlLiteral('9007199254740993',true),'9007199254740993');assert.equal(sqlLiteral(null),'NULL');assert.equal(sqlLiteral(true),'TRUE');assert.equal(sqlLiteral('1); DROP TABLE x',true),"'1); DROP TABLE x'");
 assert.equal(sqlValues([[{value:'Call'}],[{value:'Call'}],[{value:null}]]),"'Call', 'Call', NULL");
 assert.equal(sqlValues([[{value:'Call'},{value:42}],[{value:'Text'},{value:18}]]),"('Call', 42),\n('Text', 18)");
});
test('distinct SQL copy keeps first appearance and deduplicates complete rows',()=>{
 const rows=[[{value:'a'}],[{value:'a'}],[{value:null}],[{value:null}],[{value:1}],[{value:'1'}]];
 assert.equal(sqlValues(rows,{distinct:true}),"'a', NULL, 1, '1'");
 assert.equal(sqlValues([[{value:'a'},{value:1}],[{value:'a'},{value:2}],[{value:'a'},{value:1}]],{distinct:true}),"('a', 1),\n('a', 2)");
});
test('SQL header names are quoted and kept separate from distinct data rows',()=>{
 assert.equal(sqlValues([[{value:'a'}],[{value:'a'}]],{headers:['a'],distinct:true}),"'a', 'a'");
 assert.equal(sqlValues([[{value:'oak'},{value:1}]],{headers:["tree's name",'count']}),"('tree''s name', 'count'),\n('oak', 1)");
});
