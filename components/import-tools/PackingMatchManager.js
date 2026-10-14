import React, {useMemo, useState} from 'react';
import {PACKING_COUNTRIES} from '../../lib/importPackingErpMatches.js';
import styles from '../../styles/PackingMatchManager.module.css';

const text = value => String(value ?? '');

function reviewReason(entry, product) {
  if (!product) return '현재 전산 품목 없음';
  if (product.country !== entry.country) return '연결 품목의 국가가 다름';
  if (!product.selectable) return '현재 선택할 수 없는 품목';
  if (product.ProdName !== entry.prodName) return '전산 품목명 변경';
  return '';
}

export default function PackingMatchManager({entries = [], products = [], disabled = false, onEdit, onReload}) {
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState('ALL');
  const [search, setSearch] = useState('');
  const [state, setState] = useState('ALL');
  const rows = useMemo(() => entries.map((entry, index) => {
    const product = products.find(item => item.ProdKey === entry.prodKey);
    return {entry, index, product, reason:reviewReason(entry, product)};
  }), [entries, products]);
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter(({entry, product, reason}) =>
      (country === 'ALL' || entry.country === country) &&
      (state === 'ALL' || Boolean(reason)) &&
      (!query || [entry.description, entry.prodName, product?.ProdName, product?.ProdCode]
        .some(value => text(value).toLocaleLowerCase().includes(query))));
  }, [rows, country, search, state]);

  return <section className={styles.manager} aria-label="팀 공용 DB 품목 매칭">
    <button type="button" className={styles.toggle} aria-expanded={open} aria-controls="packing-match-manager-panel"
      disabled={disabled} onClick={() => setOpen(value => !value)}>
      매칭 데이터 조회·수정 ({entries.length}) <span aria-hidden="true">{open ? '▴' : '▾'}</span>
    </button>
    {open && <div id="packing-match-manager-panel" className={styles.panel}>
      <p className={styles.scope}>팀 공용 전산 DB 품목 연결 기록만 표시합니다. 기존 변환 별칭·기본 변환 규칙은 포함하지 않습니다. 이 연결을 수정해도 이미 입고한 문서는 변경되지 않습니다.</p>
      <div className={styles.toolbar}>
        <label>국가
          <select value={country} onChange={event => setCountry(event.target.value)} disabled={disabled}>
            <option value="ALL">전체</option>
            {Object.entries(PACKING_COUNTRIES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <label className={styles.searchLabel}>품목 검색
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} disabled={disabled}
            placeholder="원문 · 저장명 · 현재명 · 코드" />
        </label>
        <label>상태
          <select value={state} onChange={event => setState(event.target.value)} disabled={disabled}>
            <option value="ALL">전체</option>
            <option value="REVIEW">확인 필요</option>
          </select>
        </label>
        <button type="button" className={styles.reload} onClick={onReload} disabled={disabled}>전산·매칭 다시 조회</button>
      </div>
      <p className={styles.count} role="status">{visible.length} / {entries.length}건 표시</p>
      <div className={styles.tableViewport}>
        <table className={styles.table}>
          <thead><tr><th scope="col">패킹 원문</th><th scope="col">국가</th><th scope="col">저장된 DB 연결</th><th scope="col">상태</th><th scope="col">작업</th></tr></thead>
          <tbody>
            {visible.map(({entry, index, product, reason}) => <tr key={`${entry.country}:${entry.sourceKey ?? entry.description}:${index}`}>
              <td className={styles.original}>{entry.description}</td>
              <td>{PACKING_COUNTRIES[entry.country] ?? entry.country}</td>
              <td className={styles.product}><strong>{entry.prodName}</strong><span>현재 코드: {product?.ProdCode || '—'}</span>
                {product && product.ProdName !== entry.prodName && <span>현재 이름: {product.ProdName}</span>}
              </td>
              <td><span className={reason ? styles.review : styles.valid}>{reason ? '확인 필요' : '정상'}</span>
                {reason && <small className={styles.reason}>{reason}</small>}
              </td>
              <td><button type="button" className={styles.edit} onClick={() => onEdit?.(entry)} disabled={disabled}>매칭 수정</button></td>
            </tr>)}
            {visible.length === 0 && <tr><td className={styles.empty} colSpan={5}>{entries.length ? '조건에 맞는 매칭이 없습니다.' : '저장된 팀 공용 DB 품목 연결이 없습니다.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>}
  </section>;
}
