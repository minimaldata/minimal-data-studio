import test from 'node:test';
import assert from 'node:assert/strict';
import {cohortGroups,canGroupCohorts,resolveSeriesKind} from '../frontend/line-series.mjs';
test('calendar selection groups retain each original member and index',()=>{
 const dates=['2024-01-01','2024-01-02','2024-03-31','2024-04-01','2025-01-01'];
 assert.equal(canGroupCohorts(dates),true);
 assert.deepEqual(cohortGroups(dates,'quarter').map(g=>[g.label,g.members.length]),[['2024 Q1',3],['2024 Q2',1],['2025 Q1',1]]);
 assert.deepEqual(cohortGroups(dates,'month')[0],{label:'2024-01',members:dates.slice(0,2),indices:[0,1]});
 assert.deepEqual(cohortGroups(dates,'year').flatMap(g=>g.members),dates);
 assert.equal(cohortGroups(dates).length,5);
});
test('non-date and invalid date series do not offer calendar grouping',()=>{
 for(const dates of [[],['A','B'],['2024-01','Other'],['2024-13'],['2025-02-29']])assert.equal(canGroupCohorts(dates),false);
 assert.equal(canGroupCohorts(['2024-02-29']),true);
 assert.deepEqual(cohortGroups(['A','B'],'year').map(g=>g.label),['A','B']);
});

test('explicit series meaning overrides automatic date detection',()=>{
 assert.equal(resolveSeriesKind('auto',['2024-01']),'cohorts');
 assert.equal(resolveSeriesKind('series',['2024-01']),'series');
 assert.equal(resolveSeriesKind('cohorts',['Launch A']),'cohorts');
 assert.equal(resolveSeriesKind(undefined,['A']),'series');
});
