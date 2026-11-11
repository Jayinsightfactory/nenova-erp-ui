import DistributionInlineDates, {DistributionInlineDatesHeader} from '../../components/shipment/DistributionInlineDates';
import {majorInlineWeekScope} from '../../lib/shipmentMajorInlineDates.js';
import DistributionProductTree from '../../components/shipment/DistributionProductTree';
import DistributionDateFilter from '../../components/shipment/DistributionDateFilter';
import {favoriteDistributionRows,buildDistributionDateLookup} from '../../lib/shipmentDistributionNavigation.js';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiGet, apiPost, apiDelete, apiPut } from '../../lib/useApi';
import { useWeekInput, getCurrentWeek, WeekInput, formatWeekDisplay } from '../../lib/useWeekInput';
import { useLang } from '../../lib/i18n';
import { distributeProductName, distributePreviousStock } from '../../lib/distributeProductDisplay';
import DistributionDateEditor from '../../components/shipment/DistributionDateEditor';
import WorkflowGuide from '../../components/WorkflowGuide';
import DistributionPicker from '../../components/shipment/DistributionPicker';
import { runEditWithFixCycle } from '../../lib/fixCycleClient';
import { suggestDisplayName, jamoMatch, filterProducts } from '../../lib/displayName';
import { customerMatchesSearch } from '../../lib/customerSearch';
import { convertQwertyInputToHangul } from '../../lib/qwertyHangul';
import { distributionQuantityRemark, distributionWeekOptions, distributionWeekButtons, distributionSubWeekButtons,
  distributionSaveLogLine, hasDistributionDrafts, mergeDistributionCustomerItems, parseDistributionFavorite, parseDistributionGroupFavorite, parseDistributionCountryFavorite,
  planDistributionMove, pendingDistributionOrderItems, pendingDistributionItem, distributionFixCycleScope, distributionCustomerSearchRows, mergeDistributionSearchCandidates,
  sortDistributionCustomers, sortDistributionProducts, distributionProductSearchRows, distributionFavoriteCountryGroups, distributionPairGroupKey, distributionPairGroups,
  distributionCountryGroups, distributionAddProductCandidates, distributionSelectionMatches, distributionPairFilterMatches, distributionUnitFactor, toDisplayQty, toNativeQty } from '../../lib/shipmentDistributionWorkspace.js';

const fmt = n => Number(n || 0).toLocaleString();
const PG_SEP = '::';
const pgLabel = (country, flower) => `${country || ''}${flower || ''}`;
const countryFlowerFromGroup = (prodGroup, prodGroups) => {
  if (!prodGroup || prodGroup.endsWith(PG_SEP)) return '';
  const g = prodGroups.find((x) => x.key === prodGroup);
  if (g?.country && g?.flower) return pgLabel(g.country, g.flower);
  if (prodGroup.includes(PG_SEP)) {
    const [country, flower] = prodGroup.split(PG_SEP);
    return pgLabel(country, flower);
  }
  return prodGroup;
};
// 상단 품종(국가::꽃) → 업체 탭 품종 필터 키("국가 꽃", distributionPairGroupKey 와 같은 형식)
const pairKeyFromGroup = (prodGroup, prodGroups) => {
  if (!prodGroup) return '';
  const g = prodGroups.find((x) => x.key === prodGroup);
  const [country, flower] = g?.country && g?.flower ? [g.country, g.flower] : prodGroup.split(PG_SEP);
  return [country, flower].map(v => String(v || '').trim()).filter(Boolean).join(' ');
};
const shipDayGroupKey = (item) => {
  const country = String(item?.CounName || '').trim();
  const flower = String(item?.FlowerName || '').trim();
  if (country && flower) return `${country}${PG_SEP}${flower}`;
  return String(item?.CountryFlower || '').trim();
};

