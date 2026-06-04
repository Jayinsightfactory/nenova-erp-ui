// components/orders/PasteHighlight.js
// 붙여넣기 텍스트를 OCR처럼 색분류해 보여주는 미리보기.
//  줄 단위 분류: 차수(파랑) / 추가(초록)·취소·삭제(빨강) / 거래처(노랑) / 품목+수량(보라)
//  + 줄 안의 차수·추가·취소·수량 토큰을 강조.
// 시각 보조용 휴리스틱(완벽 파싱 아님). 거래처는 로드된 거래처명 사전으로 보정.
import { useMemo } from 'react';

const RE_WEEK = /(\d{1,2}\s*-\s*\d{1,2}\s*차?|CL\s*\d+|\d{4}\s*\/\s*\d{1,2}\s*\/\s*\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*차)/i;
const RE_ADD = /추가/;
const RE_CANCEL = /취소|삭제/;
const RE_QTY = /-?\d[\d,\.]*\s*(박스|단|송이|개|스팀|st|box|cm)?/i;
// 줄 안 토큰 강조용 (캡처 그룹으로 split)
const RE_TOKENS = /(\d{1,2}\s*-\s*\d{1,2}\s*차?|CL\s*\d+|추가|취소|삭제|-?\d[\d,\.]*\s*(?:박스|단|송이|개|스팀|st|box)?)/gi;

const C = {
  week: { bar: '#1565c0', bg: '#e3f2fd', tok: { background: '#bbdefb', color: '#0d47a1' } },
  add: { bar: '#2e7d32', bg: '#e8f5e9', tok: { background: '#c8e6c9', color: '#1b5e20' } },
  cancel: { bar: '#c62828', bg: '#ffebee', tok: { background: '#ffcdd2', color: '#b71c1c' } },
  customer: { bar: '#e65100', bg: '#fff3e0' },
  product: { bar: '#6a1b9a', bg: '#f3e5f5' },
  plain: { bar: 'transparent', bg: 'transparent' },
};

function buildCustomerSet(customers) {
  const set = new Set();
  for (const c of customers || []) {
    [c.CustName, c.OrderCode, c.custName].forEach(n => {
      const s = String(n || '').trim().toLowerCase();
      if (s) { set.add(s); set.add(s.split(/[\s/]/)[0]); }
    });
  }
  return set;
}

function classifyLine(line, custSet) {
  const t = line.trim();
  if (!t) return 'plain';
  if (RE_WEEK.test(t) && /차|cl|발주|변경|추가|취소|월/i.test(t)) return 'week';
  if (RE_CANCEL.test(t)) return 'cancel';
  if (RE_ADD.test(t)) return 'add';
  const head = t.toLowerCase().split(/[\s/(]/)[0];
  if (custSet.has(t.toLowerCase()) || custSet.has(head)) return 'customer';
  if (RE_QTY.test(t) && /\d/.test(t)) return 'product';
  // 숫자 없는 짧은 이름 줄 → 거래처로 추정
  if (!/\d/.test(t) && t.length <= 14 && !/[:：!?~.]/.test(t)) return 'customer';
  return 'plain';
}

function renderTokens(line) {
  const parts = line.split(RE_TOKENS);
  return parts.map((p, i) => {
    if (p == null || p === '') return null;
    if (RE_ADD.test(p) && !/\d/.test(p)) return <span key={i} style={tok(C.add.tok)}>{p}</span>;
    if (RE_CANCEL.test(p) && !/\d/.test(p)) return <span key={i} style={tok(C.cancel.tok)}>{p}</span>;
    if (/^(\d{1,2}\s*-\s*\d{1,2}\s*차?|CL\s*\d+)$/i.test(p.trim())) return <span key={i} style={tok(C.week.tok)}>{p}</span>;
    if (/^-?\d[\d,\.]*\s*(박스|단|송이|개|스팀|st|box)?$/i.test(p.trim())) return <span key={i} style={{ fontWeight: 700 }}>{p}</span>;
    return <span key={i}>{p}</span>;
  });
}
function tok(s) { return { ...s, borderRadius: 3, padding: '0 3px', fontWeight: 700 }; }

export default function PasteHighlight({ text, customers }) {
  const custSet = useMemo(() => buildCustomerSet(customers), [customers]);
  const lines = (text || '').split('\n');

  return (
    <div style={{ border: '1px solid #cfd8dc', borderRadius: 6, background: '#fff', marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '6px 10px', borderBottom: '1px solid #eceff1', fontSize: 11 }}>
        <Legend c={C.week.bar} t="차수/날짜" />
        <Legend c={C.add.bar} t="추가" />
        <Legend c={C.cancel.bar} t="취소/삭제" />
        <Legend c={C.customer.bar} t="거래처" />
        <Legend c={C.product.bar} t="품목+수량" />
      </div>
      <div style={{ maxHeight: 430, overflow: 'auto', padding: '4px 0', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.5 }}>
        {lines.map((line, i) => {
          const cat = classifyLine(line, custSet);
          const col = C[cat] || C.plain;
          return (
            <div key={i} style={{ padding: '1px 10px 1px 8px', borderLeft: `4px solid ${col.bar}`, background: col.bg, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {line === '' ? ' ' : renderTokens(line)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ c, t }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 12, height: 12, background: c, borderRadius: 2, display: 'inline-block' }} /> {t}
    </span>
  );
}
