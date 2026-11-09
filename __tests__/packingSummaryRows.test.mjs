import test from 'node:test';
import assert from 'node:assert/strict';
import {CO_461_SOURCE_HASH,reconcilePackingSummaryRows} from '../lib/importPackingSummaryRows.js';
const options={sourceHash:CO_461_SOURCE_HASH};
test('source-verified category summary is audit evidence, not extra goods',()=>{
 const products=Array.from({length:24},(_,n)=>({description:(n<20?'CAR ':'MIN ')+n,t_price:10,total_stems:100,pcs:1,source_page:6}));
 products.push({description:'CARNATION (Dianthus spp.)',t_price:200,total_stems:2000,source_page:7},{description:'MINICARNATION (Dianthus spp.)',t_price:40,total_stems:400,source_page:7});
 const invoice={invoice:'133495',products},before=JSON.stringify(invoice);
 const result=reconcilePackingSummaryRows(invoice,options);
 assert.equal(result.products.length,24);assert.equal(result.source_summary_rows[0].rows.length,2);assert.equal(JSON.stringify(invoice),before);
 assert.equal(reconcilePackingSummaryRows(invoice,{sourceHash:'a'.repeat(64)}),invoice);
 products[24].t_price=201;assert.equal(reconcilePackingSummaryRows(invoice,options),invoice);
});
test('manifest pieces retained separately; no fictitious per-product allocation',()=>{
 const invoice={invoice:'FEER 4346',invoice_total:621,products:[{pcs:0,t_price:621,total_stems:1500}]};
 const result=reconcilePackingSummaryRows(invoice,options);
 assert.equal(result.source_box_total,15);assert.equal(result.products[0].pcs,0);assert.equal(result.source_box_evidence.page,1);
 assert.equal(reconcilePackingSummaryRows({...invoice,invoice_total:620},options).source_box_total,undefined);
});
test('17805 cross-page summary needs both matching money and quantity',()=>{
 const rows=Array.from({length:24},(_,n)=>({description:'CARNATION '+n,source_page:17+n%2,t_price:1,total_stems:10}));
 rows.push({description:'CARNATION CARNATION CARNATION',source_page:19,t_price:24,total_stems:240});
 const invoice={invoice:'17805',products:rows};assert.equal(reconcilePackingSummaryRows(invoice,options).products.length,24);
 rows[24].total_stems=241;assert.equal(reconcilePackingSummaryRows(invoice,options),invoice);
});
test('202875 parent packing rows retain box total while child rows carry goods',()=>{
 const p=(description,pcs,stems,amount)=>({description,pcs,total_stems:stems,t_price:amount,u_price:pcs?0:.1,steam_box:100,source_page:32});
 const rows=[p('ROSE BE SWEET CB (DRY) PK 10',2,200,20),p('ROSE BICOLOR SALMON PINK',0,100,10),p('ROSE BICOLOR SALMON PINK',0,100,10),p('ROSE MOMENTUM CB (DRY) PK 10',2,200,20),p('ROSE YELLOW',0,200,20),p('ROSE PLAYA BLANCA CB (DRY) PK 10',4,400,40),p('ROSE WHITE',0,400,40)];
 const invoice={invoice:'202875',products:rows},result=reconcilePackingSummaryRows(invoice,options);
 assert.equal(result.products.length,4);assert.equal(result.source_box_total,8);assert.equal(result.source_summary_rows[0].rows.length,3);
 rows[6].t_price=41;assert.equal(reconcilePackingSummaryRows(invoice,options),invoice);
});
