import { useState } from 'react';
import useRankedProductSearch from '../../lib/useRankedProductSearch';

export default function PasteProductSearch({ products, initialQuery = '', selectedKey, onPick }) {
  const [query, setQuery] = useState(initialQuery);
  const { results, loading, error } = useRankedProductSearch(query, products, { limit: 10 });
  return <>
    <input autoFocus value={query} onChange={event => setQuery(event.target.value)}
      placeholder="품목명으로 검색 (예: 문라이트, mariposa)"
      style={{ width: '100%', padding: '5px 8px', border: '1px solid #90caf9', borderRadius: 5, fontSize: 12, boxSizing: 'border-box' }} />
    <div style={{ maxHeight: 170, overflow: 'auto', marginTop: 4 }} aria-busy={loading}>
      {(loading || error || !results.length) && <div role="status" style={{ fontSize: 11, color: error ? '#c62828' : '#607d8b', padding: 6 }}>
        {loading ? '품목 검색 중…' : error || (query.trim() ? '검색 결과가 없습니다.' : '검색어를 입력하세요.')}
      </div>}
      {results.map(product => <button key={product.ProdKey} type="button" onClick={() => onPick(product)}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', border: 0, borderBottom: '1px solid #e3f2fd', background: Number(product.ProdKey) === Number(selectedKey) ? '#e3f2fd' : '#fff', cursor: 'pointer', fontSize: 12 }}>
        <b>{product.DisplayName || product.ProdName}</b>
        <span style={{ color: '#90a4ae', marginLeft: 6, fontSize: 11 }}>{[product.CounName, product.FlowerName].filter(Boolean).join(' · ')}</span>
      </button>)}
    </div>
  </>;
}
