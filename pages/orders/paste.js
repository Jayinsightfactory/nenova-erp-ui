// pages/orders/paste.js — 붙여넣기 주문등록 (Claude AI 파싱, 다중거래처/변경사항, 미매칭 질문)
import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';
import { apiGet } from '../../lib/useApi';
import { filterProducts, jamoSimilarity, getDisplayName } from '../../lib/displayName';
import { getCurrentWeek, formatWeekDisplay } from '../../lib/useWeekInput';
import { defaultUnit } from '../../lib/orderUtils';

const MAPPING_KEY = 'nenova_paste_mappings';

// 오늘 기준 2026 차수 (항상 신형식 YYYY-WW-SS)
function getDefaultWeek() {
  return getCurrentWeek(); // 2026-WW-01
}

// 현재 주차 기준 ±N 범위의 2026 차수 목록 (최신순)
function getNearby2026Weeks(range = 4) {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const dayOfYear = Math.floor((now - start) / 86400000) + 1;
  const curWeek = Math.min(Math.ceil(dayOfYear / 7), 52);
  const weeks = [];
  for (let w = curWeek + range; w >= Math.max(1, curWeek - range); w--) {
    weeks.push(`${year}-${String(w).padStart(2,'0')}-01`);
  }
  return weeks;
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(MAPPING_KEY) || '{}'); } catch { return {}; }
}
function saveCache(cache) {
  try { localStorage.setItem(MAPPING_KEY, JSON.stringify(cache)); } catch {}
}
function cacheKey(inputName) {
  return (inputName || '').toLowerCase().trim();
}

