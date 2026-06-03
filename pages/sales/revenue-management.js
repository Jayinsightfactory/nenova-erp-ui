import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';

const fmt = n => Number(n || 0).toLocaleString();

const COMPARE_WEEKS = ['22', '23', '24', '25', '26'];

const BASE_CUSTOMERS = [
  '미우', '소재2호', '그린', '꽃길', '알파', '꽃동산', '레바논', '미카엘', '꿀벌',
  '공주', '성남', '플로르아름', '나래꽃', '경향', '대한꽃집', '송우', '코코도르',
  '청지화원', '존버', '시흥장미', '매일', '남촌', '신초원', '선미', '미소',
  '꽃사레', '유니온', '아이엠', '정원꽃', '청목소재', '코벤트', '파란마을',
  '타우블', '스타일', '녹색', '자연원예', '강남',
];

const SAMPLE_2025_BY_WEEK = {
  '22': {
    미우: 12770363, 소재2호: 18245090, 그린: 3458727, 꽃길: 2131272, 알파: 2044090,
    레바논: 5607545, 미카엘: 2127272, 꿀벌: 1976818, 성남: 408636, 플로르아름: 359090,
    나래꽃: 1818181, 경향: 143636, 송우: 2851136, 존버: 152727, 매일: 217500,
    남촌: 400909, 신초원: 87272, 선미: 151363, 꽃사레: 359090, 유니온: 538636,
    아이엠: 139090, 코벤트: 179545, 타우블: 332272, 스타일: 1745999, 녹색: 3904772,
  },
  '23': {
    미우: 13100454, 소재2호: 18185000, 그린: 2861181, 꽃길: 3001727, 알파: 2207272,
    꽃동산: 152727, 레바논: 3907727, 미카엘: 2303181, 꿀벌: 1221818, 성남: 408636,
    플로르아름: 359090, 나래꽃: 1636363, 경향: 551909, 송우: 865636, 존버: 152727,
    매일: 216818, 남촌: 405454, 신초원: 87272, 선미: 286818, 꽃사레: 179545,
    유니온: 538636, 코벤트: 179545, 타우블: 152727, 스타일: 1787272, 녹색: 2968545,
  },
};

const RAW_2025_WEEK_24 = [
  ['소재2호', 17807900],
  ['아이엠', 14891800],
  ['그린화원', 3414900],
  ['(주)플라워녹색공간', 3382000],
  ['꽃길', 3269700],
  ['구백의 천사', 2702500],
  ['나래꽃(중매1390)', 2226000],
  ['알파플라워', 2218100],
  ['(주)미카엘플라워', 1935000],
  ['주식회사 꿀벌원예', 1568000],
  ['중매1536 (스타일)', 1490000],
  ['경향농원', 653500],
  ['주식회사 송우플라워시스템', 624500],
  ['플로르 스터프 오피셜', 521000],
  ['중매1453호 유니온', 513500],
  ['성남원예', 425600],
  ['타우블', 365500],
  ['선미원예(중매1484)', 361500],
  ['주식회사 매일농원', 252000],
  ['코벤트원예 2호', 197500],
  ['꽃사레', 197500],
  ['존버', 168000],
  ['남촌원예', 168000],
].map(([ecountName, amount]) => ({ ecountName, amount }));

