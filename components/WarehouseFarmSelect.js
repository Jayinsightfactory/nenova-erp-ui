import { useState } from 'react';
import { warehouseFarmSearch } from '../lib/warehouseFarmChoices.js';

export default function WarehouseFarmSelect({ farms, currentFarm, value, onChange, label = '수정 농장', placeholder }) {
  const [search, setSearch] = useState('');
  const { names, matches } = warehouseFarmSearch(farms, search, [currentFarm, value]);
  const visible = names.filter(name => name === value || matches.includes(name));
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, minWidth: 0 }}>
    <label style={{ maxWidth: '100%', minWidth: 0 }}>농장 검색<input type="search" aria-label="농장 검색" placeholder="농장명 입력" value={search}
      onChange={e => setSearch(e.target.value)} style={{ maxWidth: '100%', width: '100%' }} /></label>
    <label style={{ maxWidth: '100%', minWidth: 0 }}>{label}<select aria-label={label} value={value} size={search.trim()?Math.min(6,Math.max(2,visible.length)):1} onChange={e => onChange(e.target.value)} style={{ maxWidth: '100%', minWidth: 0, width: '100%' }}>
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {visible.map(name => <option key={name} value={name}>{name}</option>)}
    </select></label>
    <small role="status" aria-live="polite">{search ? matches.length ? `${matches.length}개 농장 검색 결과` : '검색 결과가 없습니다. 현재 선택은 유지됩니다.' : `${names.length}개 농장`}</small>
  </div>;
}
