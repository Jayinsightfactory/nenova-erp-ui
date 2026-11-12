import React, { useMemo } from 'react';
import { rankProductSuggestions } from '../../lib/invoiceMatchAssist.js';
import { receiptProductLabel } from '../../lib/invoiceReceiptProductSearch.js';

// 100% 미만이면 1순위를 크게, 2순위 이하는 옆에 버튼으로 둔다. 누르면 바로 그 품목으로 선택된다(저장·입고 등록은 하지 않음).
export function topSuggestion(line, products, country, history) {
  const ranked = rankProductSuggestions(line?.originalName, products, { country, limit: 1, history });
  return ranked.items[0] || null;
}

export default function InvoiceMatchSuggestions({ line, products, country, product, history, onSelect }) {
  const ranked = useMemo(() => rankProductSuggestions(line?.originalName, products, { country, limit: 5, history }), [line?.originalName, products, country, history]);
  if (!ranked.items.length) return null;
  const selectedKey = product ? Number(product.ProdKey) : null;
  // 이미 이름이 100% 같은 품목이 선택돼 있으면 보여 줄 필요가 없다.
  if (ranked.exact && selectedKey === Number(ranked.items[0].product.ProdKey)) return null;
  return <div role="group" aria-label={`${line.lineNo}행 후보 순위`} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
    {ranked.items.map((item, index) => {
      const active = selectedKey === Number(item.product.ProdKey);
      return <button type="button" key={item.product.ProdKey} aria-pressed={active} title={receiptProductLabel(item.product)}
        onClick={() => onSelect(item.product)}
        style={{ textAlign: 'left', whiteSpace: 'normal', maxWidth: 260, padding: index === 0 ? '5px 8px' : '3px 7px', fontSize: index === 0 ? 14 : 13,
          borderRadius: 5, border: active ? '2px solid #0b6b3a' : index === 0 ? '2px solid #1d5fb4' : '1px solid #c3d1e6',
          background: active ? '#e3f5ea' : index === 0 ? '#e8f1ff' : '#fff', color: '#163a65', fontWeight: index === 0 ? 700 : 400 }}>
        <small style={{ display: 'block', color: active ? '#0b6b3a' : '#4a5e78' }}>{index + 1}순위 · {item.score}%{item.history ? ` · 과거 ${item.history.count}회 매칭` : ''}{active ? ' · 선택됨' : ''}</small>
        {item.product.ProdName}
      </button>;
    })}
  </div>;
}
