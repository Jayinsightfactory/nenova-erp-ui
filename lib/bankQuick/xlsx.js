// 은행 거래내역 엑셀(하나은행 '전체엑셀다운로드') → { headers, rows }. 헤더는 그대로 보존(숨은 열 포함, RawJson 용). 값 변환 없음.
import XLSX from 'xlsx';

const cell = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// 앞 30행 중 '거래일시' 또는 '거래일자' 와 입금/출금/잔액 계열 열이 함께 있는 첫 행을 헤더로 본다.
export function parseBankAoa(aoa) {
  let hi = -1;
  for (let i = 0; i < Math.min(aoa.length, 30); i += 1) {
    const cells = (aoa[i] || []).map(cell);
    if (cells.some((c) => /거래일시|거래일자/.test(c)) && cells.some((c) => /입금|출금|거래금액/.test(c))) { hi = i; break; }
  }
  if (hi < 0) return { headers: [], rows: [] };
  const headers = aoa[hi].map(cell);
  const rows = aoa.slice(hi + 1)
    .map((r) => headers.map((_, c) => (r[c] === undefined || r[c] === null ? '' : cell(r[c]))))
    .filter((r) => r.some((v) => v !== ''));
  return { headers, rows };
}

export function parseBankXlsx(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  return parseBankAoa(aoa);
}
