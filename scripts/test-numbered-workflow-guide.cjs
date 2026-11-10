const assert=require('node:assert/strict'),fs=require('node:fs');
const {cameraFilters}=require('./lib/workflow-guide-recorder.cjs');
assert.deepEqual(cameraFilters([]),[],'Existing recorders keep their original encoding path');
const shot={number:1,start:2,end:8,x:500,y:450};
const filter=cameraFilters([shot])[1];
assert(filter.includes('cos(PI*'),'Smooth cosine transitions');
assert(filter.includes('.4*'),'Maximum editorial zoom 1.4x');
assert(filter.includes('crop=1920:830:0:70'),'Only middle band is zoomed; original top70 / bottom180 stay unscaled');
assert(filter.includes('[original][zoomed]overlay=0:70'),'Zoom cannot duplicate the numbered badge or subtitle');
assert(filter.includes('s=1920x830:fps=20'));assert(filter.includes('-70-ih/zoom/2'),'Camera Y converts from original viewport to middle band');
for(const invalid of [{...shot,x:2000},{...shot,y:930},{...shot,end:3},{...shot,number:0}])assert.throws(()=>cameraFilters([invalid]));
assert.throws(()=>cameraFilters([shot,{...shot,start:7,end:11}]),/continuity/);
if(process.argv.includes('--recorded')){
  const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json'));
  const guide=registry.workflows.find(w=>w.id==='customs-settlement-zip').guides[0];
  const proof=JSON.parse(fs.readFileSync('public'+guide.proof));
  assert.equal(proof.browserZoom,100);assert.equal(proof.fps,20);assert.equal(proof.productionWrites,0);
  assert.equal(proof.presentation.numberedSteps,4);assert.deepEqual(proof.presentation.cameraBand,{x:0,y:70,width:1920,height:830});cameraFilters(proof.presentation.focusShots);
  assert.deepEqual([...new Set(proof.presentation.focusShots.map(s=>s.number))],[1,2,3,4]);
  guide.chapters.forEach((c,i)=>assert(c.title.startsWith(`${i+1}. `)));
  const cues=fs.readFileSync('public'+guide.captions,'utf8').split(/\r?\n\r?\n/).slice(1).filter(Boolean);
  assert(cues.every(c=>/^\d\. /m.test(c)),'Every Korean cue carries its business-step number');
  assert.deepEqual([...new Set(cues.map(c=>Number(c.match(/^(\d)\. /m)[1])))],[1,2,3,4]);
  const seconds=value=>value.split(':').reduce((total,n)=>total*60+Number(n),0);
  for(const [number,text] of [[1,'정상 문서 1건'],[2,'2026년 34차 실제 원천이라는'],[3,'원천 등록 완료 2건'],[4,'다시 올려도 완료 2건']]){
    const cue=cues.find(c=>c.includes(text));assert(cue,`Result cue ${number}`);
    const resultAt=seconds(cue.split(' --> ')[0]);
    const shots=proof.presentation.focusShots.filter(s=>s.number===number);
    assert(resultAt>=shots.at(-1).end,`Step ${number} result must be read after full zoom-out, without stale target marking`);
  }
}
console.log('PASS optional camera / numbering / bounds / continuity / original caption and badge bands');
