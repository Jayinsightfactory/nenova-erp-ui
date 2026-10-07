import assert from 'node:assert/strict';
import { buildDefectProductDisplay as display } from '../lib/defectProductDisplay.js';
const source = {countryName:'콜롬비아',productName:'장미',matchedProductDbName:'ROSE / Be Sweet 50cm'};
assert.deepEqual(display(source),{category:'콜롬비아장미',name:'Be Sweet 50cm',fullName:'콜롬비아 · 장미 · ROSE / Be Sweet 50cm'});
assert.equal(source.matchedProductDbName,'ROSE / Be Sweet 50cm');
assert.equal(display({countryName:'CHINA',productName:'장미',matchedProductDbName:'ROSE CHINA / 프라우드(White proud) [red box] 75-80cm'}).name,'프라우드(White proud) [red box] 75-80cm');
assert.equal(display({countryName:'중국',productName:'장미',matchedProductName:'rose china / Sweet Rose'}).category,'중국장미');
assert.equal(display({countryName:'중국',productName:'장미',matchedProductName:'rose china / Sweet Rose'}).name,'Sweet Rose');
assert.equal(display({countryName:'콜롬비아',productName:'장미',matchedProductName:'China Girl 60cm'}).name,'China Girl 60cm');
assert.equal(display({countryName:'중국',productName:'기타',matchedProductName:'CHINA / 리모늄 시네신스 화이트 (Sinensis white) 500g'}).name,'리모늄 시네신스 화이트 (Sinensis white) 500g');
assert.equal(display({countryName:'중국',productName:'스프레이장미',matchedProductName:'SPRAY ROSE CHINA / 소피아 베이비 (Spray-Rose Sofia babe)'}).name,'소피아 베이비 (Spray-Rose Sofia babe)');
assert.equal(display({productName:'장미',matchedProductName:'ROSE'}).name,'-');
assert.equal(display({countryName:'중국',productName:'중국장미',colorName:'화이트'}).category,'중국장미');
assert.equal(display({}).name,'-');
assert.equal(display({productName:'긴 미매칭 원문 품종 이름'}).fullName,'긴 미매칭 원문 품종 이름');
for (const orderYear of [2025,2026]) {
  const row={...source,orderYear,orderWeek:'40',prodKey:447};
  assert.equal(display(row).category,'콜롬비아장미');
  assert.equal(row.orderYear,orderYear);
  assert.equal(row.prodKey,447);
}
console.log('defect product display: country/category, metadata-only trimming, variety/size preservation passed');
