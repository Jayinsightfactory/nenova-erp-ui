import test from 'node:test';
import assert from 'node:assert/strict';
import {rankProductSearchOptions,scoreProductSearchOptions} from '../lib/productSearchRanking.js';

const p=(ProdKey,ProdName,extra={})=>({ProdKey,ProdName,...extra});
const rank=(query,products)=>rankProductSearchOptions(query,products,{packingSuggestions:true});
test('packing suggestions support composed, decomposed, compatibility jamo, initials and Korean typo',()=>{
 const products=[p(2,'튤립'),p(1,'문라이트')];
 for(const query of ['문라이트','문라이트'.normalize('NFD'),'ㅁㅜㄴㄹㅏㅇㅣㅌㅡ','ㅁㄹㅇㅌ','문라잍트']) assert.equal(rank(query,products)[0]?.ProdKey,1,query);
});
test('English edit distance and exact names/aliases outrank popular fuzzy candidates',()=>{
 assert.equal(rank('Moon Ligth',[p(1,'Moon Light'),p(2,'Tulip')])[0]?.ProdKey,1);
 const products=[p(2,'Moon Lights',{UsageCount:1e8}),p(1,'Moon Light')];
 assert.equal(rank('Moon Light',products)[0].ProdKey,1);
 assert.equal(rank('Vendor Moon 60cm',[p(2,'Vendor Moons 60cm',{UsageCount:1e8}),p(1,'Internal Name',{MappingAliases:['Vendor Moon 60cm']})])[0].ProdKey,1);
});
test('long source family/length tags do not swamp cultivar and numbers remain meaningful',()=>{
 const products=[p(2,'Roselily Aisha 80cm'),p(3,'ROSE Aisha 60cm'),p(1,'Roselily Aisha 60cm')];
 const ranked=rank('Roselily Aisha [LILY:60cm]',products);
 assert.equal(ranked[0].ProdKey,1);
 assert.ok(!ranked.some(p=>p.ProdKey===3),'different flower is not an equal suggestion');
 const scored=scoreProductSearchOptions('Roselily Aisha [LILY:60cm]',products,{packingSuggestions:true});
 assert.match(scored.find(x=>x.product.ProdKey===2).suggestion.reason,/길이\/숫자/);
 assert.equal(rank('Moon Light 60cm',[p(2,'Moon Light 80cm'),p(1,'Moon Light 60cm')])[0].ProdKey,1);
});
test('common ranking default is identical with omitted and explicit false opt-in',()=>{
 const products=[p(1,'Moon Light'),p(2,'Candlelight'),p(3,'튤립')];
 for(const q of ['', '문라이트','Moon Ligth','ㅁㄹㅇㅌ']) assert.deepEqual(rankProductSearchOptions(q,products),rankProductSearchOptions(q,products,{packingSuggestions:false}));
});

test('packing suggestions prioritize original word order over popularity and ignore DB annotations',()=>{
 const products=[p(2,'White CHINA Preserved Asparagus',{UsageCount:1e12}),p(1,'CHINA Preserved Asparagus White (보존 아스파라거스)')];
 assert.equal(rank('Preserved Asparagus - White',products)[0].ProdKey,1);
 assert.equal(rank('Preserved Asparagus - White',[...products,p(3,'CHINA Preserved Asparagus Burgundy')])[0].ProdKey,1);
});