// 차수(예: "15-01") → 정상 출고일(YYYY-MM-DD) 변환
function weekToShipDate(weekStr, year = new Date().getFullYear()) {
  try {
    const [wStr, dStr] = weekStr.split('-');
    const weekNum = parseInt(wStr, 10);
    const delivNum = parseInt(dStr, 10) || 1;
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
    const offsets = [0, 0, 3, 5];
    monday.setDate(monday.getDate() + (offsets[delivNum] ?? 0));
    return `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
  } catch { return null; }
}
const WEEK_SUFFIXES = ['-01', '-02'];
const DAY_NAMES = ['월','화','수','목','금'];
const DAY_NAMES_TAB2 = ['월','화','수','목','금','토','일'];
const EXE_DAY_NUM = { 월: 2, 화: 3, 수: 4, 목: 5, 금: 6, 토: 7, 일: 1 };
const PRODUCT_FAVORITE_PAGE = 'shipment-distribute-products';
// 품종(CounName::FlowerName) 즐겨찾기 — 계정별, 차수와 무관하게 고정. 같은 UserFavorite 테이블, 다른 PageName.
const GROUP_FAVORITE_PAGE = 'shipment-distribute-groups';
const COUNTRY_FAVORITE_PAGE = 'shipment-distribute-countries';

function mapCustWeekGridRow(row) {
  const dayByKr = {};
  for (const d of DAY_NAMES_TAB2) {
    dayByKr[d] = Number(row[`day${EXE_DAY_NUM[d]}`]) || 0;
  }
  const totalOut = Number(row.OutQuantity) || 0;
  const daySum = Object.values(dayByKr).reduce((a, b) => a + b, 0);
  return {
    ProdKey: row.ProdKey,
    ProdName: row.ProdName,
    OutUnit: row.OutUnit,
    EstUnit: row.EstUnit,
    SdetailKey: row.SdetailKey,
    출고수량: totalOut || daySum,
    _exeWeekGrid: true,
    _dayByKr: dayByKr,
    _ymdByKr: Object.fromEntries(DAY_NAMES_TAB2.map(d=>[d,row[`ymd${EXE_DAY_NUM[d]}`]])),
  };
}

// 출고수량을 요일별로 자동 균등 분배
function autoSplitQty(totalQty, dayCount) {
  if (dayCount <= 0 || totalQty <= 0) return [];
  const base = Math.floor(totalQty / dayCount);
  const remainder = totalQty - base * dayCount;
  return Array.from({ length: dayCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

// 나란히 보기 업체 3~5 색과 번호 표시
const PEER_COLORS = ['#047857', '#7c3aed', '#be185d'];
const SLOT_MARK = ['①', '②', '③', '④', '⑤'];

export default function Distribute() {
  const { t } = useLang();
  // 0:출고분배 및 농장정보(품목 기준) 1:출고분배 및 업체정보(업체 기준) 2:출고일지정 3:집계
  const [tab, setTab] = useState(0);
  const [dateEditor, setDateEditor] = useState(null);
  const [majorInlineFacts,setMajorInlineFacts]=useState(null);
  const majorInlineFactsMap=useMemo(()=>{if(!majorInlineFacts)return null;const map=new Map();for(const r of majorInlineFacts){const key=String(r.CustKey)+'|'+String(r.ProdKey);if(!map.has(key))map.set(key,[]);map.get(key).push(r);}return map;},[majorInlineFacts]);
  const [inlineCalendar,setInlineCalendar]=useState([]),[inlineFacts,setInlineFacts]=useState([]),[dateDrafts,setDateDrafts]=useState({});
  const hasDateDrafts=Object.keys(dateDrafts).length>0;
  const inlineFactsMap=useMemo(()=>{const map=new Map();for(const r of inlineFacts){const key=`${r.CustKey}|${r.ProdKey}`;if(!map.has(key))map.set(key,[]);map.get(key).push(r);}return map;},[inlineFacts]);
  useEffect(()=>{const warn=e=>{if(hasDateDrafts){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[hasDateDrafts]);
  const weekInput = useWeekInput('');
  const week = weekInput.value;
  const selectedOrderYear = String(week || '').match(/^(\d{4})-/)?.[1] || '';
  const majorWeekScope=useMemo(()=>majorInlineWeekScope(majorInlineFacts,selectedOrderYear,week),[majorInlineFacts,selectedOrderYear,week]);
  const apiGetDistribute = useCallback(
    (params) => apiGet('/api/shipment/distribute', { ...params, year: selectedOrderYear }),
    [selectedOrderYear],
  );
  const [prodGroup, setProdGroup] = useState('');
  const [farmCountry,setFarmCountry]=useState('');
  const [expandedFamilies,setExpandedFamilies]=useState({});
  const [farmDate,setFarmDate]=useState(''),[customerDate,setCustomerDate]=useState('');
  const [dateIndex,setDateIndex]=useState([]),[dateIndexLoading,setDateIndexLoading]=useState(false),[dateIndexError,setDateIndexError]=useState('');
  const dateRequestRef=useRef(0),customerListRequestRef=useRef(0),dealerSearchRef=useRef(null);
  const dateLookup=useMemo(()=>buildDistributionDateLookup(dateIndex),[dateIndex]);

  const [prodGroups, setProdGroups] = useState([]);
  const [showAllProdGroups, setShowAllProdGroups] = useState(false);
  const [prodGroupsLoading, setProdGroupsLoading] = useState(false);
  // 'prod'=품목기준(탭0) 'cust'=업체기준(탭1) — nenova.exe처럼 탭이 곧 조회 기준
  const viewMode = tab === 1 ? 'cust' : 'prod';
  const setViewMode = mode => requestTab(mode === 'cust' ? 1 : 0);
  // Ctrl+S / 저장 버튼 결과 화면 로그 (최신이 위)
  const [saveLog, setSaveLog] = useState([]);
  const appendSaveLog = entry => setSaveLog(prev => [distributionSaveLogLine(entry), ...prev].slice(0, 30));

  // 품목기준
  const [products, setProducts] = useState([]);
  const [selectedProd, setSelectedProd] = useState(null);
  const [custDist, setCustDist] = useState([]);
  const [distLoading, setDistLoading] = useState(false);
  const [inQty, setInQty] = useState(0);
  const [outQty, setOutQty] = useState(0);
  const [prodFilter, setProdFilter] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [farmCustomerSearch, setFarmCustomerSearch] = useState('');

  // 업체기준
  const [custList, setCustList] = useState([]);
  const [selectedCust, setSelectedCust] = useState(null);
  const [custItems, setCustItems] = useState([]);
  const [custLoading, setCustLoading] = useState(false);

  // 업체기준 인라인 편집: { [prodKey]: { outQty, cost } }
  const [custEditInputs, setCustEditInputs] = useState({});
  const [moveUnitInputs, setMoveUnitInputs] = useState({}); // 품목별 이동 수량 단위 (기본 OutUnit)
  const [fixedScopeMap, setFixedScopeMap] = useState({}); // { [ProdKey]: { fixed, countryFlower } } — 화면 확정 표시 (읽기 전용 조회)
  // 업체기준 두 업체 나란히 보기(업체 2): 한쪽 수량을 줄이고 다른 쪽에 더하기 쉽게
  const [pairSlot, setPairSlot] = useState(1); // 업체 버튼 클릭이 채우는 칸: 1~5
  const [pairCust, setPairCust] = useState(null);
  const [pairItems, setPairItems] = useState([]);
  const [pairEditInputs, setPairEditInputs] = useState({});
  const [pairLoading, setPairLoading] = useState(false);
  const [moveQtyInputs, setMoveQtyInputs] = useState({}); // 품목별 이동 수량 (비우면 전부, 화면 입력 단위)
  const [pairGroupFilter, setPairGroupFilter] = useState(''); // 나란히 보기 품종 버튼 (화면 필터 전용)
  // 업체 3~5 (나란히 보기 추가 칸): [{ cust, items, inputs }] — 업체 1·2와 같은 custItems 조회·배치 저장 경로
  const [extraPeers, setExtraPeers] = useState([]);
  const [extraLoading, setExtraLoading] = useState(0);
  const [multiMove, setMultiMove] = useState({});
  // 품목추가·수량추가 창: 품종 → 품목 → 단위 → ± 버튼 (현재 수량에 더하기, 저장은 기존 업체 탭 저장)
  const [addPanel, setAddPanel] = useState(null);
  // 이 차수 주문이 없는 업체도 목록에 (업체 2~5 비교·이동 대상). GET /api/master/customers 읽기 전용
  const [showAllCustomers, setShowAllCustomers] = useState(false);
  const [custItemFilter, setCustItemFilter] = useState('');
  const [productCatalog, setProductCatalog] = useState(null); // 품목 전체 카탈로그 (검색어 입력 시 1회 로드, 주문 없는 품목·다른 품종 후보)
  const productCatalogLoadingRef = useRef(false);
  // 품목 탭 업체추가: 담당자 → 업체 버튼. 차수 안에서 품목을 바꿔도 유지 (주문 없는 업체는 저장 시 주문등록 후 분배)
  const [prodAddedCusts, setProdAddedCusts] = useState([]); // [{ CustKey, CustName, OrderCode, Manager }]
  const [prodAddOpen, setProdAddOpen] = useState(false);
  const [prodAddManager, setProdAddManager] = useState(null);
  const [prodAddFilter, setProdAddFilter] = useState(''); // 품목 탭 업체추가: 업체명 검색 (담당자 상관없이 버튼으로) // 업체 탭 품목명 검색 (화면 필터 전용)
  const [addProdFilter, setAddProdFilter] = useState(''); // 품목추가 창 품목명 검색
  const [addCustFilter, setAddCustFilter] = useState(''); // 품목추가 창 업체 검색 (주문 없는 업체 포함)
  const [allCustomers, setAllCustomers] = useState([]);
  const [custFilter, setCustFilter] = useState('');
  const customerPool = (showAllCustomers || String(custFilter || '').trim())
    ? [...custList, ...allCustomers.filter(a => !custList.some(c => Number(c.CustKey) === Number(a.CustKey))).map(a => ({ ...a, noOrder: true }))]
    : custList;
  const loadAllCustomers = async () => {
    if (allCustomers.length > 0) return true;
    try {
      const res = await fetch('/api/master/customers');
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.success !== true) throw new Error(d.error || '전체 업체 목록을 불러오지 못했습니다.');
      setAllCustomers((d.data || []).map(c => ({ CustKey: c.CustKey, CustName: c.CustName, CustArea: c.CustArea, OrderCode: c.OrderCode, Manager: String(c.Manager || '').trim() })));
      return true;
    } catch (e) { setErr(e.message); return false; }
  };
  const inCustomerPool = (cust) => [...customerPool, ...allCustomers].some(c => Number(c.CustKey) === Number(cust?.CustKey));
  const toggleAllCustomers = async (on) => {
    setShowAllCustomers(on);
    if (on && !(await loadAllCustomers())) setShowAllCustomers(false);
  }; // { side, group, prodKey, unit } | null // 품목별 이동 방향 { from, to } (업체 3개 이상일 때)

  const [productListLoading,setProductListLoading]=useState(false),[customerListLoading,setCustomerListLoading]=useState(false);
  const loading=tab===1?customerListLoading:productListLoading;
  const setLoading=tab===1?setCustomerListLoading:setProductListLoading;
  const [distMode, setDistMode] = useState('ratio');
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveModal, setSaveModal] = useState(null); // 저장 완료 모달
  const [outInputs, setOutInputs] = useState({});
  const [fixLoading, setFixLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  const [isFixed, setIsFixed] = useState(false);
  const [validateResult, setValidateResult] = useState(null);
  const [showValidate, setShowValidate] = useState(false);
  const [spLoading, setSpLoading] = useState(false);
  const [spModal, setSpModal] = useState(null);

  // 탭2: 출고요일 설정
  const [shipDayConfigs, setShipDayConfigs] = useState({}); // { 'prodGroup|suffix': '월,화,수' }
  const [shipDayLoading, setShipDayLoading] = useState(false);
  const [shipDaySaving, setShipDaySaving] = useState(false);
  // 탭2: 업체별 일별 수량 분배 { 'custKey|prodKey': { '월': 3, '화': 2, ... } }
  const [dailyQtyInputs, setDailyQtyInputs] = useState({});
  // 탭2: 품목별 출고일 오버라이드 { 'custKey|prodKey': '월,수' }
  const [prodDayOverrides, setProdDayOverrides] = useState({});
  const [tab2CustKey, setTab2CustKey] = useState(null);
  const [tab2Items, setTab2Items] = useState([]);
  const [tab2Loading, setTab2Loading] = useState(false);
  const [excelDownloading, setExcelDownloading] = useState(false);
  const [pivotRows, setPivotRows] = useState([]);
  const [pivotLoading, setPivotLoading] = useState(false);
  const [tab2UsesExeGrid, setTab2UsesExeGrid] = useState(false);
  const [selectedDistCust, setSelectedDistCust] = useState(null);
  const [farmRows, setFarmRows] = useState([]);
  const [farmLoading, setFarmLoading] = useState(false);
  const [favoriteProducts, setFavoriteProducts] = useState([]);
  const [countryFavorite, setCountryFavorite] = useState(undefined);
  const [favoriteGroups, setFavoriteGroups] = useState([]); // [{ groupKey, favoriteKey }]
  const groupChosenRef = useRef(false); // 사용자가 품종(전체 포함)을 직접 고른 뒤에는 즐겨찾기 기본값을 덮어쓰지 않음
  const [favoritesPending, setFavoritesPending] = useState(false);
  const [favoriteError, setFavoriteError] = useState('');
  const [accountId, setAccountId] = useState('');
  const weekPickerRef = useRef(null);
  const productPickerRef = useRef(null);
  const customerPickerRef = useRef(null);
  const saveButtonRef = useRef(null);
  const saveModalConfirmRef = useRef(null);
  const productSearchRef = useRef(null);
  const customerSearchRef = useRef(null);
  const currentWeekRef = useRef(week);
  currentWeekRef.current = week;
  const currentGroupRef = useRef(prodGroup);
  currentGroupRef.current = prodGroup;
  const currentFarmCountryRef=useRef(farmCountry);currentFarmCountryRef.current=farmCountry;
  const searchRequestRef = useRef(0);
  const productRequestRef = useRef(0);
  const customerRequestRef = useRef(0);
  const pairRequestRef = useRef(0);
  const extraRequestRef = useRef(0);
  const farmRequestRef = useRef(0);
  const tab2RequestRef = useRef(0);
  const pivotRequestRef = useRef(0);
  const favoritesRequestRef = useRef(0);
  const accountRef = useRef('');
  const saveInFlightRef = useRef(false);
  const anySaveModal = Boolean(saveModal || spModal || showValidate || showHistory);
  const saveBlocked = hasDateDrafts || tab > 1 || !!dateEditor || saving || loading || distLoading || custLoading || spLoading || fixLoading || shipDaySaving || anySaveModal;

  const loadFavoriteProducts = useCallback(async () => {
    const request = ++favoritesRequestRef.current;
    try {
      const auth = await apiGet('/api/auth/me');
      const uid = String(auth?.user?.userId || '');
      if (!uid) throw new Error('로그인 사용자를 확인하지 못했습니다.');
      if (request !== favoritesRequestRef.current) return;
      if (accountRef.current !== uid) {
        accountRef.current = uid;
        setAccountId(uid);
        setFavoriteProducts([]);
        setFavoriteGroups([]);
        setExpandedFamilies({});
        setCountryFavorite(undefined);
        setShowAllProdGroups(false);
      }
      const data = await apiGet('/api/favorites', { page: PRODUCT_FAVORITE_PAGE });
      if (request !== favoritesRequestRef.current || accountRef.current !== uid) return;
      if (data?.success !== true) throw new Error(data?.error || '즐겨찾기를 읽지 못했습니다.');
      setFavoriteProducts((data.favorites || []).map(parseDistributionFavorite).filter(Boolean));
      const groupData = await apiGet('/api/favorites', { page: GROUP_FAVORITE_PAGE });
      if (request !== favoritesRequestRef.current || accountRef.current !== uid) return;
      if (groupData?.success !== true) throw new Error(groupData?.error || '품종 즐겨찾기를 읽지 못했습니다.');
      setFavoriteGroups((groupData.favorites || []).map(parseDistributionGroupFavorite).filter(Boolean));
      const countryData = await apiGet('/api/favorites', { page: COUNTRY_FAVORITE_PAGE });
      if (request !== favoritesRequestRef.current || accountRef.current !== uid) return;
      if (countryData?.success !== true) throw new Error(countryData?.error || '국가 즐겨찾기를 읽지 못했습니다.');
      setCountryFavorite(parseDistributionCountryFavorite(countryData.favorites || []));
      setFavoriteError('');
    } catch (error) {
      if (request === favoritesRequestRef.current) {
        accountRef.current = '';
        setAccountId('');
        setFavoriteProducts([]);
        setFavoriteGroups([]);
        setExpandedFamilies({});
        setCountryFavorite(undefined);
        setFavoriteError(error.message || '즐겨찾기 조회에 실패했습니다.');
      }
    }
  }, []);

  useEffect(() => {
    loadFavoriteProducts();
    window.addEventListener('focus', loadFavoriteProducts);
    return () => {
      favoritesRequestRef.current += 1;
      window.removeEventListener('focus', loadFavoriteProducts);
    };
  }, [loadFavoriteProducts]);

  const toggleProductFavorite = async (prod, event) => {
    event?.stopPropagation();
    if (!accountId || favoritesPending) return;
    setFavoritesPending(true);
    setFavoriteError('');
    try {
      const auth = await apiGet('/api/auth/me');
      if (String(auth?.user?.userId || '') !== accountId) {
        await loadFavoriteProducts();
        throw new Error('로그인 계정이 바뀌어 즐겨찾기 목록을 다시 읽었습니다. 다시 선택해 주세요.');
      }
      const existing = favoriteProducts.find(row => row.prodKey === Number(prod.ProdKey));
      const result = existing
        ? await apiDelete('/api/favorites', { favoriteKey: existing.favoriteKey })
        : await apiPost('/api/favorites', {
          page: PRODUCT_FAVORITE_PAGE,
          name: String(prod.ProdName || prod.DisplayName || `품목 #${prod.ProdKey}`).slice(0, 100),
          filterData: JSON.stringify({ prodKey: Number(prod.ProdKey) }),
        });
      if (result?.success !== true) throw new Error(result?.error || '즐겨찾기를 저장하지 못했습니다.');
      await loadFavoriteProducts();
    } catch (error) { setFavoriteError(error.message || '즐겨찾기 변경에 실패했습니다.'); }
    finally { setFavoritesPending(false); }
  };

  const toggleGroupFavorite = async (group, event) => {
    event?.stopPropagation();
    if (!accountId || favoritesPending || !group?.key) return;
    setFavoritesPending(true);
    setFavoriteError('');
    try {
      const existing = favoriteGroups.find(row => row.groupKey === group.key);
      const result = existing
        ? await apiDelete('/api/favorites', { favoriteKey: existing.favoriteKey })
        : await apiPost('/api/favorites', {
          page: GROUP_FAVORITE_PAGE,
          name: String(group.label || group.key.replace(PG_SEP, ' ')).slice(0, 100),
          filterData: JSON.stringify({ groupKey: group.key }),
        });
      if (result?.success !== true) throw new Error(result?.error || '품종 즐겨찾기를 저장하지 못했습니다.');
      await loadFavoriteProducts();
    } catch (error) { setFavoriteError(error.message || '품종 즐겨찾기 변경에 실패했습니다.'); }
    finally { setFavoritesPending(false); }
  };

  const selectedCountries = countryFavorite?.countries ?? [...new Set(favoriteGroups.map(f => f.groupKey.split(PG_SEP)[0]))];
  const toggleCountryFavorite = async country => {
    if (!accountId || favoritesPending) return;
    setFavoritesPending(true); setFavoriteError('');
    try {
      const auth = await apiGet('/api/auth/me');
      if (String(auth?.user?.userId || '') !== accountRef.current || accountRef.current !== accountId)
        throw new Error('로그인 계정이 바뀌었습니다. 다시 조회하세요.');
      const countries = selectedCountries.includes(country) ? selectedCountries.filter(v => v !== country) : [...selectedCountries, country];
      const body = { page: COUNTRY_FAVORITE_PAGE, name: '출고분배 국가', filterData: JSON.stringify({version:1,countries}) };
      const result = countryFavorite?.favoriteKey
        ? await apiPut('/api/favorites', {...body, favoriteKey:countryFavorite.favoriteKey})
        : await apiPost('/api/favorites', body);
      if (result?.success !== true) throw new Error(result?.error || '국가 즐겨찾기 저장 실패');
      await loadFavoriteProducts();
    } catch (e) { setFavoriteError(e.message); }
    finally { setFavoritesPending(false); }
  };

  const confirmDateDraftDiscard=()=>{if(!hasDateDrafts)return true;if(!window.confirm('저장하지 않은 출고일 수량이 있습니다. 날짜 입력을 취소하고 이동할까요?'))return false;setDateDrafts({});return true;};
  const confirmFarmDraftDiscard=()=>!saving&&confirmDateDraftDiscard()&&(!hasDistributionDrafts(custDist,outInputs,[],{})||window.confirm('저장하지 않은 품목 분배가 있습니다. 선택을 바꾸면 이 품목 입력값이 사라집니다. 계속할까요?'));
  const confirmCustomerDraftDiscard=()=>!saving&&confirmDateDraftDiscard()&&((!hasDistributionDrafts([],{},custItems,custEditInputs)&&!hasDistributionDrafts([],{},pairItems,pairEditInputs)&&!extraPeers.some(p=>hasDistributionDrafts([],{},p.items,p.inputs)))||window.confirm('저장하지 않은 업체 분배가 있습니다. 업체 선택을 바꿀까요?'));
  const chooseProdGroup = (key) => {
    if(key===prodGroup || !confirmFarmDraftDiscard())return;
    groupChosenRef.current=true;setProdGroup(key);
    if(key){const country=key.split(PG_SEP)[0];if(country)setFarmCountry(country);}
    setSelectedProd(null);setCustDist([]);setOutInputs({});setSelectedDistCust(null);setFarmRows([]);
  };
  const chooseFarmCountry=country=>{
    if(country===farmCountry||!confirmFarmDraftDiscard())return;
    groupChosenRef.current=true;setFarmCountry(country);setProdGroup(country?`${country}${PG_SEP}`:'');
  };

  const loadDateIndex=useCallback(async()=>{
    if(!week||!selectedOrderYear)return;
    const request=++dateRequestRef.current,requestedWeek=week;setDateIndexLoading(true);setDateIndexError('');
    try{const result=await apiGetDistribute({type:'workspaceDateIndex',week});
      if(request!==dateRequestRef.current||requestedWeek!==currentWeekRef.current)return;
      if(!result.success)throw new Error(result.error||'조회 결과 없음');setDateIndex(result.rows||[]);setInlineFacts(result.dateFacts||[]);setInlineCalendar(result.calendar||[]);setMajorInlineFacts(Array.isArray(result.majorDateFacts)?result.majorDateFacts:null);
    }catch(error){if(request===dateRequestRef.current){setDateIndexError(error.message);setFarmDate('');setCustomerDate('');}}
    finally{if(request===dateRequestRef.current)setDateIndexLoading(false);}
  },[week,selectedOrderYear,apiGetDistribute]);
  useEffect(()=>{setFarmDate('');setCustomerDate('');setDateIndex([]);setMajorInlineFacts(null);setInlineFacts([]);setInlineCalendar([]);setDateDrafts({});loadDateIndex();return()=>{dateRequestRef.current+=1;};},[loadDateIndex]);
  useEffect(()=>{if(saveModal)loadDateIndex();},[saveModal,loadDateIndex]);
  const loadWorkspaceCustomers=useCallback(async()=>{
    if(!week||!selectedOrderYear)return;const request=++customerListRequestRef.current,requestedWeek=week;
    setCustomerListLoading(true);setCustList([]);
    try{const data=await apiGetDistribute({type:'workspaceCustomers',week,prodGroup:''});
      if(request!==customerListRequestRef.current||requestedWeek!==currentWeekRef.current)return;
      if(!data.success)throw new Error(data.error||'업체 조회 실패');setCustList(sortDistributionCustomers(data.customers||[]));return data;
    }catch(e){if(request===customerListRequestRef.current)setErr(e.message);return {success:false,error:e.message};}
    finally{if(request===customerListRequestRef.current)setCustomerListLoading(false);}
  },[week,selectedOrderYear,apiGetDistribute]);
  useEffect(()=>{loadWorkspaceCustomers();return()=>{customerListRequestRef.current+=1;};},[loadWorkspaceCustomers]);

  const prevSearchWeekRef = useRef(week);
  useEffect(() => {
    const request = ++searchRequestRef.current;
    // 같은 차수에서 품종만 바꾼 경우: 업체 탭에서 고른 업체·입력값은 유지하고 그 품종 품목만 보이게 (초기화 금지)
    const keepCust = prevSearchWeekRef.current === week;
    prevSearchWeekRef.current = week;
    productRequestRef.current += 1;
    farmRequestRef.current += 1;
    setProducts([]);
    setSelectedProd(null); setCustDist([]); setOutInputs({});
    if (!keepCust) {
      customerRequestRef.current += 1;tab2RequestRef.current += 1;pivotRequestRef.current += 1;
      setSelectedCust(null); setCustItems([]); setCustEditInputs({});
      pairRequestRef.current += 1;
      setPairCust(null); setPairItems([]); setPairEditInputs({}); setPairSlot(1); setMoveQtyInputs({}); setPairGroupFilter('');
      extraRequestRef.current += 1; setExtraPeers([]); setMultiMove({});
    }
    setProdAddedCusts([]); setProdAddOpen(false);
    setSelectedDistCust(null); setFarmRows([]);
    if(!keepCust){setTab2CustKey(null); setTab2Items([]); setDailyQtyInputs({});setPivotRows([]);}
    if (!week || !selectedOrderYear) return;
    const requestedCountry=farmCountry;
    setProductListLoading(true);
    apiGetDistribute({type:'products',week,prodGroup:farmCountry?`${farmCountry}${PG_SEP}`:''}).then(prodRes=>{
      if(request!==searchRequestRef.current||week!==currentWeekRef.current||requestedCountry!==currentFarmCountryRef.current)return;
      if(!prodRes?.success)throw new Error('품목 조회 결과를 확인하지 못했습니다.');setProducts(sortDistributionProducts(prodRes.products||[]));
    }).catch(error=>{if(request===searchRequestRef.current)setErr(error.message);}).finally(()=>{if(request===searchRequestRef.current)setProductListLoading(false);});

  }, [week, farmCountry]);

  const extraHasDrafts = () => extraPeers.some(p => hasDistributionDrafts([], {}, p.items, p.inputs));
  const confirmDraftDiscard = () => !saving && confirmDateDraftDiscard() && ((!hasDistributionDrafts(custDist, outInputs, custItems, custEditInputs) &&
    !hasDistributionDrafts([], {}, pairItems, pairEditInputs) && !extraHasDrafts()) ||
    window.confirm('저장하지 않은 출고수량 또는 단가 변경이 있습니다. 선택을 바꾸면 입력값이 사라집니다. 계속하시겠습니까?'));
  const hasQuantityDraft = () => hasDistributionDrafts(custDist, outInputs, custItems, custEditInputs) ||
    hasDistributionDrafts([], {}, pairItems, pairEditInputs) || extraHasDrafts();
  const hasAnyDraft = () => hasDateDrafts || hasQuantityDraft();

  // 화면에서 바꾼 수량·단가·이동을 모두 되돌린다 (DB 조회값으로). 저장된 데이터는 건드리지 않음.
  const discardDrafts = () => {
    if (saving || !hasAnyDraft()) return;
    if (!window.confirm('화면에서 바꾼 출고수량·단가·이동 내용을 모두 취소할까요? (저장된 DB 값은 그대로)')) return;
    const inputs = {};
    custDist.forEach(c => { inputs[c.CustKey] = c.출고수량 || 0; });
    setDateDrafts({});setOutInputs(inputs);
    setCustEditInputs({}); setPairEditInputs({}); setMoveQtyInputs({});
    setCustItems(prev => prev.filter(item => !item.pendingOrder));
    setPairItems(prev => prev.filter(item => !item.pendingOrder));
    setExtraPeers(prev => prev.map(p => ({ ...p, items: p.items.filter(item => !item.pendingOrder), inputs: {} })));
  };

  // 닫기: 팝업이면 창 닫기, 아니면 이전 화면(없으면 첫 화면). 미저장 변경이 있으면 먼저 확인.
  const handleClose = () => {
    if (!confirmDraftDiscard()) return;
    if (window.opener && !window.opener.closed) { window.close(); return; }
    if (window.history.length > 1) { window.history.back(); return; }
    window.location.href = '/';
  };

  const closeSaveModal = () => { setSaveModal(null); requestAnimationFrame(() => saveButtonRef.current?.focus()); };
  useEffect(() => {
    if (!saveModal) return undefined;
    saveModalConfirmRef.current?.focus();
    const onEscape = event => { if (event.key === 'Escape') { event.preventDefault(); closeSaveModal(); } };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [saveModal]);
  const guardedWeekInput = {
    ...weekInput,
    props: { ...weekInput.props,
      onChange: event => { if (confirmDraftDiscard()) weekInput.props.onChange(event); },
    },
    setValue: value => { if (value !== week && confirmDraftDiscard()) weekInput.setValue(value); },
    prev: () => { if (confirmDraftDiscard()) weekInput.prev(); },
    next: () => { if (confirmDraftDiscard()) weekInput.next(); },
    prevWeek: () => { if (confirmDraftDiscard()) weekInput.prevWeek(); },
    nextWeek: () => { if (confirmDraftDiscard()) weekInput.nextWeek(); },
  };

  // ── 출고요일 설정 로드
  const loadShipDayConfigs = useCallback(async () => {
    setShipDayLoading(true);
    try {
      const d = await apiGet('/api/shipment/ship-days', {});
      const map = {};
      (d.configs || []).forEach(c => {
        map[`${c.ProdGroup}|${c.WeekSuffix}`] = c.ShipDays;
      });
      setShipDayConfigs(map);
    } catch (e) { setErr(e.message); } finally { setShipDayLoading(false); }
  }, []);

  useEffect(() => { loadShipDayConfigs(); }, [loadShipDayConfigs]);

  // 품목그룹 목록 — DB CounName+FlowerName (nenova.exe / 주문등록 동일)
  const loadProdGroups = useCallback(async (wk) => {
    setProdGroupsLoading(true);
    try {
      const d = await apiGetDistribute({ type: 'groups', ...(wk ? { week: wk } : {}) });
      return d.groups || [];
    } catch (e) {
      return [];
    } finally {
      setProdGroupsLoading(false);
    }
  }, [apiGetDistribute]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const groups = await loadProdGroups(week || '');
      if (cancelled) return;
      setProdGroups(groups);
      setProdGroup(prev => prev && groups.some(g=>g.key===prev||(prev.endsWith(PG_SEP)&&g.country===prev.slice(0,-2)))?prev:'');
      setFarmCountry(prev=>groups.some(g=>g.country===prev)?prev:'');
    })();
    return () => { cancelled = true; };
  }, [week, loadProdGroups]);

  // 품종 즐겨찾기가 있으면 차수가 바뀌어도 그 품종을 기본 선택 (사용자가 직접 고르기 전까지만)
  useEffect(() => {
    if (countryFavorite === undefined || groupChosenRef.current || farmCountry || favoriteGroups.length === 0) return;
    const first = favoriteGroups.find(fav => prodGroups.some(g => g.key === fav.groupKey && (countryFavorite === null || countryFavorite.countries.includes(g.country))));
    if (first){const country=first.groupKey.split(PG_SEP)[0];setFarmCountry(country);setProdGroup(`${country}${PG_SEP}`);}
  }, [favoriteGroups, prodGroups, farmCountry, countryFavorite]);

  const countryGroups = countryFavorite === undefined && !showAllProdGroups ? [] : distributionCountryGroups(prodGroups).filter(g=>showAllProdGroups||selectedCountries.includes(g.country)).sort((a,b)=>Number(selectedCountries.includes(b.country))-Number(selectedCountries.includes(a.country))||a.country.localeCompare(b.country,'ko'));
  useEffect(()=>{if(tab===0)ensureProductCatalog();},[tab]);
  const selectedProdGroupLabel = prodGroups.find(g => g.key === prodGroup)?.label || prodGroup.replace(PG_SEP, '');

  // 출고요일 설정 저장
  const saveShipDayConfigs = async () => {
    setShipDaySaving(true); setErr('');
    try {
      const configs = Object.entries(shipDayConfigs).map(([key, days]) => {
        const lastPipe = key.lastIndexOf('|');
        const prodGroupKey = lastPipe > 0 ? key.slice(0, lastPipe) : key;
        const weekSuffix = lastPipe > 0 ? key.slice(lastPipe + 1) : '-01';
        return { prodGroup: prodGroupKey, weekSuffix, custKey: 0, shipDays: days };
      });
      const res = await fetch('/api/shipment/ship-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSuccessMsg('✅ 출고요일 설정 저장 완료');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e) { setErr(e.message); } finally { setShipDaySaving(false); }
  };

  // 출고요일 토글
  const toggleShipDay = (prodGroup, suffix, day) => {
    const key = `${prodGroup}|${suffix}`;
    const current = (shipDayConfigs[key] || '').split(',').filter(Boolean);
    const idx = current.indexOf(day);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(day);
    // 월~금 순서 정렬
    current.sort((a, b) => DAY_NAMES.indexOf(a) - DAY_NAMES.indexOf(b));
    setShipDayConfigs(prev => ({ ...prev, [key]: current.join(',') }));
  };

  // 품목의 출고요일 가져오기 (오버라이드 → 기본설정 → 빈배열)
  const getShipDays = (custKey, prodKey, prodGroup) => {
    const overKey = `${custKey}|${prodKey}`;
    if (prodDayOverrides[overKey]) return prodDayOverrides[overKey].split(',').filter(Boolean);
    // 차수 접미사 파악 (week = "14-01" → suffix = "-01")
    const suffix = week ? `-${week.split('-').pop()}` : '-01';
    const cfgKey = `${prodGroup}|${suffix}`;
    const days = (shipDayConfigs[cfgKey] || '').split(',').filter(Boolean);
    return days;
  };

  // 탭2 업체 선택 → 품목+출고수량 로드 → 자동 일별 분배
  const loadTab2Items = async (ck) => {
    if (!week || !ck) return;
    const request = ++tab2RequestRef.current;
    const requestedWeek = week;
    setTab2CustKey(ck);
    setTab2Loading(true);
    const cf = countryFlowerFromGroup(prodGroup, prodGroups);
    try {
      let items = [];
      let usesExe = false;
      if (cf) {
        const d = await apiGetDistribute({
          type: 'custWeekGrid',
          week,
          custKey: ck,
          countryFlower: cf,
        });
        items = (d.rows || []).map(mapCustWeekGridRow);
        usesExe = items.length > 0;
      }
      if (!usesExe) {
        const d = await apiGetDistribute({ type: 'custItems', week, custKey: ck });
        items = d.items || [];
      }
      if (request !== tab2RequestRef.current || requestedWeek !== currentWeekRef.current) return;
      items = sortDistributionProducts(usesExe ? items : items.filter(item=>distributionSelectionMatches(item,prodGroup)));
      setTab2UsesExeGrid(usesExe);
      setTab2Items(items);
      // Only persisted native dates are exportable; no fabricated weekday auto split.
      setDailyQtyInputs(Object.fromEntries(items.filter(item=>item._exeWeekGrid).map(item=>[`${ck}|${item.ProdKey}`,{...item._dayByKr}])));
    } catch (e) { if (request === tab2RequestRef.current) setErr(e.message); }
    finally { if (request === tab2RequestRef.current) setTab2Loading(false); }
  };

  const handleExcelDownload = async (singleCustKey) => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    setExcelDownloading(true); setErr('');
    try {
      const params = new URLSearchParams({ week });
      if (singleCustKey) params.set('custKey', singleCustKey);
      // 출고요일 설정과 일별 수량을 쿼리에 포함
      params.set('shipDayConfigs', JSON.stringify(shipDayConfigs));
      params.set('dailyQtyInputs', JSON.stringify(dailyQtyInputs));
      params.set('prodDayOverrides', JSON.stringify(prodDayOverrides));

      const res = await fetch(`/api/shipment/excel-download?${params.toString()}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || '다운로드 실패'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g,'') || `출고_${week}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccessMsg('✅ 엑셀 다운로드 완료');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e) { setErr(e.message); } finally { setExcelDownloading(false); }
  };

  const handleFix = async () => {
    if (prodGroup.endsWith(PG_SEP)) { setErr('국가 전체 조회에서는 실행할 수 없습니다. 먼저 품종을 선택하세요.'); return; }
    if (!week) { setErr('차수를 입력하세요.'); return; }
    // 사전검증
    setFixLoading(true); setErr('');
    try {
      const orderYear = selectedOrderYear;
      const vRes = await fetch(`/api/shipment/fix?week=${encodeURIComponent(week)}&orderYear=${encodeURIComponent(orderYear)}`);
      const vData = await vRes.json();
      if (vData.issueCount > 0) {
        setValidateResult(vData);
        setShowValidate(true);
        setFixLoading(false);
        return;
      }
    } catch(e) { /* 검증 실패해도 확정 진행 허용 */ }
    await doFix();
  };

  const doFix = async () => {
    if (prodGroup.endsWith(PG_SEP)) { setErr('국가 전체 조회에서는 실행할 수 없습니다. 먼저 품종을 선택하세요.'); return; }
    if (!confirm(`[${week}] 차수를 확정하시겠습니까?\n\n확정 시 재고가 업데이트되고 견적서에 반영됩니다.`)) { setFixLoading(false); return; }
    setFixLoading(true); setErr('');
    try {
      const res = await fetch('/api/shipment/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, orderYear: selectedOrderYear, action: 'fix' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setIsFixed(true);
      setShowValidate(false);
      setSuccessMsg('✅ ' + data.message);
      setTimeout(() => setSuccessMsg(''), 5000);
      handleSearch();
    } catch(e) { setErr(e.message); } finally { setFixLoading(false); }
  };

  const handleUnfix = async () => {
    if (prodGroup.endsWith(PG_SEP)) { setErr('국가 전체 조회에서는 실행할 수 없습니다. 먼저 품종을 선택하세요.'); return; }
    if (!week) { setErr('차수를 입력하세요.'); return; }
    if (!confirm(`[${week}] 확정을 취소 / Cancelar하시겠습니까?`)) return;
    setFixLoading(true); setErr('');
    try {
      const res = await fetch('/api/shipment/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, orderYear: selectedOrderYear, action: 'unfix' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setIsFixed(false);
      setSuccessMsg('✅ ' + data.message);
      setTimeout(() => setSuccessMsg(''), 3000);
      handleSearch();
    } catch(e) { setErr(e.message); } finally { setFixLoading(false); }
  };

  const handleSpDistribute = async (action) => {
    if (prodGroup.endsWith(PG_SEP)) { setErr('국가 전체 조회에서는 실행할 수 없습니다. 먼저 품종을 선택하세요.'); return; }
    if (!week) { setErr('차수를 입력하세요.'); return; }
    if (action === 'one' && !selectedProd) { setErr('개별 전산 출고분배는 품목을 먼저 선택하세요.'); return; }
    if (action === 'group' && !prodGroup) { setErr('꽃/품목그룹을 선택하세요. 전체 차수 실행은 사용하지 않습니다.'); return; }

    const label = action === 'one'
      ? `${week}차 ${selectedProd.DisplayName || selectedProd.ProdName} 개별 출고분배`
      : action === 'group'
        ? `${week}차 ${selectedProdGroupLabel} 일괄출고분배`
        : `${week}차 전체 일괄출고분배`;
    if (!confirm(`${label}를 전산 nenova.exe와 같은 저장 프로시저 경로로 실행하시겠습니까?\n\n실행 전 KeyNumbering/확정상태를 확인하고, 실행 후 출고일/중복 출고상세 검증에 실패하면 롤백합니다.`)) return;

    setSpLoading(true);
    setErr('');
    setSuccessMsg('');
    setSpModal({
      running: true,
      title: label,
      logs: [
        `${label} 시작`,
        '전산 저장 프로시저 확인 중',
        'KeyNumbering, 확정상태, 출고일 정합성을 함께 검사합니다.',
      ],
    });
    try {
      const res = await fetch('/api/shipment/distribute-sp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          week,
          year: selectedOrderYear,
          prodKey: action === 'one' ? selectedProd.ProdKey : undefined,
          prodGroup: action === 'group' ? prodGroup : undefined,
          distributionType: distMode === 'prior' ? 2 : 1, // 2=우선 분배, 1=비율 분배 (nenova.exe @DistributionType)
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || '전산 출고분배 실행 실패');
      setSpModal({
        running: false,
        title: label,
        logs: data.logs || [],
        before: data.before,
        after: data.after,
        procedureName: data.procedureName,
      });
      setSuccessMsg(`✅ ${label} 완료`);
      setTimeout(() => setSuccessMsg(''), 5000);
      await handleSearch();
      if (action === 'one' && selectedProd) await selectProd(selectedProd);
    } catch (e) {
      setErr(e.message);
      setSpModal(prev => ({
        ...(prev || { title: label }),
        running: false,
        failed: true,
        logs: [...((prev || {}).logs || []), `오류: ${e.message}`],
      }));
    } finally {
      setSpLoading(false);
    }
  };

  // 개별 초기화 — nenova.exe "개별 초기화"(usp_DistributeClear) 와 동일. 선택 품목의 출고분배를 되돌린다.
  const handleClearOne = async () => {
    if (prodGroup.endsWith(PG_SEP)) { setErr('국가 전체 조회에서는 실행할 수 없습니다. 먼저 품종을 선택하세요.'); return; }
    if (!week) { setErr('차수를 입력하세요.'); return; }
    if (!selectedProd?.ProdKey) { setErr('초기화할 품목을 먼저 선택하세요.'); return; }
    const label = `${week}차 ${selectedProd.DisplayName || selectedProd.ProdName} 개별 초기화`;
    if (!confirm(`${label}\n\n선택 품목의 출고분배를 전산 nenova.exe와 동일한 경로(usp_DistributeClear)로 되돌립니다.\n확정된 분배는 먼저 확정취소해야 합니다. 계속하시겠습니까?`)) return;
    setSpLoading(true); setErr(''); setSuccessMsg('');
    try {
      const res = await fetch('/api/shipment/distribute-clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, year: selectedOrderYear, prodKey: selectedProd.ProdKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || '개별 초기화 실패');
      setSuccessMsg(`✅ ${label} 완료`);
      setTimeout(() => setSuccessMsg(''), 4000);
      await handleSearch();
      if (selectedProd) await selectProd(selectedProd);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSpLoading(false);
    }
  };

  const handleHistory = async () => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    try {
      const d = await apiGet('/api/shipment/history', {
        startDate: '2020-01-01',
        endDate: new Date().toISOString().slice(0,10),
        search: week,
      });
      setHistoryData(d.history || []);
      setShowHistory(true);
    } catch(e) { setErr(e.message); }
  };

  const handleSearch = async () => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    if (!confirmDraftDiscard()) return;
    const request = ++searchRequestRef.current;
    const requestedWeek = week;
    const requestedGroup = prodGroup;
    loadDateIndex();
    productRequestRef.current += 1;
    customerRequestRef.current += 1;
    setLoading(true); setErr('');
    const cf = countryFlowerFromGroup(prodGroup, prodGroups);

    try {
      const [prodRes, custRes] = await Promise.all([
        apiGetDistribute({
          type: 'products',
          week,
          prodGroup:farmCountry?`${farmCountry}${PG_SEP}`:'',
        }),
        loadWorkspaceCustomers(),
      ]);
      if (request !== searchRequestRef.current || requestedWeek !== currentWeekRef.current || requestedGroup !== currentGroupRef.current) return;
      if (prodRes?.success !== true || custRes?.success !== true) throw new Error('분배 조회 결과를 확인하지 못했습니다.');
      const nextProducts = sortDistributionProducts(prodRes.products || []);
      setProducts(nextProducts);
      const customers = sortDistributionCustomers(custRes.customers || []);
      const matchingProd = nextProducts.find(p => Number(p.ProdKey) === Number(selectedProd?.ProdKey));
      const matchingCust = customers.find(c => Number(c.CustKey) === Number(selectedCust?.CustKey));
      if (matchingProd && viewMode === 'prod') selectProd(matchingProd, { skipDraftCheck: true });
      else if (matchingCust && viewMode === 'cust') selectCust(matchingCust, { skipDraftCheck: true });
      else if (viewMode === 'prod') { setSelectedProd(null); setCustDist([]); setOutInputs({}); }
      else { setSelectedCust(null); setCustItems([]); setCustEditInputs({}); }
      if (custFilter && !customers.some(c => c.CustName.includes(custFilter.trim())))
        setErr(`거래처 "${custFilter}" 를 이 차수에서 찾을 수 없습니다.`);
    } catch(e) { if (request === searchRequestRef.current) setErr(e.message); }
    finally { if (request === searchRequestRef.current) setLoading(false); }
  };

  const loadPivotRows = useCallback(async () => {
    const cf = countryFlowerFromGroup(prodGroup, prodGroups);
    if (!week || !cf) { setPivotRows([]); return; }
    const request = ++pivotRequestRef.current;
    const requestedWeek = week;
    setPivotLoading(true);
    try {
      const d = await apiGetDistribute({ type: 'pivot', week, countryFlower: cf });
      if (request === pivotRequestRef.current && requestedWeek === currentWeekRef.current)
        setPivotRows(sortDistributionProducts(d.rows || []));
    } catch {
      if (request === pivotRequestRef.current) setPivotRows([]);
    } finally {
      if (request === pivotRequestRef.current) setPivotLoading(false);
    }
  }, [week, prodGroup, prodGroups]);

  useEffect(() => {
    if (tab === 3) loadPivotRows();
  }, [tab, loadPivotRows]);

  // 품목 클릭 → 거래처 분배 정보 로드
  const selectProd = async (prod, { skipDraftCheck = false } = {}) => {
    if ((saving || loading) && !skipDraftCheck) return;
    if (!week || !mergeDistributionSearchCandidates(products, productCatalog).some(p => Number(p.ProdKey) === Number(prod?.ProdKey))) return;
    if (!skipDraftCheck && !confirmFarmDraftDiscard()) return;
    const request = ++productRequestRef.current;
    const requestedWeek = week;
    setSelectedProd(prod);
    if(prod.CounName&&prod.FlowerName)setProdGroup(`${prod.CounName}${PG_SEP}${prod.FlowerName}`);
    setSelectedDistCust(null);
    setFarmRows([]);
    setOutInputs({}); setCustDist([]);
    setInQty(prod.inQty || 0);
    setOutQty(prod.outQty || 0);
    setDistLoading(true);
    try {
      const d = await apiGetDistribute({ type:'custDist', week, prodKey: prod.ProdKey });
      if (request !== productRequestRef.current || requestedWeek !== currentWeekRef.current) return;
      if (d?.success !== true) throw new Error('거래처 분배 조회 결과를 확인하지 못했습니다.');
      setCustDist(sortDistributionCustomers(d.customers || []));
      // 기존 출고수량으로 초기화
      const inputs = {};
      (d.customers||[]).forEach(c => { inputs[c.CustKey] = c.출고수량 || 0; });
      setOutInputs(inputs);
      setInQty(prod.inQty || 0);
      setOutQty(d.totalOut || 0);
    } catch(e) { if (request === productRequestRef.current) setErr(e.message); }
    finally { if (request === productRequestRef.current) setDistLoading(false); }
  };

  const selectDistCustRow = async (c) => {
    const request = ++farmRequestRef.current;
    const requestedWeek = week;
    setSelectedDistCust(c);
    if (!c?.SdetailKey || !selectedProd?.ProdKey) {
      setFarmRows([]);
      return;
    }
    setFarmLoading(true);
    try {
      const d = await apiGetDistribute({
        type: 'shipmentFarms',
        prodKey: selectedProd.ProdKey,
        sdetailKey: c.SdetailKey,
      });
      if (request === farmRequestRef.current && requestedWeek === currentWeekRef.current) setFarmRows(d.farms || []);
    } catch (e) {
      if (request === farmRequestRef.current) { setFarmRows([]); setErr(e.message); }
    } finally {
      if (request === farmRequestRef.current) setFarmLoading(false);
    }
  };

  // 업체 선택 → 해당 업체 주문 품목 로드
  const selectCust = async (cust, { skipDraftCheck = false } = {}) => {
    if ((saving || loading) && !skipDraftCheck) return;
    if (!week || !inCustomerPool(cust)) return;
    if (!skipDraftCheck && !confirmCustomerDraftDiscard()) return;
    const request = ++customerRequestRef.current;
    const requestedWeek = week;
    setSelectedCust(cust); setPairSlot(1);
    setCustItems([]); setCustEditInputs({});
    setCustLoading(true);
    try {
      const d = await apiGetDistribute({ type:'custItems', week, custKey: cust.CustKey });
      if (request !== customerRequestRef.current || requestedWeek !== currentWeekRef.current) return;
      if (d?.success !== true) throw new Error('업체 품목 조회 결과를 확인하지 못했습니다.');
      const items = sortDistributionProducts(d.items || []);
      setCustItems(items);
      // 편집 입력값 초기화: 기존 출고수량 + 기존 단가
      const inputs = {};
      items.forEach(item => {
        inputs[item.ProdKey] = { outQty: item.출고수량 || 0, cost: item.Cost || 0 };
      });
      setCustEditInputs(inputs);
    } catch(e) { if (request === customerRequestRef.current) setErr(e.message); }
    finally { if (request === customerRequestRef.current) setCustLoading(false); }
  };

  // 업체 2 선택 (두 업체 나란히 보기) — 업체 1과 같은 custItems 조회, 저장도 같은 배치 경로
  const selectPairCust = async (cust, { skipDraftCheck = false } = {}) => {
    if ((saving || loading) && !skipDraftCheck) return;
    if (!week || !inCustomerPool(cust)) return;
    if (Number(cust.CustKey) === Number(selectedCust?.CustKey)) { setErr('업체 1과 같은 업체는 업체 2로 선택할 수 없습니다.'); return; }
    if (!skipDraftCheck && hasDistributionDrafts([], {}, pairItems, pairEditInputs) &&
      !window.confirm('업체 2의 저장하지 않은 변경이 있습니다. 업체를 바꾸면 입력값이 사라집니다. 계속하시겠습니까?')) return;
    const request = ++pairRequestRef.current;
    const requestedWeek = week;
    setPairCust(cust);
    setPairItems([]); setPairEditInputs({}); setMoveQtyInputs({}); setPairGroupFilter('');
    setPairLoading(true);
    try {
      const d = await apiGetDistribute({ type:'custItems', week, custKey: cust.CustKey });
      if (request !== pairRequestRef.current || requestedWeek !== currentWeekRef.current) return;
      if (d?.success !== true) throw new Error('업체 2 품목 조회 결과를 확인하지 못했습니다.');
      const items = sortDistributionProducts(d.items || []);
      setPairItems(items);
      const inputs = {};
      items.forEach(item => { inputs[item.ProdKey] = { outQty: item.출고수량 || 0, cost: item.Cost || 0 }; });
      setPairEditInputs(inputs);
    } catch(e) { if (request === pairRequestRef.current) setErr(e.message); }
    finally { if (request === pairRequestRef.current) setPairLoading(false); }
  };
  const clearPairCust = () => {
    if (hasDistributionDrafts([], {}, pairItems, pairEditInputs) &&
      !window.confirm('업체 2의 저장하지 않은 변경이 있습니다. 해제하면 입력값이 사라집니다. 계속하시겠습니까?')) return;
    if (extraHasDrafts() && !window.confirm('업체 3~5의 저장하지 않은 변경도 함께 사라집니다. 계속하시겠습니까?')) return;
    pairRequestRef.current += 1;
    setPairCust(null); setPairItems([]); setPairEditInputs({}); setPairSlot(1); setMoveQtyInputs({}); setPairGroupFilter('');
    extraRequestRef.current += 1; setExtraPeers([]); setMultiMove({});
  };
  // 업체 3~5 선택 — slot 3 이면 extraPeers[0]. 앞 칸이 비어 있으면 다음 빈 칸에 채운다.
  const updateExtra = (index, key, next) => setExtraPeers(prev => prev.map((p, i) => i === index ? { ...p, [key]: typeof next === 'function' ? next(p[key]) : next } : p));
  const selectExtraCust = async (cust, slot, { skipDraftCheck = false } = {}) => {
    if ((saving || loading) && !skipDraftCheck) return;
    if (!week || !pairCust || !inCustomerPool(cust)) return;
    const index = Math.min(slot - 3, extraPeers.length);
    const taken = [selectedCust, pairCust, ...extraPeers.filter((_, i) => i !== index).map(p => p.cust)];
    if (taken.some(c => Number(c?.CustKey) === Number(cust.CustKey))) { setErr('이미 다른 칸에 선택된 업체입니다.'); return; }
    const prev = extraPeers[index];
    if (!skipDraftCheck && prev && Number(prev.cust.CustKey) !== Number(cust.CustKey) && hasDistributionDrafts([], {}, prev.items, prev.inputs) &&
      !window.confirm(`업체 ${index + 3}의 저장하지 않은 변경이 있습니다. 업체를 바꾸면 입력값이 사라집니다. 계속하시겠습니까?`)) return;
    const request = ++extraRequestRef.current;
    const requestedWeek = week;
    setExtraPeers(list => { const next = [...list]; next[index] = { cust, items: [], inputs: {} }; return next; });
    setExtraLoading(n => n + 1);
    try {
      const d = await apiGetDistribute({ type:'custItems', week, custKey: cust.CustKey });
      if (request !== extraRequestRef.current || requestedWeek !== currentWeekRef.current) return;
      if (d?.success !== true) throw new Error(`업체 ${index + 3} 품목 조회 결과를 확인하지 못했습니다.`);
      const items = sortDistributionProducts(d.items || []);
      const inputs = {};
      items.forEach(item => { inputs[item.ProdKey] = { outQty: item.출고수량 || 0, cost: item.Cost || 0 }; });
      setExtraPeers(list => list.map((p, i) => i === index && Number(p.cust.CustKey) === Number(cust.CustKey) ? { cust, items, inputs } : p));
    } catch(e) { if (request === extraRequestRef.current) setErr(e.message); }
    finally { setExtraLoading(n => Math.max(0, n - 1)); }
  };
  const clearExtraCust = (index) => {
    const peer = extraPeers[index];
    if (!peer) return;
    if (hasDistributionDrafts([], {}, peer.items, peer.inputs) &&
      !window.confirm(`업체 ${index + 3}의 저장하지 않은 변경이 있습니다. 해제하면 입력값이 사라집니다. 계속하시겠습니까?`)) return;
    extraRequestRef.current += 1;
    setExtraPeers(prev => prev.filter((_, i) => i !== index));
    setMultiMove({}); setPairSlot(1);
  };
  // 나란히 보기의 업체 칸들: 0=업체 1, 1=업체 2, 2~4=업체 3~5
  const pairSides = () => [
    { cust: selectedCust, items: custItems, inputs: custEditInputs, setItems: setCustItems, setInputs: setCustEditInputs },
    { cust: pairCust, items: pairItems, inputs: pairEditInputs, setItems: setPairItems, setInputs: setPairEditInputs },
    ...extraPeers.map((p, i) => ({ cust: p.cust, items: p.items, inputs: p.inputs, setItems: next => updateExtra(i, 'items', next), setInputs: next => updateExtra(i, 'inputs', next) })),
  ];
  // 한쪽 업체의 출고수량을 다른 쪽으로 옮기기 (화면 입력값만; DB 반영은 저장)
  // - 이동 수량 칸이 비어 있으면 전부, 숫자가 있으면 그만큼만 (보내는 쪽 수량이 상한)
  // - 받는 업체에 그 품목 주문이 없으면 임시 행(주문수량 0)을 만들고, 저장 시 주문등록 → 분배 순으로 처리
  // - 보내는 쪽이 0 이 돼도 주문등록은 건드리지 않는다
  const moveDistributionQty = (prodKey, fromIndex, toIndex, factor = 1) => {
    const sides = pairSides();
    if (!sides[fromIndex]?.cust || !sides[toIndex]?.cust || fromIndex === toIndex) return;
    const { items: fromItems, inputs: fromInputs, setInputs: setFromInputs } = sides[fromIndex];
    const { items: toItems, inputs: toInputs, setItems: setToItems, setInputs: setToInputs } = sides[toIndex];
    const source = fromItems.find(item => Number(item.ProdKey) === Number(prodKey));
    if (!source) return;
    const target = toItems.find(item => Number(item.ProdKey) === Number(prodKey));
    const fromQty = fromInputs[prodKey]?.outQty !== undefined ? parseFloat(fromInputs[prodKey].outQty) || 0 : (source.출고수량 || 0);
    const toQty = target ? (toInputs[prodKey]?.outQty !== undefined ? parseFloat(toInputs[prodKey].outQty) || 0 : (target.출고수량 || 0)) : 0;
    const requested = String(moveQtyInputs[prodKey] ?? '').trim() === '' ? '' : toNativeQty(moveQtyInputs[prodKey], factor);
    const plan = planDistributionMove({ fromQty, toQty, requested });
    if (plan.moved <= 0) return;
    if (!target) setToItems(prev => [...prev, pendingDistributionItem(source)]);
    setFromInputs(prev => ({ ...prev, [prodKey]: { ...(prev[prodKey] || {}), outQty: plan.fromAfter } }));
    setToInputs(prev => ({ ...prev, [prodKey]: { ...(prev[prodKey] || {}), outQty: plan.toAfter, cost: prev[prodKey]?.cost ?? (target?.Cost ?? source.Cost ?? 0) } }));
    setMoveQtyInputs(prev => ({ ...prev, [prodKey]: '' }));
  };

  // 주문이 없던 업체에 옮긴 품목 → 기존 주문등록 API(가산 등록)로 먼저 주문을 만든다. 분배 저장은 그 뒤.
  const registerPendingOrders = async (cust, items, inputs) => {
    const pending = pendingDistributionOrderItems(items, inputs);
    if (!cust || pending.length === 0) return 0;
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ custKey: cust.CustKey, custName: cust.CustName, week, year: selectedOrderYear, source: 'distribute-pair', items: pending })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success !== true) throw new Error(`${cust.CustName} 주문등록 실패: ${data.error || res.status}`);
    return pending.length;
  };

  // 확정된 품목군이 섞여 있으면: 기존 확정해제 → 저장 → 재확정 사이클 (docs/CONFIRMED_WEEK_EDIT_SAFETY_CHECKLIST.md C-1, C-10)
  // - 바꾸는 품목이 속한 품목군만 풀고(force=false, 화면 연도 명시), 저장 실패해도 재확정까지 마친다
  // - 확정 품목군이 없으면 사이클 없이 apply() 그대로
  const saveWithFixCycleIfNeeded = async ({ prodKeys, label, logName, mode, apply }) => {
    const keys = [...new Set(prodKeys.map(Number).filter(k => Number.isInteger(k) && k > 0))];
    if (keys.length === 0) return apply();
    const d = await apiGetDistribute({ type: 'fixedScopes', week, prodKeys: keys.join(',') });
    if (d?.success !== true) throw new Error(d?.error || '확정 상태를 확인하지 못해 저장하지 않았습니다.');
    const scope = distributionFixCycleScope(d.scopes || []);
    if (!scope.needed) return apply();
    if (scope.blocked.length > 0) throw new Error(`품목군이 없는 확정 품목(ProdKey ${scope.blocked.join(', ')})이 있어 자동 확정해제를 할 수 없습니다. 확정취소 후 다시 저장하세요.`);
    if (!window.confirm(`${week}차 ${scope.countryFlowers.join(', ')} 품목군이 확정되어 있습니다.\n\n${label}\n\n확정해제 → 저장 → 재확정 순서로 진행할까요?`)) {
      throw Object.assign(new Error('확정차수 저장을 취소했습니다.'), { cancelled: true });
    }
    return runEditWithFixCycle({
      weeks: [week],
      orderYear: selectedOrderYear,
      countryFlowers: scope.countryFlowers,
      stockProdKeys: keys,
      cycleSource: 'distribute-save',
      progress: step => appendSaveLog({ mode, name: logName, week, note: step }),
      apply,
    });
  };

  // 업체기준 저장 — 업체 1(+업체 2) 행을 같은 배치 저장 경로로
  const handleSaveCustItems = async () => {
    if (saveBlocked || saveInFlightRef.current) return;
    if (!selectedCust || !week) { setErr('업체와 차수를 선택하세요.'); return; }
    const pairName = [selectedCust, pairCust, ...extraPeers.map(p => p.cust)].filter(Boolean).map(c => c.CustName).join(' + ');
    if (!hasDistributionDrafts([], {}, custItems, custEditInputs) && !hasDistributionDrafts([], {}, pairItems, pairEditInputs) && !extraHasDrafts()) {
      appendSaveLog({ mode: 'cust', name: pairName, week, skipped: true });
      return;
    }
    saveInFlightRef.current = true;
    const submittedWeek = week;
    const submittedCust = selectedCust;
    const submittedPair = pairCust;
    const submittedExtras = pairCust ? extraPeers : [];
    setSaving(true); setErr('');
    try {
      // 바뀐 행만 저장 대상. 안 바뀐 품목까지 보내면 그 품목군까지 확정해제 대상이 되어
      // 관계없는 품종의 다음차수 확정에 막힌다 (2026-45-01 CHINA 사례). 저장 API는 행 단위 절대값이라 나머지는 그대로.
      const toEntries = (cust, items, inputs) => items.flatMap(item => {
        const edit = inputs[item.ProdKey] || {};
        const qty = edit.outQty !== undefined ? parseFloat(edit.outQty) || 0 : (item.출고수량 || 0);
        const cost = edit.cost !== undefined ? parseFloat(edit.cost) || 0 : (item.Cost || 0);
        const changed = item.pendingOrder || qty !== Number(item.출고수량 || 0) || cost !== Number(item.Cost || 0);
        return changed ? [{ custKey: cust.CustKey, prodKey: item.ProdKey, outQty: qty, cost }] : [];
      });
      const dropEmptyPending = (items, inputs) => items.filter(item => !item.pendingOrder || (parseFloat(inputs[item.ProdKey]?.outQty) || 0) > 0);
      const entries = [
        ...toEntries(selectedCust, dropEmptyPending(custItems, custEditInputs), custEditInputs),
        ...(pairCust ? toEntries(pairCust, dropEmptyPending(pairItems, pairEditInputs), pairEditInputs) : []),
        ...submittedExtras.flatMap(p => toEntries(p.cust, dropEmptyPending(p.items, p.inputs), p.inputs)),
      ];
      if (entries.length === 0) { appendSaveLog({ mode: 'cust', name: pairName, week, skipped: true }); return; }
      // 확정 품목군이 있으면 확정해제 뒤에 주문등록·분배를 하고 재확정 (해제 실패 시 아무것도 쓰지 않음)
      await saveWithFixCycleIfNeeded({
        prodKeys: entries.map(entry => entry.prodKey),
        label: `${pairName} 분배 저장${pendingDistributionOrderItems(custItems, custEditInputs).length + pendingDistributionOrderItems(pairItems, pairEditInputs).length + submittedExtras.reduce((a, p) => a + pendingDistributionOrderItems(p.items, p.inputs).length, 0) > 0 ? ' (주문 없는 품목은 주문등록 포함)' : ''}`,
        logName: pairName, mode: 'cust',
        apply: async () => {
          // 주문 없던 품목: 수량이 남아 있으면 주문등록 먼저, 0 으로 돌아갔으면 주문도 분배도 만들지 않음
          const count = (await registerPendingOrders(selectedCust, custItems, custEditInputs))
            + (pairCust ? await registerPendingOrders(pairCust, pairItems, pairEditInputs) : 0);
          let extraCount = 0;
          for (const p of submittedExtras) extraCount += await registerPendingOrders(p.cust, p.items, p.inputs);
          const res = await fetch('/api/shipment/distribute', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ week, year: selectedOrderYear, entries })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.success !== true || data.verified !== true) throw new Error(data.error || '출고분배 저장 검증에 실패했습니다.');
          return count + extraCount;
        },
      });
      if (submittedWeek !== currentWeekRef.current) return;
      const savedItems = entries.filter(entry => entry.outQty > 0);
      const totalQty = savedItems.reduce((a, entry) => a + entry.outQty, 0);
      // 업체별로 따로 표기 (이동 후 "업체1 + 업체2" 한 줄로 묶이던 표기 대신, 실제 바뀐 업체마다 한 줄)
      const custSides = [[submittedCust, custItems, custEditInputs], ...(submittedPair ? [[submittedPair, pairItems, pairEditInputs]] : []),
        ...submittedExtras.map(p => [p.cust, p.items, p.inputs])];
      const perCust = custSides.map(([cust, items, inputs]) => {
        const mine = entries.filter(entry => Number(entry.custKey) === Number(cust.CustKey));
        const saved = mine.filter(entry => entry.outQty > 0);
        return { cust, changed: mine.length, savedCount: saved.length, totalQty: saved.reduce((a, entry) => a + entry.outQty, 0),
          orderCount: pendingDistributionOrderItems(items, inputs).length };
      }).filter(x => x.changed > 0);
      setSaveModal({ prodName: perCust.map(x => `${x.cust.CustName} ${x.changed}건`).join(' / '), week, savedCount: savedItems.length, totalQty });
      perCust.forEach(x => appendSaveLog({ mode: 'cust', name: x.cust.CustName, week: submittedWeek, savedCount: x.savedCount, totalQty: x.totalQty, orderCount: x.orderCount }));
      if (Number(submittedCust.CustKey) === Number(selectedCust?.CustKey)) selectCust(submittedCust, { skipDraftCheck: true }); // 새로고침
      if (submittedPair && Number(submittedPair.CustKey) === Number(pairCust?.CustKey)) selectPairCust(submittedPair, { skipDraftCheck: true }); // 업체 2 새로고침
      submittedExtras.forEach((p, i) => selectExtraCust(p.cust, i + 3, { skipDraftCheck: true })); // 업체 3~5 새로고침
    } catch(e) {
      setErr(e.message);
      appendSaveLog({ mode: 'cust', name: pairName, week: submittedWeek, error: e.message });
    } finally { saveInFlightRef.current = false; setSaving(false); }
  };

  // 비율 분배 자동 계산
  const autoDistribute = () => {
    if (saving || loading) return;
    if (!selectedProd || custDist.length === 0) {
      setErr('품목을 선택하고 조회된 거래처 분배 정보가 있어야 자동 계산할 수 있습니다.');
      return;
    }

    const available = selectedProd.inQty || 0; // 입고 가능 수량
    const newInputs = {};

    if (distMode === 'ratio') {
      // ── 비율 분배: 입고수량을 주문비율대로 나눔
      const totalOrder = custDist.reduce((a,b) => a+(b.주문수량||0), 0);
      if (totalOrder === 0) { alert('주문 수량이 없습니다.'); return; }

      let allocated = 0;
      const sorted = [...custDist].sort((a,b) => (b.주문수량||0)-(a.주문수량||0));

      sorted.forEach((c, idx) => {
        if (idx === sorted.length - 1) {
          // 마지막 거래처: 나머지 전부 (반올림 오차 보정)
          newInputs[c.CustKey] = Math.max(0, available - allocated);
        } else {
          const ratio = (c.주문수량||0) / totalOrder;
          const qty = Math.floor(ratio * available); // 소수점 버림
          newInputs[c.CustKey] = qty;
          allocated += qty;
        }
      });

    } else {
      // ── 우선 분배: 주문수량 순서대로 입고수량 소진
      let remain = available;
      const sorted = [...custDist].sort((a,b) => (b.주문수량||0)-(a.주문수량||0));

      sorted.forEach(c => {
        const want = c.주문수량||0;
        const give = Math.min(want, remain);
        newInputs[c.CustKey] = give;
        remain = Math.max(0, remain - give);
      });
    }

    setOutInputs(newInputs);
    setOutQty(Object.values(newInputs).reduce((a,b)=>a+b,0));
    setErr('');
    setSuccessMsg('분배 수량을 자동 계산했습니다. 실제 DB 저장은 상단 저장 버튼을 눌러야 적용됩니다.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const fillOrderQuantities = () => {
    if (saving || loading) return;
    if (!selectedProd || custDist.length === 0) {
      setErr('품목을 선택하고 조회된 거래처 분배 정보가 있어야 주문수량을 채울 수 있습니다.');
      return;
    }
    const nextInputs = {};
    custDist.forEach(c => { nextInputs[c.CustKey] = c.주문수량 || 0; });
    setOutInputs(nextInputs);
    setOutQty(Object.values(nextInputs).reduce((a,b)=>a+(b||0),0));
    setErr('');
    setSuccessMsg('주문수량 기준으로 출고수량 입력값을 채웠습니다. 실제 DB 저장은 상단 저장 버튼을 눌러야 적용됩니다.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  // 저장
  const handleSave = async () => {
    if (saveBlocked || saveInFlightRef.current) return;
    if (!selectedProd || !week) { setErr('품목과 차수를 선택하세요.'); return; }
    if (!hasDistributionDrafts(custDistRows, outInputs)) {
      appendSaveLog({ mode: 'prod', name: selectedProd.ProdName, week, skipped: true });
      return;
    }
    saveInFlightRef.current = true;
    const submittedWeek = week;
    const submittedProd = selectedProd;
    setSaving(true); setErr('');
    try {
      // 추가한(주문 없는) 업체는 수량이 있을 때만 — 주문등록 먼저, 0 이면 주문도 분배도 만들지 않음
      const rows = custDistRows.filter(c => !c.addedNoOrder || (Number(outInputs[c.CustKey]) || 0) > 0);
      const newOrders = rows.filter(c => c.addedNoOrder);
      const entries = rows.map(c => ({
        custKey: c.CustKey,
        prodKey: selectedProd.ProdKey,
        outQty: Number(outInputs[c.CustKey]) || 0,
        cost: Number(c.Cost ?? c.단가 ?? selectedProd.Cost ?? 0),
      }));
      await saveWithFixCycleIfNeeded({
        prodKeys: [selectedProd.ProdKey],
        label: `${selectedProd.ProdName} 분배 저장`,
        logName: selectedProd.ProdName, mode: 'prod',
        apply: async () => {
          for (const c of newOrders) {
            const orderRes = await fetch('/api/orders', {
              method: 'POST',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify({ custKey: c.CustKey, custName: c.CustName, week, year: selectedOrderYear, source: 'distribute-product-add',
                items: [{ prodKey: Number(selectedProd.ProdKey), qty: Number(outInputs[c.CustKey]) || 0, unit: selectedProd.OutUnit || '박스' }] })
            });
            const orderData = await orderRes.json().catch(() => ({}));
            if (!orderRes.ok || orderData.success !== true) throw new Error(`${c.CustName} 주문등록 실패: ${orderData.error || orderRes.status}`);
          }
          const res = await fetch('/api/shipment/distribute', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ week, year: selectedOrderYear, entries })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.success !== true || data.verified !== true) throw new Error(data.error || '출고분배 저장 검증에 실패했습니다.');
        },
      });
      if (submittedWeek !== currentWeekRef.current) return;
      const savedCount = custDistRows.filter(c => (outInputs[c.CustKey]||0) > 0).length;
      const totalSaved = Object.values(outInputs).reduce((a,b)=>a+(b||0),0);
      setSaveModal({ prodName: selectedProd.ProdName, week, savedCount, totalQty: totalSaved });
      appendSaveLog({ mode: 'prod', name: submittedProd.ProdName, week: submittedWeek, savedCount, totalQty: totalSaved, orderCount: newOrders.length });
      if (Number(submittedProd.ProdKey) === Number(selectedProd?.ProdKey)) selectProd(submittedProd, { skipDraftCheck: true }); // 새로고침
    } catch(e) {
      setErr(e.message);
      appendSaveLog({ mode: 'prod', name: submittedProd.ProdName, week: submittedWeek, error: e.message });
    } finally { saveInFlightRef.current = false; setSaving(false); }
  };

  const custDistRows = selectedProd ? [...custDist, ...prodAddedCusts
    .filter(a => !custDist.some(c => Number(c.CustKey) === Number(a.CustKey)))
    .map(a => ({ CustKey: a.CustKey, CustName: a.CustName, 주문코드: a.OrderCode || '', 주문수량: 0, 출고수량: 0, Cost: selectedProd.Cost || 0, addedNoOrder: true }))].filter(c=>dateLookup.matches(farmDate,selectedProd.ProdKey,c.CustKey)) : custDist;
  const visibleFarmCustomerRows = farmCustomerSearch.trim()
    ? custDistRows.filter(c => customerMatchesSearch(c, farmCustomerSearch.trim()))
    : custDistRows;
  const favoriteKeys = new Set(favoriteProducts.map(row => row.prodKey));
  const filteredProds = favoriteDistributionRows(sortDistributionProducts(distributionAddProductCandidates(products,productCatalog),prodFilter)
    .filter(p=>String(prodFilter||'').trim()||!farmCountry||p.CounName===farmCountry)
    .filter(p=>!favoritesOnly||favoriteKeys.has(Number(p.ProdKey)))
    .filter(p=>dateLookup.matches(farmDate,p.ProdKey)),favoriteKeys);
  const filteredCustomers = sortDistributionCustomers(customerPool,custFilter).filter(c=>dateLookup.matches(customerDate,null,c.CustKey));
  const totalOutInput = Object.values(outInputs).reduce((a,b)=>a+b,0);
  const remain = (inQty||0) - totalOutInput;
  const selectedFlower = prodGroups.find(group => group.key === prodGroup)?.flower || '';
  const previousStock = distributePreviousStock(selectedProd);

  const tabs = ['출고분배 및 농장정보','출고분배 및 업체정보','출고일 지정','출고 분배 집계'];
  // 확정 여부 표시: 선택 품목 + 업체 탭 품목들의 품목군이 이 차수에 확정인지 (GET type=fixedScopes, SELECT 전용)
  const fixedScopeKeys = [...new Set([selectedProd?.ProdKey, ...custItems.map(i => i.ProdKey), ...pairItems.map(i => i.ProdKey), ...extraPeers.flatMap(p => p.items.map(i => i.ProdKey))]
    .map(Number).filter(k => Number.isInteger(k) && k > 0))].sort((a, b) => a - b).slice(0, 500).join(',');
  useEffect(() => {
    if (!week || !fixedScopeKeys) { setFixedScopeMap({}); return undefined; }
    let cancelled = false;
    apiGetDistribute({ type: 'fixedScopes', week, prodKeys: fixedScopeKeys, purpose: 'badge' }).then(d => {
      if (cancelled || d?.success !== true) return;
      setFixedScopeMap(Object.fromEntries((d.scopes || []).map(x => [Number(x.prodKey), { fixed: !!x.fixed, countryFlower: x.countryFlower || '' }])));
    }).catch(() => { if (!cancelled) setFixedScopeMap({}); });
    return () => { cancelled = true; };
  }, [week, fixedScopeKeys, saving, selectedCust?.CustKey, pairCust?.CustKey, extraPeers.map(p => p.cust.CustKey).join(',')]);
  const fixedBadge = (prodKey) => fixedScopeMap[Number(prodKey)]?.fixed
    ? <span data-ai-verify={`fixed-${prodKey}`} title={`${fixedScopeMap[Number(prodKey)].countryFlower} 품목군이 이 차수에 확정됨 — 저장 시 확정해제→저장→재확정`}
        style={{display:'inline-block',padding:'0 5px',marginRight:4,borderRadius:4,fontSize:10,fontWeight:700,background:'#FEE2E2',color:'#B91C1C'}}>🔒확정</span>
    : null;
  // 품목명 검색: 영문 ProdName + 한글 DisplayName + 한글 자동명(알스트로·거베라…) + 자모/초성, 한글→영문 동의어 (lib/displayName 공용)
  const matchItemName = (row, text) => {
    const raw = String(text || '').trim();
    if (!raw) return true;
    const typed = convertQwertyInputToHangul(raw); // 영문 자판으로 친 한글 (dkftmxmfh → 알스트로)
    return [raw, ...(typed !== raw ? [typed] : [])].some(q => matchItemNameOne(row, q));
  };
  const matchItemNameOne = (row, q) => {
    const ko = suggestDisplayName(row.ProdName || '');
    if (`${row.DisplayName || ''} ${row.ProdName || ''} ${ko}`.toLowerCase().includes(q.toLowerCase())) return true;
    if (/[ㄱ-힣]/.test(q) && [row.DisplayName, ko, row.FlowerName].some(name => name && jamoMatch(q, name))) return true;
    return /[ㄱ-힣]/.test(q) && filterProducts([row], q, 0.9).length > 0;
  };
  const ensureProductCatalog = () => {
    if (productCatalog || productCatalogLoadingRef.current) return;
    productCatalogLoadingRef.current = true;
    apiGetDistribute({ type: 'productCatalog' })
      .then(res => { if (res?.success === true) setProductCatalog(res.products || []); })
      .catch(() => { setErr('전체 품목 검색 목록을 불러오지 못했습니다. 검색창을 다시 선택해 주세요.'); })
      .finally(() => { productCatalogLoadingRef.current = false; });
  };
  const itemFilterInput = (
    <input className="filter-input" placeholder="품목명 검색 (전체 품목)" value={custItemFilter} data-ai-verify="cust-item-search" aria-label="품목명 검색"
      title="주문 있는 품목이 먼저, 그 뒤 주문 없는 품목·다른 품종도 전체 품목에서 찾아 수량을 넣을 수 있습니다"
      onFocus={ensureProductCatalog}
      onChange={e => { if (e.target.value.trim()) ensureProductCatalog(); setCustItemFilter(e.target.value); }} style={{height:26,fontSize:12,width:160,marginLeft:8}} />
  );
  // 나란히 보기 한 칸 (업체 sideIndex × 품목). 그 업체에 행이 없어도 입력 가능 → 주문등록 예정 행을 만들고 저장 시 주문등록 후 분배.
  // 박스·단·송이 세 칸 환산, 저장값은 OutUnit 하나. 값이 바뀌면 아래에 변경 전 수량.
  const pairQtyCell = (sideIndex, row, color) => {
    const side = pairSides()[sideIndex];
    if (!side?.cust) return '—';
    const item = side.items.find(i => Number(i.ProdKey) === Number(row.ProdKey));
    const edit = side.inputs[row.ProdKey] || {};
    const before = item ? Number(item.출고수량 || 0) : 0;
    const value = edit.outQty !== undefined ? edit.outQty : before;
    const src = row.a || row.b || (row.extra || []).find(Boolean) || row;
    const setQty = (native) => {
      if (!item) side.setItems(prev => prev.some(i => Number(i.ProdKey) === Number(row.ProdKey)) ? prev : [...prev, pendingDistributionItem({ ...row, Cost: src.Cost })]);
      side.setInputs(prev => ({ ...prev, [row.ProdKey]: { ...(prev[row.ProdKey] || {}), outQty: native, cost: prev[row.ProdKey]?.cost ?? (item?.Cost ?? src.Cost ?? 0) } }));
    };
    const changed = (parseFloat(value) || 0) !== before;
    return (
      <div>
        <span style={{display:'inline-flex',gap:3}}>
          {['박스', '단', '송이'].map(unit => {
            const f = distributionUnitFactor(row, unit);
            const native = unit === (row.OutUnit || '박스');
            const filled = parseFloat(value) > 0;
            return (
              <input key={unit} type="number" min={0} step={native ? 0.1 : 0.01} placeholder={unit}
                value={filled && f ? toDisplayQty(value, f) : ''} disabled={hasDateDrafts || saving || loading || !f}
                title={f ? `${unit} (저장 단위 ${row.OutUnit})${item ? '' : ' — 주문 없음: 입력하면 저장 시 주문등록 후 분배'}` : `${unit}: 입수 정보가 없어 환산 불가`}
                {...(native ? { 'data-distribute-qty': 'true', 'aria-keyshortcuts': 'Enter', onKeyDown: handleQuantityEnter } : {})}
                data-ai-verify={native ? `qty-${side.cust.CustKey}-${row.ProdKey}` : `qty-${side.cust.CustKey}-${row.ProdKey}-${unit}`}
                aria-label={`${side.cust.CustName} ${row.ProdName} 출고수량 (${unit})`}
                onChange={e => setQty(native ? e.target.value : toNativeQty(e.target.value, f))}
                style={{width:native?58:50,height:26,border:`1px solid ${filled&&native?color:'var(--border2)'}`,borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 3px',background:filled&&native?'var(--blue-bg)':item?'var(--bg)':'#fafafa',fontWeight:filled&&native?700:400,color:native?undefined:'var(--text2)'}} />
            );
          })}
        </span>
        {dateButton(side.cust.CustKey,row,`${side.cust.CustName} · ${row.ProdName}`)}
        {changed && <div data-ai-verify={`before-${side.cust.CustKey}-${row.ProdKey}`} style={{fontSize:10,color:'#b45309',textAlign:'right'}}>변경 전 {before} {row.OutUnit}</div>}
      </div>
    );
  };
  const pairRows = mergeDistributionCustomerItems(custItems, pairItems, extraPeers.map(p => p.items));
  // 검색 후보 = 이 차수 품종 목록(products) + 품목 전체 카탈로그. 선택한 품종이 아니거나 이 차수에 아무 주문이 없는 품목(예: 라벤더)도 검색으로 찾아 수량을 넣을 수 있게.
  const searchCandidates = mergeDistributionSearchCandidates(products, productCatalog);
  const pairSearchRows = String(custItemFilter || '').trim()
    ? [...pairRows, ...sortDistributionProducts(searchCandidates.filter(p => matchItemName(p, custItemFilter) && !pairRows.some(r => Number(r.ProdKey) === Number(p.ProdKey))))
      .map(p => ({ ...p, extra: [], searchOnly: true }))]
    : pairRows;
  // 업체 한 곳 보기: 검색어가 있으면 주문(분배) 있는 품목을 먼저, 그 뒤에 주문 없는 품목도 보여 수량을 바로 넣을 수 있게.
  // 주문 없는 행에 수량을 넣으면 임시 행(주문수량 0)을 만들고 저장 시 주문등록 후 분배.
  const custSearchRows = favoriteDistributionRows(distributionCustomerSearchRows(custItems, searchCandidates, custItemFilter, matchItemName)
    .filter(row => distributionPairFilterMatches(row, pairGroupFilter))
    .filter(row => dateLookup.matches(customerDate,row.ProdKey,selectedCust?.CustKey)),favoriteKeys);
  const addCustSearchItem = (prod, outQty) => {
    setCustItems(prev => prev.some(i => Number(i.ProdKey) === Number(prod.ProdKey)) ? prev : [...prev, pendingDistributionItem(prod)]);
    setCustEditInputs(prev => ({ ...prev, [prod.ProdKey]: { ...(prev[prod.ProdKey] || {}), outQty, cost: prev[prod.ProdKey]?.cost ?? (prod.Cost ?? 0) } }));
  };
  const fixedCount = (items) => items.filter(i => fixedScopeMap[Number(i.ProdKey)]?.fixed).length;

  // 품종 즐겨찾기 버튼: 이 차수 품종 목록에 있는 것만 (없는 차수에선 숨김)

  const weekButtons = distributionWeekButtons(week, 3);
  const subWeekButtons = distributionSubWeekButtons(week);
  const weekButtonStyle = (value, active) => ({
    padding: '5px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
    border: active ? '2px solid #1a237e' : '1px solid #c5cae9',
    background: active ? '#1a237e' : '#f3f4ff', color: active ? '#fff' : '#1a237e', fontWeight: active ? 700 : 500,
  });
  const pickButtonStyle = (active, hasStock) => ({
    padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', maxWidth: 220, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left',
    border: active ? '2px solid var(--blue)' : '1px solid var(--border2)',
    background: active ? 'var(--blue)' : hasStock ? '#F0F7FF' : 'var(--bg)',
    color: active ? '#fff' : hasStock ? 'var(--blue)' : 'var(--text2)', fontWeight: active || hasStock ? 700 : 400,
  });

  const handleQuantityEnter = event => {
    if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
      event.repeat || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (saveBlocked || saveInFlightRef.current) return;
    const quantities = Array.from(document.querySelectorAll('[data-distribute-qty="true"]'))
      .filter(input => !input.disabled && !input.readOnly && input.getClientRects().length > 0 &&
        window.getComputedStyle(input).visibility !== 'hidden');
    const next = quantities[quantities.indexOf(event.currentTarget) + 1];
    if (next) { next.focus(); next.select?.(); }
    else saveButtonRef.current?.focus();
  };

  useEffect(() => {
    const onShortcut = event => {
      if (dateEditor) { if(event.ctrlKey && event.key.toLowerCase()==='s')event.preventDefault(); return; }
      if (event.ctrlKey && !event.altKey && !event.metaKey && String(event.key).toLowerCase() === 's') {
        event.preventDefault();
        if (!saveBlocked && !saveInFlightRef.current && !event.repeat && !event.isComposing && event.keyCode !== 229)
          saveButtonRef.current?.click();
        return;
      }
      if (anySaveModal || saving) return;
      if (event.ctrlKey && event.altKey && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        if (event.key === '1') weekPickerRef.current?.click();
        if (event.key === '2') productPickerRef.current?.click();
        if (event.key === '3' && requestTab(1)) setTimeout(()=>dealerSearchRef.current?.focus(),0);
        if (event.key === '4') document.querySelector('[data-distribute-qty="true"]')?.focus();
      } else if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        handleSearch();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  });

  const requestTab = index => {
    if(index===tab)return true;
    if(hasAnyDraft()){setErr('수량·단가·출고일 변경을 먼저 저장하거나 변경 취소한 후 탭을 이동하세요.');return false;}
    setErr('');setTab(index);
    if(index===0&&selectedProd)selectProd(selectedProd,{skipDraftCheck:true});
    if(index===1){if(selectedCust)selectCust(selectedCust,{skipDraftCheck:true});if(pairCust)selectPairCust(pairCust,{skipDraftCheck:true});void(async()=>{for(let i=0;i<extraPeers.length;i++)await selectExtraCust(extraPeers[i].cust,i+3,{skipDraftCheck:true});})();}
    return true;
  };

  const openDateEditor = (custKey, prod, label, inlineDraft=null) => {
    if (hasQuantityDraft()) { setErr('수량·단가 변경을 먼저 저장하거나 초기화한 후 출고일을 수정하세요.'); return; }
    setDateEditor({scope:{orderYear:selectedOrderYear,orderWeek:week.slice(-5),custKey:Number(custKey),prodKey:Number(prod.ProdKey)},label,inlineDraft,draftKey:`${custKey}|${prod.ProdKey}`});
  };
  const dateHeader = <DistributionInlineDatesHeader calendar={inlineCalendar} year={selectedOrderYear} week={week}/>;
  const dateButton = (custKey, prod, label) => <DistributionInlineDates commonWeeks={majorWeekScope.weeks} commonError={majorWeekScope.error} productInfo={prod} majorFacts={majorInlineFactsMap?.get(String(custKey)+'|'+String(prod.ProdKey))??(majorInlineFactsMap?[]:null)} calendar={inlineCalendar} facts={inlineFactsMap.get(`${custKey}|${prod.ProdKey}`)||[]} year={selectedOrderYear} week={week}
    custKey={custKey} prodKey={prod.ProdKey} draft={dateDrafts[`${custKey}|${prod.ProdKey}`]} loading={dateIndexLoading} error={dateIndexError}
    disabled={saving||loading||hasQuantityDraft()||!!dateEditor} onDraft={draft=>setDateDrafts(prev=>{const next={...prev},key=`${custKey}|${prod.ProdKey}`;if(draft)next[key]=draft;else delete next[key];return next;})}
    onOpen={draft=>openDateEditor(custKey,prod,label,draft)} />;

  return (
    <div data-testid="distribution-workspace" style={{display:'flex',flexDirection:'column',minHeight:'calc(100vh - 104px)',minWidth:0}}>
      {dateEditor && <DistributionDateEditor {...dateEditor} onClose={()=>setDateEditor(null)} onSaved={async()=>{
        setDateDrafts(prev=>{const next={...prev};delete next[dateEditor.draftKey];return next;});
        setSuccessMsg('출고일 분배 저장 완료 · 출고 총량·매출·확정 상태 유지');
        await loadDateIndex();
        if(tab===2&&tab2CustKey)await loadTab2Items(tab2CustKey);
        else if(tab===0&&selectedProd)await selectProd(selectedProd,{skipDraftCheck:true});
        else if(tab===1&&selectedCust)await selectCust(selectedCust,{skipDraftCheck:true});
      }} />}
      <WorkflowGuide workflowId="shipment-distribution-dates" />
      <style jsx global>{`[data-testid=distribution-workspace] .tbl th,[data-testid=distribution-workspace] .tbl td { padding-left:4px;padding-right:4px; }
      .page-area:has([data-testid=distribution-workspace]) {padding:3px !important;}
      [data-ui-shell=popup] > div:has(> [data-testid=distribution-workspace]) {padding:3px !important;}
      .distribution-customer-table th:nth-child(1){width:150px}.distribution-customer-table th:nth-child(2){width:64px}.distribution-customer-table th:nth-child(3){width:40px}
      .distribution-customer-table th:nth-child(n+4):nth-child(-n+10){width:72px}
      @media (max-width: 900px) { .distribution-workspace-grid { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
      {/* 툴바 */}
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'8px 8px 0 0',padding:'4px 5px',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',flexShrink:0}}>
        <WeekInput weekInput={guardedWeekInput} label="차수" />
        <DistributionPicker label="차수" value={week} triggerRef={weekPickerRef} shortcut="Ctrl+Alt+1" disabled={hasDateDrafts||saving}
          options={distributionWeekOptions(week).map(value => ({ key: value, label: value, selected: value === week }))}
          onSelect={option => guardedWeekInput.setValue(option.key)} testId="distribution-week-picker" />
        {tab!==1 && <>
        <DistributionPicker label="품목그룹" value={selectedProdGroupLabel || '전체'} disabled={hasDateDrafts || saving || prodGroupsLoading}
          options={[{ key: '', label: '전체', selected: !prodGroup }, ...prodGroups.map(g => ({ key: g.key, label: g.label, selected: g.key === prodGroup }))]}
          onSelect={option => chooseProdGroup(option.key)} />
        <DistributionPicker label="품목" value={selectedProd?.ProdName || ''} triggerRef={productPickerRef}
          shortcut="Ctrl+Alt+2" disabled={hasDateDrafts || saving || loading} onOpen={ensureProductCatalog} maxResults={80}
          options={favoriteDistributionRows(sortDistributionProducts(mergeDistributionSearchCandidates(products, productCatalog)),favoriteKeys).filter(p => !favoritesOnly || favoriteKeys.has(Number(p.ProdKey))).map(p => ({ key: p.ProdKey,
            label: p.ProdName || p.DisplayName || `#${p.ProdKey}`,
            hint: `${favoriteKeys.has(Number(p.ProdKey)) ? '★ ' : ''}#${p.ProdKey}`,
            selected: Number(p.ProdKey) === Number(selectedProd?.ProdKey), product: p }))}
          onSelect={option => { setViewMode('prod'); selectProd(option.product); }} testId="distribution-product-picker" />
        </>}
        <div style={{marginLeft:'auto',display:'flex',gap:6,flexWrap:'wrap'}}>
          <button className="btn btn-secondary btn-sm" onClick={handleSearch} disabled={hasDateDrafts||saving}>🔍 조회</button>
          {tab!==1 && <>
          <button className="btn btn-success btn-sm" onClick={handleFix} disabled={hasDateDrafts||fixLoading||isFixed}>
            {fixLoading?'처리중... / Procesando': isFixed?'✅ 확정됨 / Confirmado':'✅ 확정 / Confirmar'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleUnfix} disabled={hasDateDrafts||fixLoading||!isFixed}>
            ↩️ 확정취소 / Cancelar / Anular
          </button>
          <button className="btn btn-success btn-sm" onClick={() => handleSpDistribute('group')} disabled={hasDateDrafts || spLoading || fixLoading || isFixed || !week || !prodGroup} title="선택한 차수와 꽃/품목그룹만 dbo.usp_DistributeOne 경로로 일괄 분배합니다.">
            {spLoading ? '전산분배 중...' : '전산 선택꽃 일괄출고분배'}
          </button>
          </>}
          {viewMode === 'cust' && selectedCust && (
            <button type="button" className="btn btn-sm" data-ai-verify="add-panel-open" disabled={hasDateDrafts || saving || loading}
              onClick={() => { setAddPanel({ side: 0, group: pairGroupFilter || '', prodKey: null, unit: '', manager: '' }); setAddCustFilter(''); setAddProdFilter(''); loadAllCustomers(); ensureProductCatalog(); }}
              title="품종 → 품목 → 수량 버튼으로 이 업체 출고수량에 더합니다 (주문 없는 품목은 저장 시 주문등록 후 분배)">➕ 품목추가·수량추가</button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" data-ai-verify="discard-drafts" onClick={discardDrafts} disabled={saving || !hasAnyDraft()}
            title="화면에서 바꾼 출고수량·단가·이동을 모두 되돌립니다 (DB 값 그대로)">↶ 변경 취소</button>
          <button ref={saveButtonRef} className="btn btn-primary btn-sm" aria-keyshortcuts="Control+S" onClick={viewMode==='cust' ? handleSaveCustItems : handleSave} disabled={saveBlocked}>{saving?'저장중... / Guardando':'💾 저장 / Guardar'}</button>
          <button className="btn btn-secondary btn-sm" onClick={handleHistory}>📋 내역 조회 / Historial</button>
          <button className="btn btn-success btn-sm" onClick={() => handleExcelDownload()} disabled={excelDownloading}>
            {excelDownloading ? '다운로드중...' : '📥 엑셀 다운 / Excel'}
          </button>
          <button className="btn btn-sm" onClick={handleClose}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>
      {/* nenova.exe식 버튼형 차수 선택: 기준 차수 앞뒤 ±3 대차수 + 세부차수 */}
      <div data-testid="distribution-week-buttons" style={{padding:'3px 5px',background:'var(--surface)',borderLeft:'1px solid var(--border)',borderRight:'1px solid var(--border)',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
        <span style={{fontSize:11,fontWeight:700,color:'var(--text2)'}}>차수</span>
        {weekButtons.length === 0 && <span style={{fontSize:11,color:'var(--text3)'}}>차수를 2026-44-01 형식으로 입력하면 앞뒤 차수 버튼이 나타납니다.</span>}
        {weekButtons.map(value => (
          <button key={value} type="button" data-ai-verify={`week-${value}`} aria-pressed={value === week}
            disabled={hasDateDrafts||saving} onClick={() => guardedWeekInput.setValue(value)} style={weekButtonStyle(value, value === week)}>
            {formatWeekDisplay(value)}
          </button>
        ))}
        {subWeekButtons.length > 0 && <span style={{fontSize:11,fontWeight:700,color:'var(--text2)',marginLeft:8}}>세부차수</span>}
        {subWeekButtons.map(value => (
          <button key={value} type="button" data-ai-verify={`subweek-${value.slice(-2)}`} aria-pressed={value === week}
            disabled={hasDateDrafts||saving} onClick={() => guardedWeekInput.setValue(value)}
            style={{...weekButtonStyle(value, value === week), padding:'3px 10px', fontSize:12}}>
            -{value.slice(-2)}
          </button>
        ))}

      </div>
      {/* 국가별 제목 아래 품종을 모으되 기존 품종 선택/즐겨찾기 동작은 유지한다. */}
      {tab!==1 && <>
      <div data-testid="distribution-group-buttons" style={{padding:'4px 5px',background:'var(--surface)',borderLeft:'1px solid var(--border)',borderRight:'1px solid var(--border)',borderTop:'1px solid var(--border-t)',display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
        <span style={{fontSize:12,fontWeight:700,color:'var(--text2)'}}>국가</span>
        <button type="button" data-ai-verify="group-all" aria-pressed={!farmCountry} disabled={hasDateDrafts || saving || prodGroupsLoading}
          onClick={() => chooseFarmCountry('')} style={pickButtonStyle(!farmCountry, true)}>전체</button>
        <button type="button" className="btn btn-sm btn-secondary" data-ai-verify="group-view-all" aria-pressed={showAllProdGroups}
          onClick={() => setShowAllProdGroups(value => !value)}>{showAllProdGroups ? '★ 즐겨찾기만 보기' : '국가 전체 보기'}</button>
        {!showAllProdGroups && countryGroups.length === 0 && <span style={{fontSize:12,color:'var(--text3)'}}>즐겨찾기한 국가가 없습니다. 「국가 전체 보기」에서 국가와 품종의 ☆를 눌러 추가하세요.</span>}
        {countryGroups.map(({country, groups}) => (
          <div key={country} data-testid={`distribution-country-${country}`} role="group" aria-label={`${country} 품종`}
            style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap',width:'100%',padding:'5px 0',borderTop:'1px solid var(--border-t)'}}>
            <h3 style={{margin:0,fontSize:12,fontWeight:700,color:'var(--text2)',display:'inline-flex',alignItems:'center',gap:3,minWidth:84}}><button type="button" data-ai-verify={`country-select-${country}`} data-distribution-country-select aria-pressed={farmCountry===country} disabled={hasDateDrafts||saving||prodGroupsLoading}
                onClick={()=>chooseFarmCountry(country)} style={{...pickButtonStyle(farmCountry===country,true),padding:'3px 5px'}}>{country}</button>
              <button type="button" data-ai-verify={`country-fav-${country}`} aria-label={`${country} 국가 즐겨찾기 ${selectedCountries.includes(country) ? '해제' : '추가'}`}
                aria-pressed={selectedCountries.includes(country)} disabled={!accountId || favoritesPending || countryFavorite === undefined} onClick={() => toggleCountryFavorite(country)}
                style={{...pickButtonStyle(false,true),padding:'2px 4px',color:selectedCountries.includes(country)?'#d97706':'var(--text3)'}}>{selectedCountries.includes(country)?'★':'☆'}</button>
            </h3>

          </div>
        ))}
      </div>
      </>}
      <details style={{padding:'1px 5px',fontSize:11,color:'var(--text3)',background:'var(--surface)'}}><summary>단축키·입력 안내 · 출고일은 선택 세부차수만 수정</summary>
        단축키: Ctrl+Alt+1 차수 · Ctrl+Alt+2 품목 · Ctrl+Alt+3 업체 · Ctrl+Alt+4 수량 · Ctrl+Enter 조회 · 수량 Enter 다음 입력(마지막은 저장 버튼 이동) · Ctrl+S 수량·단가 저장 · 출고일은 실제 날짜순 · 단/송이 수량 입력. Enter 이동만으로 저장되지 않습니다.
      </details>
      {favoriteError && <div role="alert" style={{padding:'4px 5px',background:'var(--red-bg)',color:'var(--red)'}}>즐겨찾기: {favoriteError}</div>}

      {/* 알림 */}
      {err && <div style={{padding:'4px 5px',background:'var(--red-bg)',color:'var(--red)',fontSize:12,borderLeft:'3px solid var(--red)',flexShrink:0}}>⚠️ {err}</div>}
      {successMsg && <div style={{padding:'4px 5px',background:'var(--green-bg)',color:'var(--green)',fontSize:12,flexShrink:0}}>{successMsg}</div>}
      {saveLog.length > 0 && (
        <div data-testid="distribution-save-log" role="status" aria-live="polite" style={{padding:'4px 5px',background:'var(--surface)',borderLeft:'3px solid var(--blue)',fontSize:11,color:'var(--text2)',flexShrink:0,maxHeight:84,overflowY:'auto'}}>
          <div style={{fontWeight:700,color:'var(--text3)',marginBottom:2}}>저장 로그 (Ctrl+S / 저장 버튼)</div>
          {saveLog.map((line, index) => (
            <div key={`${index}-${line}`} style={{color: line.includes('저장 실패') ? 'var(--red)' : line.includes('저장 생략') ? 'var(--text3)' : 'var(--green)'}}>• {line}</div>
          ))}
        </div>
      )}

      {/* 품목추가·수량추가 창 */}
      {addPanel && selectedCust && (() => {
        const sides = pairSides().filter(side => side.cust);
        const side = sides[Math.min(addPanel.side, sides.length - 1)];
        const addCandidates = distributionAddProductCandidates(products,productCatalog);
        const groups = distributionPairGroups(addCandidates);
        const searching = String(addProdFilter || '').trim() !== '';
        const groupProducts = searching ? sortDistributionProducts(addCandidates.filter(p => matchItemName(p, addProdFilter)))
          : addPanel.group ? sortDistributionProducts(addCandidates.filter(p => distributionPairFilterMatches(p,addPanel.group))) : [];
        const prod = addCandidates.find(p => Number(p.ProdKey) === Number(addPanel.prodKey));
        const unit = prod ? (addPanel.unit || prod.OutUnit || '박스') : '';
        const factor = prod ? (distributionUnitFactor(prod, unit) || 1) : 1;
        const itemOf = (sd, key) => sd.items.find(i => Number(i.ProdKey) === Number(key));
        const qtyOf = (sd, key) => { const item = itemOf(sd, key); if (!item) return 0; const e = sd.inputs[key]; return e?.outQty !== undefined ? parseFloat(e.outQty) || 0 : (item.출고수량 || 0); };
        const remainOf = (p) => {
          const delta = sides.reduce((a, sd) => { const item = itemOf(sd, p.ProdKey); return a + (item ? qtyOf(sd, p.ProdKey) - (item.출고수량 || 0) : 0); }, 0);
          return (Number(p.inQty) || 0) - (Number(p.outQty) || 0) - delta;
        };
        const bump = (n) => {
          if (!prod || !side) return;
          const exists = itemOf(side, prod.ProdKey);
          const next = Math.max(0, Math.round((qtyOf(side, prod.ProdKey) + toNativeQty(n, factor)) * 1000) / 1000);
          if (!exists) {
            if (next <= 0) return;
            side.setItems(prev => [...prev, pendingDistributionItem(prod)]);
          }
          side.setInputs(prev => ({ ...prev, [prod.ProdKey]: { ...(prev[prod.ProdKey] || {}), outQty: next, cost: prev[prod.ProdKey]?.cost ?? (exists?.Cost ?? prod.Cost ?? 0) } }));
        };
        const current = prod && side ? qtyOf(side, prod.ProdKey) : 0;
        const stepRow = (sign) => (
          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
            {[1, 2, 5, 10, 16, 25].map(n => (
              <button key={n} type="button" className="btn" data-ai-verify={`add-${sign > 0 ? 'plus' : 'minus'}-${n}`} disabled={!prod || saving || (sign < 0 && current <= 0)}
                onClick={() => bump(sign * n)}
                style={{minWidth:52,height:40,fontSize:15,fontWeight:700,color:sign > 0 ? 'var(--blue)' : 'var(--red)'}}>{sign > 0 ? '+' : '−'}{n}</button>
            ))}
          </div>
        );
        return (
          <div className="modal-overlay" onClick={() => setAddPanel(null)}>
            <div className="modal" role="dialog" aria-modal="true" aria-label="품목추가·수량추가" data-testid="distribution-add-panel"
              onClick={e => e.stopPropagation()} style={{maxWidth:860,width:'95vw',maxHeight:'90vh',overflowY:'auto',padding:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <b>➕ 품목추가·수량추가 — {week}</b>
                <button type="button" className="btn btn-sm" data-ai-verify="add-panel-close" onClick={() => setAddPanel(null)}>닫기</button>
              </div>
              {sides.length > 1 && (
                <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:8}}>
                  <span style={{fontSize:11,color:'var(--text3)',alignSelf:'center'}}>업체</span>
                  {sides.map((sd, i) => (
                    <button key={sd.cust.CustKey} type="button" data-ai-verify={`add-side-${i + 1}`} aria-pressed={sd === side}
                      onClick={() => setAddPanel(prev => ({ ...prev, side: i }))} style={pickButtonStyle(sd === side, true)}>{SLOT_MARK[i]} {sd.cust.CustName}</button>
                  ))}
                </div>
              )}
              {sides.length === 1 && <div style={{fontSize:12,marginBottom:8}}>업체: <b>{side.cust.CustName}</b></div>}
              {(() => {
                // 업체 검색: 이 차수 주문 업체 + 전체 업체(주문 없음). 고르면 빈 칸(업체 2 → 3~5)에 넣고 그 업체로 전환
                const text = addCustFilter.trim().toLowerCase();
                const searchInput = (
                  <input className="filter-input" placeholder="업체 검색 (이름·코드, 주문 없는 업체 포함)" value={addCustFilter} data-ai-verify="add-cust-search" aria-label="품목추가 업체 검색"
                    onChange={e => setAddCustFilter(e.target.value)} style={{height:28,fontSize:12,width:280,marginBottom:4}} />
                );
                const managerOf = (c) => String(c.Manager || allCustomers.find(a => Number(a.CustKey) === Number(c.CustKey))?.Manager || '').trim() || '담당자 없음';
                const pool = [...custList, ...allCustomers.filter(a => !custList.some(c => Number(c.CustKey) === Number(a.CustKey))).map(a => ({ ...a, noOrder: true }))];
                const managers = [...new Set(pool.map(managerOf))].sort((a, b) => a.localeCompare(b, 'ko'));
                const managerRow = (
                  <div data-testid="distribution-add-managers" style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center',marginBottom:4}}>
                    <span style={{fontSize:11,color:'var(--text3)'}}>담당자</span>
                    {allCustomers.length === 0 && <span style={{fontSize:11,color:'var(--text3)'}}>불러오는 중…</span>}
                    {managers.map(m => (
                      <button key={m} type="button" data-ai-verify={`add-manager-${m}`} aria-pressed={addPanel.manager === m}
                        onClick={() => setAddPanel(prev => ({ ...prev, manager: prev.manager === m ? '' : m }))} style={pickButtonStyle(addPanel.manager === m, true)}>{m}</button>
                    ))}
                  </div>
                );
                if (!text && !addPanel.manager) return <div style={{marginBottom:4}}>{managerRow}{searchInput}</div>;
                const hits = sortDistributionCustomers(pool.filter(c => (!addPanel.manager || managerOf(c) === addPanel.manager) &&
                  (!text || customerMatchesSearch(c, text)))).slice(0, 60);
                const pick = async (c) => {
                  const at = sides.findIndex(sd => Number(sd.cust.CustKey) === Number(c.CustKey));
                  if (at >= 0) { setAddPanel(prev => ({ ...prev, side: at })); setAddCustFilter(''); return; }
                  if (!pairCust) { await selectPairCust(c); setAddPanel(prev => prev && ({ ...prev, side: 1 })); }
                  else if (extraPeers.length < 3) { const slot = 3 + extraPeers.length; await selectExtraCust(c, slot); setAddPanel(prev => prev && ({ ...prev, side: slot - 1 })); }
                  else { setErr('업체는 5개까지 고를 수 있습니다. 칸을 비운 뒤 다시 고르세요.'); return; }
                  setAddCustFilter('');
                };
                return (
                  <div style={{marginBottom:8}}>
                    {managerRow}
                    {searchInput}
                    <div data-testid="distribution-add-cust-hits" style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                      {hits.length === 0 && <span style={{fontSize:11,color:'var(--text3)'}}>검색 결과 없음</span>}
                      {hits.map(c => (
                        <button key={c.CustKey} type="button" data-ai-verify={`add-cust-${c.CustKey}`} disabled={hasDateDrafts || saving || loading} onClick={() => pick(c)}
                          style={pickButtonStyle(false, true)}>{c.CustName}{c.noOrder ? ' (주문없음)' : ''}</button>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div style={{fontSize:11,color:'var(--text3)',marginBottom:4}}>① 품종</div>
              <div data-testid="distribution-add-groups" style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:8}}>
                {groups.length === 0 && <span style={{fontSize:11,color:'var(--text3)'}}>이 차수 품목이 없습니다.</span>}
                {groups.map(g => (
                  <button key={g} type="button" data-ai-verify={`add-group-${g}`} aria-pressed={addPanel.group === g}
                    onClick={() => setAddPanel(prev => ({ ...prev, group: g, prodKey: null, unit: '' }))} style={pickButtonStyle(addPanel.group === g, true)}>{g}</button>
                ))}
              </div>
              <input className="filter-input" placeholder="품목명 검색 (품종 상관없이)" value={addProdFilter} data-ai-verify="add-prod-search" aria-label="품목추가 품목명 검색"
                onChange={e => setAddProdFilter(e.target.value)} style={{height:28,fontSize:12,width:240,marginBottom:8}} />
              {(addPanel.group || searching) && (<>
                <div style={{fontSize:11,color:'var(--text3)',marginBottom:4}}>② 품목 (남은 재고)</div>
                <div data-testid="distribution-add-products" style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:8}}>
                  {groupProducts.map(p => {
                    const left = remainOf(p);
                    const ordered = side && itemOf(side, p.ProdKey) && !itemOf(side, p.ProdKey).pendingOrder;
                    return (
                      <button key={p.ProdKey} type="button" data-ai-verify={`add-prod-${p.ProdKey}`} aria-pressed={Number(addPanel.prodKey) === Number(p.ProdKey)}
                        onClick={() => setAddPanel(prev => ({ ...prev, prodKey: p.ProdKey, unit: '' }))} style={pickButtonStyle(Number(addPanel.prodKey) === Number(p.ProdKey), false)}>
                        {fixedBadge(p.ProdKey)}{p.DisplayName || p.ProdName}
                        <span style={{fontSize:10,marginLeft:4,color:left < 0 ? 'var(--red)' : 'inherit',opacity:0.8}}>{left.toFixed(1)}{p.OutUnit}</span>
                        {ordered && <span style={{fontSize:10,marginLeft:4,opacity:0.8}}>· 주문 있음</span>}
                      </button>
                    );
                  })}
                </div>
              </>)}
              {prod && side && (<>
                <div style={{fontSize:11,color:'var(--text3)',marginBottom:4}}>③ 단위 · 수량 (현재 수량에 더하기 / 빼기)</div>
                <div style={{display:'flex',gap:4,marginBottom:8,alignItems:'center'}}>
                  {['박스', '단', '송이'].filter(u => distributionUnitFactor(prod, u)).map(u => (
                    <label key={u} style={{display:'inline-flex',gap:3,alignItems:'center',padding:'4px 10px',border:'1px solid var(--border2)',borderRadius:6,cursor:'pointer',background:unit === u ? 'var(--blue-bg)' : 'var(--bg)'}}>
                      <input type="radio" name="add-unit" data-ai-verify={`add-unit-${u}`} checked={unit === u} onChange={() => setAddPanel(prev => ({ ...prev, unit: u }))} />{u}
                    </label>
                  ))}
                  <span style={{marginLeft:12,fontSize:13}}>{side.cust.CustName} · <b data-testid="distribution-add-current" style={{fontSize:20,fontFamily:'var(--mono)'}}>{toDisplayQty(current, factor)}</b> {unit}
                    {unit !== prod.OutUnit && <span style={{fontSize:11,color:'var(--text3)'}}> (= {current} {prod.OutUnit})</span>}
                    <span style={{fontSize:11,marginLeft:8,color:remainOf(prod) < 0 ? 'var(--red)' : 'var(--text3)'}}>재고잔량 {remainOf(prod).toFixed(2)} {prod.OutUnit}{remainOf(prod) < 0 ? ' ⚠ 마이너스' : ''}</span>
                  </span>
                </div>
                {stepRow(1)}
                <div style={{height:4}} />
                {stepRow(-1)}
              </>)}
              <div style={{display:'flex',justifyContent:'flex-end',gap:6,marginTop:12}}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddPanel(null)}>닫기 (입력값은 표에 남음)</button>
                <button type="button" className="btn btn-primary" data-ai-verify="add-panel-save" disabled={saveBlocked}
                  onClick={async () => { setAddPanel(null); await handleSaveCustItems(); }}>💾 저장</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 저장 완료 모달 */}
      {saveModal && (
        <div className="modal-overlay" onClick={closeSaveModal}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="출고 분배 저장 완료" style={{maxWidth:380, textAlign:'center'}}
            onClick={e=>e.stopPropagation()} onKeyDown={event => {
              if (event.key === 'Tab') { event.preventDefault(); saveModalConfirmRef.current?.focus(); }
            }}>
            <div className="modal-header" style={{background:'#E8F8E8', borderBottom:'2px solid #66BB66'}}>
              <span className="modal-title" style={{color:'#006600'}}>✅ 출고 분배 저장 완료</span>
            </div>
            <div className="modal-body" style={{padding:'20px 24px'}}>
              <div style={{fontSize:15, fontWeight:'bold', marginBottom:16, color:'#006600'}}>
                출고 분배가 저장되었습니다.
              </div>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:16}}>
                <tbody>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'6px 4px', color:'var(--text3)', width:100}}>품목</td>
                    <td style={{padding:'6px 4px', fontWeight:'bold'}}>{saveModal.prodName}</td>
                  </tr>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'6px 4px', color:'var(--text3)'}}>차수</td>
                    <td style={{padding:'6px 4px', fontWeight:'bold', color:'var(--blue)'}}>{saveModal.week}</td>
                  </tr>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'6px 4px', color:'var(--text3)'}}>거래처 수</td>
                    <td style={{padding:'6px 4px', fontWeight:'bold'}}>{saveModal.savedCount}개</td>
                  </tr>
                  <tr>
                    <td style={{padding:'6px 4px', color:'var(--text3)'}}>총 출고수량</td>
                    <td style={{padding:'6px 4px', fontWeight:'bold', color:'var(--amber)'}}>{saveModal.totalQty.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
              <button ref={saveModalConfirmRef} className="btn btn-primary" style={{width:'100%', height:36, fontSize:13}}
                onClick={closeSaveModal}>확인</button>
            </div>
          </div>
        </div>
      )}

      {spModal && (
        <div className="modal-overlay" onClick={() => !spModal.running && setSpModal(null)}>
          <div className="modal" style={{maxWidth:620}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header" style={{background:spModal.failed?'#FDECEC':'#E8F8E8', borderBottom:`2px solid ${spModal.failed?'#CC3333':'#66BB66'}`}}>
              <span className="modal-title" style={{color:spModal.failed?'#AA0000':'#006600'}}>
                {spModal.running ? '전산 출고분배 진행 중' : spModal.failed ? '전산 출고분배 중단' : '전산 출고분배 완료'}
              </span>
            </div>
            <div className="modal-body" style={{padding:'18px 22px'}}>
              <div style={{fontSize:15,fontWeight:800,marginBottom:10}}>{spModal.title}</div>
              {spModal.procedureName && (
                <div style={{fontSize:12,color:'var(--text3)',marginBottom:10}}>실행 경로: dbo.{spModal.procedureName}</div>
              )}
              {spModal.before && spModal.after && (
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginBottom:14}}>
                  <thead>
                    <tr style={{background:'#F8FAFC'}}>
                      <th style={{padding:6,border:'1px solid var(--border)'}}>구분</th>
                      <th style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>품목</th>
                      <th style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>업체</th>
                      <th style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>출고합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{padding:6,border:'1px solid var(--border)'}}>분배 전</td>
                      <td style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>{fmt(spModal.before.productCount)}</td>
                      <td style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>{fmt(spModal.before.customerCount)}</td>
                      <td style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>{fmt(spModal.before.outQuantity)}</td>
                    </tr>
                    <tr>
                      <td style={{padding:6,border:'1px solid var(--border)'}}>분배 후</td>
                      <td style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>{fmt(spModal.after.productCount)}</td>
                      <td style={{padding:6,border:'1px solid var(--border)',textAlign:'right'}}>{fmt(spModal.after.customerCount)}</td>
                      <td style={{padding:6,border:'1px solid var(--border)',textAlign:'right',fontWeight:800,color:'var(--blue)'}}>{fmt(spModal.after.outQuantity)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              <div style={{border:'1px solid var(--border)',borderRadius:6,background:'#FAFAFA',padding:10,maxHeight:240,overflowY:'auto',fontSize:12,lineHeight:1.7}}>
                {(spModal.logs || []).map((line, i) => (
                  <div key={i} style={{color:line.startsWith('오류')?'var(--red)':'var(--text2)'}}>• {line}</div>
                ))}
              </div>
              <button className="btn btn-primary" style={{width:'100%',height:36,marginTop:14}} disabled={spModal.running} onClick={() => setSpModal(null)}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 탭 */}
      <div style={{display:'flex',flexWrap:'wrap',borderBottom:'2px solid var(--border)',background:'var(--surface)',flexShrink:0}}>
        {tabs.map((t,i) => (
          <button type="button" key={t} onClick={()=>requestTab(i)} aria-current={tab===i?'page':undefined}
            style={{padding:'9px 16px',fontSize:13,fontWeight:600,cursor:'pointer',color:tab===i?'var(--blue)':'var(--text3)',borderBottom:tab===i?'2px solid var(--blue)':'2px solid transparent',marginBottom:-2,whiteSpace:'nowrap'}}>
            {['🚚','🏬','📅','📊'][i]} {t}
          </button>
        ))}
        {(tab === 0 || tab === 1) && (
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,padding:'0 14px',fontSize:11,color:'var(--text3)'}}>
            조회 기준: <b style={{color:'var(--blue)'}}>{viewMode === 'prod' ? '품목 기준 (품목 → 거래처별 분배)' : '업체 기준 (업체 → 품목별 분배)'}</b>
          </div>
        )}
      </div>

      {/* 탭0 품목 기준 / 탭1 업체 기준 본문 */}
      {(tab === 0 || tab === 1) && (
        <div className="distribution-workspace-grid" style={{display:'grid',gridTemplateColumns: viewMode==='prod'?'minmax(210px, 20%) minmax(0, 1fr)':'minmax(240px, 28%) minmax(0, 1fr)',alignItems:'start',background:'var(--surface)',border:'1px solid var(--border)',borderTop:'none',borderRadius:'0 0 8px 8px'}}>

          {/* ── 품목 기준: 왼쪽 품목 목록 ── */}
          {viewMode === 'prod' && (
            <div style={{borderRight:'1px solid var(--border)',minWidth:0}}>
              <DistributionDateFilter label="품종·품목" value={farmDate} onChange={setFarmDate} dates={dateLookup.dates} loading={dateIndexLoading} error={dateIndexError} />
              <div style={{padding:'8px 12px',background:'#F8FAFC',borderBottom:'1px solid var(--border)',display:'flex',gap:6,flexWrap:'wrap'}}>
                <input ref={productSearchRef} className="filter-input" placeholder="품목·국가·품종 검색 (전체 품목)" value={prodFilter} onFocus={ensureProductCatalog} onChange={e=>{ if (e.target.value.trim()) ensureProductCatalog(); setProdFilter(e.target.value); }} style={{flex:1,height:28,fontSize:12,minWidth:0}}/>
                <button type="button" className={`btn btn-sm ${favoritesOnly?'btn-primary':'btn-secondary'}`}
                  aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(value => !value)}>★ 즐겨찾기만</button>
              </div>
              <div style={{overflowX:'auto'}}>
                {loading ? <div className="skeleton" style={{margin:12,height:300,borderRadius:8}}></div> : (
                  // 품목명만 — 단위·입수·잔량·입고·출고·현재고는 선택하면 오른쪽에 같은 내용이 나온다.
                  <DistributionProductTree rows={filteredProds} favoriteKeys={favoriteKeys} groupFavorites={favoriteGroups} selectedProd={selectedProd}
                    activeFamily={prodGroup} onSelect={selectProd} onFavorite={toggleProductFavorite} onGroupFavorite={toggleGroupFavorite} onFamilySelect={chooseProdGroup}
                    expanded={expandedFamilies} setExpanded={setExpandedFamilies} disabled={loading||saving} favoritesDisabled={!accountId||favoritesPending} search={prodFilter} />
                )}
              </div>
            </div>
          )}

          {/* ── 업체 기준: 왼쪽 업체 목록 ── */}
          {viewMode === 'cust' && (
            <div style={{borderRight:'1px solid var(--border)',minWidth:0}}>
              <DistributionDateFilter label="업체" value={customerDate} onChange={setCustomerDate} dates={dateLookup.dates} loading={dateIndexLoading} error={dateIndexError} />
              <div style={{padding:'8px 12px',background:'#F8FAFC',borderBottom:'1px solid var(--border)',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontSize:11,fontWeight:700,color:'var(--text2)'}}>거래처 목록</span>
                <input ref={dealerSearchRef} className="filter-input" placeholder="업체명 검색" value={custFilter||''} disabled={hasDateDrafts||saving} data-ai-verify="customer-search"
                  aria-label="업체명 검색" onChange={e=>{ setCustFilter(e.target.value); if (e.target.value.trim()) loadAllCustomers(); }} style={{flex:1,height:28,fontSize:12,minWidth:120}} />
                <label style={{fontSize:11,display:'inline-flex',gap:3,alignItems:'center'}} title="이 차수에 주문이 없는 업체도 목록에 보여 줍니다. 그 업체로 옮기거나 추가하면 저장 시 주문등록 후 분배합니다.">
                  <input type="checkbox" data-ai-verify="customer-show-all" checked={showAllCustomers} disabled={hasDateDrafts||saving} onChange={e => toggleAllCustomers(e.target.checked)} />주문 없는 업체도
                </label>
              </div>
              {!loading && custList.length>0 && custList.every(c=>c.noOrder) && <p role="status" data-testid="distribution-no-order-candidates" style={{margin:0,padding:5,fontSize:12,color:'var(--blue)'}}>이 차수·선택 범위에 주문이 없어 전체 업체를 표시합니다. 업체 선택 후 품목을 추가하세요. 양수 수량을 저장할 때 주문등록 후 분배합니다.</p>}
              {filteredCustomers.length>80 && <p role="status" style={{margin:0,padding:5,fontSize:11}}>전체 {filteredCustomers.length}개 업체 중 80개 표시 · 업체명 검색으로 전체 업체를 찾을 수 있습니다.</p>}
              {/* 두 업체 나란히 보기: 업체 버튼 클릭이 채울 칸 선택 */}
              <div data-testid="distribution-pair-slots" style={{padding:'6px 12px',borderBottom:'1px solid var(--border)',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',fontSize:11}}>
                <span style={{color:'var(--text3)'}}>버튼 클릭 →</span>
                <button type="button" data-ai-verify="pair-slot-1" aria-pressed={pairSlot === 1} disabled={hasDateDrafts||saving} onClick={() => setPairSlot(1)}
                  style={{...weekButtonStyle('1', pairSlot === 1), padding:'3px 10px', fontSize:11}}>
                  업체 1{selectedCust ? `: ${selectedCust.CustName}` : ''}
                </button>
                <button type="button" data-ai-verify="pair-slot-2" aria-pressed={pairSlot === 2} disabled={hasDateDrafts||saving} onClick={() => setPairSlot(2)}
                  style={{...weekButtonStyle('2', pairSlot === 2), padding:'3px 10px', fontSize:11,
                    border: pairSlot === 2 ? '2px solid #b45309' : '1px solid #fcd34d', background: pairSlot === 2 ? '#b45309' : '#fffbeb', color: pairSlot === 2 ? '#fff' : '#b45309'}}>
                  업체 2{pairCust ? `: ${pairCust.CustName}` : ' (비교·이동)'}
                </button>
                {pairCust && <button type="button" className="btn btn-sm" data-ai-verify="pair-clear" disabled={hasDateDrafts||saving} onClick={clearPairCust} style={{padding:'2px 7px',fontSize:11}}>업체 2 해제</button>}
                {pairCust && [3, 4, 5].filter(slot => slot - 3 <= extraPeers.length).map(slot => {
                  const peer = extraPeers[slot - 3];
                  const color = PEER_COLORS[slot - 3];
                  return (
                    <span key={slot} style={{display:'inline-flex',gap:3}}>
                      <button type="button" data-ai-verify={`pair-slot-${slot}`} aria-pressed={pairSlot === slot} disabled={hasDateDrafts||saving} onClick={() => setPairSlot(slot)}
                        style={{...weekButtonStyle(String(slot), pairSlot === slot), padding:'3px 10px', fontSize:11,
                          border: `${pairSlot === slot ? 2 : 1}px solid ${color}`, background: pairSlot === slot ? color : '#fff', color: pairSlot === slot ? '#fff' : color}}>
                        업체 {slot}{peer ? `: ${peer.cust.CustName}` : ' (추가)'}
                      </button>
                      {peer && <button type="button" className="btn btn-sm" data-ai-verify={`pair-clear-${slot}`} disabled={hasDateDrafts||saving} onClick={() => clearExtraCust(slot - 3)} style={{padding:'2px 7px',fontSize:11}}>해제</button>}
                    </span>
                  );
                })}
                <span style={{color:'var(--text3)'}}>업체를 2~5개 고르면 품목·수량이 나란히 보이고 → ← 로 수량을 옮길 수 있습니다.</span>
              </div>
              {/* nenova.exe식 버튼형 업체 선택 */}
              <div data-testid="distribution-customer-buttons" style={{padding:'8px 12px',borderBottom:'1px solid var(--border)',display:'flex',gap:5,flexWrap:'wrap',maxHeight:150,overflowY:'auto'}}>
                {loading ? <span style={{fontSize:11,color:'var(--text3)'}}>업체 조회 중…</span>
                  : filteredCustomers.length === 0 ? <span style={{fontSize:11,color:'var(--text3)'}}>차수를 선택하면 업체 버튼이 나타납니다.</span>
                  : filteredCustomers.slice(0,80).map(c => {
                    const active = Number(selectedCust?.CustKey) === Number(c.CustKey);
                    const isPair = Number(pairCust?.CustKey) === Number(c.CustKey);
                    const extraIndex = extraPeers.findIndex(p => Number(p.cust.CustKey) === Number(c.CustKey));
                    return (
                      <button key={c.CustKey} type="button" data-ai-verify={`customer-${c.CustKey}`} aria-pressed={active || isPair || extraIndex >= 0}
                        disabled={loading || saving} title={`${c.CustName} #${c.CustKey}${isPair ? ' (업체 2)' : active ? ' (업체 1)' : extraIndex >= 0 ? ` (업체 ${extraIndex + 3})` : ''}`}
                        onClick={() => (!selectedCust ? selectCust(c) : pairSlot >= 3 ? selectExtraCust(c, pairSlot) : pairSlot === 2 ? selectPairCust(c) : selectCust(c))}
                        style={isPair ? {...pickButtonStyle(true, false), background:'#b45309', border:'2px solid #b45309'}
                          : extraIndex >= 0 ? {...pickButtonStyle(true, false), background:PEER_COLORS[extraIndex], border:`2px solid ${PEER_COLORS[extraIndex]}`}
                          : pickButtonStyle(active, false)}>
                        {active ? '① ' : isPair ? '② ' : extraIndex >= 0 ? `${SLOT_MARK[extraIndex + 2]} ` : ''}{c.CustName}{c.noOrder && <span style={{fontSize:10,opacity:0.7}}> (주문없음)</span>}
                      </button>
                    );
                  })}
              </div>
              <div style={{overflowX:'auto'}}>
                {loading ? <div className="skeleton" style={{margin:12,height:200,borderRadius:8}}></div> : (
                  <table className="tbl distribution-compact-table" style={{fontSize:12}}>
                    <thead><tr><th>거래처명</th><th>지역</th><th>코드</th></tr></thead>
                    <tbody>
                      {filteredCustomers.length === 0
                        ? <tr><td colSpan={3} style={{textAlign:'center',padding:24,color:'var(--text3)'}}>{custFilter ? '검색 결과가 없습니다.' : '표시할 활성 업체가 없습니다.'}</td></tr>
                        : filteredCustomers.slice(0,80).map(c => (
                          <tr key={c.CustKey} className={selectedCust?.CustKey===c.CustKey?'selected':''}>
                            <td className="name"><button type="button" className="btn btn-sm" disabled={loading || saving} data-ai-verify={`customer-row-${c.CustKey}`}
                              onClick={() => (!selectedCust ? selectCust(c) : pairSlot >= 3 ? selectExtraCust(c, pairSlot) : pairSlot === 2 ? selectPairCust(c) : selectCust(c))}>{c.CustName}</button></td>
                            <td><span className="badge badge-gray" style={{fontSize:10}}>{c.CustArea}</span></td>
                            <td style={{fontFamily:'var(--mono)',fontSize:11}}>{c.OrderCode}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── 오른쪽: 거래처 분배 정보 (품목기준) / 품목 목록 (업체기준) ── */}
          <div style={{minWidth:0}}>
            {viewMode === 'prod' && (
              <>
                {/* 분배 컨트롤 */}
                <div style={{padding:'8px 14px',background:'#F8FAFC',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,fontWeight:600,color:'var(--text2)'}}>분배방식</span>
                  <label style={{display:'flex',alignItems:'center',gap:5,fontSize:13,cursor:'pointer'}}>
                    <input type="radio" name="distMode" checked={distMode==='ratio'} onChange={()=>setDistMode('ratio')}/> 비율 분배
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:5,fontSize:13,cursor:'pointer'}}>
                    <input type="radio" name="distMode" checked={distMode==='prior'} onChange={()=>setDistMode('prior')}/> 우선 분배
                  </label>
                  <button className="btn btn-success btn-sm" onClick={() => handleSpDistribute('one')} disabled={hasDateDrafts || spLoading || !selectedProd || custDist.length === 0 || isFixed} title="nenova.exe 개별출고분배와 같은 dbo.usp_DistributeOne 경로로 저장합니다.">전산 개별출고분배</button>
                  <button className="btn btn-warning btn-sm" onClick={handleClearOne} disabled={hasDateDrafts || spLoading || !selectedProd || isFixed} title="nenova.exe 개별 초기화와 같은 dbo.usp_DistributeClear 경로로 이 품목의 출고분배를 DB에서 되돌립니다. (확정된 분배는 먼저 확정취소)">전산 개별 초기화</button>
                  <button className="btn btn-secondary btn-sm" onClick={autoDistribute} disabled={hasDateDrafts || saving || loading || !selectedProd || custDist.length === 0} title="화면 입력값만 자동 계산합니다. DB 반영은 상단 저장 버튼으로 적용됩니다.">화면 비율계산</button>
                  <button className="btn btn-secondary btn-sm" onClick={fillOrderQuantities} disabled={hasDateDrafts || saving || loading || !selectedProd || custDist.length === 0} title="주문수량을 출고수량 입력값으로 채웁니다. DB 반영은 상단 저장 버튼으로 적용됩니다.">주문수량 채우기</button>
                  <button className="btn btn-secondary btn-sm" disabled={hasDateDrafts || saving || loading} onClick={()=>{const o={};custDist.forEach(c=>{o[c.CustKey]=0;});setOutInputs(o);setOutQty(0);}}>🔄 개별 초기화</button>
                </div>
                {selectedProd && fixedScopeMap[Number(selectedProd.ProdKey)] && (
                  <div data-testid="distribution-fixed-status" style={{padding:'4px 5px',fontSize:12,fontWeight:700,borderBottom:'1px solid var(--border)',
                    background: fixedScopeMap[Number(selectedProd.ProdKey)].fixed ? '#FEF2F2' : '#F0FDF4',
                    color: fixedScopeMap[Number(selectedProd.ProdKey)].fixed ? '#B91C1C' : '#15803D'}}>
                    {fixedScopeMap[Number(selectedProd.ProdKey)].fixed
                      ? `🔒 확정됨 — ${fixedScopeMap[Number(selectedProd.ProdKey)].countryFlower || '이 품목군'} (${week}). 수량·단가 저장은 확정해제 → 저장 → 재확정 순서입니다. 출고일만 수정하면 확정 상태를 유지합니다.`
                      : `미확정 — ${fixedScopeMap[Number(selectedProd.ProdKey)].countryFlower || '이 품목군'} (${week})`}
                  </div>
                )}
                {/* 입고/출고/잔량 */}
                <div style={{display:'flex',borderBottom:'1px solid var(--border)',background:'var(--bg)',flexShrink:0}}>
                  {[['전차수 재고',previousStock,'var(--text2)'],['입고수량',inQty,'var(--blue)'],['출고수량',totalOutInput,'var(--text1)'],['잔량',remain,remain<0?'var(--red)':remain===0?'var(--green)':'var(--amber)']].map(([label,val,color])=>(
                    <div key={label} data-testid={label === '전차수 재고' ? 'distribution-previous-stock' : undefined} style={{flex:1,padding:'10px 16px',textAlign:'center',borderRight:'1px solid var(--border)'}}>
                      <div style={{fontSize:11,color:'var(--text3)',marginBottom:3}}>{label}{selectedProd?.OutUnit ? ` (${selectedProd.OutUnit})` : ''}</div>
                      {label === '전차수 재고' && val == null
                        ? <div style={{fontSize:12,color:'var(--text3)',padding:'5px 0'}}>{selectedProd ? '위 품종 버튼을 고르면 표시' : '—'}</div>
                        : <div style={{fontSize:20,fontWeight:900,fontFamily:'var(--mono)',color}}>{(val||0).toFixed(2)}</div>}
                    </div>
                  ))}
                </div>
                {/* 거래처 분배 테이블 */}
                <div style={{overflowX:'auto'}}>
                  {!selectedProd
                    ? <div className="empty-state"><div className="empty-icon">←</div><div className="empty-text">품목을 선택하세요</div></div>
                    : distLoading ? <div className="skeleton" style={{margin:16,height:200,borderRadius:8}}></div>
                    : (
                      <>
                        <div style={{padding:'4px 5px',background:'var(--blue-bg)',fontSize:12,color:'var(--blue)',fontWeight:600,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                          <span>{distributeProductName(selectedProd, selectedFlower)} — 거래처 분배 정보</span>
                          <input className="filter-input" placeholder="업체명 검색 (분배 업체)" value={farmCustomerSearch}
                            data-ai-verify="farm-distribution-customer-search" aria-label="농장정보 분배 업체 검색"
                            onChange={e=>setFarmCustomerSearch(e.target.value)} style={{height:25,fontSize:11,width:190,background:'white'}} />
                          <span role="status" style={{fontSize:10,fontWeight:400,color:'var(--text3)'}}>{visibleFarmCustomerRows.length}/{custDistRows.length}곳</span>
                          <button type="button" className="btn btn-sm" data-ai-verify="prod-add-cust-open" disabled={hasDateDrafts || saving || loading}
                            onClick={async () => { const next = !prodAddOpen; setProdAddOpen(next); if (next) await loadAllCustomers(); }}
                            style={{padding:'1px 8px',fontSize:11}}>{prodAddOpen ? '업체추가 닫기' : '+ 업체추가'}</button>
                          {prodAddedCusts.length > 0 && <span style={{fontWeight:400,color:'#b45309'}}>추가 업체 {prodAddedCusts.length}곳 (품목을 바꿔도 유지)</span>}
                        </div>
                        {prodAddOpen && (() => {
                          const managers = [...new Set(allCustomers.map(c => c.Manager || '담당자 없음'))].sort((a, b) => a.localeCompare(b, 'ko'));
                          const addText = prodAddFilter.trim().toLowerCase();
                          const list = addText
                            ? sortDistributionCustomers(allCustomers.filter(c => (!prodAddManager || (c.Manager || '담당자 없음') === prodAddManager) && customerMatchesSearch(c, addText))).slice(0, 60)
                            : prodAddManager ? sortDistributionCustomers(allCustomers.filter(c => (c.Manager || '담당자 없음') === prodAddManager)) : [];
                          return (
                            <div data-testid="distribution-prod-add-cust" style={{padding:'4px 5px',borderBottom:'1px solid var(--border-t)',display:'grid',gap:6}}>
                              <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
                                <input className="filter-input" placeholder="업체명 검색" value={prodAddFilter} data-ai-verify="prod-add-cust-search" aria-label="업체추가 업체명 검색"
                                  onChange={e => setProdAddFilter(e.target.value)} style={{height:26,fontSize:12,width:150,marginRight:6}} />
                                <span style={{fontSize:11,color:'var(--text3)'}}>담당자</span>
                                {allCustomers.length === 0 && <span style={{fontSize:11,color:'var(--text3)'}}>불러오는 중…</span>}
                                {managers.map(m => (
                                  <button key={m} type="button" data-ai-verify={`prod-add-manager-${m}`} aria-pressed={prodAddManager === m}
                                    onClick={() => setProdAddManager(prev => prev === m ? null : m)} style={pickButtonStyle(prodAddManager === m, true)}>{m}</button>
                                ))}
                              </div>
                              {(prodAddManager || addText) && (
                                <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
                                  <span style={{fontSize:11,color:'var(--text3)'}}>업체</span>
                                  {list.length === 0 && <span style={{fontSize:11,color:'var(--text3)'}}>검색 결과 없음</span>}
                                  {list.map(c => {
                                    const inDist = custDist.some(d => Number(d.CustKey) === Number(c.CustKey));
                                    const added = prodAddedCusts.some(a => Number(a.CustKey) === Number(c.CustKey));
                                    return (
                                      <button key={c.CustKey} type="button" data-ai-verify={`prod-add-cust-${c.CustKey}`} aria-pressed={added || inDist} disabled={inDist || saving}
                                        title={inDist ? '이미 이 품목 주문이 있는 업체' : added ? '다시 누르면 빼기' : '추가'}
                                        onClick={() => setProdAddedCusts(prev => added ? prev.filter(a => Number(a.CustKey) !== Number(c.CustKey)) : [...prev, c])}
                                        style={pickButtonStyle(added || inDist, false)}>{added ? '✓ ' : ''}{c.CustName}</button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        <table className="tbl distribution-customer-table" style={{fontSize:12}}>
                          <thead>
                            <tr>
                              <th>거래처명</th><th>주문코드</th><th>단위</th>
                              <th style={{textAlign:'right'}}>주문수량</th>
                              <th style={{textAlign:'right',color:'var(--blue)'}}>출고수량 입력</th>
                              <th style={{textAlign:'right'}}>차이</th>
                              <th style={{textAlign:'right'}}>Box수량</th>
                              <th style={{textAlign:'right'}}>단수량</th>
                              <th style={{textAlign:'right'}}>송이수량</th>
                              <th style={{textAlign:'right'}}>단가</th>
                              <th style={{padding:0}}>{dateHeader}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleFarmCustomerRows.length === 0
                              ? <tr><td colSpan={11} style={{textAlign:'center',padding:24,color:'var(--text3)'}}>{farmCustomerSearch.trim() ? '검색 결과가 없습니다.' : '주문 데이터 없음 — 위 「+ 업체추가」로 업체를 넣을 수 있습니다'}</td></tr>
                              : visibleFarmCustomerRows.map(c => {
                                const outVal = outInputs[c.CustKey] || 0;
                                const diff = (c.주문수량||0) - outVal;
                                // Box·단·송이 칸은 출고수량(OutUnit)을 환산해 보여 주고, 어느 칸에 입력해도 OutUnit 으로 바꿔 저장값 하나만 둔다.
                                const unitCell = (unit) => {
                                  const f = distributionUnitFactor(selectedProd, unit);
                                  return (
                                    <td key={unit} style={{textAlign:'right'}}>
                                      <input type="number" min={0} step={0.01} placeholder={unit} value={outVal && f ? toDisplayQty(outVal, f) : ''} disabled={hasDateDrafts || saving || loading || !f}
                                        data-ai-verify={`qty-${c.CustKey}-${selectedProd.ProdKey}-${unit}`} aria-label={`${c.CustName} ${selectedProd.ProdName} 출고수량 (${unit})`}
                                        title={f ? `${unit} 입력 → 저장 단위 ${selectedProd.OutUnit} 로 환산` : `${unit}: 입수 정보가 없어 환산 불가`}
                                        onClick={e=>e.stopPropagation()}
                                        onChange={e=>{const v=Number(toNativeQty(e.target.value, f))||0;setOutInputs(o=>({...o,[c.CustKey]:v}));}}
                                        style={{width:62,height:26,border:'1px solid var(--border2)',borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 4px',background:'var(--bg)'}} />
                                    </td>
                                  );
                                };
                                const isSel = selectedDistCust?.CustKey === c.CustKey;
                                return (
                                  <tr key={c.CustKey}
                                    onClick={() => selectDistCustRow(c)}
                                    style={{ cursor: 'pointer', background: isSel ? 'var(--blue-bg)' : undefined }}>
                                    <td className="name" style={{whiteSpace:'normal',overflowWrap:'anywhere'}}>{c.CustName}
                                      {c.addedNoOrder && <span style={{fontSize:10,color:'#b45309',marginLeft:4}}>주문 없음 · 저장 시 주문등록</span>}
                                      {c.addedNoOrder && <button type="button" className="btn btn-sm" data-ai-verify={`prod-added-remove-${c.CustKey}`} disabled={hasDateDrafts||saving}
                                        onClick={e => { e.stopPropagation(); setProdAddedCusts(prev => prev.filter(a => Number(a.CustKey) !== Number(c.CustKey))); setOutInputs(o => { const n = { ...o }; delete n[c.CustKey]; return n; }); }}
                                        style={{padding:'0 5px',fontSize:10,marginLeft:4}}>✕</button>}
                                    </td>
                                    <td style={{fontFamily:'var(--mono)',fontSize:11}}>{c.주문코드}</td>
                                    <td style={{fontSize:11}}>{selectedProd.OutUnit || c.OutUnit || '—'}</td>
                                    <td className="num">{(c.주문수량||0).toFixed(2)}</td>
                                    <td>
                                      <input type="number" min={0} step={1} value={outVal||''} data-distribute-qty="true" aria-keyshortcuts="Enter" disabled={hasDateDrafts || saving || loading}
                                        data-ai-verify={`qty-${c.CustKey}-${selectedProd.ProdKey}`}
                                        aria-label={`${c.CustName} ${selectedProd.ProdName} 출고수량 (${selectedProd.OutUnit || c.OutUnit || ''})`}
                                        onKeyDown={handleQuantityEnter}
                                        onChange={e=>{const v=parseFloat(e.target.value)||0;setOutInputs(o=>({...o,[c.CustKey]:v}));}}
                                        style={{width:75,height:26,border:`1px solid ${outVal>0?'var(--blue)':'var(--border2)'}`,borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 4px',background:outVal>0?'var(--blue-bg)':'var(--bg)',fontWeight:outVal>0?700:400}}
                                      />
                                    </td>
                                    <td className="num" style={{color:diff<0?'var(--red)':diff===0?'var(--green)':'var(--text3)'}}>{diff.toFixed(2)}</td>
                                    {['박스', '단', '송이'].map(unitCell)}
                                    <td className="num">{fmt(c.Cost || selectedProd.Cost || 0)}</td>
                                    <td style={{fontSize:11,color:'var(--text3)'}}>
                                      {dateButton(c.CustKey,{...selectedProd,...c,ProdKey:selectedProd.ProdKey},`${c.CustName} · ${selectedProd.ProdName}`)}
                                      <div>{distributionQuantityRemark(c.ShipmentDescr, c.출고수량, outVal, selectedProd.OutUnit || c.OutUnit)}</div>
                                      {c.비고 && c.비고 !== c.ShipmentDescr && <div>주문 메모: {c.비고}</div>}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                          <tfoot>
                            <tr className="foot">
                              <td colSpan={3}>합계</td>
                              <td className="num">{custDist.reduce((a,b)=>a+(b.주문수량||0),0).toFixed(2)}</td>
                              <td className="num" style={{color:'var(--blue)'}}>{totalOutInput.toFixed(2)}</td>
                              <td className="num" style={{color:remain<0?'var(--red)':remain===0?'var(--green)':'var(--amber)'}}>{remain.toFixed(2)}</td>
                              <td colSpan={5}></td>
                            </tr>
                          </tfoot>
                        </table>
                        {/* exe 농장 정보 (grdViewShipment_FocusedRowChanged) */}
                        <div style={{borderTop:'2px solid var(--border)',padding:'8px 14px',background:'#FAFAFA'}}>
                          <div style={{fontSize:12,fontWeight:700,marginBottom:8,color:'var(--text2)'}}>
                            ≡ 농장 정보
                            {selectedDistCust ? ` — ${selectedDistCust.CustName}` : ' (거래처 행 클릭)'}
                          </div>
                          {farmLoading ? (
                            <div className="skeleton" style={{height:60,borderRadius:6}} />
                          ) : !selectedDistCust ? (
                            <div style={{fontSize:11,color:'var(--text3)'}}>위 분배표에서 거래처를 클릭하면 농장별 입고/출고 잔량이 표시됩니다.</div>
                          ) : farmRows.length === 0 ? (
                            <div style={{fontSize:11,color:'var(--text3)'}}>농장 데이터 없음</div>
                          ) : (
                            <table className="tbl" style={{fontSize:11}}>
                              <thead>
                                <tr>
                                  <th>농장명</th><th>코드</th><th>주문코드</th>
                                  <th style={{textAlign:'right'}}>입고</th>
                                  <th style={{textAlign:'right'}}>출고</th>
                                  <th style={{textAlign:'right'}}>잔량</th>
                                </tr>
                              </thead>
                              <tbody>
                                {farmRows.map((f, i) => (
                                  <tr key={i}>
                                    <td>{f.FarmName}</td>
                                    <td style={{fontFamily:'var(--mono)'}}>{f.FarmCode}</td>
                                    <td style={{fontFamily:'var(--mono)'}}>{f.OrderCode}</td>
                                    <td className="num">{(f.wOutQuantity ?? 0).toLocaleString()}</td>
                                    <td className="num">{(f.sOutQuantity ?? 0).toLocaleString()}</td>
                                    <td className="num" style={{fontWeight:700,color:(f.Remainuantity||0)<0?'var(--red)':'var(--green)'}}>
                                      {(f.Remainuantity ?? 0).toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </>
                    )}
                </div>
              </>
            )}

            {/* 업체 기준 오른쪽: 해당 업체 주문 품목 */}
            {viewMode === 'cust' && (
              <div style={{overflowX:'auto'}}>
                {!selectedCust
                  ? <div className="empty-state"><div className="empty-icon">←</div><div className="empty-text">업체를 선택하세요</div></div>
                  : custLoading || pairLoading || extraLoading > 0 ? <div className="skeleton" style={{margin:16,height:300,borderRadius:8}}></div>
                  : pairCust ? (
                    <>
                      <div style={{padding:'8px 14px',background:'var(--blue-bg)',fontSize:12,color:'var(--blue)',fontWeight:600,borderBottom:'1px solid var(--border-t)'}}>
                        ① {selectedCust.CustName} ↔ ② {pairCust.CustName} — 품목별 출고수량 나란히 보기 (→ ← 로 이동, Ctrl+S 저장은 두 업체 함께)
                        {extraPeers.map((p, i) => <span key={p.cust.CustKey} style={{color:PEER_COLORS[i]}}> ↔ {SLOT_MARK[i + 2]} {p.cust.CustName}</span>)}
                        {fixedCount(pairRows) > 0 && <span data-testid="distribution-pair-fixed-count" style={{marginLeft:8,color:'#B91C1C'}}>🔒 확정 품목 {fixedCount(pairRows)}개 (저장 시 확정해제→저장→재확정)</span>}
                      </div>
                      {(() => {
                        const groups = distributionPairGroups(pairRows);
                        return (
                          <div style={{padding:'4px 5px',borderBottom:'1px solid var(--border-t)',display:'flex',gap:5,flexWrap:'wrap',alignItems:'center'}}>
                            {itemFilterInput}
                            <span style={{fontSize:11,color:'var(--text3)'}}>품종</span>
                            <span data-testid="distribution-pair-group-buttons" style={{display:'contents'}}>
                              {['', ...groups].map(g => (
                                <button key={g || 'all'} type="button" data-ai-verify={`pair-group-${g || 'all'}`} aria-pressed={pairGroupFilter === g}
                                  onClick={() => setPairGroupFilter(g)} style={pickButtonStyle(pairGroupFilter === g, true)}>{g || '전체'}</button>
                              ))}
                            </span>
                          </div>
                        );
                      })()}
                      {extraPeers.length > 0 ? (() => {
                        // 업체 3개 이상: 이동 칸 없이 업체 열끼리 붙여서 바로 수정 (업체명 = 머리줄)
                        const sides = pairSides();
                        const colors = ['var(--blue)', '#b45309', ...PEER_COLORS];
                        const rows = pairSearchRows.filter(row => matchItemName(row, custItemFilter)).filter(row => distributionPairFilterMatches(row, pairGroupFilter)).filter(row=>!customerDate||pairSides().some(side=>side.cust&&dateLookup.matches(customerDate,row.ProdKey,side.cust.CustKey)));
                        const itemAt = (sd, row) => sd.items.find(i => Number(i.ProdKey) === Number(row.ProdKey));
                        const qtyAt = (sd, row) => { const item = itemAt(sd, row); const e = sd.inputs[row.ProdKey]; return e?.outQty !== undefined ? parseFloat(e.outQty) || 0 : (item?.출고수량 || 0); };
                        const edge = i => ({ borderLeft: `2px solid ${colors[i]}` });
                        return (
                          <table className="tbl" data-testid="distribution-pair-table" data-layout="multi" style={{fontSize:12,width:'auto'}}>
                            <thead>
                              <tr data-testid="distribution-pair-cust-header">
                                <th rowSpan={2}>품목명</th><th rowSpan={2}>단위</th>
                                {sides.map((sd, i) => (
                                  <th key={sd.cust.CustKey} colSpan={2} data-ai-verify={`pair-cust-head-${i + 1}`}
                                    style={{...edge(i), textAlign:'center', color:colors[i], fontSize:13, background:'#f8fafc'}}>{SLOT_MARK[i]} {sd.cust.CustName}</th>
                                ))}
                                <th rowSpan={2} style={{textAlign:'right'}} title="이 차수 입고 − 전체 출고(선택 업체들의 화면 변경분 반영), 저장 단위">재고잔량(변경후)</th>
                              </tr>
                              <tr>
                                {sides.map((sd, i) => [
                                  <th key={`o-${i}`} style={{...edge(i), textAlign:'right'}}>주문</th>,
                                  <th key={`q-${i}`} style={{textAlign:'center',color:colors[i]}}>출고 입력 <span style={{fontWeight:400,fontSize:10}}>박스 · 단 · 송이</span>{dateHeader}</th>,
                                ])}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map(row => {
                                const prod = products.find(p => Number(p.ProdKey) === Number(row.ProdKey));
                                const delta = sides.reduce((a, sd) => { const item = itemAt(sd, row); return a + (item ? qtyAt(sd, row) - (item.출고수량 || 0) : 0); }, 0);
                                const left = prod ? (Number(prod.inQty) || 0) - (Number(prod.outQty) || 0) - delta : null;
                                return (
                                  <tr key={row.ProdKey}>
                                    <td style={{fontWeight:500,padding:'3px 6px',whiteSpace:'nowrap'}}>{fixedBadge(row.ProdKey)}{row.DisplayName || row.ProdName}</td>
                                    <td style={{fontSize:11,padding:'3px 6px'}} title="저장 단위">{row.OutUnit}</td>
                                    {sides.map((sd, i) => {
                                      const item = itemAt(sd, row);
                                      return [
                                        <td key={`o-${i}`} className="num" style={{...edge(i), color:colors[i]}}>{item ? (item.pendingOrder ? <span style={{fontSize:11}}>주문등록 예정</span> : (item.주문수량 || 0).toFixed(2)) : <span style={{color:'var(--text3)',fontSize:11}}>주문 없음</span>}</td>,
                                        <td key={`q-${i}`}>{pairQtyCell(i, row, colors[i])}</td>,
                                      ];
                                    })}
                                    <td className="num" data-ai-verify={`pair-remain-${row.ProdKey}`}>{left === null ? <span style={{color:'var(--text3)'}}>—</span>
                                      : <span style={{fontWeight:700,color:left<0?'var(--red)':left===0?'var(--green)':'var(--text1)'}}>{left.toFixed(2)} <span style={{fontSize:10,fontWeight:400,color:'var(--text3)'}}>{row.OutUnit}</span></span>}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="foot">
                                <td colSpan={2}>합계</td>
                                {sides.map((sd, i) => [
                                  <td key={`o-${i}`} className="num" style={edge(i)}>{sd.items.reduce((a, b) => a + (b.주문수량 || 0), 0).toFixed(2)}</td>,
                                  <td key={`q-${i}`} className="num" style={{color:colors[i]}}>{sd.items.reduce((a, item) => a + qtyAt(sd, item), 0).toFixed(2)}</td>,
                                ])}
                                <td></td>
                              </tr>
                            </tfoot>
                          </table>
                        );
                      })() : (
                      <table className="tbl" data-testid="distribution-pair-table" style={{fontSize:12,width:'auto'}}>
                        <thead>
                          <tr data-testid="distribution-pair-cust-header">
                            <th colSpan={2} />
                            <th colSpan={2} data-ai-verify="pair-cust-head-1" style={{textAlign:'center',color:'var(--blue)',background:'#eff6ff',fontSize:13}}>① {selectedCust.CustName}</th>
                            <th style={{textAlign:'center',fontSize:11}}>① ⇄ ②</th>
                            <th colSpan={2} data-ai-verify="pair-cust-head-2" style={{textAlign:'center',color:'#b45309',background:'#fff7ed',fontSize:13}}>② {pairCust.CustName}</th>
                            {extraPeers.map((p, i) => <th key={p.cust.CustKey} colSpan={2} data-ai-verify={`pair-cust-head-${i + 3}`} style={{textAlign:'center',color:PEER_COLORS[i],background:'#f8fafc',fontSize:13}}>{SLOT_MARK[i + 2]} {p.cust.CustName}</th>)}
                            <th colSpan={2} />
                          </tr>
                          <tr>
                            <th>품목명</th><th>단위</th>
                            <th style={{textAlign:'right'}}>① 주문</th>
                            <th style={{textAlign:'center',color:'var(--blue)'}}>① 출고 입력 <span style={{fontWeight:400,fontSize:10}}>박스 · 단 · 송이</span>{dateHeader}</th>
                            <th style={{textAlign:'center'}}>이동</th>
                            <th style={{textAlign:'center',color:'#b45309'}}>② 출고 입력 <span style={{fontWeight:400,fontSize:10}}>박스 · 단 · 송이</span>{dateHeader}</th>
                            <th style={{textAlign:'right'}}>② 주문</th>
                            {extraPeers.map((p, i) => [
                              <th key={`in-${i}`} style={{textAlign:'center',color:PEER_COLORS[i]}}>{SLOT_MARK[i + 2]} 출고 입력{dateHeader}</th>,
                              <th key={`ord-${i}`} style={{textAlign:'right'}}>{SLOT_MARK[i + 2]} 주문</th>,
                            ])}
                            <th style={{textAlign:'right'}} title="이 차수 입고 − 전체 출고(선택 업체들의 화면 변경분 반영), 저장 단위">재고잔량(변경후)</th>
                            <th>미저장 변경</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pairSearchRows.filter(row => matchItemName(row, custItemFilter)).filter(row => distributionPairFilterMatches(row, pairGroupFilter)).filter(row=>!customerDate||pairSides().some(side=>side.cust&&dateLookup.matches(customerDate,row.ProdKey,side.cust.CustKey))).map(row => {
                            const editA = custEditInputs[row.ProdKey] || {};
                            const editB = pairEditInputs[row.ProdKey] || {};
                            const qtyA = row.a ? (editA.outQty !== undefined ? editA.outQty : (row.a.출고수량 || 0)) : null;
                            const qtyB = row.b ? (editB.outQty !== undefined ? editB.outQty : (row.b.출고수량 || 0)) : null;
                            const qtyX = extraPeers.map((p, i) => {
                              const item = row.extra?.[i];
                              if (!item) return null;
                              const e = p.inputs[row.ProdKey] || {};
                              return e.outQty !== undefined ? e.outQty : (item.출고수량 || 0);
                            });
                            // 박스·단·송이 세 칸이 같은 값을 환산해 보여 준다. 어느 칸에 넣어도 저장값은 OutUnit 하나
                            // (입수 BunchOf1Box/SteamOf1Box 가 없으면 그 단위 칸은 잠금). OutUnit 칸만 Enter 이동 대상.
                            const qtyInput = (cust, item, value, inputs, setInputs, color) => (
                              <span style={{display:'inline-flex',gap:3}}>
                                {['박스', '단', '송이'].map(unit => {
                                  const f = distributionUnitFactor(row, unit);
                                  const native = unit === (row.OutUnit || '박스');
                                  const filled = parseFloat(value) > 0;
                                  return (
                                    <input key={unit} type="number" min={0} step={native ? 0.1 : 0.01} placeholder={unit}
                                      value={filled && f ? toDisplayQty(value, f) : ''} disabled={hasDateDrafts || saving || loading || !f}
                                      title={f ? `${unit} (저장 단위 ${row.OutUnit})` : `${unit}: 입수 정보가 없어 환산 불가`}
                                      {...(native ? { 'data-distribute-qty': 'true', 'aria-keyshortcuts': 'Enter', onKeyDown: handleQuantityEnter } : {})}
                                      data-ai-verify={native ? `qty-${cust.CustKey}-${item.ProdKey}` : `qty-${cust.CustKey}-${item.ProdKey}-${unit}`}
                                      aria-label={`${cust.CustName} ${item.ProdName} 출고수량 (${unit})`}
                                      onChange={e=>setInputs(prev=>({...prev,[item.ProdKey]:{...(prev[item.ProdKey]||{}),outQty:native ? e.target.value : toNativeQty(e.target.value, f)}}))}
                                      style={{width:native?58:50,height:26,border:`1px solid ${filled?(native?color:'var(--border2)'):'var(--border2)'}`,borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 3px',background:filled&&native?'var(--blue-bg)':'var(--bg)',fontWeight:filled&&native?700:400,color:native?undefined:'var(--text2)'}} />
                                  );
                                })}
                              </span>
                            );
                            return (
                              <tr key={row.ProdKey}>
                                <td style={{fontWeight:500,padding:'3px 6px',whiteSpace:'nowrap'}}>{fixedBadge(row.ProdKey)}{row.DisplayName || row.ProdName}</td>
                                <td style={{fontSize:11,padding:'3px 6px'}} title="저장 단위">{row.OutUnit}</td>
                                <td className="num" style={{color:'var(--blue)'}}>{row.a ? (row.a.pendingOrder ? <span style={{color:'#b45309',fontSize:11}}>주문등록 예정</span> : (row.a.주문수량||0).toFixed(2)) : <span style={{color:'var(--text3)'}}>주문 없음</span>}</td>
                                <td>{pairQtyCell(0, row, 'var(--blue)')}</td>
                                <td style={{textAlign:'center',whiteSpace:'nowrap'}}>
                                  <button type="button" className="btn btn-sm" data-ai-verify={`move-to1-${row.ProdKey}`} disabled={hasDateDrafts || saving || loading || !(parseFloat(qtyB) > 0)}
                                    title={!row.a ? '②→① 이동 (①에 주문이 없어 저장 시 주문등록 후 분배)' : '②→① 이동 (이동 수량이 비어 있으면 전부; 화면 입력값만, 저장 시 반영)'}
                                    onClick={() => moveDistributionQty(row.ProdKey, 1, 0, distributionUnitFactor(row, moveUnitInputs[row.ProdKey] || row.OutUnit) || 1)} style={{padding:'1px 7px'}}>←</button>
                                  <input type="number" min={0} step={0.1} value={moveQtyInputs[row.ProdKey] ?? ''} placeholder="전부" disabled={hasDateDrafts || saving || loading}
                                    data-ai-verify={`move-qty-${row.ProdKey}`} aria-label={`${row.ProdName} 이동 수량`}
                                    onChange={e=>setMoveQtyInputs(prev=>({...prev,[row.ProdKey]:e.target.value}))}
                                    style={{width:50,height:24,margin:'0 0 0 3px',border:'1px solid var(--border2)',borderRadius:'4px 0 0 4px',textAlign:'right',fontSize:11,fontFamily:'var(--mono)',padding:'0 3px'}} />
                                  <select value={moveUnitInputs[row.ProdKey] || row.OutUnit || '박스'} disabled={hasDateDrafts || saving || loading}
                                    data-ai-verify={`move-unit-${row.ProdKey}`} aria-label={`${row.ProdName} 이동 수량 단위`}
                                    onChange={e=>setMoveUnitInputs(prev=>({...prev,[row.ProdKey]:e.target.value}))}
                                    style={{height:24,marginRight:3,border:'1px solid var(--border2)',borderLeft:'none',borderRadius:'0 4px 4px 0',fontSize:11}}>
                                    {['박스', '단', '송이'].filter(u => distributionUnitFactor(row, u)).map(u => <option key={u} value={u}>{u}</option>)}
                                  </select>
                                  <button type="button" className="btn btn-sm" data-ai-verify={`move-to2-${row.ProdKey}`} disabled={hasDateDrafts || saving || loading || !(parseFloat(qtyA) > 0)}
                                    title={!row.b ? '①→② 이동 (②에 주문이 없어 저장 시 주문등록 후 분배)' : '①→② 이동 (이동 수량이 비어 있으면 전부; 화면 입력값만, 저장 시 반영)'}
                                    onClick={() => moveDistributionQty(row.ProdKey, 0, 1, distributionUnitFactor(row, moveUnitInputs[row.ProdKey] || row.OutUnit) || 1)} style={{padding:'1px 7px'}}>→</button>
                                  {extraPeers.length > 0 && (() => {
                                    // 업체 3개 이상: 보내는 곳 → 받는 곳 을 골라 같은 이동 수량·단위로 이동
                                    const mm = multiMove[row.ProdKey] || { from: 0, to: 2 };
                                    const names = pairSides().map((side, i) => `${SLOT_MARK[i]} ${side.cust?.CustName || ''}`);
                                    const pick = (key, label) => (
                                      <select value={mm[key]} disabled={hasDateDrafts || saving || loading} data-ai-verify={`move-${key}-${row.ProdKey}`} aria-label={`${row.ProdName} 이동 ${label}`}
                                        onChange={e => setMultiMove(prev => ({ ...prev, [row.ProdKey]: { ...mm, [key]: Number(e.target.value) } }))}
                                        style={{height:22,fontSize:11,maxWidth:110}}>
                                        {names.map((n, i) => <option key={i} value={i}>{n}</option>)}
                                      </select>
                                    );
                                    return (
                                      <div style={{marginTop:3,display:'flex',gap:2,alignItems:'center',justifyContent:'center'}}>
                                        {pick('from', '보내는 업체')}<span>→</span>{pick('to', '받는 업체')}
                                        <button type="button" className="btn btn-sm" data-ai-verify={`move-go-${row.ProdKey}`} disabled={hasDateDrafts || saving || loading || mm.from === mm.to}
                                          title="고른 업체끼리 이동 (이동 수량이 비어 있으면 전부; 받는 곳에 주문이 없으면 저장 시 주문등록 후 분배)"
                                          onClick={() => moveDistributionQty(row.ProdKey, mm.from, mm.to, distributionUnitFactor(row, moveUnitInputs[row.ProdKey] || row.OutUnit) || 1)} style={{padding:'1px 6px',fontSize:11}}>이동</button>
                                      </div>
                                    );
                                  })()}
                                </td>
                                <td>{pairQtyCell(1, row, '#b45309')}</td>
                                <td className="num" style={{color:'#b45309'}}>{row.b ? (row.b.pendingOrder ? <span style={{color:'#b45309',fontSize:11}}>주문등록 예정</span> : (row.b.주문수량||0).toFixed(2)) : <span style={{color:'var(--text3)'}}>주문 없음</span>}</td>
                                {extraPeers.map((p, i) => {
                                  const item = row.extra?.[i];
                                  return [
                                    <td key={`in-${i}`}>{pairQtyCell(i + 2, row, PEER_COLORS[i])}</td>,
                                    <td key={`ord-${i}`} className="num" style={{color:PEER_COLORS[i]}}>{item ? (item.pendingOrder ? <span style={{fontSize:11}}>주문등록 예정</span> : (item.주문수량||0).toFixed(2)) : <span style={{color:'var(--text3)'}}>주문 없음</span>}</td>,
                                  ];
                                })}
                                <td className="num" data-ai-verify={`pair-remain-${row.ProdKey}`}>{(() => {
                                  const prod = products.find(p => Number(p.ProdKey) === Number(row.ProdKey));
                                  if (!prod) return <span style={{color:'var(--text3)'}}>—</span>;
                                  const delta = (row.a ? (parseFloat(qtyA) || 0) - (row.a.출고수량 || 0) : 0) + (row.b ? (parseFloat(qtyB) || 0) - (row.b.출고수량 || 0) : 0)
                                    + extraPeers.reduce((a, _, i) => a + (row.extra?.[i] ? (parseFloat(qtyX[i]) || 0) - (row.extra[i].출고수량 || 0) : 0), 0);
                                  const left = (Number(prod.inQty) || 0) - (Number(prod.outQty) || 0) - delta;
                                  return <span style={{fontWeight:700,color:left<0?'var(--red)':left===0?'var(--green)':'var(--text1)'}}>{left.toFixed(2)} <span style={{fontSize:10,fontWeight:400,color:'var(--text3)'}}>{row.OutUnit}</span></span>;
                                })()}</td>
                                <td style={{fontSize:11,color:'var(--text3)'}}>
                                  {row.a && <div>① {distributionQuantityRemark(row.a.ShipmentDescr, row.a.출고수량, qtyA, row.OutUnit)}</div>}
                                  {row.b && <div>② {distributionQuantityRemark(row.b.ShipmentDescr, row.b.출고수량, qtyB, row.OutUnit)}</div>}
                                  {extraPeers.map((p, i) => row.extra?.[i] && <div key={i}>{SLOT_MARK[i + 2]} {distributionQuantityRemark(row.extra[i].ShipmentDescr, row.extra[i].출고수량, qtyX[i], row.OutUnit)}</div>)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="foot">
                            <td colSpan={2}>합계</td>
                            <td className="num">{custItems.reduce((a,b)=>a+(b.주문수량||0),0).toFixed(2)}</td>
                            <td className="num" style={{color:'var(--blue)'}}>{custItems.reduce((a,item)=>{const e=custEditInputs[item.ProdKey]||{};return a+(parseFloat(e.outQty!==undefined?e.outQty:(item.출고수량||0))||0);},0).toFixed(2)}</td>
                            <td></td>
                            <td className="num" style={{color:'#b45309'}}>{pairItems.reduce((a,item)=>{const e=pairEditInputs[item.ProdKey]||{};return a+(parseFloat(e.outQty!==undefined?e.outQty:(item.출고수량||0))||0);},0).toFixed(2)}</td>
                            <td className="num">{pairItems.reduce((a,b)=>a+(b.주문수량||0),0).toFixed(2)}</td>
                            {extraPeers.map((p, i) => [
                              <td key={`in-${i}`} className="num" style={{color:PEER_COLORS[i]}}>{p.items.reduce((a,item)=>{const e=p.inputs[item.ProdKey]||{};return a+(parseFloat(e.outQty!==undefined?e.outQty:(item.출고수량||0))||0);},0).toFixed(2)}</td>,
                              <td key={`ord-${i}`} className="num">{p.items.reduce((a,b)=>a+(b.주문수량||0),0).toFixed(2)}</td>,
                            ])}
                            <td></td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{padding:'8px 14px',background:'var(--blue-bg)',fontSize:12,color:'var(--blue)',fontWeight:600,borderBottom:'1px solid var(--border-t)'}}>
                        {selectedCust.CustName} ({selectedCust.OrderCode}) — 주문 품목 목록
                        {itemFilterInput}
                      </div>
                      <table className="tbl" style={{fontSize:12}}>
                        <thead>
                          <tr>
                            <th>국가</th><th>꽃</th><th>품목명</th><th>단위</th>
                            <th style={{textAlign:'right',color:'var(--blue)'}}>주문수량</th>
                            <th style={{textAlign:'right',color:'var(--blue)'}}>출고수량 입력</th>
                            <th style={{textAlign:'center'}}>박스 · 단 · 송이</th>
                            <th style={{textAlign:'right'}}>잔량</th>
                            <th style={{textAlign:'right',color:'var(--amber)'}}>단가 (편집)</th>
                            <th style={{textAlign:'right',color:'var(--text3)'}}>금액</th>
                            <th style={{padding:0}}>{dateHeader}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {custSearchRows.length === 0
                            ? <tr><td colSpan={11} style={{textAlign:'center',padding:24,color:'var(--text3)'}}>{String(custItemFilter||'').trim() ? '검색 결과 없음' : '주문 데이터 없음'}</td></tr>
                            : custSearchRows.map((item,i) => {
                              if (item.searchOnly) {
                                // 주문 없는 품목 (검색으로만 표시) — 수량을 넣으면 주문등록 예정 행으로 바뀜
                                return (
                                  <tr key={`search-${item.ProdKey}`} data-ai-verify={`search-only-${selectedCust.CustKey}-${item.ProdKey}`} style={{background:'#fafafa',color:'var(--text2)'}}>
                                    <td style={{fontSize:11}}>{item.CounName}</td>
                                    <td style={{fontSize:11}}>{item.FlowerName}</td>
                                    <td style={{fontWeight:500}}>{item.DisplayName || item.ProdName} <span style={{fontSize:10,color:'#b45309'}}>주문 없음</span></td>
                                    <td style={{fontSize:11}}>{item.OutUnit}</td>
                                    <td className="num" style={{color:'var(--text3)'}}>0.00</td>
                                    <td>
                                      <input type="number" min={0} step={0.1} value="" placeholder="수량" data-distribute-qty="true" aria-keyshortcuts="Enter" disabled={hasDateDrafts || saving || loading}
                                        data-ai-verify={`qty-${selectedCust.CustKey}-${item.ProdKey}`}
                                        aria-label={`${selectedCust.CustName} ${item.ProdName} 출고수량 (${item.OutUnit || ''})`}
                                        title="주문 없음: 입력하면 저장 시 주문등록 후 분배"
                                        onKeyDown={handleQuantityEnter}
                                        onChange={e=>addCustSearchItem(item, e.target.value)}
                                        style={{width:80,height:26,border:'1px dashed var(--border2)',borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 4px',background:'var(--bg)'}}
                                      />
                                    </td>
                                    <td style={{whiteSpace:'nowrap'}}>
                                      {['박스', '단', '송이'].map(unit => {
                                        const f = distributionUnitFactor(item, unit);
                                        return (
                                          <input key={unit} type="number" min={0} step={0.01} placeholder={unit} disabled={hasDateDrafts || saving || loading || !f} value=""
                                            data-ai-verify={`qty-${selectedCust.CustKey}-${item.ProdKey}-${unit}`} aria-label={`${selectedCust.CustName} ${item.ProdName} 출고수량 (${unit})`}
                                            title={f ? `${unit} 입력 → 저장 단위 ${item.OutUnit}` : `${unit}: 입수 정보가 없어 환산 불가`}
                                            onChange={e=>addCustSearchItem(item, toNativeQty(e.target.value, f))}
                                            style={{width:52,height:26,marginRight:2,border:'1px dashed var(--border2)',borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 3px',background:'var(--bg)',color:'var(--text2)'}} />
                                        );
                                      })}
                                    </td>
                                    <td className="num" style={{color:'var(--text3)'}}>0.00</td>
                                    <td className="num" style={{color:'var(--text3)'}}>{item.Cost ? fmt(Math.round(item.Cost)) : '—'}</td>
                                    <td className="num" style={{color:'var(--text3)'}}>—</td>
                                    <td style={{fontSize:11,color:'var(--text3)'}}>수량 입력 시 저장할 때 주문등록 후 분배</td>
                                  </tr>
                                );
                              }
                              const edit = custEditInputs[item.ProdKey] || {};
                              const outVal = edit.outQty !== undefined ? edit.outQty : (item.출고수량 || 0);
                              const costVal = edit.cost !== undefined ? edit.cost : (item.Cost || 0);
                              const diff = (item.주문수량||0) - parseFloat(outVal||0);
                              const amount = parseFloat(outVal||0) * parseFloat(costVal||0);
                              return (
                                <tr key={i} style={{background:item.잔량>0?'#FFFBEB':undefined}}>
                                  <td style={{fontSize:11}}>{item.CounName}</td>
                                  <td style={{fontSize:11}}>{item.FlowerName}</td>
                                  <td style={{fontWeight:500}}>{fixedBadge(item.ProdKey)}{item.DisplayName || item.ProdName}</td>
                                  <td style={{fontSize:11}}>{item.OutUnit}</td>
                                  <td className="num" style={{color:'var(--blue)',fontWeight:700}}>{(item.주문수량||0).toFixed(2)}</td>
                                  <td>
                                    <input type="number" min={0} step={0.1} value={outVal||''} data-distribute-qty="true" aria-keyshortcuts="Enter" disabled={hasDateDrafts || saving || loading}
                                      data-ai-verify={`qty-${selectedCust.CustKey}-${item.ProdKey}`}
                                      aria-label={`${selectedCust.CustName} ${item.ProdName} 출고수량 (${item.OutUnit || ''})`}
                                      onKeyDown={handleQuantityEnter}
                                      onChange={e=>setCustEditInputs(prev=>({...prev,[item.ProdKey]:{...(prev[item.ProdKey]||{}),outQty:e.target.value}}))}
                                      style={{width:80,height:26,border:`1px solid ${parseFloat(outVal)>0?'var(--blue)':'var(--border2)'}`,borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 4px',background:parseFloat(outVal)>0?'var(--blue-bg)':'var(--bg)',fontWeight:parseFloat(outVal)>0?700:400}}
                                    />
                                  </td>
                                  <td style={{whiteSpace:'nowrap'}}>
                                    {/* 박스·단·송이 환산 칸 — 어느 칸에 넣어도 저장값은 OutUnit 하나 (입수 없으면 잠금) */}
                                    {['박스', '단', '송이'].map(unit => {
                                      const f = distributionUnitFactor(item, unit);
                                      return (
                                        <input key={unit} type="number" min={0} step={0.01} placeholder={unit} disabled={hasDateDrafts || saving || loading || !f}
                                          value={parseFloat(outVal) > 0 && f ? toDisplayQty(outVal, f) : ''}
                                          data-ai-verify={`qty-${selectedCust.CustKey}-${item.ProdKey}-${unit}`} aria-label={`${selectedCust.CustName} ${item.ProdName} 출고수량 (${unit})`}
                                          title={f ? `${unit} 입력 → 저장 단위 ${item.OutUnit}` : `${unit}: 입수 정보가 없어 환산 불가`}
                                          onChange={e=>setCustEditInputs(prev=>({...prev,[item.ProdKey]:{...(prev[item.ProdKey]||{}),outQty:toNativeQty(e.target.value, f)}}))}
                                          style={{width:52,height:26,marginRight:2,border:'1px solid var(--border2)',borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 3px',background:'var(--bg)',color:'var(--text2)'}} />
                                      );
                                    })}
                                  </td>
                                  <td className="num" style={{fontWeight:700,color:diff<0?'var(--red)':diff===0?'var(--green)':'var(--amber)'}}>{diff.toFixed(2)}</td>
                                  <td>
                                    <input type="number" min={0} step={1} value={costVal||''} disabled={hasDateDrafts || saving || loading}
                                      data-ai-verify={`cost-${selectedCust.CustKey}-${item.ProdKey}`} aria-label={`${selectedCust.CustName} ${item.ProdName} 단가`}
                                      onChange={e=>setCustEditInputs(prev=>({...prev,[item.ProdKey]:{...(prev[item.ProdKey]||{}),cost:e.target.value}}))}
                                      style={{width:90,height:26,border:'1px solid var(--amber)',borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 4px',background:'#FFFBEB'}}
                                    />
                                  </td>
                                  <td className="num" style={{color:'var(--text2)'}}>{amount>0?fmt(Math.round(amount)):'—'}</td>
                                  <td style={{fontSize:11,color:'var(--text3)'}}>
                                    {dateButton(selectedCust.CustKey,item,`${selectedCust.CustName} · ${item.ProdName}`)}<div>{distributionQuantityRemark(item.ShipmentDescr, item.출고수량, outVal, item.OutUnit)}</div>
                                    {item.비고 && item.비고 !== item.ShipmentDescr && <div>주문 메모: {item.비고}</div>}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                        <tfoot>
                          <tr className="foot">
                            <td colSpan={4}>합계</td>
                            <td className="num">{custItems.reduce((a,b)=>a+(b.주문수량||0),0).toFixed(2)}</td>
                            <td className="num" style={{color:'var(--blue)'}}>
                              {custItems.reduce((a,item)=>{const e=custEditInputs[item.ProdKey]||{};return a+parseFloat(e.outQty!==undefined?e.outQty:(item.출고수량||0))||0;},0).toFixed(2)}
                            </td>
                            <td></td>
                            <td className="num">
                              {custItems.reduce((a,item)=>{const e=custEditInputs[item.ProdKey]||{};const q=parseFloat(e.outQty!==undefined?e.outQty:(item.출고수량||0))||0;return a+((item.주문수량||0)-q);},0).toFixed(2)}
                            </td>
                            <td></td>
                            <td className="num" style={{color:'var(--text2)',fontWeight:700}}>
                              {fmt(Math.round(custItems.reduce((a,item)=>{const e=custEditInputs[item.ProdKey]||{};const q=parseFloat(e.outQty!==undefined?e.outQty:(item.출고수량||0))||0;const c=parseFloat(e.cost!==undefined?e.cost:(item.Cost||0))||0;return a+q*c;},0)))}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </>
                  )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 출고일은 실제 저장값만 표시하며 모든 탭에서 같은 날짜 편집기를 사용한다. */}
      {tab === 2 && <div style={{border:'1px solid var(--border)',padding:5,background:'var(--surface)'}}>
        <p style={{fontSize:12,margin:'5px 0'}}>저장된 출고일을 조회합니다. 「분배·수정」에서 날짜별 수량을 입력하고 미리보기 후 저장하세요.</p>
        <details><summary style={{cursor:'pointer'}}>기본 출고요일 설정 (실제 출고일 저장과 별도)</summary>
          <div style={{padding:'12px 16px',borderBottom:'2px solid var(--border)',background:'#F8FAFC'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
              <span style={{fontSize:13,fontWeight:700}}>📅 품목그룹별 기본 출고요일 설정</span>
              <button className="btn btn-primary btn-sm" onClick={saveShipDayConfigs} disabled={shipDaySaving}>
                {shipDaySaving ? '저장중...' : '💾 출고요일 저장'}
              </button>
              {shipDayLoading && <span style={{fontSize:11,color:'var(--text3)'}}>로딩...</span>}
            </div>
            <div style={{overflowX:'auto'}}>
              <table className="tbl" style={{fontSize:12,minWidth:600}}>
                <thead>
                  <tr>
                    <th style={{width:180}}>품목그룹</th>
                    {WEEK_SUFFIXES.map(s => (
                      <th key={s} colSpan={5} style={{textAlign:'center',color:'var(--blue)'}}>
                        {s.replace('-','')+'차'}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th></th>
                    {WEEK_SUFFIXES.map(s => DAY_NAMES.map(d => (
                      <th key={s+d} style={{textAlign:'center',fontSize:11,width:40,padding:'4px 2px'}}>{d}</th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {prodGroups.map(pg => (
                    <tr key={pg.key}>
                      <td style={{fontWeight:600,fontSize:12}}>{pg.label}</td>
                      {WEEK_SUFFIXES.map(s => DAY_NAMES.map(d => {
                        const key = `${pg.key}|${s}`;
                        const checked = (shipDayConfigs[key] || '').split(',').includes(d);
                        return (
                          <td key={s+d} style={{textAlign:'center',padding:'3px 2px'}}>
                            <input type="checkbox" checked={checked}
                              onChange={() => toggleShipDay(pg.key, s, d)}
                              style={{cursor:'pointer',width:16,height:16}} />
                          </td>
                        );
                      }))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 하단: 업체별 일별 수량 분배 */}
        </details>
        <div className="distribution-workspace-grid" style={{display:'grid',gridTemplateColumns:'minmax(180px,20%) minmax(0,1fr)',gap:5}}>
          <div>{sortDistributionCustomers(custList).map(c=><button type="button" key={c.CustKey} onClick={()=>loadTab2Items(c.CustKey)} aria-pressed={tab2CustKey===c.CustKey}
            style={{display:'block',width:'100%',textAlign:'left',padding:'5px',background:tab2CustKey===c.CustKey?'var(--blue-bg)':'var(--surface)',border:'1px solid var(--border)'}}>{c.CustName}</button>)}</div>
          <div style={{minWidth:0,overflowX:'auto'}}>{tab2Loading?'출고일 조회 중…':!tab2CustKey?'업체를 선택하세요':<table className="tbl"><thead><tr><th>품목</th><th>출고수량</th><th style={{padding:0}}>{dateHeader}</th></tr></thead>
            <tbody>{tab2Items.filter(item=>Number(item.출고수량)>0).map(item=><tr key={item.ProdKey}><td>{item.ProdName}</td><td className="num">{fmt(item.출고수량)} {item.OutUnit}</td><td>
              {item._exeWeekGrid&&<div style={{fontSize:11}}>{DAY_NAMES_TAB2.filter(d=>Number(item._dayByKr[d])>0).map(d=>`${String(item._ymdByKr?.[d]||'').slice(0,10)}(${d}) ${fmt(item._dayByKr[d])}`).join(' · ')}</div>}
              {dateButton(tab2CustKey,item,item.ProdName)}</td></tr>)}</tbody></table>}</div>
        </div>
      </div>}

      {/* 탭3: 출고 분배 집계 (exe GetPivotData) */}
      {tab === 3 && (
        <div style={{border:'1px solid var(--border)',borderTop:'none',borderRadius:'0 0 8px 8px',background:'var(--surface)'}}>
          <div style={{padding:'8px 14px',background:'#F8FAFC',borderBottom:'1px solid var(--border)',display:'flex',gap:8,alignItems:'center',justifyContent:'space-between'}}>
            <span style={{fontSize:12,color:'var(--text2)'}}>
              {countryFlowerFromGroup(prodGroup, prodGroups)
                ? `품목그룹 ${selectedProdGroupLabel} — 출고>0 집계 (nenova.exe GetPivotData)`
                : '품목그룹을 선택하고 조회하세요'}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={loadPivotRows} disabled={pivotLoading || !countryFlowerFromGroup(prodGroup, prodGroups)}>새로고침</button>
          </div>
          <div style={{overflowX:'auto'}}>
            {pivotLoading ? (
              <div className="skeleton" style={{margin:16,height:200,borderRadius:8}} />
            ) : (
              <table className="tbl" style={{minWidth:800,fontSize:12}}>
                <thead>
                  <tr>
                    <th>국가</th><th>꽃</th><th>품목</th><th>거래처</th><th>지역</th><th>담당</th>
                    <th style={{textAlign:'right'}}>주문</th><th style={{textAlign:'right'}}>출고</th>
                  </tr>
                </thead>
                <tbody>
                  {pivotRows.length === 0 ? (
                    <tr><td colSpan={8} style={{textAlign:'center',padding:32,color:'var(--text3)'}}>데이터 없음</td></tr>
                  ) : pivotRows.map((r, i) => (
                    <tr key={`${r.CustName}-${r.ProdName}-${i}`}>
                      <td>{r.CounName}</td>
                      <td>{r.FlowerName}</td>
                      <td className="name">{r.ProdName}</td>
                      <td className="name">{r.CustName}</td>
                      <td>{r.CustArea}</td>
                      <td>{r.Manager}</td>
                      <td className="num">{(r.oOutQuantity ?? 0).toLocaleString()}</td>
                      <td className="num" style={{fontWeight:700,color:'var(--blue)'}}>{(r.sOutQuantity ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* 확정 전 사전검증 모달 */}
      {showValidate && validateResult && (
        <div className="modal-overlay" onClick={() => setShowValidate(false)}>
          <div className="modal" style={{maxWidth:620}} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{background:'#FFF3CD', borderBottom:'2px solid #FFC107'}}>
              <span className="modal-title" style={{color:'#856404'}}>⚠️ 확정 전 이슈 발견 ({validateResult.issueCount}건) — [{validateResult.week}]</span>
              <button className="modal-close" onClick={() => setShowValidate(false)}>✕</button>
            </div>
            <div className="modal-body" style={{padding:'16px 20px', maxHeight:'60vh', overflowY:'auto', fontSize:12}}>

              {validateResult.negative?.length > 0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontWeight:700, color:'#c00', marginBottom:6}}>🔴 마이너스 잔량 ({validateResult.negative.length}건) — 출고량이 입고+재고 초과</div>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                    <thead><tr style={{background:'#f8d7da'}}>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>품목</th>
                      <th style={{padding:'4px 6px'}}>전재고</th>
                      <th style={{padding:'4px 6px'}}>입고</th>
                      <th style={{padding:'4px 6px'}}>출고</th>
                      <th style={{padding:'4px 6px', color:'#c00'}}>잔량</th>
                    </tr></thead>
                    <tbody>{validateResult.negative.map((r,i) => (
                      <tr key={i} style={{borderBottom:'1px solid #f5c6cb'}}>
                        <td style={{padding:'3px 6px'}}>{r.ProdName}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.prevStock}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.inQty}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.outQty}</td>
                        <td style={{padding:'3px 6px', textAlign:'center', color:'#c00', fontWeight:700}}>{r.remain}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

              {validateResult.duplicate?.length > 0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontWeight:700, color:'#856404', marginBottom:6}}>🟡 중복 출고 ({validateResult.duplicate.length}건) — 같은 거래처+품목에 복수 입력</div>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                    <thead><tr style={{background:'#fff3cd'}}>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>거래처</th>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>품목</th>
                      <th style={{padding:'4px 6px'}}>건수</th>
                      <th style={{padding:'4px 6px'}}>합계</th>
                    </tr></thead>
                    <tbody>{validateResult.duplicate.map((r,i) => (
                      <tr key={i} style={{borderBottom:'1px solid #ffeeba'}}>
                        <td style={{padding:'3px 6px'}}>{r.CustName}</td>
                        <td style={{padding:'3px 6px'}}>{r.ProdName}</td>
                        <td style={{padding:'3px 6px', textAlign:'center', color:'#c00', fontWeight:700}}>{r.cnt}건</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.totalQty}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

              {validateResult.ghost?.length > 0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontWeight:700, color:'#555', marginBottom:6}}>⚪ 주문 없는 출고 ({validateResult.ghost.length}건) — 주문 미등록 상태에서 출고 분배됨</div>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                    <thead><tr style={{background:'#e2e3e5'}}>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>거래처</th>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>품목</th>
                      <th style={{padding:'4px 6px'}}>수량</th>
                      <th style={{padding:'4px 6px'}}>확정여부</th>
                    </tr></thead>
                    <tbody>{validateResult.ghost.map((r,i) => (
                      <tr key={i} style={{borderBottom:'1px solid #d6d8db'}}>
                        <td style={{padding:'3px 6px'}}>{r.CustName}</td>
                        <td style={{padding:'3px 6px'}}>{r.ProdName}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.OutQuantity}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.isFix ? '확정' : '미확정'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

              <div style={{color:'#666', fontSize:11, marginTop:8}}>위 이슈를 확인 후 수정하거나, 이상 없으면 그대로 확정할 수 있습니다.</div>
            </div>
            <div className="modal-footer" style={{display:'flex', gap:8, justifyContent:'flex-end', padding:'12px 20px'}}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowValidate(false)}>취소 / Cancelar</button>
              <button className="btn btn-warning btn-sm" style={{background:'#FFC107', color:'#000', border:'none'}}
                onClick={() => { setShowValidate(false); doFix(); }}>
                이슈 무시하고 확정
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 출고 분배 내역 조회 모달 */}
      {showHistory && (
        <div className="modal-overlay" onClick={()=>setShowHistory(false)}>
          <div className="modal" style={{maxWidth:860}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">■ 출고 분배 내역 조회 — [{week}] 차수</span>
              <button className="btn btn-sm" onClick={()=>setShowHistory(false)}>{t('닫기')}</button>
            </div>
            <div className="modal-body" style={{padding:0,maxHeight:'70vh',overflowY:'auto'}}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>변경일자</th><th>차수</th><th>거래처명</th>
                    <th>국가</th><th>꽃</th><th>품목명</th>
                    <th>변경유형</th><th>변경항목</th>
                    <th style={{textAlign:'right'}}>기준값</th>
                    <th style={{textAlign:'right'}}>변경값</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {historyData.length === 0
                    ? <tr><td colSpan={11} style={{textAlign:'center',padding:32,color:'var(--text3)'}}>변경 내역 없음</td></tr>
                    : historyData.map((r,i) => (
                      <tr key={i}>
                        <td style={{fontFamily:'var(--mono)',fontSize:11}}>{r.ChangeDtm}</td>
                        <td style={{fontFamily:'var(--mono)',fontWeight:'bold'}}>{r.week}</td>
                        <td>{r.CustName}</td>
                        <td>{r.country}</td>
                        <td>{r.flower}</td>
                        <td style={{fontSize:12}}>{r.name}</td>
                        <td>
                          <span className={`badge ${r.type==='신규'?'badge-green':r.type==='수정'?'badge-blue':'badge-red'}`}>
                            {r.type}
                          </span>
                        </td>
                        <td style={{fontSize:11}}>{r.변경항목||'수량'}</td>
                        <td className="num" style={{color:'var(--text3)'}}>{r.before}</td>
                        <td className="num" style={{fontWeight:'bold',color:r.type==='삭제'?'var(--red)':r.type==='신규'?'var(--green)':'var(--blue)'}}>{r.after}</td>
                        <td style={{fontSize:11,color:'var(--text3)'}}>{r.Descr||'—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setShowHistory(false)}>{t('닫기')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