const BUILT_IN_ALIASES = {
  소재2호: '소재2호',
  아이엠: '미우',
  그린화원: '그린',
  '(주)플라워녹색공간': '녹색',
  꽃길: '꽃길',
  '나래꽃(중매1390)': '나래꽃',
  알파플라워: '알파',
  '(주)미카엘플라워': '미카엘',
  '주식회사 꿀벌원예': '꿀벌',
  '중매1536 (스타일)': '스타일',
  경향농원: '경향',
  '주식회사 송우플라워시스템': '송우',
  '플로르 스터프 오피셜': '플로르아름',
  '중매1453호 유니온': '유니온',
  성남원예: '성남',
  타우블: '타우블',
  '선미원예(중매1484)': '선미',
  '주식회사 매일농원': '매일',
  '코벤트원예 2호': '코벤트',
  꽃사레: '꽃사레',
  존버: '존버',
  남촌원예: '남촌',
};

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/㈜|\(주\)|（주）|주식회사|유한회사|농업회사법인|영농조합법인/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/꽃(?=소재)/g, '')
    .replace(/[|:：,\-→>]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function growth(current, previous) {
  if (!previous) return current ? '신규' : '';
  return `${(((current - previous) / previous) * 100).toFixed(1)}%`;
}

function yearValue(row, week, year) {
  return row.weeks?.[week]?.[year] || 0;
}

export default function SalesRevenueManagement() {
  const currentYear = new Date().getFullYear();
  const [channel, setChannel] = useState('양재동');
  const [week, setWeek] = useState('24');
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [years, setYears] = useState({
    y1: String(currentYear - 2),
    y2: String(currentYear - 1),
    y3: String(currentYear),
  });
  const [mappings, setMappings] = useState({});
  const [mappingErr, setMappingErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedSource, setSelectedSource] = useState(null);
  const [custSearch, setCustSearch] = useState('');
  const [custResults, setCustResults] = useState([]);
  const [selectedCust, setSelectedCust] = useState(null);
  const [canonicalInput, setCanonicalInput] = useState('');
  const [msg, setMsg] = useState('');
  const searchTimer = useRef(null);

  useEffect(() => {
    apiGet('/api/sales/revenue-customer-mappings')
      .then(d => setMappings(d.mappings || {}))
      .catch(e => setMappingErr(e.message));
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!custSearch.trim()) {
      setCustResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      apiGet('/api/customers/search', { q: custSearch })
        .then(d => setCustResults(d.customers || []))
        .catch(() => setCustResults([]));
    }, 250);
    return () => clearTimeout(searchTimer.current);
  }, [custSearch]);

  const rawRows = useMemo(() => {
    return RAW_2025_WEEK_24.map(row => {
      const key = normalizeName(row.ecountName);
      const saved = mappings[key];
      const builtIn = BUILT_IN_ALIASES[row.ecountName];
      const canonicalName = saved?.canonicalName || builtIn || row.ecountName;
      return {
        ...row,
        key,
        canonicalName,
        status: saved ? '확정' : builtIn ? '후보' : '미매칭',
        saved,
      };
    });
  }, [mappings]);

  const compareRows = useMemo(() => {
    const map = new Map(BASE_CUSTOMERS.map(name => [name, {
      canonicalName: name,
      weeks: {},
      sourceNames: [],
      status: '',
    }]));

    for (const weekNo of COMPARE_WEEKS) {
      for (const [name, amount] of Object.entries(SAMPLE_2025_BY_WEEK[weekNo] || {})) {
        if (!map.has(name)) map.set(name, { canonicalName: name, weeks: {}, sourceNames: [], status: '' });
        const row = map.get(name);
        row.weeks[weekNo] = row.weeks[weekNo] || {};
        row.weeks[weekNo][years.y2] = amount;
      }
    }

    for (const raw of rawRows) {
      if (!map.has(raw.canonicalName)) {
        map.set(raw.canonicalName, { canonicalName: raw.canonicalName, weeks: {}, sourceNames: [], status: '' });
      }
      const row = map.get(raw.canonicalName);
      row.weeks['24'] = row.weeks['24'] || {};
      row.weeks['24'][years.y2] = (row.weeks['24'][years.y2] || 0) + raw.amount;
      row.sourceNames.push(raw.ecountName);
      if (raw.status === '미매칭') row.status = '미매칭';
      else if (raw.status === '후보' && row.status !== '미매칭') row.status = '후보';
      else if (raw.status === '확정' && !row.status) row.status = '확정';
    }

    return Array.from(map.values()).sort((a, b) => {
      const aKnown = BASE_CUSTOMERS.includes(a.canonicalName) ? 0 : 1;
      const bKnown = BASE_CUSTOMERS.includes(b.canonicalName) ? 0 : 1;
      if (aKnown !== bKnown) return aKnown - bKnown;
      return BASE_CUSTOMERS.indexOf(a.canonicalName) - BASE_CUSTOMERS.indexOf(b.canonicalName);
    });
  }, [rawRows, years.y2]);

  const summary = useMemo(() => {
    const selected = week || '24';
    return compareRows.reduce((acc, row) => {
      acc.y1 += yearValue(row, selected, years.y1);
      acc.y2 += yearValue(row, selected, years.y2);
      acc.y3 += yearValue(row, selected, years.y3);
      if (row.status === '미매칭') acc.unmatched += 1;
      if (row.status === '후보') acc.candidate += 1;
      return acc;
    }, { y1: 0, y2: 0, y3: 0, unmatched: 0, candidate: 0 });
  }, [compareRows, week, years]);

  const reviewSources = useMemo(() => {
    return rawRows.filter(r => r.status !== '확정').sort((a, b) => {
      if (a.status !== b.status) return a.status === '미매칭' ? -1 : 1;
      return b.amount - a.amount;
    });
  }, [rawRows]);

  const selectSource = (source) => {
    setSelectedSource(source);
    setCanonicalInput(source.canonicalName || '');
    setCustSearch(source.canonicalName || source.ecountName || '');
    setSelectedCust(null);
    setMsg('');
  };

  const selectCustomer = (cust) => {
    setSelectedCust(cust);
    setCustSearch(cust.CustName || '');
    setCanonicalInput(prev => prev || cust.CustName || '');
    setCustResults([]);
  };

  const saveMapping = async () => {
    if (!selectedSource) {
      setMsg('먼저 미매칭/후보 업체를 선택하세요.');
      return;
    }
    if (!canonicalInput.trim()) {
      setMsg('통용명을 입력하세요.');
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      const data = await apiPost('/api/sales/revenue-customer-mappings', {
        ecountName: selectedSource.ecountName,
        canonicalName: canonicalInput.trim(),
        custKey: selectedCust?.CustKey || null,
        custName: selectedCust?.CustName || '',
        custArea: selectedCust?.CustArea || '',
      });
      setMappings(prev => ({ ...prev, [data.key]: data.mapping }));
      setSelectedSource(null);
      setSelectedCust(null);
      setCustSearch('');
      setCanonicalInput('');
      setMsg('매칭을 저장했습니다. 같은 이카운트 거래처명은 다음 조회부터 자동 적용됩니다.');
    } catch (e) {
      setMsg(`저장 오류: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const pendingAction = () => {
    alert('다음 단계에서 이카운트 판매현황 read-only API 조회와 DB 저장을 연결합니다. 현재 화면은 표 구조와 업체명 매칭 저장을 먼저 배포한 상태입니다.');
  };

  return (
    <div>
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="filter-label">지점</span>
        <select className="filter-select" value={channel} onChange={e => setChannel(e.target.value)}>
          <option value="양재동">양재동</option>
          <option value="전체">전체</option>
        </select>
        <span className="filter-label">차수</span>
        <input
          className="filter-input"
          value={week}
          onChange={e => setWeek(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
          style={{ width: 46, textAlign: 'center' }}
        />
        <span className="filter-label">차</span>
        <span className="filter-label">기간</span>
        <input className="filter-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span style={{ color: 'var(--text3)' }}>~</span>
        <input className="filter-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <span className="filter-label">비교연도</span>
        {['y1', 'y2', 'y3'].map(key => (
          <input
            key={key}
            className="filter-input"
            value={years[key]}
            onChange={e => setYears(prev => ({ ...prev, [key]: e.target.value.replace(/[^\d]/g, '').slice(0, 4) }))}
            style={{ width: 58, textAlign: 'center' }}
          />
        ))}
        <div className="page-actions">
          <button className="btn btn-primary" onClick={pendingAction}>이카운트 API 조회 및 저장</button>
          <button className="btn" onClick={pendingAction}>강제 재조회</button>
          <button className="btn" onClick={pendingAction}>매칭 검증</button>
          <button className="btn" onClick={pendingAction}>비교표 생성</button>
          <button className="btn" onClick={pendingAction}>엑셀</button>
        </div>
      </div>

      <div className="banner-warn" style={{ marginBottom: 6 }}>
        표는 업로드한 `매출비교.xlsx`처럼 업체 전체 행을 먼저 깔고, 이카운트 API 저장 데이터가 들어오면 금액을 채우는 방식입니다. 저장한 업체명 매칭은 다음 조회부터 계속 자동 적용됩니다.
      </div>
      {mappingErr && <div className="banner-err">매칭 로드 오류: {mappingErr}</div>}

      <div className="kpi-grid">
        <div className="kpi-card kpi-accent">
          <div className="kpi-label">{years.y1}년 {week}차 매출</div>
          <div className="kpi-value">{fmt(summary.y1)}</div>
          <div className="kpi-sub">저장 Batch 기준</div>
        </div>
        <div className="kpi-card kpi-green">
          <div className="kpi-label">{years.y2}년 {week}차 매출</div>
          <div className="kpi-value">{fmt(summary.y2)}</div>
          <div className="kpi-sub">현재 샘플 원본 반영</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">{years.y3}년 {week}차 매출</div>
          <div className="kpi-value">{fmt(summary.y3)}</div>
          <div className="kpi-sub">API 조회 후 표시</div>
        </div>
        <div className="kpi-card kpi-amber">
          <div className="kpi-label">매칭 확인</div>
          <div className="kpi-value">{summary.unmatched + summary.candidate}</div>
          <div className="kpi-sub">미매칭 {summary.unmatched} / 후보 {summary.candidate}</div>
        </div>
      </div>

      <div style={styles.grid}>
        <section style={styles.panel}>
          <div style={styles.panelHead}>
            <strong>업체명 매칭 설정</strong>
            <span>한 번 저장하면 같은 이카운트 거래처명에 계속 적용</span>
          </div>
          <div style={styles.matchGrid}>
            <div>
              <div style={styles.subHead}>미매칭/후보 원본 거래처</div>
              <div style={styles.sourceList}>
                {reviewSources.length === 0 && <div style={styles.empty}>확인 필요한 업체가 없습니다.</div>}
                {reviewSources.map(source => (
                  <button
                    key={source.ecountName}
                    type="button"
                    onClick={() => selectSource(source)}
                    style={{
                      ...styles.sourceButton,
                      borderColor: selectedSource?.ecountName === source.ecountName ? '#1166BB' : '#D0D0D0',
                      background: selectedSource?.ecountName === source.ecountName ? '#E8F0FF' : '#FFF',
                    }}
                  >
                    <b>{source.ecountName}</b>
                    <span>{fmt(source.amount)} / {source.status} / 후보 {source.canonicalName}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={styles.subHead}>검색 후 확정 저장</div>
              <label style={styles.label}>이카운트 거래처명</label>
              <input className="filter-input" value={selectedSource?.ecountName || ''} readOnly style={styles.fullInput} />
              <label style={styles.label}>통용명</label>
              <input
                className="filter-input"
                value={canonicalInput}
                onChange={e => setCanonicalInput(e.target.value)}
                placeholder="예: 미우, 미카엘, 송우"
                style={styles.fullInput}
              />
              <label style={styles.label}>네노바 거래처 검색</label>
              <input
                className="filter-input"
                value={custSearch}
                onChange={e => {
                  setCustSearch(e.target.value);
                  setSelectedCust(null);
                }}
                placeholder="업체명 검색"
                style={styles.fullInput}
              />
              {custResults.length > 0 && (
                <div style={styles.resultBox}>
                  {custResults.map(cust => (
                    <button key={cust.CustKey} type="button" onClick={() => selectCustomer(cust)} style={styles.resultButton}>
                      <b>{cust.CustName}</b>
                      <span>{cust.CustArea || '-'} / {cust.Manager || '-'}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedCust && (
                <div className="banner-info" style={{ marginTop: 6 }}>
                  선택: {selectedCust.CustName} / {selectedCust.CustArea || '-'}
                </div>
              )}
              <button className="btn btn-primary" onClick={saveMapping} disabled={saving || !selectedSource} style={{ marginTop: 8 }}>
                {saving ? '저장중...' : '이 매칭 확정 저장'}
              </button>
              {msg && <div className={msg.includes('오류') ? 'banner-err' : 'banner-ok'} style={{ marginTop: 8 }}>{msg}</div>}
            </div>
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.panelHead}>
            <strong>이카운트 원본 매칭 상태</strong>
            <span>24차 샘플 원본 기준</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 310 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>원본 거래처명</th>
                  <th>통용명</th>
                  <th>금액</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {rawRows.map(row => (
                  <tr key={row.ecountName}>
                    <td>{row.ecountName}</td>
                    <td>{row.canonicalName}</td>
                    <td style={styles.num}>{fmt(row.amount)}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section style={styles.panel}>
        <div style={styles.panelHead}>
          <strong>차수별 매출 비교표</strong>
          <span>엑셀형 전체 업체 목록</span>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th rowSpan="2">업체 통용명</th>
                {COMPARE_WEEKS.map(w => <th key={w} colSpan="4" style={{ textAlign: 'center' }}>{w}차</th>)}
                <th rowSpan="2">원본 거래처명</th>
                <th rowSpan="2">매칭상태</th>
              </tr>
              <tr>
                {COMPARE_WEEKS.map(w => (
                  <FragmentHeaders key={w} years={years} />
                ))}
              </tr>
            </thead>
            <tbody>
              {compareRows.map(row => (
                <tr key={row.canonicalName}>
                  <td className="name">{row.canonicalName}</td>
                  {COMPARE_WEEKS.map(w => {
                    const y1 = yearValue(row, w, years.y1);
                    const y2 = yearValue(row, w, years.y2);
                    const y3 = yearValue(row, w, years.y3);
                    return (
                      <Cells key={w} y1={y1} y2={y2} y3={y3} />
                    );
                  })}
                  <td>{row.sourceNames.join(', ')}</td>
                  <td>{row.status || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FragmentHeaders({ years }) {
  return (
    <>
      <th>{years.y1}</th>
      <th>{years.y2}</th>
      <th>{years.y3}</th>
      <th>성장률</th>
    </>
  );
}

function Cells({ y1, y2, y3 }) {
  const valueStyle = { textAlign: 'right', fontFamily: 'var(--mono)' };
  return (
    <>
      <td style={valueStyle}>{y1 ? fmt(y1) : ''}</td>
      <td style={valueStyle}>{y2 ? fmt(y2) : ''}</td>
      <td style={valueStyle}>{y3 ? fmt(y3) : ''}</td>
      <td style={valueStyle}>{growth(y3, y2)}</td>
    </>
  );
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: '1.15fr 0.85fr',
    gap: 6,
    marginBottom: 6,
  },
  panel: {
    background: 'var(--surface)',
    border: '1px solid var(--border2)',
    padding: 8,
  },
  panelHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderBottom: '1px solid var(--border)',
    paddingBottom: 6,
    marginBottom: 8,
    fontSize: 12,
    color: 'var(--text1)',
  },
  matchGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  subHead: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  sourceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    maxHeight: 260,
    overflow: 'auto',
  },
  sourceButton: {
    border: '1px solid #D0D0D0',
    padding: '6px 8px',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  label: {
    display: 'block',
    fontSize: 11,
    color: 'var(--text3)',
    margin: '6px 0 3px',
  },
  fullInput: {
    width: '100%',
    boxSizing: 'border-box',
  },
  resultBox: {
    border: '1px solid var(--border2)',
    marginTop: 4,
    maxHeight: 120,
    overflow: 'auto',
    background: '#FFF',
  },
  resultButton: {
    width: '100%',
    border: 0,
    borderBottom: '1px solid #EEE',
    background: '#FFF',
    padding: '5px 6px',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 12,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
  },
  empty: {
    fontSize: 12,
    color: 'var(--text3)',
    padding: 8,
    border: '1px solid var(--border)',
  },
  num: {
    textAlign: 'right',
    fontFamily: 'var(--mono)',
  },
};