export default function PasteOrderPage() {
  const [allProducts, setAllProducts] = useState([]);
  const [allCustomers, setAllCustomers] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [week, setWeek] = useState('');
  const [weekPage, setWeekPage] = useState(0);
  const WEEK_PAGE_SIZE = 6;
  const [showOldWeeks, setShowOldWeeks] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [orders, setOrders] = useState([]);
  const [parseError, setParseError] = useState('');
  const [mappingCache, setMappingCache] = useState({});
  const [queueIdx, setQueueIdx] = useState(0);   // 현재 질문 중인 미매칭 항목 인덱스
  const [disambigSearch, setDisambigSearch] = useState('');
  const [disambigResults, setDisambigResults] = useState([]);
  const [registeredOrders, setRegisteredOrders] = useState({}); // orderId → DB 주문내역
  const [prodUnitMap, setProdUnitMap] = useState({}); // { [ProdKey]: '박스'|'단'|'송이' }

  useEffect(() => {
    setMappingCache(loadCache());
    apiGet('/api/master', { entity: 'customers' }).then(d => setAllCustomers(d.data || []));
    apiGet('/api/master', { entity: 'products'  }).then(d => setAllProducts(d.data  || []));
    apiGet('/api/orders/prod-units').then(d => { if (d.success) setProdUnitMap(d.units || {}); });
    apiGet('/api/orders/weeks').then(d => {
      if (d.success) {
        const def = getDefaultWeek();
        const nearby = getNearby2026Weeks(4); // 2026 최근 ±4주
        const dbWeeks = (d.weeks || []).filter(w => !nearby.includes(w)); // 중복 제거
        // 2026 차수 먼저, 그 다음 DB 구형식(25년도) 차수
        const ws = [...nearby, ...dbWeeks];
        setWeeks(ws);
        setWeek(def);
        setWeekPage(0);
      }
    });
  }, []);

  // 캐시 적용: 이미 알고 있는 inputName은 자동 매칭
  const applyCache = (rawOrders, cache, prods) => rawOrders.map(o => ({
    ...o,
    items: o.items.map(it => {
      if (it.prodKey) return it;
      const hit = cache[cacheKey(it.inputName)];
      if (!hit) return it;
      const prod = prods.find(p => p.ProdKey === hit.prodKey);
      if (!prod) return it;
      return { ...it, prodKey: prod.ProdKey, prodName: prod.ProdName, displayName: prod.DisplayName || prod.ProdName, unit: defaultUnit(prod, it.unit, prodUnitMap) };
    }),
  }));

  const handleParse = async () => {
    if (!pasteText.trim()) return;
    setParsing(true);
    setOrders([]);
    setParseError('');
    setQueueIdx(0);
    setDisambigSearch('');
    setDisambigResults([]);
    try {
      const res = await fetch('/api/orders/parse-paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text: pasteText }),
      });
      const d = await res.json();
      if (!d.success) { setParseError(d.error || '파싱 실패'); return; }

      const cache = loadCache();
      setMappingCache(cache);

      const raw = (d.orders || []).map((o, oi) => ({
        id: oi,
        custMatch: o.custMatch,
        saving: false,
        resultMsg: '',
        items: (o.items || []).map((it, idx) => {
          const prod = it.prodKey ? allProducts.find(p => p.ProdKey === it.prodKey) : null;
          return {
            ...it,
            idx,
            unit: defaultUnit(prod, it.unit, prodUnitMap),
            skip: false,
          };
        }),
      }));

      const applied = applyCache(raw, cache, allProducts);
      setOrders(applied);

      // 거래처 매칭된 업체의 저장내역 자동 로드
      if (week) {
        applied.forEach(async (o) => {
          if (!o.custMatch) return;
          try {
            const od = await apiGet('/api/orders', { custName: o.custMatch.CustName, week });
            if (od.success && od.orders?.length > 0) {
              const matched = od.orders.find(r => r.custName === o.custMatch.CustName) || od.orders[0];
              setRegisteredOrders(prev => ({ ...prev, [o.id]: matched }));
            }
          } catch { /* 조회 실패 무시 */ }
        });
      }
    } catch (e) {
      setParseError(e.message);
    } finally {
      setParsing(false);
    }
  };

  // 전체 미매칭 항목 (skip 제외, 이미 매칭된 것 제외)
  const unmatchedQueue = [];
  orders.forEach(o => {
    o.items.forEach((it, idx) => {
      if (!it.skip && !it.prodKey) {
        unmatchedQueue.push({ orderId: o.id, itemIdx: idx, inputName: it.inputName, action: it.action });
      }
    });
  });
  const currentQ = unmatchedQueue[queueIdx] || null;

  const updateItem = (oid, idx, patch) => {
    setOrders(prev => prev.map(o =>
      o.id === oid
        ? { ...o, items: o.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }
        : o
    ));
  };

  const updateOrder = (oid, patch) => {
    setOrders(prev => prev.map(o => o.id === oid ? { ...o, ...patch } : o));
  };

  const handleProdSearch = (oid, idx, q) => {
    const results = q ? filterProducts(allProducts, q).slice(0, 10) : [];
    updateItem(oid, idx, { prodSearch: q, prodSearchResults: results });
  };

  // 미매칭 질문 패널: 사용자가 품목 선택
  const handleDisambigSelect = (prod, saveToCache = true) => {
    if (!currentQ) return;
    const { orderId, itemIdx, inputName } = currentQ;
    updateItem(orderId, itemIdx, {
      prodKey:     prod.ProdKey,
      prodName:    prod.ProdName,
      displayName: prod.DisplayName || prod.ProdName,
      unit:        defaultUnit(prod, null, prodUnitMap),  // 장미/네덜란드 → 단, 나머지 → 박스
    });
    if (saveToCache) {
      const updated = { ...mappingCache, [cacheKey(inputName)]: { prodKey: prod.ProdKey, prodName: prod.ProdName } };
      setMappingCache(updated);
      saveCache(updated);
      // 서버에도 저장 (전 사용자 공유 학습)
      fetch('/api/orders/mappings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ inputToken: inputName, prodKey: prod.ProdKey, prodName: prod.ProdName,
          displayName: prod.DisplayName, flowerName: prod.FlowerName, counName: prod.CounName }),
      }).catch(() => {});
    }
    setDisambigSearch('');
    setDisambigResults([]);
    // queueIdx는 그대로 — 이 항목이 사라지면서 다음 항목이 자동으로 currentQ가 됨
  };

  const handleDisambigSkip = () => {
    if (!currentQ) return;
    updateItem(currentQ.orderId, currentQ.itemIdx, { skip: true });
    setDisambigSearch('');
    setDisambigResults([]);
  };

  const handleDisambigSkipAll = () => {
    unmatchedQueue.forEach(q => updateItem(q.orderId, q.itemIdx, { skip: true }));
    setDisambigSearch('');
    setDisambigResults([]);
  };

  // 품목 스코어링: inputName + 검색어 조합, 0~100
  const scoreProduct = (inputName, prod, searchQuery = '') => {
    const dn = (getDisplayName(prod) || '').toLowerCase();
    const pn = (prod.ProdName || '').toLowerCase();
    const fn = (prod.FlowerName || '').toLowerCase();
    const q  = (inputName || '').toLowerCase();

    let score = Math.max(
      jamoSimilarity(q, dn),
      jamoSimilarity(q, pn),
      jamoSimilarity(q, fn),
      dn.includes(q) ? 1 : 0,
      pn.includes(q) ? 1 : 0,
    );

    if (searchQuery) {
      const sq = searchQuery.toLowerCase();
      const sqScore = Math.max(
        jamoSimilarity(sq, dn),
        jamoSimilarity(sq, pn),
        dn.includes(sq) ? 1 : 0,
        pn.includes(sq) ? 1 : 0,
      );
      if (sqScore > 0) score = Math.max(score, sqScore);
    }
    return Math.round(score * 100);
  };

  // 후보 목록: 검색어 없으면 inputName 기준 자동 스코어링, 있으면 필터+스코어
  const buildCandidates = (inputName, searchQuery) => {
    const base = searchQuery
      ? filterProducts(allProducts, searchQuery)
      : allProducts;
    return base
      .map(p => ({ prod: p, score: scoreProduct(inputName, p, searchQuery) }))
      .filter(x => searchQuery ? true : x.score >= 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
  };

  const handleDisambigSearchChange = (q) => {
    setDisambigSearch(q);
    setDisambigResults(buildCandidates(currentQ?.inputName || '', q));
  };

  // currentQ 바뀌면 자동으로 후보 계산
  useEffect(() => {
    if (currentQ) {
      setDisambigSearch('');
      setDisambigResults(buildCandidates(currentQ.inputName, ''));
    } else {
      setDisambigResults([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQ?.orderId, currentQ?.itemIdx]);

  const flog = (step, detail) => fetch('/api/log', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ category: 'paste', step, detail: String(detail) }),
  }).catch(() => {});

  const handleRegister = async (oid) => {
    const order = orders.find(o => o.id === oid);

    const allItems  = order?.items || [];
    const addItems  = allItems.filter(it => !it.skip && it.action !== '취소');
    const matched   = addItems.filter(it => it.prodKey);
    const unmatched = addItems.filter(it => !it.prodKey);
    await flog('버튼클릭', `oid=${oid} custMatch=${order?.custMatch?.CustName||'없음'} week=${week} 전체=${allItems.length} 추가대상=${addItems.length} 매칭=${matched.length} 미매칭=${unmatched.length} 미매칭품목=${unmatched.map(i=>i.inputName||'?').join(',')}`);

    if (!order?.custMatch) { alert('거래처를 확인하세요.'); return; }
    if (!week) { alert('차수를 선택하세요.'); return; }

    const items = order.items
      .filter(it => !it.skip && it.prodKey && it.action !== '취소')
      .map(it => ({ prodKey: it.prodKey, prodName: it.prodName, qty: it.qty, unit: it.unit }));

    if (items.length === 0) { await flog('0건차단', `미매칭으로 API 미호출`); alert('등록할 추가 품목이 없습니다.'); return; }

    const yearFromWeek = week.match(/^(\d{4})-/) ? week.match(/^(\d{4})-/)[1] : String(new Date().getFullYear());

    updateOrder(oid, { saving: true, resultMsg: '' });
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ custKey: order.custMatch.CustKey, week, year: yearFromWeek, items }),
      });
      const d = await res.json();
      if (d.success) {
        const okCount = d.results?.filter(r => r.status === 'OK' || r.status === 'UPDATED').length ?? items.length;
        updateOrder(oid, { saving: false, resultMsg: `✅ ${okCount}개 저장 완료 (${order.custMatch.CustName} / ${formatWeekDisplay(week)}) — OrderKey: ${d.orderMasterKey}` });
        // 저장 성공한 품목의 inputName→prodKey 매핑 서버에 학습
        const mappingItems = order.items.filter(it => !it.skip && it.prodKey && it.inputName && it.action !== '취소');
        mappingItems.forEach(it => {
          fetch('/api/orders/mappings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
            body: JSON.stringify({ inputToken: it.inputName, prodKey: it.prodKey, prodName: it.prodName,
              displayName: it.displayName, flowerName: it.flowerName, counName: it.counName }),
          }).catch(() => {});
        });
        try {
          const od = await apiGet('/api/orders', { custName: order.custMatch.CustName, week });
          if (od.success && od.orders?.length > 0) {
            const matched = od.orders.find(o => o.custName === order.custMatch.CustName) || od.orders[0];
            setRegisteredOrders(prev => ({ ...prev, [oid]: matched }));
          }
        } catch { /* 조회 실패해도 저장은 완료 */ }
      } else {
        updateOrder(oid, { saving: false, resultMsg: `❌ ${d.error || '저장 실패'}` });
      }
    } catch (e) {
      updateOrder(oid, { saving: false, resultMsg: `❌ 네트워크 오류: ${e.message}` });
    }
  };

  const totalAdd    = orders.reduce((s, o) => s + o.items.filter(it => !it.skip && it.action !== '취소' && it.prodKey).length, 0);
  const totalCancel = orders.reduce((s, o) => s + o.items.filter(it => !it.skip && it.action === '취소').length, 0);
  const cachedEntries = Object.keys(mappingCache).length;

  return (
    <Layout title="붙여넣기 주문등록">
      <div style={{ padding: '16px 20px', maxWidth: 980, margin: '0 auto', paddingBottom: currentQ ? 280 : 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a237e', margin: 0 }}>
            📋 붙여넣기 주문등록
          </h2>
          {orders.length > 0 && (
            <button
              onClick={() => {
                setPasteText('');
                setOrders([]);
                setParseError('');
                setQueueIdx(0);
                setDisambigSearch('');
                setDisambigResults([]);
                setRegisteredOrders({});
              }}
              style={{ padding: '6px 16px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              ✏️ 다른 주문하기
            </button>
          )}
          {cachedEntries > 0 && (
            <span style={{ fontSize: 11, color: '#888', background: '#f0f0f0', padding: '2px 8px', borderRadius: 10 }}>
              💾 저장된 매칭 {cachedEntries}개
              <button
                onClick={() => { saveCache({}); setMappingCache({}); }}
                style={{ marginLeft: 6, fontSize: 10, color: '#c62828', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >초기화</button>
            </span>
          )}
        </div>

        {/* 차수 선택 */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelS}>차수</label>
          {/* 2026 차수 (신형식) */}
          {(() => {
            const newWeeks = weeks.filter(w => w.match(/^\d{4}-/));
            const oldWeeks = weeks.filter(w => !w.match(/^\d{4}-/));
            return (
              <div>
                {/* 2026 섹션 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: '#1a237e', fontWeight: 700, background: '#e8eaf6', padding: '2px 8px', borderRadius: 10 }}>2026</span>
                  {newWeeks.map(w => (
                    <button key={w} onClick={() => setWeek(w)}
                      style={{
                        padding: '5px 22px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                        border: week === w ? '2px solid #1a237e' : '1px solid #c5cae9',
                        background: week === w ? '#1a237e' : '#f3f4ff',
                        color: week === w ? '#fff' : '#1a237e',
                        fontWeight: week === w ? 700 : 500,
                      }}>
                      {formatWeekDisplay(w)}
                    </button>
                  ))}
                </div>

                {/* 이전 차수 (25년도) */}
                {oldWeeks.length > 0 && (
                  <div>
                    <button onClick={() => setShowOldWeeks(v => !v)}
                      style={{ fontSize: 11, color: '#888', background: 'none', border: '1px solid #ddd', borderRadius: 10, padding: '2px 10px', cursor: 'pointer', marginBottom: 4 }}>
                      {showOldWeeks ? '▲' : '▼'} 이전 차수 (25년도) {oldWeeks.length}개
                    </button>
                    {showOldWeeks && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {oldWeeks.map(w => (
                          <button key={w} onClick={() => setWeek(w)}
                            style={{
                              padding: '4px 11px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                              border: week === w ? '2px solid #888' : '1px solid #ddd',
                              background: week === w ? '#666' : '#f9f9f9',
                              color: week === w ? '#fff' : '#888',
                            }}>
                            {formatWeekDisplay(w)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {week && (
                  <div style={{ fontSize: 12, color: '#1a237e', fontWeight: 600, marginTop: 4 }}>
                    선택: {formatWeekDisplay(week)}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* 텍스트 입력 */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelS}>
            텍스트 붙여넣기
            <span style={{ fontWeight: 400, color: '#888', fontSize: 11, marginLeft: 6 }}>
              기본형 (거래처명 / 품목 | 수량) 또는 변경사항형 (섹션헤더 + 거래처 + 품목 추가/취소)
            </span>
          </label>
          <textarea
            style={{ width: '100%', height: 200, padding: '10px 12px', border: '1px solid #bbb', borderRadius: 6, fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }}
            placeholder={'[변경사항형]\n16-1 수국 변경사항\n미우\n화이트 3박스 취소\n\n공주\n블루 1박스 추가\n\n[기본형]\n청화꽃집\nCaroline | 2'}
            value={pasteText}
            onChange={e => { setPasteText(e.target.value); setOrders([]); setParseError(''); setQueueIdx(0); }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
          <button
            onClick={handleParse}
            disabled={parsing || !pasteText.trim()}
            style={{ padding: '9px 24px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: parsing ? 0.7 : 1 }}
          >
            {parsing ? '🤖 분석 중...' : '🤖 Claude로 분석'}
          </button>
          {parseError && <span style={{ color: '#c62828', fontSize: 13 }}>❌ {parseError}</span>}
          {orders.length > 0 && (
            <span style={{ fontSize: 13, color: '#555' }}>
              <b style={{ color: '#1a237e' }}>{orders.length}개 거래처</b>
              {totalAdd > 0 && <> / <b style={{ color: '#2e7d32' }}>추가 {totalAdd}건</b></>}
              {totalCancel > 0 && <> / <b style={{ color: '#c62828' }}>취소 {totalCancel}건</b></>}
              {unmatchedQueue.length > 0 && <> / <b style={{ color: '#e65100' }}>미매칭 {unmatchedQueue.length}개</b></>}
            </span>
          )}
        </div>

        {/* 거래처별 주문 카드 */}
        {orders.map(order => {
          const addItems    = order.items.filter(it => !it.skip && it.action !== '취소');
          const cancelItems = order.items.filter(it => !it.skip && it.action === '취소');
          const matchedAdd  = addItems.filter(it => it.prodKey);
          const unmatched   = addItems.filter(it => !it.prodKey);

          return (
            <div key={order.id} style={{ border: '1px solid #c5cae9', borderRadius: 8, marginBottom: 16, overflow: 'hidden' }}>
              {/* 거래처 헤더 */}
              <div style={{
                background: order.custMatch ? '#1a237e' : '#e65100',
                color: '#fff', padding: '10px 16px',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                {order.custMatch ? (
                  <>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>✅ {order.custMatch.CustName}</span>
                    <span style={{ fontSize: 12, opacity: 0.8 }}>{order.custMatch.CustArea}</span>
                    <button onClick={() => updateOrder(order.id, { custMatch: null })}
                      style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 4, cursor: 'pointer' }}>
                      변경
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>⚠️ 거래처 미확인</span>
                    <div style={{ flex: 1 }}>
                      <CustSelector customers={allCustomers}
                        onSelect={c => updateOrder(order.id, { custMatch: c })} />
                    </div>
                  </>
                )}
              </div>

              {/* 품목 테이블 */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#e8eaf6' }}>
                      <th style={thS(30)}>#</th>
                      <th style={thS(46)}>동작</th>
                      <th style={thS(160, 'left')}>입력 품목명</th>
                      <th style={thS(60)}>수량</th>
                      <th style={thS(70)}>단위</th>
                      <th style={{ padding: '7px 8px', textAlign: 'left', fontWeight: 600, color: '#333' }}>매칭 결과</th>
                      <th style={thS(60)}>건너뛰기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((it, idx) => {
                      const isCancel = it.action === '취소';
                      const isCurrentQ = currentQ?.orderId === order.id && currentQ?.itemIdx === idx;
                      return (
                        <tr key={idx} style={{
                          background: it.skip ? '#fafafa' :
                            isCurrentQ ? '#fff9c4' :
                            isCancel ? '#fff3e0' :
                            it.prodKey ? '#e8f5e9' : '#fff8e1',
                          opacity: it.skip ? 0.4 : 1,
                          borderBottom: '1px solid #eee',
                          outline: isCurrentQ ? '2px solid #f9a825' : 'none',
                        }}>
                          <td style={{ padding: '5px 8px', textAlign: 'center', color: '#aaa', fontSize: 11 }}>{idx + 1}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <span style={{
                              fontSize: 11, padding: '2px 7px', borderRadius: 10, fontWeight: 700,
                              background: isCancel ? '#ffcdd2' : '#c8e6c9',
                              color: isCancel ? '#c62828' : '#2e7d32',
                            }}>
                              {isCancel ? '취소' : '추가'}
                            </span>
                          </td>
                          <td style={{
                            padding: '5px 8px', fontFamily: 'monospace', fontSize: 12,
                            textDecoration: isCancel ? 'line-through' : 'none',
                            color: isCancel ? '#999' : isCurrentQ ? '#333' : '#333',
                            fontWeight: isCurrentQ ? 700 : 400,
                          }}>
                            {isCurrentQ && <span style={{ color: '#f9a825', marginRight: 4 }}>❓</span>}
                            {it.inputName}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <input type="number" min="0" step="0.5" value={it.qty}
                              onChange={e => updateItem(order.id, idx, { qty: parseFloat(e.target.value) || 0 })}
                              style={{ width: 56, padding: '2px 4px', border: '1px solid #ddd', borderRadius: 4, textAlign: 'right', fontSize: 13 }} />
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <select value={it.unit} onChange={e => {
                              const newUnit = e.target.value;
                              updateItem(order.id, idx, { unit: newUnit });
                              if (it.prodKey) {
                                fetch('/api/orders/prod-units', {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  credentials: 'same-origin',
                                  body: JSON.stringify({ prodKey: it.prodKey, unit: newUnit }),
                                });
                              }
                            }}
                              style={{ fontSize: 12, padding: '2px 4px', border: '1px solid #ddd', borderRadius: 4 }}>
                              <option>박스</option><option>단</option><option>송이</option>
                            </select>
                          </td>
                          <td style={{ padding: '4px 8px' }}>
                            {it.prodKey ? (() => {
                              const pd = allProducts.find(p => p.ProdKey === it.prodKey);
                              return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <span style={{ color: '#1b5e20', fontWeight: 600, fontSize: 12 }}>
                                    ✅ {it.displayName || it.prodName}
                                  </span>
                                  {pd?.CounName && <span style={{ fontSize: 10, background: '#e8f5e9', color: '#388e3c', borderRadius: 8, padding: '1px 6px' }}>{pd.CounName}</span>}
                                  {pd?.FlowerName && <span style={{ fontSize: 10, background: '#f3e5f5', color: '#7b1fa2', borderRadius: 8, padding: '1px 6px' }}>{pd.FlowerName}</span>}
                                  <span style={{ color: '#aaa', fontSize: 10 }}>{it.prodName}</span>
                                  <button onClick={() => updateItem(order.id, idx, { prodKey: null, prodName: null, displayName: null })}
                                    style={{ fontSize: 10, padding: '1px 5px', background: 'none', border: '1px solid #ddd', borderRadius: 3, cursor: 'pointer', color: '#aaa', marginLeft: 'auto' }}>
                                    변경
                                  </button>
                                </div>
                              );
                            })() : it.skip ? null : (
                              <span style={{ fontSize: 11, color: isCurrentQ ? '#f57f17' : '#bbb' }}>
                                {isCurrentQ ? '↓ 아래에서 선택' : '대기 중…'}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <input type="checkbox" checked={it.skip}
                              onChange={e => updateItem(order.id, idx, { skip: e.target.checked })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 카드 하단 액션 */}
              <div style={{ padding: '10px 16px', background: '#f5f5f5', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                {order.resultMsg && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: order.resultMsg.startsWith('✅') ? '#1b5e20' : '#c62828' }}>
                    {order.resultMsg}
                  </span>
                )}
                {cancelItems.length > 0 && (
                  <span style={{ fontSize: 12, color: '#e65100' }}>⚠️ 취소 {cancelItems.length}건 (수동처리)</span>
                )}
                {unmatched.length > 0 && (
                  <span style={{ fontSize: 12, color: '#e65100' }}>❓ 미매칭 {unmatched.length}개</span>
                )}
                <button
                  onClick={() => handleRegister(order.id)}
                  disabled={order.saving || matchedAdd.length === 0 || !order.custMatch || !week}
                  style={{
                    marginLeft: 'auto',
                    padding: '8px 24px',
                    background: (matchedAdd.length > 0 && order.custMatch && week) ? '#2e7d32' : '#bbb',
                    color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700,
                    cursor: (matchedAdd.length > 0 && order.custMatch && week) ? 'pointer' : 'not-allowed',
                  }}
                >
                  {order.saving ? '등록 중...' : `💾 추가 ${matchedAdd.length}건 등록`}
                </button>
              </div>

              {/* 등록 후 DB 주문내역 */}
              {registeredOrders[order.id] && (() => {
                const ro = registeredOrders[order.id];
                return (
                  <div style={{ borderTop: '2px solid #2e7d32', background: '#f1f8e9' }}>
                    <div style={{ padding: '8px 16px', fontWeight: 700, fontSize: 13, color: '#2e7d32', display: 'flex', alignItems: 'center', gap: 8 }}>
                      📋 DB 저장 내역 — {ro.custName} / {formatWeekDisplay(ro.week)}
                      <button onClick={() => setRegisteredOrders(p => { const n={...p}; delete n[order.id]; return n; })}
                        style={{ marginLeft: 'auto', fontSize: 11, padding: '1px 8px', background: 'none', border: '1px solid #a5d6a7', borderRadius: 4, color: '#388e3c', cursor: 'pointer' }}>
                        닫기
                      </button>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#c8e6c9' }}>
                            <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600 }}>품목명</th>
                            <th style={{ padding: '5px 8px', fontWeight: 600 }}>국가</th>
                            <th style={{ padding: '5px 8px', fontWeight: 600 }}>꽃</th>
                            <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>수량</th>
                            <th style={{ padding: '5px 8px', fontWeight: 600 }}>단위</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(ro.items || []).map((it, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid #dcedc8', background: i%2===0?'#f9fbe7':'#f1f8e9' }}>
                              <td style={{ padding: '4px 8px' }}>{it.displayName || it.prodName}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'center', color: '#388e3c', fontSize: 11 }}>{it.counName || '—'}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'center', color: '#7b1fa2', fontSize: 11 }}>{it.flowerName || '—'}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>{it.qty}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'center', color: '#666' }}>{it.unit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* ── 미매칭 질문 패널 (sticky bottom) ── */}
      {currentQ && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#fff', borderTop: '3px solid #f9a825',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
          padding: '14px 24px 16px',
          zIndex: 500,
        }}>
          <div style={{ maxWidth: 980, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#333' }}>
                ❓ &nbsp;
                <span style={{ color: '#1a237e' }}>'{currentQ.inputName}'</span>
                &nbsp;은(는) 어떤 품목인가요?
              </span>
              <span style={{
                fontSize: 11, padding: '2px 7px', borderRadius: 10, fontWeight: 700,
                background: currentQ.action === '취소' ? '#ffcdd2' : '#c8e6c9',
                color: currentQ.action === '취소' ? '#c62828' : '#2e7d32',
              }}>
                {currentQ.action}
              </span>
              <span style={{ fontSize: 12, color: '#aaa', marginLeft: 'auto' }}>
                미매칭 {unmatchedQueue.length}개 남음
              </span>
            </div>

            {/* 후보 카드 목록 (항상 표시, 매칭률 순) */}
            {disambigResults.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {disambigResults.map(({ prod: p, score }) => {
                  const pctColor = score >= 70 ? '#2e7d32' : score >= 40 ? '#e65100' : '#999';
                  const pctBg    = score >= 70 ? '#e8f5e9' : score >= 40 ? '#fff3e0' : '#f5f5f5';
                  return (
                    <button key={p.ProdKey}
                      onMouseDown={() => handleDisambigSelect(p)}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 2,
                        padding: '6px 10px', border: `1px solid ${score >= 70 ? '#a5d6a7' : '#ddd'}`,
                        borderRadius: 8, background: '#fff', cursor: 'pointer',
                        textAlign: 'left', minWidth: 120, maxWidth: 180,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background='#f0f4ff'}
                      onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 6,
                          background: pctBg, color: pctColor, whiteSpace: 'nowrap',
                        }}>{score}%</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a237e', lineHeight: 1.3 }}>
                        {p.DisplayName || p.ProdName}
                      </div>
                      <div style={{ fontSize: 10, color: '#888' }}>{p.ProdName}</div>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {p.CounName && <span style={{ fontSize: 9, background: '#e8f5e9', color: '#388e3c', borderRadius: 6, padding: '1px 4px' }}>{p.CounName}</span>}
                        {p.FlowerName && <span style={{ fontSize: 9, background: '#f3e5f5', color: '#7b1fa2', borderRadius: 6, padding: '1px 4px' }}>{p.FlowerName}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                autoFocus
                type="text"
                placeholder="추가 검색으로 좁히기 (한글/영문)…"
                value={disambigSearch}
                onChange={e => handleDisambigSearchChange(e.target.value)}
                style={{ flex: 1, padding: '8px 12px', border: '2px solid #f9a825', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
              />
              <button
                onClick={handleDisambigSkip}
                style={{ padding: '8px 16px', border: '1px solid #bbb', background: '#f5f5f5', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#666', whiteSpace: 'nowrap' }}
              >
                건너뛰기
              </button>
              <button
                onClick={handleDisambigSkipAll}
                style={{ padding: '9px 18px', border: '1px solid #ffcdd2', background: '#fff', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#c62828', whiteSpace: 'nowrap' }}
              >
                전부 건너뛰기
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>
              💾 선택 시 이 이름은 자동으로 저장됩니다 — 다음번에 같은 이름이 오면 자동 매칭
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function CustSelector({ customers, onSelect }) {
  const [q, setQ] = useState('');
  const results = q ? customers.filter(c => c.CustName?.includes(q)) : customers.slice(0, 15);
  return (
    <div style={{ position: 'relative' }}>
      <input type="text" placeholder="거래처 검색..." value={q} onChange={e => setQ(e.target.value)}
        style={{ width: '100%', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.5)', borderRadius: 4, fontSize: 13, background: 'rgba(255,255,255,0.9)' }} />
      {results.length > 0 && q && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: 180, overflowY: 'auto' }}>
          {results.map(c => (
            <div key={c.CustKey}
              style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f5f5f5', color: '#111', background: '#fff' }}
              onMouseEnter={e => e.currentTarget.style.background='#f0f4ff'}
              onMouseLeave={e => e.currentTarget.style.background='#fff'}
              onMouseDown={() => { onSelect(c); setQ(''); }}>
              <strong style={{ color: '#1a237e' }}>{c.CustName}</strong>
              <span style={{ color: '#666', fontSize: 11, marginLeft: 6 }}>{c.CustArea}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const labelS = { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 };
const thS = (w, align = 'center') => ({ width: w, minWidth: w, padding: '7px 8px', textAlign: align, fontWeight: 600, color: '#333' });
const navBtnS = { padding: '5px 10px', borderRadius: 6, border: '1px solid #bbb', background: '#f5f5f5', cursor: 'pointer', fontSize: 13, color: '#555' };
