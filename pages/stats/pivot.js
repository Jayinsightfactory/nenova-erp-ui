// pages/stats/pivot.js
// Pivot 통계 — 기존 프로그램과 동일한 구조
// 수정이력: 2026-03-30 — 완전 재구현
//   행 토글: 품목명, 출고일, 입고단가, 입고총단가, AWB
//   열: 주문년도 ▲, 주문차수 ▲, 구분(01전재고/02주문/03입고/05현재고) ▲▼, 지역 ▲, 비고 ▲, 거래처명/농장명 ▲
//   구분별 열: 02.주문=거래처명, 03.입고=농장명
//   즐겨찾기: 현재 설정 저장/불러오기

import { useState, useEffect, useMemo, useCallback } from 'react';
import { apiGet } from '../../lib/useApi';
import { useWeekInput, useYearInput, getCurrentWeek, WeekInput, YearInput } from '../../lib/useWeekInput';
import { t } from '../../lib/i18n';
import { useLang } from '../../lib/i18n';

const fN = n => (!n || n === 0) ? '' : Number(n).toFixed(2);

// 정렬 방향 토글
const nextSort = s => s === null ? 'asc' : s === 'asc' ? 'desc' : null;
const SortIcon = ({ dir }) => dir === 'asc' ? ' ▲' : dir === 'desc' ? ' ▼' : ' ▲';

// 컬럼 헤더 버튼 (클릭 시 정렬)
function ColHeader({ label, sortKey, sorts, onSort, filter, onFilter, filterOptions }) {
  const [showFilter, setShowFilter] = useState(false);
  const dir = sorts[sortKey] || null;
  return (
    <th style={{textAlign:'center', minWidth:80, fontSize:11, position:'relative', cursor:'pointer',
      background:'#D4DDE8', whiteSpace:'nowrap'}}
      onClick={() => onSort(sortKey)}
    >
      {label}<SortIcon dir={dir}/>
      {filterOptions && (
        <span onClick={e=>{e.stopPropagation();setShowFilter(s=>!s)}}
          style={{marginLeft:3, color:filter?.length?'var(--blue)':'var(--text3)', fontSize:10}}>▼</span>
      )}
      {showFilter && filterOptions && (
        <div style={{position:'absolute', top:'100%', left:0, zIndex:300,
          background:'#fff', border:'2px solid var(--border2)', minWidth:160,
          maxHeight:200, overflowY:'auto', boxShadow:'2px 2px 8px rgba(0,0,0,.2)'}}
          onClick={e=>e.stopPropagation()}>
          {filterOptions.map(opt => {
            const selected = filter?.length ? filter : filterOptions;
            const isChecked = selected.includes(opt);
            return (
              <label key={opt} style={{display:'flex', alignItems:'center', gap:6, padding:'4px 8px', fontSize:11, cursor:'pointer'}}>
                <input type="checkbox" checked={isChecked}
                  onChange={e => {
                    let next;
                    if (e.target.checked) {
                      next = [...selected, opt];
                    } else {
                      next = selected.filter(x => x !== opt);
                    }
                    if (next.length === filterOptions.length) next = [];
                    onFilter(sortKey, next);
                    e.stopPropagation();
                  }} />
                {opt}
              </label>
            );
          })}
          <div style={{padding:'4px 8px', borderTop:'1px solid var(--border)', display:'flex', gap:4}}>
            <button className="btn btn-sm" style={{fontSize:10,height:18}}
              onClick={() => {
                const allSelected = !filter?.length;
                onFilter(sortKey, allSelected ? ['__EMPTY__'] : []);
              }}>
              {!filter?.length ? '전체해제' : '전체선택'}
            </button>
            <button className="btn btn-sm" style={{fontSize:10,height:18}} onClick={()=>setShowFilter(false)}>{t('닫기')}</button>
          </div>
        </div>
      )}
    </th>
  );
}

