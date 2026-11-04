import test from 'node:test';
import assert from 'node:assert/strict';
import {chinaSeaCbmDefault} from '../lib/chinaSeaCbmReference.js';
import {INVOICE_COST_EXPORT_PROFILES} from '../lib/invoiceCostExportProfiles.js';
const fixture=()=>({profile:INVOICE_COST_EXPORT_PROFILES.CN_SEA_ORIGINAL_V1,source:{originalName:'Ammi CHINA 아미초'},detail:{},setting:{bunchesPerBox:10}});
test('verified original package default is bound to exact product, count and source',()=>{
 const f=fixture(),before=JSON.stringify(f),r=chinaSeaCbmDefault(f);
 assert.equal(r.boxCbm,.04704);assert.match(r.basis,/H44.*M7\/N7/);assert.equal(JSON.stringify(f),before);
 for(const val of [0,-1,.1,NaN])assert.equal(chinaSeaCbmDefault({...f,setting:{...f.setting,boxCbm:val}}),null);
 assert.equal(chinaSeaCbmDefault({...f,setting:{bunchesPerBox:20}}),null);
 assert.equal(chinaSeaCbmDefault({...f,source:{originalName:'Ammi unknown'}}),null);
 assert.equal(chinaSeaCbmDefault({...f,profile:{...f.profile,sourceHash:'other'}}),null);
 assert.equal(chinaSeaCbmDefault({...f,profile:INVOICE_COST_EXPORT_PROFILES.CN_AIR_ORIGINAL_V1}),null);
});
