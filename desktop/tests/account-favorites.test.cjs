'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { syncAccountFavorites } = require('../account-favorites.cjs');

test('migration preserves web numbers, fills a missing alias, and restores on a fresh PC', async () => {
  const fixture = require('../scripts/favorite-fixture.cjs')();
  const owner='test-a';
  const fetch = (url,opts) => fixture(new Request(url,opts),owner);
  const sync = args => syncAccountFavorites({owner, fetch, current:()=>true, ...args});
  await sync({action:{kind:'add',item:{url:'/sales/a',title:'원래 메뉴'}}});
  const imported = await sync({legacy:[
    {url:'/sales/a?popup=1',title:'원래 메뉴',number:3,alias:'매출자료'},
    {url:'/sales/b?year=2026&week=45',title:'물량표',number:2},
  ]});
  assert.deepEqual(imported.map(x=>[x.number,x.title,x.alias]),[[1,'원래 메뉴','매출자료'],[2,'물량표',undefined]]);
  const cleanPC = await sync({});
  assert.deepEqual(cleanPC,imported);
  await sync({action:{kind:'remove',item:imported[0]}});
  assert.deepEqual(await sync({}),[imported[1]]);
  await assert.rejects(syncAccountFavorites({owner:'test-b',fetch,current:()=>true}),/동기화/);
});
