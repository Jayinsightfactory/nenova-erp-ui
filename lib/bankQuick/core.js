// 은행 빠른조회 순수 함수(DB·브라우저 의존 없음). 계좌번호 원문은 어떤 함수도 로그/저장하지 않는다.
import crypto from 'node:crypto';

// HANA = 1차 대상(하나은행 기업뱅킹, 로그인 세션 재사용). NH/KB/WOORI/IBK = 빠른조회(자격증명 필요) 후보.
export const BANKS = ['HANA', 'NH', 'KB', 'WOORI', 'IBK'];

// 앞3·뒤4 만 남기고 가운데는 * (숫자 외 문자는 제거 후 처리)
export function maskAccountNo(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length < 8) return d ? '*'.repeat(d.length) : '';
  return `${d.slice(0, 3)}${'*'.repeat(d.length - 7)}${d.slice(-4)}`;
}

export function parseAmount(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[,\s원]/g, '');
  if (s === '' || s === '-') return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = Number(s.replace(/[()-]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

// '2026/11/03 13:05:22' '2026.11.03' '20261103' → { date:'2026-11-03', time:'13:05:22'|null }
export function parseDateTime(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\s*(\d{2}):?(\d{2}):?(\d{2})?)?$/);
  if (!m) return null;
  const p = (x) => String(x).padStart(2, '0');
  const date = `${m[1]}-${p(m[2])}-${p(m[3])}`;
  const time = m[4] !== undefined ? `${p(m[4])}:${m[5]}:${m[6] || '00'}` : null;
  return { date, time };
}

const pickCol = (headers, re) => headers.findIndex((h) => re.test(String(h).replace(/\s/g, '')));

// 결과 테이블(헤더+행 배열) → 정규화 거래 배열. 출금/입금 분리열 또는 구분+금액열 모두 지원.
export function parseTxnTable(headers, rows) {
  const ix = {
    dt: pickCol(headers, /거래일시|거래일자|일자|거래일/),
    out: pickCol(headers, /출금|찾으신금액|지급/),
    inn: pickCol(headers, /입금|맡기신금액|예입/),
    amt: pickCol(headers, /^(거래)?금액$/),
    kind: pickCol(headers, /^(거래)?구분$/),
    bal: pickCol(headers, /잔액/),
    desc: pickCol(headers, /거래내용|적요|기재내용/),
    cp: pickCol(headers, /거래기록사항|의뢰인|상대|받는분|보내는분|내용/),
    br: pickCol(headers, /거래점|취급점|지점/),
    memo: pickCol(headers, /메모|비고/),
  };
  const txns = [];
  const skipped = [];
  (rows || []).forEach((row, i) => {
    const cell = (k) => (ix[k] >= 0 ? row[ix[k]] : null);
    const dt = parseDateTime(cell('dt'));
    let type = null;
    let amount = null;
    const o = parseAmount(cell('out'));
    const n = parseAmount(cell('inn'));
    if (o && o > 0) { type = 'withdrawal'; amount = o; }
    else if (n && n > 0) { type = 'deposit'; amount = n; }
    else if (ix.amt >= 0) {
      const a = parseAmount(cell('amt'));
      const k = String(cell('kind') ?? '');
      if (a !== null && a !== 0) {
        if (/출금|지급|withdraw/i.test(k) || a < 0) type = 'withdrawal';
        else if (/입금|예입|deposit/i.test(k)) type = 'deposit';
        amount = Math.abs(a);
      }
    }
    if (!dt || !type || amount === null) { skipped.push(i + 1); return; }
    const raw = {};
    headers.forEach((h, c) => { raw[String(h)] = row[c] ?? null; });
    const txt = (k) => { const v = cell(k); const t = v === null || v === undefined ? '' : String(v).trim(); return t || null; };
    txns.push({
      rowNo: i + 1, txnDate: dt.date, txnTime: dt.time, type, amount,
      balance: parseAmount(cell('bal')), description: txt('desc'), displayName: txt('cp'),
      counterparty: txt('cp'), branch: txt('br'), memo: txt('memo'), raw,
    });
  });
  return { txns, skipped };
}

