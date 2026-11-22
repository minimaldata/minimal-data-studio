import test from 'node:test';import assert from 'node:assert/strict';import {lineSettings,legendStyle} from '../frontend/line-settings.mjs';
test('meaning and count choose defaults but explicit legend and hover settings are independent',()=>{
 assert.deepEqual(lineSettings({},2),{legend:'inline',hover:'all'});assert.deepEqual(lineSettings({},48),{legend:'list',hover:'selected'});
 for(const n of [1,2,48]){assert.deepEqual(lineSettings({seriesLegend:'strip',hoverBehavior:'all'},n),{legend:'strip',hover:'all'});assert.deepEqual(lineSettings({seriesLegend:'inline',hoverBehavior:'selected'},n),{legend:'inline',hover:'selected'});}
 assert.deepEqual(lineSettings({seriesLegend:'invalid',hoverBehavior:'auto'},2),{legend:'inline',hover:'all'});
});

test('shared legend defaults distinguish nominal series from ordered cohorts',()=>{
 for(const type of ['line','bar','stacked','percent']){
  assert.equal(legendStyle({type},['Agent 01']),'inline');
  assert.equal(legendStyle({type},['Call','Text','Email','Meeting']),'inline');
  assert.equal(legendStyle({type},Array.from({length:30},(_,i)=>`Agent ${i}`)),'list');
  for(const dates of [['2025-01','2025-02'],['2025','2026'],['2025 Q1','2025 Q2']])assert.equal(legendStyle({type},dates),'strip');
  assert.equal(legendStyle({type,seriesKind:'series'},['2025-01','2025-02']),'inline');
  assert.equal(legendStyle({type,seriesKind:'cohorts'},['Early','Late']),'strip');
  for(const style of ['inline','list','strip'])assert.equal(legendStyle({type,seriesLegend:style},['Call','Text']),style);
 }
});
