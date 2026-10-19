const test=require('node:test');
const assert=require('node:assert/strict');
test('duplicate source names stay connected to their own invoice and line',async()=>{
 const {packingSourceMatchedName:find}=await import('../lib/packingSourceMatch.js');
 const invoices=[{sourceInvoiceIndex:0,products:[{sourceLineIndex:0,sourceName:'Rose',matchedName:'Rose A'},{sourceLineIndex:1,sourceName:'Rose',matchedName:'Rose B'}]}];
 assert.equal(find(invoices,0,{lineIndex:0,description:'Rose'}),'Rose A');
 assert.equal(find(invoices,0,{lineIndex:1,description:'Rose'}),'Rose B');
 assert.equal(find(invoices,1,{lineIndex:0,description:'Rose'}),null);
 assert.equal(find(invoices,0,{description:'Rose'}),null);
 invoices[0].products[1].matchedName='Rose A';
 assert.equal(find(invoices,0,{description:'Rose'}),'Rose A');
});
test('NL catalog candidates find Aisha and Casablanca without accepting ambiguous grades',async()=>{
 const {resolveProductNL,packingSourceKey}=await import('../lib/importPacking.js');
 const items=['Lily Oriental Double Roselily Aisha 2+','Lily Oriental Double Roselily Aisha 3+','Amaryllis / Casablanca 12st White1','Amaryllis / Casablanca 15st White2'].map(name=>({name}));
 const a='LILY ORIENTAL DOUBLE ROSELILY AISHA 3+ 75cm';
 assert.equal(resolveProductNL(a,items).matchedName,items[1].name);
 assert.equal(resolveProductNL('HIPPEASTRUM CASABLANCA 12x 4 80cm',items).matchedName,items[2].name);
 assert.equal(resolveProductNL('LILY ORIENTAL DOUBLE ROSELILY AISHA',items).unmatched,true);
 assert.equal(resolveProductNL(a,items,{[packingSourceKey(a)]:'deleted'}).unmatched,true);
 const {packingMatchReview}=await import('../lib/packingMatchReview.js');
 const result=resolveProductNL(a,items);
 assert.equal(packingMatchReview({...result,sourceName:a},[{ProdKey:1,ProdName:result.matchedName,country:'NL',selectable:true}],'NL').needsReview,true);
});
