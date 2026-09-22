// lib/farmRemitImport.js
// 농장 송금 자동 인식 — 경영지원(강명훈)이 은행 제출용으로 만드는 "해외건별송금신청YYYYMMDD.xlsx"가 업무 드라이브에
// 자동 업로드되면 그 행(거래접수번호·작성일·통화·금액·받는 분·송금예정일자)을 읽어 WebFarmRemit(웹 전용)에 '확인 대기' 행으로 넣는다.
// 수입부가 통합 화면에서 농장·차수를 확인해 확정하면 정산 잔액에 반영된다. 전산(MSSQL 공유) 테이블은 건드리지 않는다.
import fs from 'fs';
import path from 'path';

export const REMIT_FILE_RE = /해외건별송금신청|건별송금신청결과/;
const LEGAL_RE = /\b(S\.?A\.?S\.?|S\.?A\.?|LTDA?\.?|LLC|INC\.?|CORP\.?|CO\.?,?\s*LTD\.?|CIA\.?|C\.?I\.?|E\.?U\.?|SAS|SA|BV|B\.V\.|GMBH|PTY|FARMS?|FLOWERS?|FLORES|ROSES?|GROUP|TRADING|INTERNATIONAL|IMPORT|EXPORT)\b/gi;
export const normName = (s) => String(s || '').toUpperCase().replace(/\(.*?\)/g, ' ').replace(LEGAL_RE, ' ').replace(/[^A-Z0-9가-힣 ]/g, ' ').replace(/\s+/g, ' ').trim();

// 헤더 행 찾기(첫 10행 안에 '받는 분'·'송금금액'이 있는 행)
export function parseRemitRequestWorkbook(buffer, XLSX) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const out = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    const hi = rows.findIndex((r) => r.some((c) => /받는\s*분/.test(String(c))) && r.some((c) => /송금\s*금액/.test(String(c))));
    if (hi < 0) continue;
    const H = rows[hi].map((c) => String(c).replace(/\s+/g, ''));
    const col = (re) => H.findIndex((h) => re.test(h));
    const cRef = col(/거래접수번호|접수번호/), cDate = col(/^작성일|처리일|송금일/), cCur = col(/송금통화|통화/), cAmt = col(/송금금액|금액/), cPayee = col(/^받는분$|받는분\(|수취인/), cBank = col(/받는은행|수취은행/), cPlan = col(/송금예정일자|예정일/), cType = col(/송금구분|처리결과|상태/);
    for (const r of rows.slice(hi + 1)) {
      const payee = String(r[cPayee] || '').trim(); const amt = Number(String(r[cAmt] || '').replace(/[^0-9.\-]/g, ''));
      if (!payee || !(amt > 0)) continue;
      out.push({ receiptNo: String(r[cRef] || '').trim(), date: toDate(r[cDate]), currency: String(r[cCur] || 'USD').trim().toUpperCase() || 'USD', amount: amt, payee, bank: String(r[cBank] || '').trim(), plannedDate: toDate(r[cPlan]), kind: String(r[cType] || '').trim(), sheet: name });
    }
  }
  return out;
}
function toDate(v) { const s = String(v || '').trim(); const m = s.match(/(20\d{2})[.\-/]?(\d{2})[.\-/]?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; }

// 농장 매칭: ① paynames.json(농장명→법인명) 역방향 ② 원장 농장명 정규화 일치 ③ 토큰 포함/자카드
export function buildFarmMatcher(farmNames = [], paynamesPath = path.join(process.cwd(), 'data', 'import-farm-paynames.json')) {
  let pay = {}; try { pay = JSON.parse(fs.readFileSync(paynamesPath, 'utf8')); } catch {}
  const byLegal = new Map(); for (const [farm, legal] of Object.entries(pay)) byLegal.set(normName(legal), farm);
  const farms = [...new Set(farmNames.filter(Boolean))].map((f) => ({ farm: f, n: normName(f), toks: new Set(normName(f).split(' ').filter(Boolean)) }));
  return (payee) => {
    const n = normName(payee); if (!n) return { farm: '', score: 0 };
    if (byLegal.has(n)) return { farm: byLegal.get(n), score: 1, via: 'paynames' };
    for (const [legal, farm] of byLegal) if (legal && (n.includes(legal) || legal.includes(n))) return { farm, score: 0.95, via: 'paynames~' };
    const ex = farms.find((f) => f.n === n); if (ex) return { farm: ex.farm, score: 0.98, via: 'exact' };
    const toks = new Set(n.split(' ').filter((t) => t.length > 1)); let best = { farm: '', score: 0 };
    for (const f of farms) { if (!f.toks.size) continue; const inter = [...toks].filter((t) => f.toks.has(t)).length; if (!inter) continue; const score = inter / Math.max(toks.size, f.toks.size) + (n.includes(f.n) || f.n.includes(n) ? 0.3 : 0); if (score > best.score) best = { farm: f.farm, score: Math.min(0.94, Math.round(score * 100) / 100), via: 'fuzzy' }; }
    return best.score >= 0.5 ? best : { farm: '', score: best.score, via: 'none', suggest: best.farm };
  };
}
