import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readPersonalHome,mutatePersonalHome,personalHomeTasks} from '../lib/personalHomeStore.js';

test('monthly tasks use the last day in short months and retain year boundaries',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nenova-monthly-'));
  try{
    await mutatePersonalHome('owner',{action:'create',requestId:'monthly-0001',expectedRevision:0,date:'2024-01-31',startDate:'2024-01-31',title:'월말 확인',frequency:'monthly',weekdays:[]},{root,now:()=>new Date('2024-01-31T00:00:00Z')});
    const record=await readPersonalHome('owner',{root});
    for(const [date,expected] of [['2024-01-31','2024-01-31'],['2024-02-29','2024-02-29'],['2024-03-31','2024-03-31'],['2025-02-28','2025-02-28']]){
      const tasks=personalHomeTasks(record,date,{limit:100}).tasks;
      assert.ok(tasks.some(task=>task.occurrenceDate===expected&&task.frequency==='monthly'&&task.monthDay===31),date);
    }
    assert.equal(personalHomeTasks(record,'2024-02-28').tasks.some(task=>task.occurrenceDate==='2024-02-28'),false);
    assert.equal(personalHomeTasks(record,'2025-02-28').totalTasks,14);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