export default function Pivot() {
  const { t } = useLang();
  const weekStartInput = useWeekInput('');
  const weekEndInput   = useWeekInput('');
  const [custFilter, setCustFilter] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // 행 추가 컬럼 토글
  const [showOutDate,  setShowOutDate]  = useState(false);
  const [showInPrice,  setShowInPrice]  = useState(false);
  const [showInTotal,  setShowInTotal]  = useState(false);
  const [showAWB,      setShowAWB]      = useState(false);
  const [showCost,     setShowCost]     = useState(false);
  const [showDescr,    setShowDescr]    = useState(false);
  const [showAmount,   setShowAmount]   = useState(false);
  const [showQty,      setShowQty]      = useState(true);
  const [showArea,     setShowArea]     = useState(false);

  // 열 구분 표시 여부
  const [showSections, setShowSections] = useState({ prev:true, order:true, incoming:true, none:true, cur:true });

  // 열 정렬
  const [sorts, setSorts] = useState({});
  const handleSort = useCallback(key => setSorts(s => ({ ...s, [key]: nextSort(s[key]) })), []);

  // 열 필터
  const [filters, setFilters] = useState({});
  const handleFilter = useCallback((key, vals) => setFilters(f => ({ ...f, [key]: vals })), []);

  // 접기
  const [collapsed, setCollapsed] = useState(new Set());
  const toggleCollapse = useCallback(key => setCollapsed(s => { const n=new Set(s); n.has(key)?n.delete(key):n.add(key); return n; }), []);

  // 즐겨찾기
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pivotFavs')||'[]'); } catch { return []; }
  });
  const [favName, setFavName] = useState('');
  const [showFavMenu, setShowFavMenu] = useState(false);

  const saveFav = () => {
    if (!favName.trim()) return;
    const cfg = { name:favName, showOutDate, showInPrice, showInTotal, showAWB, showCost, showQty, showSections };
    const next = [...favorites, cfg];
    setFavorites(next);
    localStorage.setItem('pivotFavs', JSON.stringify(next));
    setFavName(''); setShowFavMenu(false);
  };
  const loadFav = fav => {
    setShowOutDate(fav.showOutDate); setShowInPrice(fav.showInPrice);
    setShowInTotal(fav.showInTotal); setShowAWB(fav.showAWB); setShowCost(fav.showCost||false);
    setShowQty(fav.showQty); setShowSections(fav.showSections || {});
    setShowFavMenu(false);
  };
  const delFav = idx => {
    const next = favorites.filter((_,i)=>i!==idx);
    setFavorites(next);
    localStorage.setItem('pivotFavs', JSON.stringify(next));
  };

  const load = () => {
    if (!weekStartInput.value) { setErr('차수를 입력하세요.'); return; }
    setLoading(true); setErr('');
    apiGet('/api/stats/pivot-data', {
      weekStart: weekStartInput.value,
      weekEnd: weekEndInput.value || weekStartInput.value,
    })
      .then(d => { setData(d); setCollapsed(new Set()); setFilters({}); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleExcel = () => {
    if (!data) return;
    const custs = data.customers || [];
    const farms = data.farms || [];
    const hdrs = ['국가','꽃','품목명'];
    if (showArea)    hdrs.push('지역');
    if (showOutDate) hdrs.push('출고일');
    if (showInPrice) hdrs.push('입고단가');
    if (showInTotal) hdrs.push('입고총단가');
    if (showAWB)     hdrs.push('AWB');
    if (showCost)    hdrs.push('판매가격');
    if (showAmount)  hdrs.push('판매금액');
    if (showDescr)   hdrs.push('비고');
    if (showSections.prev)     hdrs.push('01.전재고');
    if (showSections.order)    custs.forEach(c=>hdrs.push(`주문_${c.custName}`));
    if (showSections.order)    hdrs.push('02.주문Total');
    if (showSections.incoming) farms.forEach(f=>hdrs.push(`입고_${f}`));
    if (showSections.none)     hdrs.push('03.미발주');
    if (showSections.cur)      hdrs.push('05.현재고');

    const rows = [hdrs];
    filteredRows.forEach(r=>{
      const row=[r.country,r.flower,r.prodName];
      if (showArea)    row.push(r.area||'');
      if (showOutDate) row.push(r.outDate||'');
      if (showInPrice) row.push(r.inPrice||0);
      if (showInTotal) row.push(r.inTotal||0);
      if (showAWB)     row.push(r.awb||'');
      if (showCost)    row.push(r.cost||0);
      if (showAmount)  row.push((r.cost||0)*(r.totalOrder||0));
      if (showDescr)   row.push(r.descr||'');
      if (showSections.prev)     row.push(r.prevStock||0);
      if (showSections.order)    custs.forEach(c=>row.push(r.orders?.[c.custName]||0));
      if (showSections.order)    row.push(r.totalOrder||0);
      if (showSections.incoming) farms.forEach(f=>row.push(r.incoming?.[f]||0));
      if (showSections.none)     row.push(r.noneOut||0);
      if (showSections.cur)      row.push(r.curStock||0);
      rows.push(row);
    });

    const csv = rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv],{type:'text/csv'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`Pivot통계_${weekStartInput.value}.csv`; a.click();
  };

  // 그룹핑
  const allCusts = data?.customers || [];
  const farms  = data?.farms || [];

  const custs = useMemo(() =>
    custFilter
      ? allCusts.filter(c => c.custName.toLowerCase().includes(custFilter.toLowerCase()) || c.area?.toLowerCase().includes(custFilter.toLowerCase()))
      : allCusts,
  [allCusts, custFilter]);

  // 필터 옵션 (필터용) — 데이터 변경 시만 재계산
  const areaOptions    = useMemo(() => [...new Set((data?.rows||[]).map(r=>r.area).filter(Boolean))].sort(),    [data]);
  const countryOptions = useMemo(() => [...new Set((data?.rows||[]).map(r=>r.country).filter(Boolean))].sort(), [data]);
  const flowerOptions  = useMemo(() => [...new Set((data?.rows||[]).map(r=>r.flower).filter(Boolean))].sort(),  [data]);
  const prodNameOptions= useMemo(() => [...new Set((data?.rows||[]).map(r=>r.prodName).filter(Boolean))].sort(),[data]);

  // 필터 적용 (__EMPTY__ = 전체 해제 → 아무것도 안 보임)
  const filteredRows = useMemo(() => (data?.rows||[]).filter(r => {
    if (filters.area?.includes('__EMPTY__'))     return false;
    if (filters.country?.includes('__EMPTY__'))  return false;
    if (filters.flower?.includes('__EMPTY__'))   return false;
    if (filters.prodName?.includes('__EMPTY__')) return false;
    if (filters.area?.length    && !filters.area.includes(r.area))       return false;
    if (filters.country?.length && !filters.country.includes(r.country)) return false;
    if (filters.flower?.length  && !filters.flower.includes(r.flower))   return false;
    if (filters.prodName?.length && !filters.prodName.includes(r.prodName)) return false;
    return true;
  }), [data, filters]);

  // 정렬 함수
  const sortFn = useCallback((a, b) => {
    for (const [key, dir] of Object.entries(sorts)) {
      if (!dir) continue;
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  }, [sorts]);

  // 그룹핑 + 정렬 — filteredRows/sorts 변경 시만 재계산
  const sortedCountries = useMemo(() => {
    const grouped = {};
    filteredRows.forEach(r => {
      const ck = r.country;
      if (!grouped[ck]) grouped[ck] = { country:r.country, flowers:{} };
      const fk = r.flower;
      if (!grouped[ck].flowers[fk]) grouped[ck].flowers[fk] = { flower:r.flower, items:[] };
      grouped[ck].flowers[fk].items.push(r);
    });

    // 아이템 정렬
    Object.values(grouped).forEach(gc => {
      Object.values(gc.flowers).forEach(gf => { gf.items = [...gf.items].sort(sortFn); });
    });

    // 국가/꽃 그룹 정렬
    const sc = Object.values(grouped).sort((a, b) => {
      const dir = sorts.country;
      if (!dir) return String(a.country).localeCompare(String(b.country));
      const cmp = String(a.country).localeCompare(String(b.country));
      return dir === 'asc' ? cmp : -cmp;
    });
    sc.forEach(gc => {
      gc._sortedFlowers = Object.values(gc.flowers).sort((a, b) => {
        const dir = sorts.flower;
        if (!dir) return String(a.flower).localeCompare(String(b.flower));
        const cmp = String(a.flower).localeCompare(String(b.flower));
        return dir === 'asc' ? cmp : -cmp;
      });
    });
    return sc;
  }, [filteredRows, sorts, sortFn]);

  // 고정 좌측 컬럼 수 (국가+꽃+품목명 + 선택 열들)
  const totalFixedCols = useMemo(() =>
    3 + (showArea?1:0) + (showOutDate?1:0) + (showInPrice?1:0) + (showInTotal?1:0)
      + (showAWB?1:0) + (showCost?1:0) + (showAmount?1:0) + (showDescr?1:0),
  [showArea, showOutDate, showInPrice, showInTotal, showAWB, showCost, showAmount, showDescr]);

  return (
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 72px)'}}>
      {/* 툴바 */}
      <div className="filter-bar">
        <WeekInput weekInput={weekStartInput} label="주문차수"/>
        <span style={{color:'var(--text3)'}}>~</span>
        <WeekInput weekInput={weekEndInput}/>
        <span style={{borderLeft:'1px solid var(--border)',margin:'0 4px'}}></span>
        <span className="filter-label">거래처</span>
        <input className="filter-input" style={{width:100,height:22,fontSize:11}} placeholder="거래처 검색..."
          value={custFilter} onChange={e=>setCustFilter(e.target.value)} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>{t('새로고침')}</button>
          <button className="btn" onClick={handleExcel}>{t('엑셀')}</button>
          {/* 즐겨찾기 */}
          <div style={{position:'relative', display:'inline-block'}}>
            <button className="btn" onClick={()=>setShowFavMenu(s=>!s)}>
              ⭐ 즐겨찾기{favorites.length>0?` (${favorites.length})`:''}
            </button>
            {showFavMenu && (
              <div style={{position:'absolute',top:'100%',right:0,zIndex:300,background:'#fff',
                border:'2px solid var(--border2)',width:260,boxShadow:'2px 2px 8px rgba(0,0,0,.2)'}}>
                <div style={{padding:'6px 8px',background:'var(--header-bg)',fontWeight:'bold',fontSize:12,borderBottom:'1px solid var(--border)'}}>
                  ⭐ 즐겨찾기
                </div>
                <div style={{padding:'6px 8px',borderBottom:'1px solid var(--border)'}}>
                  <div style={{fontSize:11,color:'var(--text3)',marginBottom:4}}>현재 설정 저장</div>
                  <div style={{display:'flex',gap:4}}>
                    <input className="filter-input" style={{flex:1,height:22}} placeholder="이름..."
                      value={favName} onChange={e=>setFavName(e.target.value)}/>
                    <button className="btn btn-sm" onClick={saveFav}>{t('저장')}</button>
                  </div>
                </div>
                {favorites.length===0
                  ? <div style={{padding:'10px',fontSize:11,color:'var(--text3)',textAlign:'center'}}>없음</div>
                  : favorites.map((fav,idx)=>(
                    <div key={idx} style={{padding:'5px 8px',borderBottom:'1px solid #EEE',display:'flex',alignItems:'center',gap:6,fontSize:12}}>
                      <span style={{flex:1,cursor:'pointer',color:'var(--blue)'}} onClick={()=>loadFav(fav)}>⭐ {fav.name}</span>
                      <button className="btn btn-sm" style={{height:18,fontSize:10,color:'var(--red)'}} onClick={()=>delFav(idx)}>✕</button>
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        </div>
      </div>

      {err && <div className="banner-err">{err}</div>}

      {/* ■ Pivot 통계 헤더 */}
      <div style={{padding:'2px 8px',background:'var(--header-bg)',border:'1px solid var(--border)',borderTop:'none',fontSize:12,fontWeight:'bold',flexShrink:0}}>
        ■ Pivot 통계
      </div>

      {/* 행 토글 버튼 */}
      <div style={{padding:'3px 8px',background:'#EEF4FA',border:'1px solid var(--border)',borderTop:'none',display:'flex',gap:4,flexWrap:'wrap',alignItems:'center',flexShrink:0}}>
        {/* 행 추가 컬럼 */}
        {[
          {label:'품목명',  active:true,   onClick:null,                     disabled:true},
          {label:'지역',    active:showArea, onClick:()=>setShowArea(s=>!s)},
          {label:'출고일',  active:showOutDate, onClick:()=>setShowOutDate(s=>!s)},
          {label:'입고단가',active:showInPrice,  onClick:()=>setShowInPrice(s=>!s)},
          {label:'입고총단가',active:showInTotal,onClick:()=>setShowInTotal(s=>!s)},
          {label:'AWB',     active:showAWB, onClick:()=>setShowAWB(s=>!s)},
          {label:'판매가격',active:showCost, onClick:()=>setShowCost(s=>!s)},
          {label:'판매금액',active:showAmount, onClick:()=>setShowAmount(s=>!s)},
          {label:'비고',   active:showDescr, onClick:()=>setShowDescr(s=>!s)},
        ].map(b=>(
          <button key={b.label}
            className={`btn btn-sm ${b.active?'btn-primary':''}`}
            style={{height:22,fontSize:11}}
            onClick={b.onClick} disabled={b.disabled}
          >{b.label}</button>
        ))}
        <span style={{borderLeft:'1px solid var(--border)',margin:'0 4px'}}></span>
        <button className={`btn btn-sm ${showQty?'btn-primary':''}`} style={{height:22,fontSize:11}}
          onClick={()=>setShowQty(s=>!s)}>수량</button>
        <span style={{borderLeft:'1px solid var(--border)',margin:'0 4px'}}></span>
        {/* 구분 표시 토글 */}
        {[
          {k:'prev',    l:'01.전재고'},
          {k:'order',   l:'02.주문'},
          {k:'incoming',l:'03.입고'},
          {k:'none',    l:'03.미발주'},
          {k:'cur',     l:'05.현재고'},
        ].map(s=>(
          <button key={s.k}
            className={`btn btn-sm ${showSections[s.k]?'btn-primary':''}`}
            style={{height:22,fontSize:11}}
            onClick={()=>setShowSections(p=>({...p,[s.k]:!p[s.k]}))}
          >{s.l}</button>
        ))}
        <span style={{borderLeft:'1px solid var(--border)',margin:'0 4px'}}></span>
        <button className="btn btn-sm" style={{height:22,fontSize:11}} onClick={()=>setCollapsed(new Set())}>▼ 펼침</button>
        <button className="btn btn-sm" style={{height:22,fontSize:11}} onClick={()=>{
          const keys=new Set();
          sortedCountries.forEach(gc=>{keys.add(gc.country);
            (gc._sortedFlowers||Object.values(gc.flowers||{})).forEach(gf=>keys.add(gc.country+'|'+gf.flower));});
          setCollapsed(keys);
        }}>▶ 닫기</button>
      </div>

      {/* 피벗 테이블 */}
      <div style={{flex:1,overflow:'auto',border:'1px solid var(--border2)',borderTop:'none'}}>
        {loading ? <div className="skeleton" style={{height:300,margin:16}}></div>
        : !data ? (
          <div className="empty-state"><div className="empty-icon">📊</div><div className="empty-text">차수 입력 후 새로고침</div></div>
        ) : (
          <table className="tbl" style={{fontSize:11, minWidth: 500+(showSections.order?custs.length*70:0)+(showSections.incoming?farms.length*70:0)}}>
            <thead>
              {/* 1행: 주문년도 */}
              <tr style={{background:'#C0CCE0'}}>
                <th colSpan={totalFixedCols}
                  style={{borderRight:'2px solid var(--border2)', fontSize:11, padding:'2px 8px', textAlign:'left'}}>
                </th>
                {showSections.prev     && <th style={{background:'#B8C8E0', textAlign:'center', fontSize:10}}>{weekStartInput.value?.split('-')[0]||'2026'}</th>}
                {showSections.order    && <th colSpan={custs.length+1} style={{background:'#B8D8B8', textAlign:'center', fontSize:10}}>{weekStartInput.value?.split('-')[0]||'2026'}</th>}
                {showSections.incoming && <th colSpan={farms.length||1} style={{background:'#D8C8B0', textAlign:'center', fontSize:10}}>{weekStartInput.value?.split('-')[0]||'2026'}</th>}
                {showSections.none     && <th style={{background:'#D8D0A0', textAlign:'center', fontSize:10}}>{weekStartInput.value?.split('-')[0]||'2026'}</th>}
                {showSections.cur      && <th style={{background:'#C0C0D8', textAlign:'center', fontSize:10}}>{weekStartInput.value?.split('-')[0]||'2026'}</th>}
              </tr>
              {/* 2행: 주문차수 */}
              <tr style={{background:'#C8D4E4'}}>
                <th colSpan={totalFixedCols}
                  style={{borderRight:'2px solid var(--border2)'}}></th>
                {showSections.prev     && <th style={{background:'#C0CCE4', textAlign:'center', fontSize:10}}>{weekStartInput.value}</th>}
                {showSections.order    && <th colSpan={custs.length+1} style={{background:'#C0D8C0', textAlign:'center', fontSize:10}}>{weekStartInput.value}</th>}
                {showSections.incoming && <th colSpan={farms.length||1} style={{background:'#D8CCBC', textAlign:'center', fontSize:10}}>{weekStartInput.value}</th>}
                {showSections.none     && <th style={{background:'#D8D4AC', textAlign:'center', fontSize:10}}>{weekStartInput.value}</th>}
                {showSections.cur      && <th style={{background:'#C4C4DC', textAlign:'center', fontSize:10}}>{weekStartInput.value}</th>}
              </tr>
              {/* 3행: 구분 */}
              <tr style={{background:'#D0D8E8'}}>
                <th colSpan={totalFixedCols}
                  style={{borderRight:'2px solid var(--border2)'}}></th>
                {showSections.prev     && <th style={{background:'#C8D0E8',textAlign:'center',fontSize:10}}>∨ 01. 전재고</th>}
                {showSections.order    && <th colSpan={custs.length+1} style={{background:'#C8D8C8',textAlign:'center',fontSize:10}}>∨ 02. 주문</th>}
                {showSections.incoming && <th colSpan={farms.length||1} style={{background:'#D8CCC0',textAlign:'center',fontSize:10}}>∨ 03. 입고</th>}
                {showSections.none     && <th style={{background:'#DCD8B0',textAlign:'center',fontSize:10}}>∨ 03. 미발주</th>}
                {showSections.cur      && <th style={{background:'#C8C8E0',textAlign:'center',fontSize:10}}>∨ 05. 현재고</th>}
              </tr>
              {/* 4행: 컬럼 헤더 */}
              <tr style={{background:'var(--header-bg)'}}>
                <ColHeader label="국가"    sortKey="country" sorts={sorts} onSort={handleSort} onFilter={handleFilter}
                  filter={filters.country} filterOptions={countryOptions}/>
                <ColHeader label="꽃"      sortKey="flower"  sorts={sorts} onSort={handleSort} onFilter={handleFilter}
                  filter={filters.flower}  filterOptions={flowerOptions}/>
                <ColHeader label="품목명(색상)" sortKey="prodName" sorts={sorts} onSort={handleSort} onFilter={handleFilter}
                  filter={filters.prodName} filterOptions={prodNameOptions}
                  style={{minWidth:180, borderRight:'2px solid var(--border2)'}}/>
                {showArea     && <ColHeader label="지역" sortKey="area" sorts={sorts} onSort={handleSort} onFilter={handleFilter}
                  filter={filters.area} filterOptions={areaOptions}/>}
                {showOutDate  && <th style={{fontSize:10,minWidth:80}}>출고일</th>}
                {showInPrice  && <th style={{fontSize:10,minWidth:70,textAlign:'right'}}>입고단가</th>}
                {showInTotal  && <th style={{fontSize:10,minWidth:80,textAlign:'right'}}>입고총단가</th>}
                {showAWB      && <th style={{fontSize:10,minWidth:80}}>AWB</th>}
                {showCost     && <th style={{fontSize:10,minWidth:70,textAlign:'right'}}>판매가격</th>}
                {showAmount   && <th style={{fontSize:10,minWidth:80,textAlign:'right'}}>판매금액</th>}
                {showDescr    && <th style={{fontSize:10,minWidth:80}}>비고</th>}
                {/* 01. 전재고 */}
                {showSections.prev && (
                  <ColHeader label="전재고" sortKey="prevStock" sorts={sorts} onSort={handleSort}/>
                )}
                {/* 02. 주문 — 거래처별 */}
                {showSections.order && custs.map(c=>(
                  <th key={c.custName} style={{textAlign:'center',minWidth:65,fontSize:10,background:'#D4ECD4',
                    maxWidth:90,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                    title={c.custName}>
                    <div>∨ {c.area}</div>
                    <div style={{fontSize:9,color:'var(--text3)'}}>∨ {c.custName.length>7?c.custName.slice(0,7)+'…':c.custName}</div>
                    <div style={{fontSize:9}}>{c.orderCode}</div>
                  </th>
                ))}
                {showSections.order && (
                  <th style={{background:'#B8D4B8',textAlign:'center',fontSize:10,fontWeight:'bold',
                    minWidth:70,borderLeft:'2px solid var(--border2)'}}>
                    02. 주문 Total
                  </th>
                )}
                {/* 03. 입고 — 농장별 */}
                {showSections.incoming && farms.map(f=>(
                  <th key={f} style={{textAlign:'center',minWidth:70,fontSize:10,background:'#E8DCCC',
                    maxWidth:90,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={f}>
                    ∨ {f.length>8?f.slice(0,8)+'…':f}
                  </th>
                ))}
                {showSections.incoming && farms.length===0 && (
                  <th style={{background:'#E8DCCC',textAlign:'center',fontSize:10,minWidth:70}}>입고 없음</th>
                )}
                {/* 03. 미발주 */}
                {showSections.none && (
                  <ColHeader label="미발주" sortKey="noneOut" sorts={sorts} onSort={handleSort}/>
                )}
                {/* 05. 현재고 */}
                {showSections.cur && (
                  <ColHeader label="현재고" sortKey="curStock" sorts={sorts} onSort={handleSort}/>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedCountries.length===0 ? (
                <tr><td colSpan={20} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>데이터 없음</td></tr>
              ) : sortedCountries.map(gCountry => {
                const ck = gCountry.country;
                const isCC = collapsed.has(ck);
                const cTot = { prev:0, order:0, none:0, cur:0, custO:{}, farmI:{} };
                Object.values(gCountry.flowers).forEach(gf=>gf.items.forEach(r=>{
                  cTot.prev  += r.prevStock||0;
                  cTot.order += r.totalOrder||0;
                  cTot.none  += r.noneOut||0;
                  cTot.cur   += r.curStock||0;
                  custs.forEach(c=>{cTot.custO[c.custName]=(cTot.custO[c.custName]||0)+(r.orders?.[c.custName]||0);});
                  farms.forEach(f=>{cTot.farmI[f]=(cTot.farmI[f]||0)+(r.incoming?.[f]||0);});
                }));
                return [
                  <tr key={`c-${ck}`} style={{background:'#D0DDE8',cursor:'pointer'}} onClick={()=>toggleCollapse(ck)}>
                    <td colSpan={totalFixedCols} style={{padding:'2px 8px',fontWeight:'bold',fontSize:12,borderRight:'2px solid var(--border2)'}}>
                      {isCC?'▶':'∨'} {gCountry.country}
                    </td>
                    {showSections.prev     && <td className="num" style={{fontWeight:'bold',background:'#C4CCE4'}}>{fN(cTot.prev)}</td>}
                    {showSections.order    && custs.map(c=><td key={c.custName} className="num" style={{background:'#C8DCC8'}}>{fN(cTot.custO[c.custName])}</td>)}
                    {showSections.order    && <td className="num" style={{fontWeight:'bold',background:'#B0CEB0'}}>{fN(cTot.order)}</td>}
                    {showSections.incoming && farms.map(f=><td key={f} className="num" style={{background:'#DCC8B8'}}>{fN(cTot.farmI[f])}</td>)}
                    {showSections.incoming && farms.length===0 && <td></td>}
                    {showSections.none     && <td className="num" style={{fontWeight:'bold',background:'#D8D0A8'}}>{fN(cTot.none)}</td>}
                    {showSections.cur      && <td className="num" style={{fontWeight:'bold',background:'#BEBEDE'}}>{fN(cTot.cur)}</td>}
                  </tr>,

                  ...(!isCC ? (gCountry._sortedFlowers || Object.values(gCountry.flowers)).map(gFlower=>{
                    const fk = ck+'|'+gFlower.flower;
                    const isFC = collapsed.has(fk);
                    const fTot = { prev:0, order:0, none:0, cur:0, custO:{}, farmI:{} };
                    gFlower.items.forEach(r=>{
                      fTot.prev  += r.prevStock||0;
                      fTot.order += r.totalOrder||0;
                      fTot.none  += r.noneOut||0;
                      fTot.cur   += r.curStock||0;
                      custs.forEach(c=>{fTot.custO[c.custName]=(fTot.custO[c.custName]||0)+(r.orders?.[c.custName]||0);});
                      farms.forEach(f=>{fTot.farmI[f]=(fTot.farmI[f]||0)+(r.incoming?.[f]||0);});
                    });

                    return [
                      <tr key={`f-${fk}`} style={{background:'#D8E4F0',cursor:'pointer'}} onClick={()=>toggleCollapse(fk)}>
                        <td style={{width:8}}></td>
                        <td colSpan={totalFixedCols-1} style={{padding:'2px 8px',fontWeight:'bold',fontSize:11,borderRight:'2px solid var(--border2)'}}>
                          {isFC?'▶':'∨'} {gFlower.flower} <span style={{fontSize:10,color:'var(--text3)'}}>({gFlower.items.length})</span>
                        </td>
                        {showSections.prev     && <td className="num" style={{background:'#CCD4EC'}}>{fN(fTot.prev)}</td>}
                        {showSections.order    && custs.map(c=><td key={c.custName} className="num" style={{background:'#CCE0CC'}}>{fN(fTot.custO[c.custName])}</td>)}
                        {showSections.order    && <td className="num" style={{fontWeight:'bold',background:'#B4D0B4'}}>{fN(fTot.order)}</td>}
                        {showSections.incoming && farms.map(f=><td key={f} className="num" style={{background:'#DCCCC0'}}>{fN(fTot.farmI[f])}</td>)}
                        {showSections.incoming && farms.length===0 && <td></td>}
                        {showSections.none     && <td className="num" style={{background:'#DDD8B0'}}>{fN(fTot.none)}</td>}
                        {showSections.cur      && <td className="num" style={{background:'#C4C4E0'}}>{fN(fTot.cur)}</td>}
                      </tr>,

                      ...(!isFC ? gFlower.items.map((r,idx)=>(
                        <tr key={`i-${r.prodKey}-${idx}`} style={{background:idx%2===0?'#fff':'var(--row-alt)'}}>
                          <td></td><td></td>
                          <td style={{fontSize:11,fontWeight:500,borderRight: showArea?'none':'2px solid var(--border2)',padding:'1px 6px',minWidth:160}}>
                            {r.prodName}
                          </td>
                          {showArea     && <td style={{fontSize:10,borderRight:'2px solid var(--border2)',color:'var(--text3)'}}>{r.area||''}</td>}
                          {showOutDate  && <td style={{fontSize:10}}>{r.outDate||''}</td>}
                          {showInPrice  && <td className="num" style={{fontSize:10}}>{fN(r.inPrice)}</td>}
                          {showInTotal  && <td className="num" style={{fontSize:10}}>{fN(r.inTotal)}</td>}
                          {showAWB      && <td style={{fontSize:10}}>{r.awb||''}</td>}
                          {showCost     && <td className="num" style={{fontSize:10,color:'var(--blue)'}}>{fN(r.cost)}</td>}
                          {showAmount   && <td className="num" style={{fontSize:10,color:'var(--green)'}}>{fN((r.cost||0)*(r.totalOrder||0))}</td>}
                          {showDescr    && <td style={{fontSize:10,color:'var(--text3)',maxWidth:100,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.descr}>{r.descr||''}</td>}
                          {showSections.prev && (
                            <td className="num" style={{background:'#F0F4FF',color:(r.prevStock||0)>0?'var(--blue)':'var(--text3)'}}>{fN(r.prevStock)}</td>
                          )}
                          {showSections.order && custs.map(c=>(
                            <td key={c.custName} className="num" style={{background:'#F4FFF4',color:(r.orders?.[c.custName]||0)>0?'#006600':'var(--text3)'}}>
                              {fN(r.orders?.[c.custName])}
                            </td>
                          ))}
                          {showSections.order && (
                            <td className="num" style={{fontWeight:'bold',background:'#E8F8E8',borderLeft:'2px solid var(--border2)',color:(r.totalOrder||0)>0?'#006600':'var(--text3)'}}>
                              {fN(r.totalOrder)}
                            </td>
                          )}
                          {showSections.incoming && farms.map(f=>(
                            <td key={f} className="num" style={{background:'#FFF8F0',color:(r.incoming?.[f]||0)>0?'var(--amber)':'var(--text3)'}}>
                              {fN(r.incoming?.[f])}
                            </td>
                          ))}
                          {showSections.incoming && farms.length===0 && <td></td>}
                          {showSections.none && (
                            <td className="num" style={{background:'#FFFCE8',color:(r.noneOut||0)>0?'var(--amber)':'var(--text3)'}}>{fN(r.noneOut)}</td>
                          )}
                          {showSections.cur && (
                            <td className="num" style={{background:'#F4F4FF',color:(r.curStock||0)<0?'var(--red)':(r.curStock||0)>0?'var(--blue)':'var(--text3)'}}>
                              {fN(r.curStock)}
                            </td>
                          )}
                        </tr>
                      )) : []),

                      <tr key={`ft-${fk}`} style={{background:'#D4E0EC',borderTop:'1px solid var(--border)'}}>
                        <td colSpan={totalFixedCols} style={{padding:'2px 16px',fontSize:11,color:'var(--text3)',borderRight:'2px solid var(--border2)'}}>
                          {gFlower.flower} Total
                        </td>
                        {showSections.prev     && <td className="num" style={{fontWeight:'bold',background:'#CAD2EA'}}>{fN(fTot.prev)}</td>}
                        {showSections.order    && custs.map(c=><td key={c.custName} className="num" style={{fontWeight:'bold',background:'#C8DCC8'}}>{fN(fTot.custO[c.custName])}</td>)}
                        {showSections.order    && <td className="num" style={{fontWeight:'bold',background:'#B0CEB0'}}>{fN(fTot.order)}</td>}
                        {showSections.incoming && farms.map(f=><td key={f} className="num" style={{fontWeight:'bold',background:'#D8C8B4'}}>{fN(fTot.farmI[f])}</td>)}
                        {showSections.incoming && farms.length===0 && <td></td>}
                        {showSections.none     && <td className="num" style={{fontWeight:'bold',background:'#DAD4AC'}}>{fN(fTot.none)}</td>}
                        {showSections.cur      && <td className="num" style={{fontWeight:'bold',background:'#C0C0DC'}}>{fN(fTot.cur)}</td>}
                      </tr>,
                    ];
                  }) : []),
                ];
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
