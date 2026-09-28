import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { buildPivotModel, filterRows, pivotModelToAoA } from '../lib/pivotExeModel.js';
import { calculatePivotResult, startPivotCalculation } from '../lib/pivotExeCalculation.js';

const rows=[
  {OrderYear:2025,OrderWeek:'01-01',ProdName:'Rose',Quantity:7,DistCost:12,ListType:'03. 입고'},
  {OrderYear:2026,OrderWeek:'01-01',ProdName:'Rose',Quantity:2,DistCost:100,ListType:'03. 입고'},
  {OrderYear:2026,OrderWeek:'01-02',ProdName:'Rose',Quantity:3,DistCost:200,ListType:'03. 입고'},
  {OrderYear:2026,OrderWeek:'01-02',ProdName:'Blue',Quantity:0,ListType:'05. 현재고'},
];
const options={layout:{row:['ProdName'],column:['OrderYear','OrderWeek'],data:['Quantity','DistCost']},weekGrouping:'main'};
for(const extra of [{},{fieldFilters:{OrderYear:[2026]}},{fieldFilters:{ProdName:[]}},{fieldFilters:{OrderWeek:['old']}},{filterEnabled:false,fieldFilters:{ProdName:[]}},{showGrandTotals:false}]) {
  const config={...options,...extra};
  const progress=[];
  const result=calculatePivotResult(rows,config,p=>progress.push(p));
  const expected=buildPivotModel(filterRows(rows,config),{...config,fieldFilters:undefined,filterTree:undefined});
  assert.deepEqual(result.model.cellMap,expected.cellMap);
  assert.deepEqual(result.model.rowAxis,expected.rowAxis);
  assert.deepEqual(result.model.columnAxis,expected.columnAxis);
  assert.deepEqual(pivotModelToAoA(result.model),pivotModelToAoA(expected));
  assert.deepEqual(progress,[25,50]);
  assert.equal('aoa' in result.model,false,'worker clone must not evaluate lazy Cartesian AOA');
  assert.deepEqual(structuredClone(result).model.cellMap,expected.cellMap);
}
const totals=calculatePivotResult(rows,{...options,showGrandTotals:false,showRowTotals:false,showColumnTotals:false}).model.cells;
assert.equal(totals.find(c=>c.values['Quantity:sum']===5).values['DistCost:weightedavg'],160);
function fakeWorker(){return {terminated:false,postMessage(){},terminate(){this.terminated=true}};}
{
  const w=fakeWorker(); const events=[];
  const dispose=startPivotCalculation({createWorker:()=>w,rows,options,onProgress:p=>events.push(p),onResult:r=>events.push(r),onError:e=>events.push(e)});
  w.onmessage({data:{type:'progress',percent:50}}); dispose();
  w.onmessage({data:{type:'result',result:'stale'}}); w.onerror();
  assert.deepEqual(events,[50]); assert.ok(w.terminated);
}
{
  const w=fakeWorker(); const errors=[]; let completed=false;
  startPivotCalculation({createWorker:()=>w,rows,options,onProgress:()=>{},onResult:()=>{completed=true},onError:e=>errors.push(e)});
  w.onmessage({data:{type:'error',message:'failure'}});
  w.onmessage({data:{type:'result',result:{}}});
  assert.deepEqual(errors,['failure']); assert.equal(completed,false);
}
{
  let error=''; startPivotCalculation({createWorker:()=>{throw Error('unsupported')},rows,options,onError:e=>{error=e}});
  assert.ok(error);
}
// Run the actual browser worker entry with an equivalent message transport.
const workerUrl=new URL('../lib/pivotExeWorker.js',import.meta.url).href;
const bridge=`import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:data=>parentPort.postMessage(data)};await import(${JSON.stringify(workerUrl)});parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({type:'ready'});`;
const worker=new Worker(new URL(`data:text/javascript,${encodeURIComponent(bridge)}`));
try {
  const steps=[];
  const actual=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('worker timed out')),10000);
    worker.on('error',error=>{clearTimeout(timer);reject(error)});
    worker.on('message',message=>{
      if(message.type==='ready') worker.postMessage({rows,options});
      if(message.type==='progress') steps.push(message.percent);
      if(message.type==='error'){clearTimeout(timer);reject(Error(message.message))}
      if(message.type==='result'){clearTimeout(timer);resolve(message.result)}
    });
  });
  assert.deepEqual(steps,[25,50]);
  assert.deepEqual(actual,calculatePivotResult(rows,options));
} finally {await worker.terminate();}
console.log('pivot worker: model/export parity, cross-year, zero/empty/stale filters, cancellation and real message clone passed');
