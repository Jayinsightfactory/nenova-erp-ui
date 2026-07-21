const assert = require('node:assert/strict');

async function main() {
  const {
    groupRaumImageRows,
    isRaumImageDraftComplete,
    buildRaumOrderItems,
    buildRaumPnlItems,
    buildRaumMatchName,
    formatRaumUnit,
    getClipboardImage,
    normalizeRaumUnit,
    parseImageNumber,
  } = await import('../lib/raumPnlImage.js');
  const { scoreMatch } = await import('../lib/displayName.js');

  assert.equal(parseImageNumber('₩12,500원'), 12500);
  assert.equal(normalizeRaumUnit('박스'), '박스');
  assert.equal(normalizeRaumUnit('단'), '단');
  assert.equal(normalizeRaumUnit('대'), '송이');
  assert.equal(normalizeRaumUnit('스팀'), '송이');
  assert.equal(formatRaumUnit('송이'), '스팀(대)');

  const imageSamples = [
    ['수국 화이트', { ProdName: 'Hydrangea White', FlowerName: '수국' }],
    ['수국 핑지', { ProdName: 'Hydrangea Peach (Florentina)', FlowerName: '수국' }],
    ['장미 화이트스프레이(스노우플레이크)', { ProdName: 'SPRAY ROSE / Snow Flake', FlowerName: '장미' }],
    ['장미 코랄핑크', { ProdName: 'ROSE / Coral Reef 50cm', FlowerName: '장미' }],
    ['카네이션 프라도민트(엥그린)', { ProdName: 'CARNATION Prado Mint', FlowerName: '카네이션' }],
    ['카네이션 도젤', { ProdName: 'CARNATION Doncel', FlowerName: '카네이션' }],
    ['알스트로엘 연핑크(두바이)', { ProdName: 'ALSTROMERIA Dubai', FlowerName: '알스트로' }],
    ['알스트로엘 화이트(쿠읍슨러)', { ProdName: 'ALSTROMERIA Whistler', FlowerName: '알스트로' }],
    ['알스트로엘 핑지', { ProdName: 'ALSTROMERIA Fifi', FlowerName: '알스트로' }],
  ];
  for (const [inputName, product] of imageSamples) {
    assert.ok(scoreMatch(buildRaumMatchName(inputName), product) >= 72, `${inputName} 샘플이 품목 후보와 매칭되어야 한다.`);
  }
  assert.ok(scoreMatch(buildRaumMatchName('카네이션 화이트'), { ProdName: 'CARNATION Moon Light', FlowerName: '카네이션' }) < 72,
    '오래된 잘못된 자동매핑은 이미지 매칭에서 재검토되어야 한다.');
  const clipboardFile = { name: 'capture.png', type: 'image/png' };
  assert.equal(getClipboardImage([
    { kind: 'string', type: 'text/plain' },
    { kind: 'file', type: 'image/png', getAsFile: () => clipboardFile },
  ]), clipboardFile, '클립보드 이미지 파일은 추출되어야 한다.');
  assert.equal(getClipboardImage([{ kind: 'string', type: 'text/plain' }]), null, '텍스트 붙여넣기는 이미지로 처리하지 않는다.');
  const base = [
    { lineId: 'a', sourceImageId: 'img-a', inputName: '수국 화이트', prodKey: 10, prodName: '수국 화이트', qty: 5, unit: '박스', price: 12000, needsReview: false, separate: false },
    { lineId: 'b', sourceImageId: 'img-b', inputName: '수국 화이트', prodKey: 10, prodName: '수국 화이트', qty: 7, unit: '박스', price: 12000, needsReview: false, separate: false },
    { lineId: 'c', sourceImageId: 'img-b', inputName: '수국 화이트', prodKey: 10, prodName: '수국 화이트', qty: 2, unit: '박스', price: 13000, needsReview: false, separate: false },
  ];
  const groups = groupRaumImageRows(base);
  assert.equal(groups.length, 2, '가격이 다른 동일 품목은 별도 행이어야 한다.');
  assert.equal(groups.find(g => g.price === 12000).qty, 12, '서로 다른 이미지의 동일 가격 품목은 합산되어야 한다.');
  assert.equal(groups.find(g => g.price === 13000).qty, 2);

  const separated = groupRaumImageRows(base.map(row => row.lineId === 'b' ? { ...row, separate: true } : row));
  assert.equal(separated.length, 3, '사용자가 분리한 원행은 합산하면 안 된다.');
  assert.equal(isRaumImageDraftComplete(base), true);
  assert.equal(isRaumImageDraftComplete([{ ...base[0], needsReview: true }]), false, '추천 미확정 행은 100% 매칭으로 처리하면 안 된다.');

  const orderItems = buildRaumOrderItems(base);
  assert.equal(orderItems.length, 1, '주문등록은 가격별 결산행을 품목·단위별로 합산해야 한다.');
  assert.equal(orderItems[0].qty, 14);
  const pnlItems = buildRaumPnlItems(base);
  assert.equal(pnlItems.length, 2, '결산 preview는 가격별 행을 유지해야 한다.');
  assert.deepEqual(pnlItems.map(x => x.price), [12000, 13000]);
  console.log('Raum P&L image policy tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
