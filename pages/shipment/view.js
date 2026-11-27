import { useEffect, useMemo, useState } from 'react';
import { useWeekInput, WeekInput } from '../../lib/useWeekInput';
import { apiGetExe } from '../../lib/exeParity/client.js';
import { downloadTextFile, makeDatedFilename } from '../../lib/exportUtils';
import {
  WEEKDAY_DISPLAY_ORDER,
  getShipmentRegionStyle,
  parseShipmentDateMeta,
} from '../../lib/shipmentWeekdayFormat';

const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const escSvg = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );

export default function ShipmentView() {
  const [shipments, setShipments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [weekdayFilter, setWeekdayFilter] = useState('');
  const weekInput = useWeekInput('');
  const [custFilter, setCustFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true);
    apiGetExe('/api/shipment', {
      week: weekInput.value,
      custName: custFilter,
      area: areaFilter,
    })
      .then((d) => {
        setShipments(d.shipments || []);
        setErr('');
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (weekInput.value) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekInput.value]);

  const selectRow = (id) => {
    setSelectedId(id);
    setWeekdayFilter('');
    setDetailLoading(true);
    apiGetExe(`/api/shipment/${id}`)
      .then((d) => setDetails(d.items || []))
      .catch(() => setDetails([]))
      .finally(() => setDetailLoading(false));
  };

  const selected = shipments.find((s) => s.ShipmentKey === selectedId);

  const enrichedDetails = useMemo(
    () =>
      (details || []).map((item) => {
        const dateMeta = parseShipmentDateMeta(item.ShipmentDtm);
        return {
          ...item,
          _dateMeta: dateMeta,
          _unit: item.unit || item.OutUnit || '',
        };
      }),
    [details],
  );

  const detailWeekdayStats = useMemo(() => {
    const counts = new Map();
    const paletteByDay = new Map();
    for (const item of enrichedDetails) {
      const key = item._dateMeta.unassigned ? '미지정' : item._dateMeta.weekday;
      counts.set(key, (counts.get(key) || 0) + 1);
      paletteByDay.set(key, item._dateMeta.dayColor);
    }
    return WEEKDAY_DISPLAY_ORDER.filter((d) => counts.has(d)).map((d) => ({
      day: d,
      count: counts.get(d),
      dayColor: paletteByDay.get(d),
    }));
  }, [enrichedDetails]);

  const activeWeekday = detailWeekdayStats.some((s) => s.day === weekdayFilter) ? weekdayFilter : '';

  const filteredDetails = useMemo(() => {
    if (!activeWeekday) return enrichedDetails;
    return enrichedDetails.filter((item) => {
      const key = item._dateMeta.unassigned ? '미지정' : item._dateMeta.weekday;
      return key === activeWeekday;
    });
  }, [enrichedDetails, activeWeekday]);

  const handlePrint = () => {
    if (!selected) {
      alert('출고 목록에서 거래처를 먼저 선택하세요.');
      return;
    }
    window.print();
  };

  const handleImageDownload = () => {
    if (!selected) {
      alert('출고 목록에서 거래처를 먼저 선택하세요.');
      return;
    }
    if (filteredDetails.length === 0) {
      alert('이미지로 저장할 출고 상세가 없습니다.');
      return;
    }
    const width = 1040;
    const rowHeight = 28;
    const headerHeight = 108;
    const height = headerHeight + (filteredDetails.length + 2) * rowHeight + 28;
    const totalQty = filteredDetails.reduce((a, b) => a + (Number(b.OutQuantity) || 0), 0);
    const totalAmount = filteredDetails.reduce((a, b) => a + (Number(b.Amount) || 0), 0);
    const rowSvg = filteredDetails
      .map((item, i) => {
        const y = headerHeight + i * rowHeight;
        const dm = item._dateMeta;
        const dayText = dm.unassigned ? '미지정' : `${dm.weekday}요일`;
        return `
        <rect x="24" y="${y}" width="992" height="${rowHeight}" fill="${i % 2 ? '#f8fafc' : '#ffffff'}" stroke="#e2e8f0"/>
        <text x="36" y="${y + 18}" font-size="13" fill="#0f172a">${escSvg(dm.unassigned ? '미지정' : dm.isoDate)}</text>
        <rect x="132" y="${y + 5}" width="52" height="18" rx="4" fill="${escSvg(dm.dayColor.fill)}"/>
        <text x="158" y="${y + 18}" font-size="12" font-weight="700" text-anchor="middle" fill="${escSvg(dm.dayColor.ink)}">${escSvg(dayText)}</text>
        <text x="200" y="${y + 18}" font-size="13" fill="#334155">${escSvg(item.CounName)}</text>
        <text x="290" y="${y + 18}" font-size="13" fill="#334155">${escSvg(item.FlowerName)}</text>
        <text x="395" y="${y + 18}" font-size="13" font-weight="600" fill="#0f172a">${escSvg(item.ProdName)}</text>
        <text x="770" y="${y + 18}" font-size="13" fill="#475569">${escSvg(item._unit)}</text>
        <text x="890" y="${y + 18}" font-size="13" font-weight="700" text-anchor="end" fill="#0f172a">${escSvg(fmt(item.OutQuantity))}</text>
        <text x="1002" y="${y + 18}" font-size="13" font-weight="600" text-anchor="end" fill="#0f172a">${escSvg(fmt(item.Amount))}</text>`;
      })
      .join('');
    const totalY = headerHeight + filteredDetails.length * rowHeight;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="font-family: 'Pretendard Variable', 'Pretendard', 'Malgun Gothic', sans-serif;">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <rect x="24" y="18" width="4" height="44" fill="#1e3a8a"/>
      <text x="38" y="38" font-size="20" font-weight="800" fill="#0f172a">${escSvg(selected.CustName)} 출고 상세 내역서</text>
      <text x="38" y="58" font-size="13" fill="#475569">차수 ${escSvg(weekInput.value || selected.OrderWeek)} · 지역 ${escSvg(selected.CustArea || '미등록')} · 담당 ${escSvg(selected.Manager || '-')}</text>
      <rect x="24" y="78" width="992" height="30" fill="#f1f5f9" stroke="#cbd5e1"/>
      <text x="36" y="98" font-size="12.5" font-weight="700" fill="#1e293b">출고일</text>
      <text x="158" y="98" font-size="12.5" font-weight="700" text-anchor="middle" fill="#1e293b">출고요일</text>
      <text x="200" y="98" font-size="12.5" font-weight="700" fill="#1e293b">국가</text>
      <text x="290" y="98" font-size="12.5" font-weight="700" fill="#1e293b">품종</text>
      <text x="395" y="98" font-size="12.5" font-weight="700" fill="#1e293b">품목명</text>
      <text x="770" y="98" font-size="12.5" font-weight="700" fill="#1e293b">단위</text>
      <text x="890" y="98" font-size="12.5" font-weight="700" text-anchor="end" fill="#1e293b">출고수량</text>
      <text x="1002" y="98" font-size="12.5" font-weight="700" text-anchor="end" fill="#1e293b">금액</text>
      ${rowSvg}
      <rect x="24" y="${totalY}" width="992" height="${rowHeight}" fill="#f1f5f9" stroke="#94a3b8"/>
      <text x="36" y="${totalY + 18}" font-size="13" font-weight="800" fill="#0f172a">합계 (${filteredDetails.length}건)</text>
      <text x="890" y="${totalY + 18}" font-size="13" font-weight="800" text-anchor="end" fill="#0f172a">${escSvg(fmt(totalQty))}</text>
      <text x="1002" y="${totalY + 18}" font-size="13" font-weight="800" text-anchor="end" fill="#0f172a">${escSvg(fmt(totalAmount))}</text>
    </svg>`;
    downloadTextFile(
      makeDatedFilename(`출고상세_${selected.CustName}`, 'svg'),
      svg,
      'image/svg+xml;charset=utf-8;',
    );
  };

  const totalShipmentsQty = useMemo(
    () => shipments.reduce((a, b) => a + (Number(b.totalQty ?? b.OutQuantity) || 0), 0),
    [shipments],
  );
  const detailTotalQty = useMemo(
    () => filteredDetails.reduce((a, b) => a + (Number(b.OutQuantity) || 0), 0),
    [filteredDetails],
  );
  const detailTotalAmount = useMemo(
    () => filteredDetails.reduce((a, b) => a + (Number(b.Amount) || 0), 0),
    [filteredDetails],
  );

  return (
    <div className="ship-view-root">
      <div className="ship-filter-bar print-hide">
        <WeekInput weekInput={weekInput} label="차수" />
        <label className="ship-filter-field">
          <span>거래처</span>
          <input
            className="filter-input"
            placeholder="거래처명 검색"
            value={custFilter}
            onChange={(e) => setCustFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') load();
            }}
          />
        </label>
        <label className="ship-filter-field">
          <span>지역</span>
          <select
            className="filter-select"
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
          >
            <option value="">전체 권역</option>
            <option>경부선</option>
            <option>양재동</option>
            <option>지방</option>
            <option>호남선</option>
          </select>
        </label>
        <div className="ship-filter-actions">
          <button type="button" className="btn-primary" onClick={load}>
            조회
          </button>
          <button type="button" onClick={handlePrint}>
            출고물량표 출력
          </button>
          <button type="button" onClick={handleImageDownload}>
            이미지 다운로드
          </button>
        </div>
      </div>

      {err && (
        <div role="alert" className="ship-error-banner print-hide">
          {err}
        </div>
      )}

      <div className="ship-split-grid">
        <section className="ship-panel ship-master-panel print-hide" aria-label="출고 거래처 목록">
          <header className="ship-panel-head">
            <div>
              <strong>출고 거래처 목록</strong>
              <span className="ship-panel-sub">거래처를 선택하면 우측에 출고일·요일별 상세 내역이 표시됩니다</span>
            </div>
            <span className="ship-count-pill">{shipments.length}곳</span>
          </header>
          <div className="ship-table-scroll">
            {loading ? (
              <div className="skeleton" style={{ margin: 14, height: 180, borderRadius: 6 }} />
            ) : (
              <table className="ship-compact-tbl">
                <thead>
                  <tr>
                    <th className="col-center" style={{ width: 64 }}>차수</th>
                    <th style={{ width: 88 }}>지역</th>
                    <th>거래처 · 담당</th>
                    <th className="col-num" style={{ width: 88 }}>총 출고</th>
                    <th className="col-center" style={{ width: 68 }}>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="ship-empty-cell">
                        해당 조건의 출고 내역이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    shipments.map((s) => {
                      const regStyle = getShipmentRegionStyle(s.CustArea);
                      const qtyVal = s.totalQty ?? s.OutQuantity ?? 0;
                      const isSel = selectedId === s.ShipmentKey;
                      return (
                        <tr
                          key={s.ShipmentKey}
                          className={isSel ? 'is-selected' : ''}
                          onClick={() => selectRow(s.ShipmentKey)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td className="col-center">
                            <span className="week-tag">{s.OrderWeek}</span>
                          </td>
                          <td>
                            <span
                              className="region-tag"
                              style={{ background: regStyle.fill, color: regStyle.ink }}
                            >
                              {regStyle.label}
                            </span>
                          </td>
                          <td>
                            <span className="cust-name">{s.CustName}</span>
                            {s.Manager ? <span className="cust-mgr"> · {s.Manager}</span> : null}
                          </td>
                          <td className="col-num">{fmt(qtyVal)}</td>
                          <td className="col-center">
                            {s.isFix ? (
                              <span className="fix-tag is-fixed">확정</span>
                            ) : (
                              <span className="fix-tag">미확정</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>합계 ({shipments.length}곳)</td>
                    <td className="col-num">{fmt(totalShipmentsQty)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </section>

        <section className="ship-panel ship-detail-panel" aria-label="출고 상세 리스트">
          <header className="ship-panel-head ship-statement-head">
            <div className="ship-statement-title">
              <strong>{selected ? `${selected.CustName} 출고 상세 리스트` : '출고 상세 리스트'}</strong>
              {selected && (
                <span className="ship-statement-meta">
                  차수 <b>{weekInput.value || selected.OrderWeek}</b>
                  {selected.CustArea ? ` · ${selected.CustArea}` : ''}
                  {selected.Manager ? ` · 담당 ${selected.Manager}` : ''}
                </span>
              )}
            </div>
            {selected && detailWeekdayStats.length > 0 && (
              <div className="ship-day-chips print-hide" role="group" aria-label="출고요일 필터">
                <button
                  type="button"
                  className={'day-filter-btn' + (!activeWeekday ? ' is-active' : '')}
                  aria-pressed={!activeWeekday}
                  onClick={() => setWeekdayFilter('')}
                >
                  전체 ({enrichedDetails.length})
                </button>
                {detailWeekdayStats.map((st) => {
                  const active = activeWeekday === st.day;
                  return (
                    <button
                      key={st.day}
                      type="button"
                      className={'day-filter-btn' + (active ? ' is-active' : '')}
                      aria-pressed={active}
                      style={
                        active
                          ? { background: st.dayColor.ink, color: '#ffffff', borderColor: st.dayColor.ink }
                          : { background: st.dayColor.fill, color: st.dayColor.ink }
                      }
                      onClick={() => setWeekdayFilter((prev) => (prev === st.day ? '' : st.day))}
                    >
                      {st.day === '미지정' ? '미지정' : `${st.day}요일`} {st.count}
                    </button>
                  );
                })}
              </div>
            )}
          </header>

          {!selectedId ? (
            <div className="ship-empty-box">좌측 출고 목록에서 거래처를 선택하세요.</div>
          ) : detailLoading ? (
            <div className="skeleton" style={{ margin: 14, height: 180, borderRadius: 6 }} />
          ) : (
            <div className="ship-table-scroll">
              <table className="ship-compact-tbl">
                <thead>
                  <tr>
                    <th style={{ width: 96 }}>출고일</th>
                    <th className="col-center" style={{ width: 78 }}>출고요일</th>
                    <th style={{ width: 84 }}>국가</th>
                    <th style={{ width: 86 }}>품종</th>
                    <th>품목명</th>
                    <th className="col-center" style={{ width: 58 }}>단위</th>
                    <th className="col-num" style={{ width: 92 }}>출고수량</th>
                    <th className="col-num" style={{ width: 108 }}>금액</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDetails.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="ship-empty-cell">
                        표시할 출고 상세 품목이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredDetails.map((item, i) => {
                      const dm = item._dateMeta;
                      const prevDm = i > 0 ? filteredDetails[i - 1]._dateMeta : null;
                      const isNewDateGroup = Boolean(prevDm && prevDm.isoDate !== dm.isoDate);
                      return (
                        <tr key={item.SdetailKey ? `${item.SdetailKey}-${i}` : i} className={isNewDateGroup ? 'is-date-divider' : ''}>
                          <td className="col-date">{dm.unassigned ? '미지정' : dm.isoDate}</td>
                          <td className="col-center">
                            <span
                              className="weekday-tag"
                              style={{ background: dm.dayColor.fill, color: dm.dayColor.ink }}
                            >
                              {dm.unassigned ? '미지정' : `${dm.weekday}요일`}
                            </span>
                          </td>
                          <td>
                            {item.CounName ? <span className="coun-tag">{item.CounName}</span> : '—'}
                          </td>
                          <td className="col-sub">{item.FlowerName || '—'}</td>
                          <td className="col-prod-name">{item.ProdName}</td>
                          <td className="col-center col-sub">{item._unit || '—'}</td>
                          <td className="col-num">{fmt(item.OutQuantity)}</td>
                          <td className="col-num">{item.Amount != null ? fmt(item.Amount) : '—'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6}>합계 ({filteredDetails.length}품목)</td>
                    <td className="col-num">{fmt(detailTotalQty)}</td>
                    <td className="col-num">{fmt(detailTotalAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>

      <style jsx>{`
        .ship-view-root {
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont,
            'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-size: 13.5px;
          color: #0f172a;
          font-variant-numeric: tabular-nums;
        }
        .ship-filter-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          margin-bottom: 10px;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-left: 4px solid #1e3a8a;
          border-radius: 6px;
        }
        .ship-filter-field {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12.5px;
          font-weight: 700;
          color: #334155;
        }
        .ship-filter-field input,
        .ship-filter-field select {
          height: 30px;
          padding: 0 9px;
          border: 1px solid #cbd5e1;
          border-radius: 5px;
          font: inherit;
          font-size: 13px;
          color: #0f172a;
          background: #ffffff;
        }
        .ship-filter-actions {
          margin-left: auto;
          display: inline-flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .ship-filter-actions button {
          height: 30px;
          padding: 0 11px;
          border: 1px solid #cbd5e1;
          border-radius: 5px;
          background: #ffffff;
          color: #1e293b;
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .ship-filter-actions button:hover {
          background: #f1f5f9;
          border-color: #94a3b8;
        }
        .ship-filter-actions .btn-primary {
          background: #1e3a8a;
          border-color: #1e3a8a;
          color: #ffffff;
        }
        .ship-filter-actions .btn-primary:hover {
          background: #1d4ed8;
          border-color: #1d4ed8;
        }
        .ship-error-banner {
          padding: 9px 12px;
          margin-bottom: 10px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 6px;
          color: #991b1b;
          font-size: 13px;
          font-weight: 600;
        }
        .ship-split-grid {
          display: grid;
          grid-template-columns: minmax(340px, 0.85fr) minmax(0, 1.45fr);
          gap: 10px;
          align-items: stretch;
        }
        @media (max-width: 1100px) {
          .ship-split-grid {
            grid-template-columns: 1fr;
          }
        }
        .ship-panel {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          min-height: 540px;
          max-height: calc(100vh - 148px);
        }
        .ship-panel-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 6px 10px;
          padding: 8px 12px;
          background: #f8fafc;
          border-bottom: 1px solid #cbd5e1;
        }
        .ship-panel-head strong {
          font-size: 14px;
          font-weight: 800;
          color: #0f172a;
        }
        .ship-panel-sub {
          display: block;
          font-size: 12px;
          color: #64748b;
        }
        .ship-statement-title {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 8px;
        }
        .ship-statement-meta {
          font-size: 12.5px;
          color: #475569;
        }
        .ship-count-pill {
          padding: 2px 8px;
          border-radius: 999px;
          background: #e2e8f0;
          color: #334155;
          font-size: 12px;
          font-weight: 700;
        }
        .ship-day-chips {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .day-filter-btn {
          height: 24px;
          padding: 0 8px;
          border-radius: 999px;
          border: 1px solid rgba(15, 23, 42, 0.14);
          background: #ffffff;
          color: #334155;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }
        .ship-table-scroll {
          flex: 1;
          overflow: auto;
        }
        .ship-compact-tbl {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          font-variant-numeric: tabular-nums;
        }
        .ship-compact-tbl th {
          position: sticky;
          top: 0;
          z-index: 2;
          padding: 5px 8px;
          background: #f1f5f9;
          color: #1e293b;
          font-size: 12.5px;
          font-weight: 700;
          text-align: left;
          border-bottom: 2px solid #94a3b8;
          white-space: nowrap;
        }
        .ship-compact-tbl td {
          padding: 4px 8px;
          height: 27px;
          border-bottom: 1px solid #e2e8f0;
          vertical-align: middle;
          white-space: nowrap;
        }
        .ship-compact-tbl tbody tr:hover {
          background: #f8fafc;
        }
        .ship-compact-tbl tbody tr.is-selected {
          background: #eff6ff;
          box-shadow: inset 3px 0 #1d4ed8;
        }
        .ship-compact-tbl tbody tr.is-date-divider td {
          border-top: 2px solid #94a3b8;
        }
        .ship-compact-tbl tfoot tr {
          position: sticky;
          bottom: 0;
          background: #f1f5f9;
          border-top: 2px solid #94a3b8;
          font-weight: 800;
          color: #0f172a;
        }
        .ship-compact-tbl tfoot td {
          padding: 5px 8px;
          border-top: 2px solid #94a3b8;
          border-bottom: 0;
        }
        .col-center {
          text-align: center !important;
        }
        .col-num {
          text-align: right !important;
          font-weight: 700;
        }
        .col-date {
          font-weight: 600;
          color: #0f172a;
        }
        .col-sub {
          color: #475569;
          font-size: 12.5px;
        }
        .col-prod-name {
          font-weight: 600;
          color: #0f172a;
          max-width: 300px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .week-tag {
          display: inline-block;
          padding: 1px 6px;
          border-radius: 4px;
          background: #f1f5f9;
          color: #334155;
          font-size: 12px;
          font-weight: 700;
        }
        .region-tag,
        .weekday-tag {
          display: inline-block;
          padding: 1px 7px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 800;
          line-height: 1.25;
        }
        .coun-tag {
          display: inline-block;
          padding: 1px 6px;
          border-radius: 4px;
          background: #f1f5f9;
          color: #334155;
          font-size: 12px;
          font-weight: 600;
        }
        .cust-name {
          font-weight: 700;
          color: #0f172a;
        }
        .cust-mgr {
          font-size: 12px;
          color: #64748b;
        }
        .fix-tag {
          display: inline-block;
          padding: 1px 6px;
          border-radius: 4px;
          background: #f1f5f9;
          color: #475569;
          font-size: 11.5px;
          font-weight: 700;
        }
        .fix-tag.is-fixed {
          background: #dcfce7;
          color: #166534;
        }
        .ship-empty-box,
        .ship-empty-cell {
          padding: 28px 14px !important;
          text-align: center !important;
          color: #64748b;
        }
        @media print {
          .print-hide {
            display: none !important;
          }
          .ship-split-grid {
            display: block;
          }
          .ship-panel {
            max-height: none;
            min-height: 0;
            border: 1px solid #94a3b8;
          }
          .ship-table-scroll {
            overflow: visible;
          }
        }
      `}</style>
    </div>
  );
}
