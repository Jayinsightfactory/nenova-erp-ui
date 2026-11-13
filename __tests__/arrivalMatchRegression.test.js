// 업무드라이브 원가자료 → 도착원가 자동 매칭 회귀: 2026-11 점검에서 나라가 어긋난 채 저장돼 있던 실제 입력값들.
// 로직만 검증한다(운영 데이터는 바꾸지 않음). 같은 입력이 다시 들어와도 다른 나라·거래 종료 거래처 품목에 연결되면 안 된다.
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

async function main() {
  const { parseArrivalCostWorkbook } = await import('../lib/arrivalCostExcel.js');
  const { isDiscontinuedVendorName } = await import('../lib/discontinuedVendors.js');
  const prod = (ProdKey, ProdName, CounName, FlowerName = '장미') => ({ ProdKey, ProdName, CounName, FlowerName, OutUnit: '단' });
  const parse = (fileName, sheetName, rawName, products) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`${fileName} 2026`], ['품목명', '수량', '도착원가(단)'], [rawName, 10, 2500]]), sheetName);
    return parseArrivalCostWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { fileName, orderYear: '2026', products });
  };
  const first = (...args) => parse(...args).rows[0];

  // 1) 콜롬비아 파일 — 에콰도르 같은 이름 품목이 아니라 콜롬비아 품목으로
  const mayra = [prod(1491, 'Ecuador Mayra Rose Pink', '에콰도르'), prod(2243, 'ROSE / Garden mayra pink 50cm', '콜롬비아')];
  assert.equal(first('37-1 Colombia 원가자료.xlsx', '37-1', 'ROSE / Garden mayra pink 50cm', mayra).prodKey, 2243);
  assert.equal(first('37-1 Colombia 원가자료.xlsx', '37-1', 'ROSE / Garden mayra pink 50cm', [mayra[0]]).prodKey, null, '콜롬비아 품목이 없으면 에콰도르 품목으로 대신 연결하지 않는다');

  // 2) 중국장미(ROSE CHINA) ≠ 콜롬비아장미(ROSE)
  const romantic = [prod(1211, 'ROSE', '콜롬비아'), prod(3251, 'ROSE CHINA / 로맨틱 비치(Romantic Beach) 70cm-75cm', '중국')];
  assert.notEqual(first('CHINA 중국 원가자료.xlsx', '34-2B CLOUD', 'ROSE CHINA / 로맨틱 비치(Romantic Beach) 40cm', romantic).prodKey, 1211);
  assert.equal(first('CHINA 중국 원가자료.xlsx', '34-2B CLOUD', 'ROSE CHINA / 킹스데이(Kings day)',
    [prod(1585, 'Rose Kings Day', '에티오피아'), prod(2099, 'ROSE CHINA / 킹스데이(Kings day) ', '중국')]).prodKey, 2099);

  // 3) 에콰도르장미(Rose Ecuador) ≠ 콜롬비아장미(ROSE)
  assert.equal(first('37-1 Ecuador 원가자료.xlsx', '37-1', 'Rose Ecuador 1 50cm', [prod(1198, 'ROSE / Candlelight 50cm', '콜롬비아')]).prodKey, null);

  // 4) 거래 종료 거래처 품목([MEL]·[오경])은 자동 연결하지 않는다 — 같은 이름의 현행 품목이 있으면 그쪽으로
  assert.equal(isDiscontinuedVendorName('[MEL] ASPARAGUS CHINA Preserved Blue / 미디오 (연블루)'), true);
  assert.equal(isDiscontinuedVendorName('[오경] ROSE CHINA / 리바이벌 (Revival)'), true);
  assert.equal(isDiscontinuedVendorName('ASPARAGUS CHINA Preserved Blue / 미디오 (연블루)'), false);
  const blue = 'ASPARAGUS CHINA Preserved Blue / 미디오 (연블루)';
  const asparagus = [prod(3086, `[MEL] ${blue}`, '중국', '기타'), prod(3210, blue, '중국', '기타')];
  assert.equal(first('CHINA 중국 원가자료.xlsx', '34-2A CLOUD', blue, asparagus).prodKey, 3210);
  assert.equal(first('CHINA 중국 원가자료.xlsx', '34-2A CLOUD', blue, [asparagus[0]]).prodKey, null, '거래 종료 품목만 있으면 미매칭으로 남겨 사람이 고른다');
  // 원문에 같은 표식을 직접 적은 옛 자료([오경] 파일)는 중국으로 등록된 같은 표식 품목과만 연결한다. 콜롬비아로 등록된 품목에는 연결하지 않는다.
  assert.equal(first('CHINA 중국 원가자료.xlsx', '13-1', '[오경] ROSE CHINA / 리바이벌 (Revival)', [prod(2768, '[오경] ROSE CHINA / 리바이벌 (Revival)', '중국')]).prodKey, 2768);
  assert.equal(first('CHINA 중국 원가자료.xlsx', '13-1', '[오경] ROSE CHINA / 리바이벌 (Revival)', [prod(2768, '[오경] ROSE CHINA / 리바이벌 (Revival)', '콜롬비아')]).prodKey, null);
  // 원문에 표식이 없는데 거래 종료 품목만 같은 이름이면 연결하지 않는다
  assert.equal(first('CHINA 중국 원가자료.xlsx', '40-1', 'ROSE CHINA / 리바이벌 (Revival)', [prod(2768, '[오경] ROSE CHINA / 리바이벌 (Revival)', '중국')]).prodKey, null);

  // 5) 양식 샘플 시트(Ejemplo)는 가져오지 않는다
  const sample = parse('37-1 Ecuador 원가자료.xlsx', 'Ejemplo', 'Rose Ecuador 1 50cm', [prod(3423, 'Ecuador Explorer 50cm', '에콰도르')]);
  assert.equal(sample.rows.length, 0);
  assert.ok(sample.skippedSheets.some(sheet => sheet.sheetName === 'Ejemplo'));
  console.log('arrival match regression tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
