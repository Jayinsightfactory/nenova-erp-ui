import assert from 'node:assert/strict';
import { computeCatalogLayout, layoutCssVars, normalizeCatalogLayoutSettings, estimateCatalogAutoTxtHcm, SLIDE_W_CM, SLIDE_H_CM } from '../lib/catalogLayout.js';
import { buildCatalogDraftPayload } from '../lib/catalogDraft.js';
import './catalogFontDefaults.test.js';

const old = computeCatalogLayout(8);
assert.equal(old.imgWcm, old.imgHcm);
assert.equal(old.spacing.top, 3.5);
const max = { frame:'fill', top:0, bottom:0, side:0, hgap:0, vgap:0, txtGap:0, showHeader:false };
const full = computeCatalogLayout(1,'wide',{layout:max,compactText:true});
assert.equal(full.imgWcm, SLIDE_W_CM);
assert.equal(full.imgHcm, SLIDE_H_CM);
assert.equal(full.showHeader,false);
assert.equal(full.cells[0].imgXcm,0);
const moved = computeCatalogLayout(1,'wide',{layout:{...max,imageSize:50,imageX:100,imageY:100},compactText:true});
assert.equal(moved.cells[0].imgXcm,SLIDE_W_CM/2);
assert.equal(moved.cells[0].imgYcm,SLIDE_H_CM/2);
assert.equal(layoutCssVars(1,'wide',{layout:max,compactText:true})['--grid-bottom'],'0cm');
assert.equal(normalizeCatalogLayoutSettings({side:0,showHeader:false}).side,0);
assert.equal(normalizeCatalogLayoutSettings({side:'bad'}).side,null);
assert.equal(normalizeCatalogLayoutSettings({imageSize:1000}).imageSize,200);
assert.equal(normalizeCatalogLayoutSettings({frame:'fill',imageSize:150}).imageSize,100);
assert.equal(normalizeCatalogLayoutSettings({frame:'square',imageSize:150}).imageSize,150);
const square100=computeCatalogLayout(8,'wide',{layout:{frame:'square',imageSize:100}});
for (const size of [125,150,200]) {
  const enlarged=computeCatalogLayout(8,'wide',{layout:{frame:'square',imageSize:size}});
  assert.equal(enlarged.imgWcm,enlarged.imgHcm);
  assert.ok(enlarged.imgWcm <= square100.imgWcm + 0.00001);
  assert.ok(enlarged.imageAutoLimited);
  assert.equal(normalizeCatalogLayoutSettings(JSON.parse(JSON.stringify({frame:'square',imageSize:size}))).imageSize,size);
  assert.equal(layoutCssVars(8,'wide',{layout:{frame:'square',imageSize:size}})['--cell-img-w'],`${enlarged.imgWcm}cm`);
}
assert.equal(normalizeCatalogLayoutSettings(null).imageX,50);
for (const n of [1,8,20,100]) {
  const l=computeCatalogLayout(n,'wide',{cols:Math.min(n,10),layout:{...max,hgap:2,vgap:2}});
  for (const c of l.cells) {
    assert.ok(c.imgWcm>0&&c.imgHcm>0);
    assert.ok(c.imgXcm>=0&&c.imgXcm+c.imgWcm<=SLIDE_W_CM+0.001);
    assert.ok(c.imgYcm>=0&&c.txtYcm+c.txtHcm<=SLIDE_H_CM+0.001);
  }
}
const line={id:'fixture',prodKey:17,engName:'Rose',korName:'장미',salePrice:1000,extra1:'안내'};
const small = estimateCatalogAutoTxtHcm([line],{fontSizes:{kor:10}},8);
const big = estimateCatalogAutoTxtHcm([line],{fontSizes:{kor:30}},8);
assert.ok(big>small);
const richLine={...line,engName:'Hydrangea GOLD PEACH (FLOWER)',extra1:'기타 1 안내\n두 번째 줄',extra2:'기타 2 안내'};
const richFields={showEng:true,showKor:true,showPrice:true,showExtra1:true,showExtra2:true};
const richHeight=estimateCatalogAutoTxtHcm([richLine],richFields,10,'wide',{cols:5});
assert.ok(richHeight>estimateCatalogAutoTxtHcm([{...richLine,extra1:'안내'}],richFields,10,'wide',{cols:5}));
for(const size of [100,125,200]) for(const imageY of [0,50,100]) {
  const l=computeCatalogLayout(10,'wide',{cols:5,txtHcm:richHeight,compactText:true,layout:{frame:'square',imageSize:size,imageY,txtGap:0,vgap:0}});
  assert.ok(!l.textOverflow);
  for(const c of l.cells){
    assert.ok(c.txtYcm-c.imgYcm-c.imgHcm>=0.24999);
    assert.ok(c.txtYcm+c.txtHcm <= l.spacing.top+(c.row+1)*c.cellHcm+c.row*l.spacing.vgap+0.00001);
  }
}
assert.ok(computeCatalogLayout(100,'wide',{txtHcm:10}).textOverflow);
for(const year of [2025,2026]) {
  const draft=buildCatalogDraftPayload({orderYear:year,selectedWeek:'37-02',catalogFields:{layout:max,fontSizes:{kor:22}},lines:[line]});
  const saved=JSON.parse(JSON.stringify(draft));
  assert.equal(saved.orderYear,year);assert.equal(saved.selectedWeek,'37-02');
  assert.equal(saved.lines[0].salePrice,1000);assert.equal(saved.lines[0].prodKey,17);
  assert.equal(saved.catalogFields.layout.side,0);assert.equal(saved.catalogFields.fontSizes.kor,22);
}
console.log('Catalog layout controls: legacy/zero/fill/position/bounds/font sizing/cross-year persistence passed');