// 시각·금액·잔액·내용이 같은 행은 같은 해시. 완전히 동일한 행이 한 조회 안에 여러 번이면 순번(occ)으로 구분.
export function computeRowHash(accountKey, t, occ = 0) {
  const key = [accountKey, t.txnDate, t.txnTime ?? '', t.type, t.amount, t.balance ?? '', t.description ?? '', t.counterparty ?? '', occ].join('|');
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

export function withHashes(accountKey, txns) {
  const seen = new Map();
  return txns.map((t) => {
    const base = computeRowHash(accountKey, t, 0);
    const occ = seen.get(base) || 0;
    seen.set(base, occ + 1);
    return { ...t, hash: occ === 0 ? base : computeRowHash(accountKey, t, occ) };
  });
}

export function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s)); }

// [from,to] 를 달력 월 단위 [시작,끝] 구간 배열로 쪼갠다(YYYY-MM-DD). 하나은행은 전 기간 조회 가능 → 월 루프.
export function monthChunks(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const p = (n) => String(n).padStart(2, '0');
  for (;;) {
    const first = `${y}-${p(m)}-01`;
    const last = `${y}-${p(m)}-${p(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
    const s = first < from ? from : first;
    const e = last > to ? to : last;
    if (s > to) break;
    out.push([s, e]);
    if (e >= to) break;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// 하나은행 기업뱅킹 보안 모듈 중 브라우저 확장(TouchEn PC보안·INISAFE CrossWeb EX)은 크롬 '프로필'마다 설치된다.
// 사장님 크롬 프로필(Profile 1)에 설치된 확장 폴더를 그대로 --load-extension 으로 불러온다(복사 없음, 읽기만).
import fs from 'node:fs';
import path from 'node:path';
export function findBankExtensions(opts = {}) {
  const base = opts.userDataDir || path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
  const profiles = opts.profiles || ['Profile 1', 'Default', 'Profile 2', 'Profile 3'];
  const want = opts.match || /touchen|inisafe|crossweb|ipinside|ahnlab|veraport|wizvera|delfino/i;
  const found = [];
  for (const prof of profiles) {
    const extDir = path.join(base, prof, 'Extensions');
    if (!fs.existsSync(extDir)) continue;
    for (const id of fs.readdirSync(extDir)) {
      const idDir = path.join(extDir, id);
      let vers = []; try { vers = fs.readdirSync(idDir).filter((v) => fs.statSync(path.join(idDir, v)).isDirectory()).sort().reverse(); } catch { continue; }
      for (const v of vers) {
        const mf = path.join(idDir, v, 'manifest.json');
        if (!fs.existsSync(mf)) continue;
        let name = '';
        try {
          const j = JSON.parse(fs.readFileSync(mf, 'utf8')); name = String(j.name || '');
          if (/^__MSG_/.test(name)) { const key = name.replace(/^__MSG_|__$/g, ''); for (const lc of ['ko', 'en']) { const loc = path.join(idDir, v, '_locales', lc, 'messages.json'); if (fs.existsSync(loc)) { try { name = JSON.parse(fs.readFileSync(loc, 'utf8'))[key]?.message || name; break; } catch {} } } }
        } catch { continue; }
        if (want.test(name) || want.test(id)) { found.push({ id, name, dir: path.join(idDir, v), profile: prof }); break; }
      }
    }
    if (found.length) break;
  }
  return found;
}
export function bankExtensionArgs(exts) {
  if (!exts || !exts.length) return [];
  const dirs = exts.map((e) => e.dir).join(',');
  return [`--disable-extensions-except=${dirs}`, `--load-extension=${dirs}`];
}
