// 매출이익 보고서 계산식 지문(calcVersion) — 빌드 시점(next.config.js)과 로컬 워밍업 스크립트가 같은 값을 만든다.
// 계산에 쓰이는 소스 파일 내용이 바뀌면(=계산식 변경 배포) 값이 바뀌어, 저장된 과거 차수 결과가 자동으로 "재계산 필요"가 된다.
// CRLF 차이로 Windows/Linux 값이 갈리지 않게 줄바꿈을 정규화한다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 수동 버전 — 파일 목록 밖(DB 뷰·SP 등)의 계산 의미가 바뀌면 올린다.
const PROFIT_REPORT_CALC_VERSION = '2026-09-30.1';

const INCLUDE = [
  /^lib\/profitReport(?!Snapshot|WeekCheck)[A-Za-z]*\.(c?m?js)$/,
  /^lib\/customs[A-Za-z]*\.js$/,
  /^lib\/freightCalc\.js$/,
  /^lib\/colombia[A-Za-z]*\.js$/,
  /^lib\/countryClassification\.js$/,
  /^lib\/taxableExchangeRate\.js$/,
  /^lib\/kcs[A-Za-z]*\.js$/,
  /^pages\/api\/sales\/profit-report\.js$/,
  /^data\/profit-report-evidence\/[^/]+\.json$/,
];

function listFiles(root) {
  const out = [];
  for (const dir of ['lib', 'pages/api/sales', 'data/profit-report-evidence']) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, dir)); } catch { continue; }
    for (const name of names) {
      const rel = `${dir}/${name}`;
      if (INCLUDE.some((re) => re.test(rel))) out.push(rel);
    }
  }
  return out.sort();
}

function computeProfitReportCalcHash(root = process.cwd()) {
  const h = crypto.createHash('sha256');
  h.update(PROFIT_REPORT_CALC_VERSION);
  for (const rel of listFiles(root)) {
    h.update(`\n@@${rel}\n`);
    h.update(fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n'));
  }
  return `${PROFIT_REPORT_CALC_VERSION}+${h.digest('hex').slice(0, 12)}`;
}

module.exports = { PROFIT_REPORT_CALC_VERSION, computeProfitReportCalcHash, listFiles };
