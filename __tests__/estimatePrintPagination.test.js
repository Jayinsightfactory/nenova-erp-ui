import assert from 'node:assert/strict';
import {test} from 'node:test';
import {paginateEstimateRows} from '../lib/estimatePrintPagination.js';
test('same explicit pages cover each physical row once with shorter first-page body',()=>{
 assert.deepEqual(paginateEstimateRows({heights:[20,20,20,20,20,20],firstCapacity:61,nextCapacity:81,footerHeight:10}),[[0,1,2],[3,4,5]]);
});
test('footer stays with the final row and never repeats on earlier pages',()=>{
 assert.deepEqual(paginateEstimateRows({heights:[20,20,20],firstCapacity:65,nextCapacity:60,footerHeight:10}),[[0,1],[2]]);
});
test('zero/missing dimensions and a genuinely oversized row fail instead of clipping',()=>{
 assert.throws(()=>paginateEstimateRows({heights:[0],firstCapacity:60,nextCapacity:60}),/높이/);
 assert.throws(()=>paginateEstimateRows({heights:[80],firstCapacity:60,nextCapacity:60}),/한 페이지/);
 assert.throws(()=>paginateEstimateRows({heights:[20],firstCapacity:0,nextCapacity:60}),/크기/);
});
test('year/customer grouping remains caller-owned; empty rows retain one page',()=>{
 assert.deepEqual(paginateEstimateRows({heights:[],firstCapacity:100,nextCapacity:100}),[[]]);
 const source=Object.freeze([10,20,30]);const a=paginateEstimateRows({heights:source,firstCapacity:35,nextCapacity:35});
 assert.deepEqual(a,[[0,1],[2]]);assert.deepEqual(source,[10,20,30]);
});
