import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../components/WeekdayCycleMatrix.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('  async function exportWorkbook()'),source.indexOf('  const validDestinations'));
assert.ok(body.includes('await onExportWorkbook()'));
assert.doesNotMatch(source,/import\('xlsx'\)|aoa_to_sheet|book_new|book_append_sheet|XLSX\.writeFile|주광_요일합계_/,'matrix cannot fall back to an unformatted workbook');
assert.match(source,/onExportWorkbook, exportReady = false/);
assert.match(source,/disabled=\{disabled \|\| exportBusy \|\| !exportReady \|\| typeof onExportWorkbook!==\'function\'\}/);
assert.doesNotMatch(body,/visibleRows|matrix\.cycles/,'whole original file export is independent of filtered/hidden products');
assert.match(source,/발주내역 엑셀/);
const create=(options={})=>{
 const state={busy:[],errors:[],lock:{current:false}};
 const defaults={disabled:false,exportBusy:false,exportReady:true,onExportWorkbook:async()=>{}};
 const props={...defaults,...options};
 const run=new Function('disabled','exportBusy','exportReady','onExportWorkbook','exportLock','setExportBusy','setSelectedInfo',body+';return exportWorkbook;')(
 props.disabled,props.exportBusy,props.exportReady,props.onExportWorkbook,state.lock,value=>state.busy.push(value),value=>state.errors.push(value));
 return {run,state};
};
let calls=0,release;
const pending=new Promise(resolve=>{release=resolve;});
let test=create({onExportWorkbook:async()=>{calls++;await pending;}});
const first=test.run();await test.run();assert.equal(calls,1,'concurrent clicks invoke the original-template callback once');
release();await first;assert.deepEqual(test.state.busy,[true,false]);assert.equal(test.state.lock.current,false);
for(const props of [{disabled:true},{exportBusy:true},{exportReady:false},{onExportWorkbook:undefined}]){
 test=create({...props,...(props.onExportWorkbook===undefined&&'onExportWorkbook' in props?{}:{onExportWorkbook:async()=>{throw Error('unexpected callback');}})});
 await test.run();assert.deepEqual(test.state.busy,[]);assert.deepEqual(test.state.errors,[]);
}
test=create({onExportWorkbook:async()=>{throw Error('fixture template failure');}});await test.run();
assert.deepEqual(test.state.busy,[true,false]);assert.equal(test.state.lock.current,false);assert.match(test.state.errors[0],/fixture template failure/);
console.log('Matrix original-template export route: callback only, no plain workbook fallback, unfiltered availability, concurrent lock and failure reset passed');
