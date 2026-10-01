import { useMemo, useState } from 'react';
import { Alert, Button, Select, Tag } from 'antd';
import { rankProductSearchOptions } from '../lib/productSearchRanking.js';

const fmt = (value) => Number(value ?? 0).toLocaleString();

export default function WarehousePackingReview({ items, rows, errors, products, valid, stale, validating, saving, onSelect }) {
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [queries, setQueries] = useState({});
  const productsByKey = useMemo(() => new Map((products || []).map((product) => [Number(product.ProdKey), product])), [products]);
  const errorByIndex = useMemo(() => {
    const map = new Map();
    for (const error of errors || []) {
      if (error.index != null && Number.isInteger(Number(error.index)) && Number(error.index) >= 0) {
        map.set(Number(error.index), error.error || error.message || error.reason);
      } else if (error.row != null) {
        const index = (items || []).findIndex((item) => Number(item.sourceRow) === Number(error.row));
        if (index >= 0) map.set(index, error.error || error.message || error.reason);
      }
    }
    return map;
  }, [errors, items]);
  const globalErrors = (errors || []).filter((error) => error.index == null && error.row == null);
  const visible = (items || []).map((item, index) => ({ item, index, result: rows?.[index] }))
    .filter(({ index, result }) => !errorsOnly || result?.status === 'error' || errorByIndex.has(index));
  const errorCount = (items || []).filter((_, index) => rows?.[index]?.status === 'error' || errorByIndex.has(index)).length;

  return <section className="packing-review">
    <div className="packing-review-tools">
      <strong>전체 {items?.length || 0}행 · 오류 {errorCount}행</strong>
      <label><input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} /> 오류 행만 보기</label>
      <span>{validating ? '품목 검증 중…' : valid ? '모든 행 검증 완료' : stale ? '이전 검증 결과 · 다시 검증 필요' : '검증 후 저장 가능'}</span>
    </div>
    {errors?.length > 0 && <Alert type="error" showIcon style={{ marginBottom: 8 }} message={`${errors.length}건의 오류가 있습니다. 품목 선택 또는 입력값을 확인하고 다시 검증하세요.`} description={globalErrors.map((error, index) => <div key={index}>{error.error || error.message || error.reason}</div>)} />}
    <div className="packing-review-scroll">
      <table className="packing-review-table">
        <thead><tr><th>원본 행</th><th>파일 원본 품목명</th><th>ERP 매칭 품목 · 국가/품종 · 단위</th><th>수동 품목 선택</th><th>박스</th><th>단</th><th>송이</th><th>검증</th></tr></thead>
        <tbody>{visible.map(({ item, index, result }) => {
          const selected = productsByKey.get(Number(item.selectedProdKey));
          const query = queries[index] ?? '';
          const ranked = query ? rankProductSearchOptions(query, products || [], { limit: 30 }) : (selected ? [selected] : []);
          const options = ranked.map((product) => ({ value: Number(product.ProdKey), disabled: Number(product.NameCount) !== 1, label: `${product.ProdName} · ${product.CounName || product.CountryFlower || ''} / ${product.FlowerName || ''} · ${product.OutUnit || '-'} / ${product.EstUnit || '-'}${Number(product.NameCount) !== 1 ? ' · 동명 중복(선택 불가)' : ''}` }));
          const reason = result?.error || errorByIndex.get(index);
          return <tr key={index} className={reason || result?.status === 'error' ? 'packing-review-error' : ''}>
            <td>{result?.sourceRow ?? item.sourceRow ?? index + 6}</td>
            <td><strong>{item.prodName}</strong><small>COD {item.orderCode || '–'}</small></td>
            <td>{result?.prodKey ? <><strong>{result.prodName}</strong><small>{result.countryFlower || '국가/품종 없음'} · 출고 {result.outUnit || '–'} / 견적 {result.estUnit || '–'}</small></> : <span className="packing-review-muted">{selected ? `${selected.ProdName} (재검증 필요)` : '매칭 없음'}</span>}</td>
            <td><div className="packing-review-choice"><Select showSearch allowClear disabled={validating || saving} value={item.selectedProdKey ? Number(item.selectedProdKey) : undefined} placeholder="품목명 검색" filterOption={false} onSearch={(value) => setQueries((current) => ({ ...current, [index]: value }))} onChange={(value) => { onSelect(index, value ?? null); setQueries((current) => ({ ...current, [index]: '' })); }} options={options} notFoundContent={query ? '검색 결과 없음' : '품목명을 입력하세요'} /><Button size="small" disabled={!item.selectedProdKey || validating || saving} onClick={() => onSelect(index, null)}>해제</Button></div></td>
            <td className="packing-review-number">{fmt(item.boxQty)}</td><td className="packing-review-number">{fmt(item.bunchQty)}</td><td className="packing-review-number">{fmt(item.steamQty)}</td>
            <td className="packing-review-status">{reason ? <Tag color="error" title={String(reason)}>{String(reason)}{stale ? ' (이전 검증)' : ''}</Tag> : result?.status === 'manual' ? <Tag color={stale ? 'default' : 'blue'}>수동 검증{stale ? ' · 이전' : ''}</Tag> : result?.status === 'exact' ? <Tag color={stale ? 'default' : 'success'}>정확 일치{stale ? ' · 이전' : ''}</Tag> : <Tag>재검증 필요</Tag>}</td>
          </tr>;
        })}</tbody>
      </table>
      {!visible.length && <div className="packing-review-empty">표시할 오류 행이 없습니다.</div>}
    </div>
    <style jsx>{`
      .packing-review { min-height: 0; display: flex; flex-direction: column; }
      .packing-review-tools { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
      .packing-review-tools span, .packing-review-muted { color: #65758a; }
      .packing-review-tools label { display: flex; gap: 6px; align-items: center; cursor: pointer; }
      .packing-review-scroll { overflow: auto; min-height: 150px; max-height: min(48vh, 520px); border: 1px solid #d9e1eb; border-radius: 6px; }
      .packing-review-table { border-collapse: collapse; width: 100%; min-width: 1250px; font-size: 12px; }
      .packing-review-table th { position: sticky; top: 0; z-index: 1; background: #f3f6fa; text-align: left; white-space: nowrap; }
      .packing-review-table td, .packing-review-table th { padding: 8px; border-bottom: 1px solid #e8edf3; vertical-align: top; }
      .packing-review-table td small { display: block; color: #65758a; margin-top: 3px; }
      .packing-review-error { background: #fff1f0; }
      .packing-review-number { text-align: right; white-space: nowrap; }
      .packing-review-choice { display: flex; gap: 4px; min-width: 290px; }
      .packing-review-choice :global(.ant-select) { flex: 1; min-width: 0; }
      .packing-review-status { max-width: 260px; min-width: 150px; }
      .packing-review-status :global(.ant-tag) { white-space: normal; max-width: 250px; overflow-wrap: anywhere; line-height: 1.4; }
      .packing-review-empty { padding: 18px; text-align: center; color: #65758a; }
    `}</style>
  </section>;
}
