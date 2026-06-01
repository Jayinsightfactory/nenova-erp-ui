// pages/orders/new.js
// 주문 등록 화면
// 수정이력: 2026-03-27 — Box/단/송이 각각 입력칸, 왼쪽 패널 검색창, 기존 프로그램 레이아웃과 동일하게 수정
// 수정이력: 2026-03-27 — 거래처 드롭다운 방향키/엔터 선택, 단축키 (F5=조회, F2=신규, F8=저장, ESC=닫기) 추가

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import { apiGet, apiPost, apiDelete } from '../../lib/useApi';
import { useWeekInput, getCurrentWeek, WeekInput } from '../../lib/useWeekInput';
import { useLang } from '../../lib/i18n';
import { useColumnResize } from '../../lib/useColumnResize';

const fmt = n => Number(n || 0).toLocaleString();
const CUSTOMER_FAV_PAGE = 'orders-customer';
const ORDER_TEMPLATE_PAGE = 'orders-template';

// 수량 구조: { prodKey: { box, bunch, steam, prodName, counName, flowerName } }
// prodName 등을 함께 저장해야 그룹 선택 전에도 주문내역서 표시 가능
const initQty = () => ({ box: 0, bunch: 0, steam: 0, prodName: '', counName: '', flowerName: '' });
const shortCustName = c => ((c?.Descr || '').split('/')[0].trim() || c?.CustName || '');
const sameKey = (a, b) => String(a || '') === String(b || '');

