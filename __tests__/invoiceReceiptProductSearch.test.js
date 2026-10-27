import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptProductLabel, searchReceiptProducts } from '../lib/invoiceReceiptProductSearch.js';
const products = [
  { ProdKey:2997, ProdName:'Wolly Bush Green Tip ', DisplayName:'울리부쉬그린', selectable:true },
  { ProdKey:2998, ProdName:'Wolly Bush Red Tip', DisplayName:'울리부쉬레드', selectable:true },
  { ProdKey:1, ProdName:'Woolly bush Green Tip', selectable:false },
];
test('both Korean display name and English ERP spelling are searchable without auto selection',()=>{
  for(const query of ['Woolly bush green tip','Wolly Green','울리부쉬그린','2997'])
    assert.deepEqual(searchReceiptProducts(products,query).map(p=>p.ProdKey),[2997]);
  assert.deepEqual(searchReceiptProducts(products,'woo').map(p=>p.ProdKey),[2997,2998]);
  assert.deepEqual(searchReceiptProducts(products,'red tip').map(p=>p.ProdKey),[2998]);
  assert.match(receiptProductLabel(products[0]),/울리부쉬그린 · Wolly Bush Green Tip/);
  assert.deepEqual(searchReceiptProducts(products,'unrelated'),[]);
});
