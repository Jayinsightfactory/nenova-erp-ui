const assert = require('node:assert/strict');

async function main() {
  const {
    groupRaumImageRows,
    isRaumImageDraftComplete,
    buildRaumOrderItems,
    buildRaumPnlItems,
    getClipboardImage,
    parseImageNumber,
  } = await import('../lib/raumPnlImage.js');

  assert.equal(parseImageNumber('₩12,500원'), 12500);
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