export default function OrderNew() {
  const router = useRouter();
  const { t } = useLang(); // 언어 변경 시 자동 리렌더
  const weekInput = useWeekInput('');
  const [year] = useState(new Date().getFullYear().toString());

  // 거래처 관련
  const [custSearch, setCustSearch] = useState('');
  const [custList, setCustList] = useState([]);
  const [allCusts, setAllCusts] = useState([]);
  const [custMgr, setCustMgr] = useState('');
  const [custPanelSearch, setCustPanelSearch] = useState('');
  const [showCustPanel, setShowCustPanel] = useState(false);
  const [customerFavorites, setCustomerFavorites] = useState([]);
  const [selectedCust, setSelectedCust] = useState(null);
  const [showCustDrop, setShowCustDrop] = useState(false);
  const dropRef = useRef();

  // 품목 관련
  const [prodList, setProdList] = useState([]);          // 현재 선택 그룹의 품목
  const [prodGroups, setProdGroups] = useState([]);      // 왼쪽 그룹 목록
  const [groupSearch, setGroupSearch] = useState('');    // 왼쪽 검색창
  const [selectedGroup, setSelectedGroup] = useState(null); // { country, flower } 또는 null
  const [prodSearch, setProdSearch] = useState('');      // 중간 패널 검색창
  const [prodLoading, setProdLoading] = useState(false); // 품목 로딩 중
  const [collapsedCountries, setCollapsedCountries] = useState(new Set());

  // 수량: { prodKey: { box, bunch, steam } }
  const [quantities, setQuantities] = useState({});

  // UI 상태
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [saveModal, setSaveModal] = useState(null); // 저장 완료 모달
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // ── 지난 주문 불러오기 모달
  const [showOrderHistory, setShowOrderHistory] = useState(false);
  const [orderHistory, setOrderHistory]         = useState([]);
  const [historyLoading, setHistoryLoading]     = useState(false);
  const [historyTab, setHistoryTab]             = useState('recent'); // 'recent' | 'fav'
  const [favorites, setFavorites]               = useState([]);
  const [favEditId, setFavEditId]               = useState(null);    // 즐겨찾기 이름 입력 중인 row id
  const [favEditName, setFavEditName]           = useState('');

  // ── 드롭다운 키보드 선택용 index
  const [dropIdx, setDropIdx] = useState(-1);

  // ── 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = e => {
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setShowCustDrop(false);
        setShowCustPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── 전역 단축키 (브라우저 기본 단축키와 충돌 없는 Ctrl 조합)
  // Ctrl+R=조회, Ctrl+N=신규, Ctrl+S=저장, ESC=닫기
  useEffect(() => {
    const handler = e => {
      if (e.ctrlKey && e.key === 'r') {
        // Ctrl+R: 조회 (브라우저 새로고침 방지)
        e.preventDefault();
        handleSearch();
      } else if (e.ctrlKey && e.key === 'n') {
        // Ctrl+N: 신규 (새 팝업 창)
        e.preventDefault();
        window.open('/orders/new?popup=1','신규주문등록','width=1280,height=820,left=100,top=100,resizable=yes,scrollbars=yes');
      } else if (e.ctrlKey && e.key === 's') {
        // Ctrl+S: 저장
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        // ESC: 드롭다운 닫기 or 페이지 닫기
        if (showCustDrop || showCustPanel) {
          setShowCustDrop(false);
          setShowCustPanel(false);
        } else {
          if (window.opener) window.close(); else router.push('/orders');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showCustDrop, showCustPanel, selectedCust, weekInput.value, quantities]);

  // ── 거래처 검색 (300ms 디바운스)
  useEffect(() => {
    if (custSearch.length < 1) { setCustList([]); return; }
    const t = setTimeout(() => {
      apiGet('/api/customers/search', { q: custSearch })
        .then(d => { setCustList(d.customers || []); setShowCustDrop(true); })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [custSearch]);

  // ── 담당자별 거래처 패널용 전체 목록 + 즐겨찾기
  useEffect(() => {
    apiGet('/api/master', { entity: 'customers' })
      .then(d => setAllCusts(d.data || []))
      .catch(() => {});
    loadCustomerFavorites();
  }, []);

  // ── 초기 로드: 그룹 목록만 (품목 전체 로드 X → 빠름)
  useEffect(() => {
    apiGet('/api/products/search', { groupsOnly: '1' }).then(d => {
      const groups = d.groups || [];
      const normalizedGroups = groups.map(g => ({
        key: g.country + '|' + g.flower,
        label: g.label,
        country: g.country,
        flower: g.flower,
        prodCount: g.prodCount,
      }));
      setProdGroups(normalizedGroups);
      setCollapsedCountries(new Set(normalizedGroups.map(g => g.country || '기타')));
    }).catch(() => {});
  }, []);

  // ── 그룹 선택 시 해당 품목만 로드
  const loadGroupProds = (group) => {
    if (!group) { setSelectedGroup(null); setProdList([]); return; }
    // 이미 같은 그룹이면 스킵
    if (selectedGroup?.key === group.key && prodList.length > 0) return;
    setSelectedGroup(group);
    setProdLoading(true);
    setProdList([]);
    apiGet('/api/products/search', { country: group.country, flower: group.flower })
      .then(d => setProdList(d.products || []))
      .catch(() => {})
      .finally(() => setProdLoading(false));
  };

  // ── 필터된 그룹 (왼쪽 패널 검색)
  const filteredGroups = groupSearch
    ? prodGroups.filter(g => g.label.includes(groupSearch) || g.country.includes(groupSearch) || g.flower.includes(groupSearch))
    : prodGroups;

  const toggleCountry = (country) => {
    setCollapsedCountries(prev => {
      const next = new Set(prev);
      next.has(country) ? next.delete(country) : next.add(country);
      return next;
    });
  };

  // ── 필터된 품목 (중간 패널 - 검색어만 적용, 그룹은 이미 서버에서 필터됨)
  const filteredProds = prodList.filter(p =>
    !prodSearch || p.ProdName.toLowerCase().includes(prodSearch.toLowerCase())
  );

  const custMgrList = useMemo(() => (
    [...new Set(allCusts.map(c => c.Manager || '미지정'))].sort((a, b) => a.localeCompare(b, 'ko'))
  ), [allCusts]);

  const favoriteCustomers = useMemo(() => (
    customerFavorites
      .map(f => {
        const c = allCusts.find(cust => sameKey(cust.CustKey, f.custKey));
        return c ? { ...c, favoriteKey: f.favoriteKey, favName: f.name } : null;
      })
      .filter(Boolean)
  ), [allCusts, customerFavorites]);

  const filteredPanelCusts = useMemo(() => {
    const q = custPanelSearch.trim().toLowerCase();
    let list = allCusts;
    if (custMgr) list = list.filter(c => (c.Manager || '미지정') === custMgr);
    if (q) {
      list = list.filter(c =>
        (c.CustName || '').toLowerCase().includes(q) ||
        (c.CustArea || '').toLowerCase().includes(q) ||
        (c.OrderCode || '').toLowerCase().includes(q) ||
        shortCustName(c).toLowerCase().includes(q)
      );
    }
    return [...list]
      .sort((a, b) => `${a.CustArea || ''}${a.CustName || ''}`.localeCompare(`${b.CustArea || ''}${b.CustName || ''}`, 'ko'))
      .slice(0, 120);
  }, [allCusts, custMgr, custPanelSearch]);

  const loadCustomerFavorites = async () => {
    try {
      const d = await apiGet('/api/favorites', { page: CUSTOMER_FAV_PAGE });
      const parsed = (d.favorites || []).map(f => {
        let data = {};
        try { data = JSON.parse(f.FilterData || '{}'); } catch {}
        return {
          favoriteKey: f.FavoriteKey,
          name: f.FavName,
          custKey: data.custKey,
          custName: data.custName,
        };
      }).filter(f => f.custKey);
      setCustomerFavorites(parsed);
    } catch {
      setCustomerFavorites([]);
    }
  };

  const customerFavoriteKey = (custKey) =>
    customerFavorites.find(f => sameKey(f.custKey, custKey))?.favoriteKey;

  const selectCustomer = (cust) => {
    setSelectedCust(cust);
    setCustSearch(cust?.CustName || '');
    setShowCustDrop(false);
    setShowCustPanel(false);
    setDropIdx(-1);
    setErr('');
  };

  const toggleCustomerFavorite = async (cust, e) => {
    e?.stopPropagation();
    if (!cust?.CustKey) return;
    const fk = customerFavoriteKey(cust.CustKey);
    try {
      if (fk) {
        await apiDelete('/api/favorites', { favoriteKey: fk });
      } else {
        await apiPost('/api/favorites', {
          page: CUSTOMER_FAV_PAGE,
          name: shortCustName(cust),
          filterData: JSON.stringify({ custKey: cust.CustKey, custName: cust.CustName }),
        });
      }
      await loadCustomerFavorites();
    } catch (e2) {
      alert(e2.message);
    }
  };

  // ── 수량 변경 핸들러
  const setQty = (prodKey, unit, val) => {
    const v = parseFloat(val) || 0;
    // 품목 정보도 함께 저장 (주문내역서 표시용)
    const prod = prodList.find(p => p.ProdKey === prodKey);
    setQuantities(q => ({
      ...q,
      [prodKey]: {
        ...(q[prodKey] || initQty()),
        [unit]: v,
        prodName:   prod?.ProdName   || q[prodKey]?.prodName   || '',
        counName:   prod?.CounName   || q[prodKey]?.counName   || '',
        flowerName: prod?.FlowerName || q[prodKey]?.flowerName || '',
      }
    }));
  };

  // ── 그룹별 합계 (왼쪽 패널 표시용)
  const groupTotals = {};
  prodGroups.forEach(g => {
    const total = Object.values(quantities)
      .filter(q => `${q.counName || ''}|${q.flowerName || ''}` === g.key)
      .reduce((a, q) => a + (q.box || 0) + (q.bunch || 0) + (q.steam || 0), 0);
    groupTotals[g.key] = total;
  });

  const groupedFilteredGroups = Object.values(filteredGroups.reduce((acc, g) => {
    const country = g.country || '기타';
    if (!acc[country]) acc[country] = { country, groups: [], total: 0, count: 0 };
    acc[country].groups.push(g);
    acc[country].total += groupTotals[g.key] || 0;
    acc[country].count += g.prodCount || 0;
    return acc;
  }, {})).sort((a, b) => a.country.localeCompare(b.country));

  // ── 주문 내역서 — quantities에서 직접 계산 (prodList 불필요)
  const orderSummary = Object.entries(quantities)
    .filter(([, q]) => (q.box||0) > 0 || (q.bunch||0) > 0 || (q.steam||0) > 0)
    .map(([prodKey, q]) => {
      // prodList에서 찾되 없으면 quantities에 저장된 정보 사용
      const prod = prodList.find(p => p.ProdKey === parseInt(prodKey));
      return {
        ProdKey:    parseInt(prodKey),
        ProdName:   prod?.ProdName   || q.prodName   || `품목#${prodKey}`,
        CounName:   prod?.CounName   || q.counName   || '',
        FlowerName: prod?.FlowerName || q.flowerName || '',
        OutUnit:    prod?.OutUnit    || '',
      };
    });

  // ── 총 합계
  const totalQty = Object.values(quantities).reduce((a, q) => {
    return a + (q.box||0) + (q.bunch||0) + (q.steam||0);
  }, 0);

  // ── 신규 (폼 초기화)
  const handleNew = () => {
    setSelectedCust(null); setCustSearch('');
    setQuantities({}); weekInput.setValue('');
    setGroupSearch(''); setProdSearch('');
    setCollapsedCountries(new Set());
    setSelectedGroup(null); setProdList([]); setErr(''); setSuccessMsg('');
  };

  // ── 조회 (거래처+차수 기준 기존 주문 로드)
  const handleSearch = async () => {
    if (!selectedCust) { setErr('거래처를 선택하세요.'); return; }
    if (!weekInput.value) { setErr('차수를 입력하세요.'); return; }
    setErr('');
    try {
      const d = await apiGet('/api/orders', { custName: selectedCust.CustName, week: weekInput.value });
      const found = d.orders?.[0];
      if (!found || !found.items?.length) {
        setSuccessMsg(`[${weekInput.value}] ${selectedCust.CustName} 기존 주문이 없습니다. 수량을 입력하세요.`);
        setTimeout(() => setSuccessMsg(''), 3000);
        return;
      }
      // 기존 주문 수량을 quantities에 로드
      const newQty = {};
      found.items.forEach(item => {
        if (!item.prodKey) return;
        newQty[item.prodKey] = {
          box:        item.unit === '박스' ? (item.boxQty || item.qty || 0) : 0,
          bunch:      item.unit === '단'   ? (item.bunchQty || item.qty || 0) : 0,
          steam:      item.unit === '송이' ? (item.steamQty || item.qty || 0) : 0,
          // box/bunch/steam 모두 합산 (기존 프로그램은 단위별로 저장)
          prodName:   item.prodName   || '',
          counName:   item.counName   || '',
          flowerName: item.flowerName || '',
        };
        // 여러 단위가 있을 경우 합산
        if ((item.boxQty||0) > 0)   newQty[item.prodKey].box   = item.boxQty;
        if ((item.bunchQty||0) > 0) newQty[item.prodKey].bunch = item.bunchQty;
        if ((item.steamQty||0) > 0) newQty[item.prodKey].steam = item.steamQty;
      });
      setQuantities(newQty);
      setSuccessMsg(`✅ [${weekInput.value}] 기존 주문 ${found.items.length}개 품목 로드됨`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch(e) { setErr(e.message); }
  };

  const normalizeTemplateItems = (items = []) => items
    .filter(item => item?.prodKey)
    .map(item => ({
      prodKey: parseInt(item.prodKey),
      prodName: item.prodName || '',
      counName: item.counName || '',
      flowerName: item.flowerName || '',
      boxQty: Number(item.boxQty || 0),
      bunchQty: Number(item.bunchQty || 0),
      steamQty: Number(item.steamQty || 0),
      qty: Number(item.qty || item.boxQty || item.bunchQty || item.steamQty || 0),
      unit: item.unit || (Number(item.bunchQty || 0) > 0 ? '단' : Number(item.steamQty || 0) > 0 ? '송이' : '박스'),
    }))
    .filter(item => item.boxQty > 0 || item.bunchQty > 0 || item.steamQty > 0 || item.qty > 0);

  const parseOrderTemplate = (fav) => {
    let data = {};
    try { data = JSON.parse(fav.FilterData || '{}'); } catch {}
    return {
      id: fav.FavoriteKey,
      favoriteKey: fav.FavoriteKey,
      name: fav.FavName,
      savedAt: String(fav.CreateDtm || data.savedAt || '').slice(0, 10),
      week: data.sourceWeek || data.week || '',
      custKey: data.custKey,
      custName: data.custName,
      items: normalizeTemplateItems(data.items || []),
    };
  };

  const loadOrderTemplates = async (cust = selectedCust) => {
    if (!cust) { setFavorites([]); return []; }
    try {
      const d = await apiGet('/api/favorites', { page: ORDER_TEMPLATE_PAGE });
      const list = (d.favorites || [])
        .map(parseOrderTemplate)
        .filter(f => sameKey(f.custKey, cust.CustKey) || (!f.custKey && f.custName === cust.CustName));
      setFavorites(list);
      return list;
    } catch {
      setFavorites([]);
      return [];
    }
  };

  const buildCurrentOrderTemplate = () => ({
    week: weekInput.value || '작성중',
    items: orderSummary.map(p => {
      const q = quantities[p.ProdKey] || initQty();
      return {
        prodKey: p.ProdKey,
        prodName: p.ProdName,
        counName: p.CounName,
        flowerName: p.FlowerName,
        boxQty: q.box || 0,
        bunchQty: q.bunch || 0,
        steamQty: q.steam || 0,
      };
    }),
  });

  // ── 지난 주문 불러오기 → 차수별 목록 모달
  const loadOrderHistory = async () => {
    if (!selectedCust) { alert('거래처를 먼저 선택하세요.'); return; }
    setHistoryLoading(true);
    setShowOrderHistory(true);
    setHistoryTab('recent');
    try {
      const d = await apiGet('/api/orders', { custName: selectedCust.CustName });
      // 차수별 그룹핑 (같은 차수면 최신 1개만)
      const weekMap = {};
      (d.orders || []).forEach(order => {
        if (!weekMap[order.week]) weekMap[order.week] = order;
      });
      const sorted = Object.values(weekMap).sort((a, b) => (b.week||'').localeCompare(a.week||''));
      setOrderHistory(sorted);
      await loadOrderTemplates(selectedCust);
    } catch(e) { setShowOrderHistory(false); alert(e.message); }
    finally { setHistoryLoading(false); }
  };

  // ── 선택한 주문을 폼에 로드
  const loadOrderToForm = (order) => {
    const newQty = {};
    (order.items || []).forEach(item => {
      if (!item.prodKey) return;
      if (!newQty[item.prodKey]) {
        newQty[item.prodKey] = { box: 0, bunch: 0, steam: 0, prodName: item.prodName || '', counName: item.counName || '', flowerName: item.flowerName || '' };
      }
      if ((item.boxQty||0)   > 0) newQty[item.prodKey].box   = item.boxQty;
      if ((item.bunchQty||0) > 0) newQty[item.prodKey].bunch = item.bunchQty;
      if ((item.steamQty||0) > 0) newQty[item.prodKey].steam = item.steamQty;
      // 단위별 qty만 있을 때
      if (!(item.boxQty||item.bunchQty||item.steamQty)) {
        if (item.unit === '박스') newQty[item.prodKey].box   = item.qty || 0;
        else if (item.unit === '단') newQty[item.prodKey].bunch = item.qty || 0;
        else if (item.unit === '송이') newQty[item.prodKey].steam = item.qty || 0;
      }
    });
    setQuantities(newQty);
    setShowOrderHistory(false);
    setSuccessMsg(`✅ [${order.week}] 주문 ${Object.keys(newQty).length}개 품목 불러옴`);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  // ── 업체별 저장 주문 저장
  const saveFavorite = async (order, name) => {
    if (!selectedCust) { alert('거래처를 먼저 선택하세요.'); return; }
    const items = normalizeTemplateItems(order.items || []);
    if (items.length === 0) { alert('저장할 주문 수량이 없습니다.'); return; }
    const favName = (name || `${order.week || weekInput.value || '작성중'} 주문`).trim();
    if (!favName) return;
    try {
      await apiPost('/api/favorites', {
        page: ORDER_TEMPLATE_PAGE,
        name: favName,
        filterData: JSON.stringify({
          custKey: selectedCust.CustKey,
          custName: selectedCust.CustName,
          sourceWeek: order.week || weekInput.value || '',
          savedAt: new Date().toISOString().slice(0, 10),
          items,
        }),
      });
      await loadOrderTemplates(selectedCust);
      setFavEditId(null); setFavEditName('');
      setHistoryTab('fav');
    } catch(e) {
      alert(e.message);
    }
  };

  const saveCurrentOrderTemplate = async () => {
    if (!selectedCust) { alert('거래처를 먼저 선택하세요.'); return; }
    if (orderSummary.length === 0) { alert('저장할 주문 수량이 없습니다.'); return; }
    const name = prompt('저장할 주문 이름을 입력하세요.', `${weekInput.value || '작성중'} 주문`);
    if (!name) return;
    await saveFavorite(buildCurrentOrderTemplate(), name);
  };

  // ── 저장 주문 삭제
  const deleteFavorite = async (favoriteKey) => {
    if (!confirm('저장 주문을 삭제하시겠습니까?')) return;
    try {
      await apiDelete('/api/favorites', { favoriteKey });
      await loadOrderTemplates(selectedCust);
    } catch(e) {
      alert(e.message);
    }
  };

  // ── 주문 변경 내역 조회
  const loadHistory = async () => {
    if (!selectedCust) { alert('거래처를 먼저 선택하세요.'); return; }
    try {
      const d = await apiGet('/api/orders/history', {
        custName: selectedCust.CustName,
        week: weekInput.value
      });
      setHistory(d.history || []);
      setShowHistory(true);
    } catch(e) { alert(e.message); }
  };

  // ── 삭제 (폼 초기화)
  const handleDelete = () => {
    if (!confirm('작성 중인 내용을 모두 지우시겠습니까?')) return;
    handleNew();
  };

  // ── 저장 → OrderMaster + OrderDetail (정식 테이블)
  const handleSave = async () => {
    if (!selectedCust) { setErr('거래처를 선택하세요.'); return; }
    if (!weekInput.value) { setErr('차수를 입력하세요.'); return; }
    if (orderSummary.length === 0) { setErr('주문 수량을 입력하세요.'); return; }
    setSaving(true); setErr('');
    try {
      // 품목별로 단위 분리해서 전송
      const items = [];
      orderSummary.forEach(p => {
        const q = quantities[p.ProdKey] || initQty();
        if ((q.box||0)   > 0) items.push({ prodKey: p.ProdKey, prodName: p.ProdName, qty: q.box,   unit: '박스' });
        if ((q.bunch||0) > 0) items.push({ prodKey: p.ProdKey, prodName: p.ProdName, qty: q.bunch, unit: '단' });
        if ((q.steam||0) > 0) items.push({ prodKey: p.ProdKey, prodName: p.ProdName, qty: q.steam, unit: '송이' });
      });

      const result = await apiPost('/api/orders', {
        custKey: selectedCust.CustKey,
        custName: selectedCust.CustName,
        week: weekInput.value,
        year,
        orderCode: selectedCust.OrderCode || '',
        items,
      });
      // 저장 완료 모달 표시
      setSaveModal({
        custName:   selectedCust.CustName,
        week:       weekInput.value,
        count:      result.results?.filter(r => r.status === 'OK').length || items.length,
        masterKey:  result.orderMasterKey,
        message:    result.message,
      });
    } catch(e) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 72px)' }}>

      {/* ── 주문 정보 툴바 ── */}
      <div style={{ background: 'var(--header-bg)', border: '1px solid var(--border2)', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 'bold', fontSize: 12, marginRight: 8 }}>▶ 주문 정보</span>

        {/* 주문년도 */}
        <span className="filter-label">주문년도</span>
        <input className="filter-input" value={year} readOnly style={{ width: 52, background: '#E8E8E8' }} />

        {/* 차수 - 자동 포맷 */}
        <WeekInput weekInput={weekInput} label="차수" />

        {/* 거래처명 - 실시간 검색 드롭다운 */}
        <span className="filter-label">거래처명</span>
        <div style={{ position: 'relative', display: 'flex', gap: 4, alignItems: 'center' }} ref={dropRef}>
          <input
            className="filter-input"
            placeholder="거래처 검색... (↑↓ 이동, Enter 선택)"
            value={custSearch}
            onChange={e => { setCustSearch(e.target.value); setSelectedCust(null); setDropIdx(-1); }}
            onFocus={() => custList.length > 0 && setShowCustDrop(true)}
            onKeyDown={e => {
              if (!showCustDrop || custList.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setDropIdx(i => Math.min(i + 1, custList.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setDropIdx(i => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const target = dropIdx >= 0 ? custList[dropIdx] : custList[0];
                if (target) {
                  selectCustomer(target);
                }
              } else if (e.key === 'Escape') {
                setShowCustDrop(false);
                setDropIdx(-1);
              }
            }}
            style={{ minWidth: 160, borderColor: selectedCust ? 'var(--blue)' : undefined }}
          />
          <button
            className="btn btn-sm"
            onClick={() => { setShowCustPanel(v => !v); setShowCustDrop(false); }}
            title="담당자별 업체 선택 / 업체 즐겨찾기"
            style={{ height: 24, padding: '1px 8px', borderColor: showCustPanel ? 'var(--blue)' : undefined }}
          >
            업체 선택
          </button>
          {/* 거래처 드롭다운 */}
          {showCustDrop && custList.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 200, background: '#fff', border: '2px solid var(--border2)', width: 300, maxHeight: 220, overflowY: 'auto', boxShadow: '2px 2px 8px rgba(0,0,0,0.25)' }}>
              {custList.map((c, idx) => (
                <div key={c.CustKey}
                  onClick={() => selectCustomer(c)}
                  style={{ padding: '5px 10px', cursor: 'pointer', borderBottom: '1px solid #EEE', fontSize: 12,
                    background: dropIdx === idx ? '#C5D9F1' : '#fff' }}
                  onMouseEnter={e => { if (dropIdx !== idx) e.currentTarget.style.background = '#E8F0FF'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = dropIdx === idx ? '#C5D9F1' : '#fff'; }}
                >
                  <div style={{ fontWeight: 'bold' }}>{c.CustName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.CustArea} · {c.Manager} · {c.OrderCode}</div>
                </div>
              ))}
            </div>
          )}
          {showCustPanel && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 210, width: 620, maxWidth: 'calc(100vw - 80px)', background: '#fff', border: '2px solid var(--border2)', boxShadow: '2px 2px 10px rgba(0,0,0,0.25)', padding: 10 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                <input
                  className="filter-input"
                  placeholder="업체명 / 지역 / 코드 검색..."
                  value={custPanelSearch}
                  onChange={e => setCustPanelSearch(e.target.value)}
                  style={{ width: 200 }}
                  autoFocus
                />
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>표시 {filteredPanelCusts.length}개</span>
                <button className="btn btn-sm" onClick={() => { setCustMgr(''); setCustPanelSearch(''); }} style={{ marginLeft: 'auto' }}>초기화</button>
              </div>
              {favoriteCustomers.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)', lineHeight: '22px' }}>즐겨찾기:</span>
                  {favoriteCustomers.map(c => (
                    <button key={`fav-${c.CustKey}`} className="btn btn-sm" onClick={() => selectCustomer(c)}
                      style={{ height: 22, padding: '1px 8px', borderColor: selectedCust?.CustKey === c.CustKey ? 'var(--blue)' : '#F0B400', background: selectedCust?.CustKey === c.CustKey ? '#DCEEFF' : '#FFF8DC', color: '#6A4A00' }}>
                      ★ {shortCustName(c)}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)', lineHeight: '22px' }}>담당자:</span>
                <button className="btn btn-sm" onClick={() => setCustMgr('')}
                  style={{ height: 22, padding: '1px 8px', background: !custMgr ? '#1565C0' : undefined, color: !custMgr ? '#fff' : undefined }}>전체</button>
                {custMgrList.map(m => (
                  <button key={m} className="btn btn-sm" onClick={() => setCustMgr(m)}
                    style={{ height: 22, padding: '1px 8px', background: custMgr === m ? '#1565C0' : undefined, color: custMgr === m ? '#fff' : undefined }}>
                    {m}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 190, overflowY: 'auto', border: '1px solid var(--border)', padding: 8, background: '#FAFAFA' }}>
                {filteredPanelCusts.map(c => {
                  const active = selectedCust?.CustKey === c.CustKey;
                  const favKey = customerFavoriteKey(c.CustKey);
                  return (
                    <button key={c.CustKey} onClick={() => selectCustomer(c)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 24, padding: '2px 7px', border: `1px solid ${active ? '#1565C0' : '#CCC'}`, borderRadius: 4, background: active ? '#1565C0' : '#fff', color: active ? '#fff' : 'var(--text)', cursor: 'pointer', fontSize: 11, fontWeight: active ? 700 : 500 }}>
                      <span>{shortCustName(c)}</span>
                      <span style={{ fontSize: 10, opacity: 0.65 }}>{c.CustArea || c.Manager || ''}</span>
                      <span onClick={e => toggleCustomerFavorite(c, e)}
                        title={favKey ? '업체 즐겨찾기 해제' : '업체 즐겨찾기 추가'}
                        style={{ marginLeft: 2, color: favKey ? '#F0B400' : (active ? 'rgba(255,255,255,0.7)' : '#AAA'), fontSize: 12 }}>
                        ★
                      </span>
                    </button>
                  );
                })}
                {filteredPanelCusts.length === 0 && <span style={{ color: 'var(--text3)', fontSize: 12 }}>검색 결과 없음</span>}
              </div>
            </div>
          )}
        </div>

        {/* 담당자 */}
        <span className="filter-label">담당자</span>
        <input className="filter-input" value={selectedCust?.Manager || ''} readOnly style={{ width: 70, background: '#E8E8E8' }} />

        {/* 클라이언트 번버 */}
        <span className="filter-label">클라이언트 번버</span>
        <input className="filter-input" value={selectedCust?.OrderCode || ''} readOnly style={{ width: 70, background: '#E8E8E8' }} />

        {/* 주문일자 */}
        <span className="filter-label">주문일자</span>
        <input type="date" className="filter-input" defaultValue={new Date().toISOString().slice(0,10)} style={{ width: 110 }} />

        {/* 오른쪽 버튼들 */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button className="btn btn-primary btn-sm" onClick={handleSearch} title="단축키: Ctrl+R">{t('조회')} [Ctrl+R]</button>
          <button className="btn btn-sm" onClick={() => window.open('/orders/new?popup=1','신규주문등록','width=1280,height=820,left=100,top=100,resizable=yes,scrollbars=yes')} title="단축키: Ctrl+N">{t('신규')} [Ctrl+N]</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving} title="단축키: Ctrl+S">{saving ? t('저장')+'중...' : t('저장')+' [Ctrl+S]'}</button>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>{t('삭제')} / Eliminar</button>
          <button className="btn btn-sm" onClick={() => window.opener ? window.close() : router.push('/orders')} title="단축키: ESC">{t('닫기')} [ESC]</button>
        </div>
      </div>

      {/* 두 번째 버튼 줄 */}
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderTop: 'none', padding: '3px 8px', display: 'flex', gap: 4, flexShrink: 0 }}>
        <button className="btn btn-sm" onClick={loadOrderHistory}>📋 {t('지난 주문 불러오기')}</button>
        <button className="btn btn-sm" onClick={loadHistory}>{t('주문 변경 내역 조회')}</button>
      </div>

      {/* 알림 배너 */}
      {err && <div className="banner-err">⚠️ {err} <span style={{ float:'right', cursor:'pointer' }} onClick={() => setErr('')}>✕</span></div>}
      {successMsg && <div className="banner-ok">{successMsg}</div>}

      {/* ── 저장 완료 모달 ── */}
      {saveModal && (
        <div className="modal-overlay" onClick={() => { setSaveModal(null); setQuantities({}); }}>
          <div className="modal" style={{ maxWidth: 400, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background: '#E8F8E8', borderBottom: '2px solid #66BB66' }}>
              <span className="modal-title" style={{ color: '#006600' }}>✅ 저장 완료</span>
            </div>
            <div className="modal-body" style={{ padding: '20px 24px' }}>
              <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 16, color: '#006600' }}>
                주문이 저장되었습니다.
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', color: 'var(--text3)', width: 100 }}>거래처</td>
                    <td style={{ padding: '6px 4px', fontWeight: 'bold' }}>{saveModal.custName}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', color: 'var(--text3)' }}>차수</td>
                    <td style={{ padding: '6px 4px', fontWeight: 'bold', color: 'var(--blue)' }}>{saveModal.week}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', color: 'var(--text3)' }}>저장 품목</td>
                    <td style={{ padding: '6px 4px', fontWeight: 'bold' }}>{saveModal.count}개</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 4px', color: 'var(--text3)' }}>주문번호</td>
                    <td style={{ padding: '6px 4px', color: 'var(--text3)', fontSize: 11 }}>#{saveModal.masterKey} (테스트)</td>
                  </tr>
                </tbody>
              </table>
              <button className="btn btn-primary" style={{ width: '100%', height: 36, fontSize: 13 }}
                onClick={() => { setSaveModal(null); setQuantities({}); }}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ■ 주문 품목 정보 */}
      <div style={{ padding: '2px 8px', background: 'var(--header-bg)', border: '1px solid var(--border)', borderTop: 'none', fontSize: 12, fontWeight: 'bold', flexShrink: 0 }}>
        주문 품목 정보
      </div>

      {/* ── 3분할 메인 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 340px', flex: 1, overflow: 'hidden', border: '1px solid var(--border2)', borderTop: 'none' }}>

        {/* ══ 왼쪽: 품목 정보 (꽃 그룹별 합계) ══ */}
        <div style={{ borderRight: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 패널 헤더 */}
          <div style={{ padding: '3px 6px', background: 'var(--header-bg)', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 'bold' }}>
            ≡ 품목 정보
          </div>
          {/* 검색 입력창 (빨간 표시된 부분) */}
          <div style={{ padding: '3px 4px', borderBottom: '1px solid var(--border)', background: '#FFF' }}>
            <input
              className="filter-input"
              placeholder="품목명 검색..."
              value={groupSearch}
              onChange={e => setGroupSearch(e.target.value)}
              style={{ width: '100%', height: 20, fontSize: 11, border: '1px solid var(--border2)' }}
            />
          </div>
          {/* 그룹 목록 */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>품목명</th>
                  <th style={{ textAlign: 'right' }}>주문수량</th>
                </tr>
              </thead>
              <tbody>
                {/* 전체 보기 행 */}
                <tr
                  onClick={() => { setSelectedGroup(null); setProdList([]); }}
                  style={{ cursor: 'pointer', background: !selectedGroup ? 'var(--blue-sel)' : undefined }}
                >
                  <td style={{ fontWeight: 'bold', fontSize: 11 }}>{t('그룹을 선택하세요')}</td>
                  <td className="num" style={{ fontWeight: 'bold', color: 'var(--blue)', fontSize: 11 }}>
                    {totalQty > 0 ? totalQty.toFixed(2) : '0.00'}
                  </td>
                </tr>
                {groupedFilteredGroups.map(group => {
                  const isCollapsed = !groupSearch && collapsedCountries.has(group.country);
                  return [
                    <tr
                      key={`country-${group.country}`}
                      onClick={() => toggleCountry(group.country)}
                      style={{
                        cursor: 'pointer',
                        background: group.total > 0 ? '#FFF4C8' : '#E8EEF4',
                      }}
                    >
                      <td style={{ color: group.total > 0 ? '#996600' : 'var(--text1)', fontWeight: 'bold', fontSize: 11 }}>
                        {isCollapsed ? '▶' : '∨'} {group.country}
                        <span style={{color:'var(--text3)',fontSize:10}}> ({group.groups.length}묶음/{group.count})</span>
                      </td>
                      <td className="num" style={{ color: group.total > 0 ? '#996600' : 'var(--text3)', fontWeight: 'bold', fontSize: 11 }}>
                        {group.total > 0 ? group.total.toFixed(2) : '0.00'}
                      </td>
                    </tr>,
                    ...(!isCollapsed ? group.groups.map(g => {
                      const total = groupTotals[g.key] || 0;
                      const isSelected = selectedGroup?.key === g.key;
                      return (
                        <tr
                          key={g.key}
                          onClick={() => { const next = isSelected ? null : g; loadGroupProds(next); }}
                          style={{
                            cursor: 'pointer',
                            background: isSelected ? 'var(--blue-sel)' : total > 0 ? '#FFFFD0' : undefined,
                          }}
                        >
                          <td style={{ color: total > 0 ? '#996600' : 'var(--text2)', fontWeight: total > 0 ? 'bold' : 'normal', fontSize: 11, paddingLeft: 18 }}>
                            {g.flower || '(분류없음)'} <span style={{color:'var(--text3)',fontSize:10}}>({g.prodCount})</span>
                          </td>
                          <td className="num" style={{ color: total > 0 ? '#996600' : 'var(--text3)', fontWeight: total > 0 ? 'bold' : 'normal', fontSize: 11 }}>
                            {total > 0 ? total.toFixed(2) : '0.00'}
                          </td>
                        </tr>
                      );
                    }) : []),
                  ];
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 'bold', fontSize: 11 }}>합계</td>
                  <td className="num" style={{ fontWeight: 'bold', fontSize: 11 }}>{totalQty.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* ══ 중간: 품목(색상) 정보 + 수량 입력 ══ */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border2)' }}>
          {/* 패널 헤더 */}
          <div style={{ padding: '3px 6px', background: 'var(--header-bg)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 'bold' }}>
              ≡ 품목(색상) 정보
              {selectedGroup && <span style={{ color: 'var(--blue)', fontWeight: 'normal', marginLeft: 4 }}>— {selectedGroup.label}</span>}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)' }}>{filteredProds.length}개</span>
            <button className="btn btn-sm" style={{ height: 18, fontSize: 10 }} onClick={() => { if(confirm('수량을 초기화하시겠습니까?')) setQuantities({}); }}>
              {t('수량 초기화')}
            </button>
          </div>
          {/* 검색 입력창 (빨간 표시된 부분) */}
          <div style={{ padding: '3px 4px', borderBottom: '1px solid var(--border)', background: '#FFF', display: 'flex', gap: 4 }}>
            <input
              className="filter-input"
              placeholder="품목명(색상) 검색..."
              value={prodSearch}
              onChange={e => setProdSearch(e.target.value)}
              style={{ flex: 1, height: 20, fontSize: 11 }}
            />
          </div>

          {/* 품목 테이블 — Box/단/송이 각각 입력 */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <table className="tbl" style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ width: 20 }}>...</th>
                  <th style={{ width: 20 }}></th>
                  {/* 품목 정보 */}
                  <th style={{ minWidth: 140 }}>품목명(색상)</th>
                  <th style={{ width: 36 }}>단위</th>
                  <th style={{ textAlign: 'right', width: 52 }}>현재고</th>
                  <th style={{ textAlign: 'right', width: 52 }}>주문수량</th>
                  <th style={{ textAlign: 'right', width: 52 }}>미발주수량</th>
                  {/* 입력수량 */}
                  <th style={{ textAlign: 'right', width: 52, color: 'var(--blue)', background: '#E8F0FF' }}>Box</th>
                  <th style={{ textAlign: 'right', width: 52, color: 'var(--blue)', background: '#E8F0FF' }}>단</th>
                  <th style={{ textAlign: 'right', width: 52, color: 'var(--blue)', background: '#E8F0FF' }}>송이</th>
                  {/* 총주문수량 */}
                  <th style={{ textAlign: 'right', width: 52 }}>Box</th>
                  <th style={{ textAlign: 'right', width: 52 }}>단</th>
                  <th style={{ textAlign: 'right', width: 52 }}>송이</th>
                </tr>
                {/* 헤더 그룹 표시 */}
                <tr style={{ background: '#F0F0F0', fontSize: 10 }}>
                  <td colSpan={5}></td>
                  <td colSpan={2} style={{ textAlign: 'center', color: 'var(--text3)', borderRight: '1px solid var(--border)' }}>품목 정보</td>
                  <td colSpan={3} style={{ textAlign: 'center', color: 'var(--blue)', background: '#E8F0FF', borderRight: '1px solid var(--border)' }}>입력수량</td>
                  <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text3)' }}>총주문수량</td>
                </tr>
              </thead>
              <tbody>
                {filteredProds.length === 0 ? (
                  <tr><td colSpan={13} style={{ textAlign: 'center', padding: 20, color: 'var(--text3)' }}>품목 로딩 중...</td></tr>
                ) : filteredProds.map(p => {
                  const q = quantities[p.ProdKey] || initQty();
                  const hasQty = q.box > 0 || q.bunch > 0 || q.steam > 0;
                  const totalProd = q.box + q.bunch + q.steam;

                  // 입력칸 공통 스타일
                  const inputStyle = (val) => ({
                    width: 48, height: 19,
                    border: `1px solid ${val > 0 ? '#AABB00' : 'var(--border2)'}`,
                    textAlign: 'right', fontSize: 11,
                    fontFamily: 'var(--mono)',
                    padding: '0 2px',
                    background: val > 0 ? '#FFFFC0' : '#FFFFFF',
                    fontWeight: val > 0 ? 'bold' : 'normal',
                  });

                  return (
                    <tr key={p.ProdKey} style={{ background: hasQty ? '#FFFFD8' : undefined }}>
                      <td style={{ textAlign: 'center', color: 'var(--text3)' }}>▶</td>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={hasQty} readOnly style={{ width: 12, height: 12 }} />
                      </td>
                      <td style={{ fontWeight: hasQty ? 'bold' : 'normal', color: hasQty ? '#996600' : 'var(--text1)', fontSize: 11 }}>
                        {p.DisplayName || p.ProdName}
                      </td>
                      <td style={{ color: 'var(--text3)', fontSize: 10 }}>{p.OutUnit}</td>
                      {/* 현재고 */}
                      <td className="num" style={{ color: 'var(--blue)', fontSize: 11 }}>{fmt(p.Stock || 0)}</td>
                      {/* 주문수량 (= 입력합계) */}
                      <td className="num" style={{ fontWeight: 'bold', color: hasQty ? '#996600' : 'var(--text3)' }}>
                        {totalProd > 0 ? totalProd.toFixed(2) : '0.00'}
                      </td>
                      {/* 미발주수량 (= 주문 - 출고, 일단 0) */}
                      <td className="num" style={{ color: 'var(--text3)' }}>0.00</td>

                      {/* ── 입력수량: Box ── */}
                      <td style={{ background: '#E8F0FF', padding: '1px 2px' }}>
                        <input
                          type="number" min={0} step={1}
                          value={q.box || ''}
                          onChange={e => setQty(p.ProdKey, 'box', e.target.value)}
                          onFocus={e => e.target.select()}
                          placeholder="0"
                          style={inputStyle(q.box)}
                        />
                      </td>
                      {/* ── 입력수량: 단 ── */}
                      <td style={{ background: '#E8F0FF', padding: '1px 2px' }}>
                        <input
                          type="number" min={0} step={1}
                          value={q.bunch || ''}
                          onChange={e => setQty(p.ProdKey, 'bunch', e.target.value)}
                          onFocus={e => e.target.select()}
                          placeholder="0"
                          style={inputStyle(q.bunch)}
                        />
                      </td>
                      {/* ── 입력수량: 송이 ── */}
                      <td style={{ background: '#E8F0FF', padding: '1px 2px' }}>
                        <input
                          type="number" min={0} step={1}
                          value={q.steam || ''}
                          onChange={e => setQty(p.ProdKey, 'steam', e.target.value)}
                          onFocus={e => e.target.select()}
                          placeholder="0"
                          style={inputStyle(q.steam)}
                        />
                      </td>

                      {/* 총주문수량: Box */}
                      <td className="num" style={{ fontSize: 11 }}>{q.box > 0 ? q.box.toFixed(2) : ''}</td>
                      {/* 총주문수량: 단 */}
                      <td className="num" style={{ fontSize: 11 }}>{q.bunch > 0 ? q.bunch.toFixed(2) : ''}</td>
                      {/* 총주문수량: 송이 */}
                      <td className="num" style={{ fontSize: 11 }}>{q.steam > 0 ? q.steam.toFixed(2) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ══ 오른쪽: 주문 내역서 ══ */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 패널 헤더 */}
          <div style={{ padding: '3px 6px', background: 'var(--header-bg)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 'bold' }}>▶ {t('주문 내역서') || '주문 내역서'}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 'bold' }}>
              {t('합계')}: {totalQty.toFixed(2)}
            </span>
          </div>
          {/* 내역 테이블 — 가로+세로 스크롤 */}
          <div style={{ overflow: 'auto', flex: 1 }}>
            {orderSummary.length === 0 ? (
              <div style={{ color: 'var(--text3)', textAlign: 'center', marginTop: 40, fontSize: 12 }}>
                수량을 입력하면 표시됩니다
              </div>
            ) : (() => {
              const byGroup = {};
              orderSummary.forEach(p => {
                const key = p.CounName + p.FlowerName;
                if (!byGroup[key]) byGroup[key] = { label: key, items: [], totalBox:0, totalBunch:0, totalSteam:0 };
                const q = quantities[p.ProdKey] || initQty();
                byGroup[key].items.push({ ...p, q });
                byGroup[key].totalBox   += (q.box||0);
                byGroup[key].totalBunch += (q.bunch||0);
                byGroup[key].totalSteam += (q.steam||0);
              });
              return (
                <table className="tbl" style={{ minWidth: 340, fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 120 }}>{t('품목명')}</th>
                      <th className="num" style={{ minWidth: 45 }}>Box</th>
                      <th className="num" style={{ minWidth: 40 }}>{t('단')}</th>
                      <th className="num" style={{ minWidth: 45 }}>{t('송이')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(byGroup).map(g => ([
                      <tr key={g.label+'_h'} style={{ background: '#E8F0FF' }}>
                        <td colSpan={4} style={{ fontWeight:'bold', color:'var(--blue)', fontSize:11 }}>
                          # {g.label}
                        </td>
                      </tr>,
                      ...g.items.map(p => (
                        <tr key={p.ProdKey}>
                          <td style={{ fontSize:10, maxWidth:130, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.DisplayName || p.ProdName}</td>
                          <td className="num" style={{ fontSize:10 }}>{p.q.box>0?p.q.box:''}</td>
                          <td className="num" style={{ fontSize:10 }}>{p.q.bunch>0?p.q.bunch:''}</td>
                          <td className="num" style={{ fontSize:10 }}>{p.q.steam>0?p.q.steam:''}</td>
                        </tr>
                      )),
                      <tr key={g.label+'_t'} style={{ background:'#F0F4FF', fontWeight:'bold' }}>
                        <td style={{ fontSize:10, textAlign:'right' }}>{t('합계')}</td>
                        <td className="num" style={{ fontSize:10 }}>{g.totalBox>0?g.totalBox:''}</td>
                        <td className="num" style={{ fontSize:10 }}>{g.totalBunch>0?g.totalBunch:''}</td>
                        <td className="num" style={{ fontSize:10 }}>{g.totalSteam>0?g.totalSteam:''}</td>
                      </tr>
                    ]))}
                  </tbody>
                </table>
              );
            })()}
          </div>
          {/* 하단 저장 버튼 */}
          {Object.values(quantities).some(q=>(q.box||0)+(q.bunch||0)+(q.steam||0)>0) && (
            <div style={{ padding: '4px 6px', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
              <button className="btn btn-primary" style={{ width: '100%', height: 24 }} onClick={handleSave} disabled={saving}>
                {saving ? '저장 중... / Guardando' : `${t('저장')} (${orderSummary.length})`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── 지난 주문 불러오기 모달 ── */}
      {showOrderHistory && (
        <div className="modal-overlay" onClick={() => setShowOrderHistory(false)}>
          <div className="modal" style={{ maxWidth: 820, width: '92%', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📋 {selectedCust?.CustName} — 지난 주문 불러오기</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button className="btn btn-primary btn-sm" onClick={saveCurrentOrderTemplate} disabled={orderSummary.length === 0}>
                  주문 저장하기
                </button>
                <button className="btn btn-sm" onClick={() => setShowOrderHistory(false)}>✕ 닫기</button>
              </div>
            </div>

            {/* 탭 */}
            <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
              {[['recent', '🕐 최근 주문 내역'], ['fav', `★ 저장 주문 (${favorites.length})`]].map(([key, label]) => (
                <div key={key} onClick={() => setHistoryTab(key)}
                  style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    color: historyTab === key ? 'var(--blue)' : 'var(--text3)',
                    borderBottom: historyTab === key ? '2px solid var(--blue)' : '2px solid transparent',
                    marginBottom: -2 }}>
                  {label}
                </div>
              ))}
            </div>

            {/* 본문 */}
            <div style={{ overflowY: 'auto', flex: 1 }}>

              {/* ── 최근 주문 내역 탭 ── */}
              {historyTab === 'recent' && (
                historyLoading
                  ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>불러오는 중...</div>
                  : orderHistory.length === 0
                  ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>주문 내역이 없습니다.</div>
                  : (
                    <table className="tbl" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 88 }}>차수</th>
                          <th style={{ width: 95 }}>주문일</th>
                          <th style={{ textAlign: 'right', width: 60 }}>품목수</th>
                          <th style={{ textAlign: 'right', width: 72 }}>총수량</th>
                          <th>품목 요약</th>
                          <th style={{ width: 200, textAlign: 'center' }}>액션</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderHistory.map((order) => {
                          const totalQ = (order.items || []).reduce((a, it) => a + (it.boxQty||0) + (it.bunchQty||0) + (it.steamQty||0) + (!it.boxQty&&!it.bunchQty&&!it.steamQty ? (it.qty||0) : 0), 0);
                          const preview = (order.items || []).slice(0, 4).map(it => it.prodName).join(', ') + ((order.items?.length||0) > 4 ? ` 외 ${order.items.length - 4}개` : '');
                          const isSaving = favEditId === order.id;
                          return (
                            <tr key={order.id} style={{ background: isSaving ? '#FFFBE6' : undefined }}>
                              <td style={{ fontWeight: 700, color: 'var(--blue)', fontFamily: 'var(--mono)' }}>{order.week}</td>
                              <td style={{ color: 'var(--text2)', fontSize: 11 }}>{order.date}</td>
                              <td className="num">{order.items?.length || 0}</td>
                              <td className="num">{totalQ > 0 ? totalQ.toFixed(2) : '0.00'}</td>
                              <td style={{ fontSize: 11, color: 'var(--text3)' }}>{preview || '—'}</td>
                              <td>
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                                  <button className="btn btn-primary btn-sm" onClick={() => loadOrderToForm(order)}>✅ 불러오기</button>
                                  {isSaving ? (
                                    <>
                                      <input autoFocus placeholder="저장 주문 이름 입력"
                                        value={favEditName} onChange={e => setFavEditName(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') saveFavorite(order, favEditName); if (e.key === 'Escape') setFavEditId(null); }}
                                        style={{ width: 120, height: 24, fontSize: 11, border: '1px solid var(--amber)', borderRadius: 3, padding: '0 4px' }}
                                      />
                                      <button className="btn btn-sm" style={{ padding: '1px 7px', fontSize: 11, background: '#FFC107', color: '#000', border: '1px solid #E0A800' }}
                                        onClick={() => saveFavorite(order, favEditName)}>저장</button>
                                      <button className="btn btn-sm" style={{ padding: '1px 6px', fontSize: 11 }}
                                        onClick={() => setFavEditId(null)}>✕</button>
                                    </>
                                  ) : (
                                    <button className="btn btn-sm" style={{ padding: '2px 8px', fontSize: 11, background: '#FFF8DC', border: '1px solid #CCA000', color: '#8B6914' }}
                                      onClick={() => { setFavEditId(order.id); setFavEditName(`${order.week} 주문`); }}>
                                      주문 저장
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )
              )}

              {/* ── 저장 주문 탭 ── */}
              {historyTab === 'fav' && (
                favorites.length === 0
                  ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
                      저장된 주문이 없습니다.<br/>
                      <span style={{ fontSize: 12, marginTop: 6, display: 'block' }}>
                        현재 작성 중인 주문이나 최근 주문 내역을 업체별 저장 주문으로 저장하세요.
                      </span>
                    </div>
                  : (
                    <table className="tbl" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>이름</th>
                          <th style={{ width: 80 }}>차수</th>
                          <th style={{ width: 85 }}>저장일</th>
                          <th style={{ textAlign: 'right', width: 60 }}>품목수</th>
                          <th>품목 요약</th>
                          <th style={{ width: 140, textAlign: 'center' }}>액션</th>
                        </tr>
                      </thead>
                      <tbody>
                        {favorites.map(fav => {
                          const preview = (fav.items || []).slice(0, 4).map(it => it.prodName).join(', ') + ((fav.items?.length||0) > 4 ? ` 외 ${fav.items.length - 4}개` : '');
                          return (
                            <tr key={fav.favoriteKey}>
                              <td style={{ fontWeight: 600 }}>★ {fav.name}</td>
                              <td style={{ fontFamily: 'var(--mono)', color: 'var(--blue)', fontSize: 11 }}>{fav.week}</td>
                              <td style={{ color: 'var(--text3)', fontSize: 11 }}>{fav.savedAt}</td>
                              <td className="num">{fav.items?.length || 0}</td>
                              <td style={{ fontSize: 11, color: 'var(--text3)' }}>{preview || '—'}</td>
                              <td>
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                  <button className="btn btn-primary btn-sm" onClick={() => loadOrderToForm(fav)}>✅ 불러오기</button>
                                  <button className="btn btn-danger btn-sm" onClick={() => deleteFavorite(fav.favoriteKey)}>🗑 삭제</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 변경 내역 모달 ── */}
      {showHistory && (
        <div className="modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="modal" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">■ 주문 변경 내역 — {selectedCust?.CustName} [{weekInput.value}]</span>
              <button className="btn btn-sm" onClick={() => setShowHistory(false)}>닫기</button>
            </div>
            <div className="modal-body" style={{ padding: 0, maxHeight: 450, overflowY: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>변경일자</th><th>변경사용자</th><th>차수</th>
                    <th>거래처</th><th>국가</th><th>꽃</th><th>품목명</th>
                    <th>변경유형</th><th>변경항목</th>
                    <th style={{ textAlign: 'right' }}>기준값</th>
                    <th style={{ textAlign: 'right' }}>변경값</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0
                    ? <tr><td colSpan={11} style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}>변경 내역 없음</td></tr>
                    : history.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.변경일자}</td>
                        <td style={{ fontSize: 11 }}>{r.변경사용자}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontWeight: 'bold' }}>{r.차수}</td>
                        <td style={{ fontSize: 11 }}>{r.거래처명}</td>
                        <td style={{ fontSize: 11 }}>{r.국가}</td>
                        <td style={{ fontSize: 11 }}>{r.꽃}</td>
                        <td style={{ fontSize: 11 }}>{r.품목명}</td>
                        <td><span className={`badge ${r.변경유형==='신규'?'badge-green':r.변경유형==='수정'?'badge-blue':'badge-red'}`}>{r.변경유형}</span></td>
                        <td style={{ fontSize: 11 }}>{r.변경항목}</td>
                        <td className="num" style={{ color: 'var(--text3)' }}>{r.기준값}</td>
                        <td className="num" style={{ fontWeight: 'bold' }}>{r.변경값}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowHistory(false)}>↩️ 닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
