import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dueAt, nextTick} from '../src/schedule.ts';

test('morning window runs every even minute',()=>{
  for(const minute of [0,2,10,58]) assert.equal(dueAt(5,minute),true);
  assert.equal(dueAt(9,58),true);
  assert.equal(dueAt(5,1),false);
  assert.equal(dueAt(9,57),false);
});

test('outside the morning window runs at :07 and :37 only',()=>{
  for(const hour of [0,4,10,23]) {
    assert.equal(dueAt(hour,7),true);assert.equal(dueAt(hour,37),true);
    assert.equal(dueAt(hour,0),false);assert.equal(dueAt(hour,30),false);
  }
});

test('nextTick always lands on the next policy minute',()=>{
  const cases:[number,number,number,number][]=[
    [4,36,4,37],[4,37,5,0],[4,38,5,0],[9,58,10,7],[10,6,10,7],[10,7,10,37],[23,37,0,7],[23,38,0,7],[5,1,5,2],
  ];
  for(const [hour,minute,nextHour,nextMinute] of cases){
    const from=new Date(2026,10,22,hour,minute,30);
    const next=nextTick(from);
    assert.equal(next.getHours(),nextHour,`from ${hour}:${minute}`);
    assert.equal(next.getMinutes(),nextMinute,`from ${hour}:${minute}`);
    assert.equal(next.getSeconds(),0);
    assert.ok(next.getTime()>from.getTime());
  }
});

test('nextTick from an exact due minute never repeats itself',()=>{
  const from=new Date(2026,10,22,5,0,0);
  assert.equal(nextTick(from).getMinutes()>=2,true);
});

test('policy stays within a bounded search window',()=>{
  let cursor=new Date(2026,10,22,0,0);
  for(let i=0;i<200;i++) cursor=nextTick(cursor);
  assert.ok(cursor.getTime()>new Date(2026,10,22,0,0).getTime());
});
