// 임시 미리보기 — 커밋 전에 삭제한다. DB/로그인 없이 대조 패널 UI만 렌더링한다.
import ProfitReportExcelParity from '../components/ProfitReportExcelParity';

const WEB_27_TOTALS = {
  N: 251445145, L: -11055272, O: -1143017, C: 239246856,
  E: 8919590, F: 15539936, H: 10813030,
  P: 133730753.465, T: 66315408.661, G: 200046162.126,
  I: 204238846, J: 35008010, K: 35008010 / (239246856 + 15539936), M: 11055272 / 239246856,
  Q: 112689.83, R: 1550, S: 52434.22, D: 1, U: 1,
};

const ROWS = [
  { category: '베트남', variant: 'normal', calc: { N: 6975000, L: 0, O: -41000, C: 6934000, E: 3779004.64, F: 2100000, H: 0, Q: 0, R: 0, S: 0, P: 0, T: 0, G: 0, I: 5879004.64, J: 1054995.36 } },
  { category: '중국', variant: 'normal', calc: { N: 14771091, L: -5793001, O: -232454, C: 8745636, E: 0, F: 1250000, H: 1675210, Q: 20000, R: 226.66, S: 1200, P: 4533200, T: 271992, G: 4805192, I: 5230402, J: 3515234 } },
];

export default function ParityPreview() {
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f1f5f9', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 16, marginBottom: 10 }}>대조 패널 미리보기 (임시)</h1>
      <ProfitReportExcelParity orderYear="2026" major="27" rowsWithCalc={ROWS} totals={WEB_27_TOTALS} />
    </div>
  );
}
