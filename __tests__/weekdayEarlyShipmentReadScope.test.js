import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeEarlyShipmentRequest} from '../lib/weekdayEarlyShipment.js';
const source=fs.readFileSync('pages/api/estimate/weekday-early-shipment.js','utf8');
const core=source.slice(source.indexOf('function lookupScope'),source.indexOf('export default')).replace('export function','function');
test('historical GET keeps year scope, never starts transaction, and validates bounds',async()=>{
 const reads=[];let writes=0;
 const factory=new Function('listEarlyShipmentStatus','weekdayRollbackAcknowledgement',core+';return createWeekdayEarlyShipmentHandler;')(
 async(q,scope)=>{reads.push(scope);return {success:true,readOnly:true,records:[],nextCycle:{year:scope.year+1,majorWeek:'01'}};},()=>({}));
 const handler=factory({queryFn:()=>{},transaction:()=>{writes++;throw Error('no writes');},dependencies:{}});
 const invoke=async(year)=>{const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({method:'GET',query:{year,majorWeek:'52',custKey:533}},res);return res;};
 assert.equal((await invoke('2025')).code,200);assert.equal((await invoke('2026')).code,200);
 assert.deepEqual(reads.map(r=>r.year),[2025,2026]);assert.equal(writes,0);
 for(const year of ['1999','2201','',false,'2025.5'])assert.equal((await invoke(year)).code,400);
 assert.equal(reads.length,2);
});
test('historical read support does not enable historical early-shipment writes',()=>{
 assert.throws(()=>normalizeEarlyShipmentRequest({operationId:'11111111-1111-4111-8111-111111111111',action:'APPLY',sourceYear:2025,targetYear:2026}),/sourceYear/);
});
