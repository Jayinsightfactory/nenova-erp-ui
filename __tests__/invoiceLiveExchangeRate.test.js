import test from 'node:test';
import assert from 'node:assert/strict';
import {liveInvoiceRate,fetchLiveInvoiceRate} from '../lib/invoiceLiveExchangeRate.js';
const now=new Date('2026-10-29T08:00:00Z');
const chart=(price,time=now.getTime()/1000)=>({chart:{result:[{meta:{regularMarketPrice:price,regularMarketTime:time}}]}});
test('current quote plus exactly15, all supported currencies, quote provenance',()=>{
 for(const currency of ['USD','EUR','CNY','AUD','NZD','THB']){const r=liveInvoiceRate(chart(950.25),currency,now);assert.equal(r.rate,965.25);assert.equal(r.marketRate,950.25);assert.equal(r.adjustmentKRW,15);assert.equal(r.quoteAt,now.toISOString());}
});
test('missing, zero, stale, future or unsupported quote never invents a rate',()=>{
 for(const c of [chart(0),chart(null),chart(1,now/1000-8*86400),chart(1,now/1000+600),{}])assert.throws(()=>liveInvoiceRate(c,'EUR',now));
 assert.throws(()=>liveInvoiceRate(chart(1),'BAD',now));
});
test('fetch bypasses cache and handles provider errors',async()=>{
 let opts;const r=await fetchLiveInvoiceRate('EUR',async(url,o)=>{opts=o;return {ok:true,json:async()=>chart(1600)}} ,now);
 assert.equal(r.rate,1615);assert.equal(opts.cache,'no-store');
 await assert.rejects(fetchLiveInvoiceRate('EUR',async()=>({ok:false,status:503}),now));
});
