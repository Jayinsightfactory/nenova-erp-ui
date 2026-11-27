import { sortDistributionCustomers } from '../../lib/shipmentDistributionWorkspace.js';
import {
  fmt,
  countryFlowerFromGroup,
  WEEK_SUFFIXES,
  DAY_NAMES,
  DAY_NAMES_TAB2,
} from '../../lib/shipmentDistributionPageHelpers.js';

export default function DistributionScheduleAndPivotTabs({
  tab,
  saveShipDayConfigs,
  shipDaySaving,
  shipDayLoading,
  prodGroups,
  shipDayConfigs,
  toggleShipDay,
  custList,
  loadTab2Items,
  tab2CustKey,
  tab2Loading,
  tab2Items,
  dateHeader,
  dateButton,
  prodGroup,
  selectedProdGroupLabel,
  loadPivotRows,
  pivotLoading,
  pivotRows,
}) {
  return (
    <>
      {tab === 2 && (
        <div style={{ border: '1px solid var(--border)', padding: 5, background: 'var(--surface)' }}>
          <p style={{ fontSize: 12, margin: '5px 0' }}>저장된 출고일을 조회합니다. 「분배·수정」에서 날짜별 수량을 입력하고 미리보기 후 저장하세요.</p>
          <details><summary style={{ cursor: 'pointer' }}>기본 출고요일 설정 (실제 출고일 저장과 별도)</summary>
            <div style={{ padding: '12px 16px', borderBottom: '2px solid var(--border)', background: '#F8FAFC' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>📅 품목그룹별 기본 출고요일 설정</span>
                <button className="btn btn-primary btn-sm" onClick={saveShipDayConfigs} disabled={shipDaySaving}>
                  {shipDaySaving ? '저장중...' : '💾 출고요일 저장'}
                </button>
                {shipDayLoading && <span style={{ fontSize: 11, color: 'var(--text3)' }}>로딩...</span>}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ fontSize: 12, minWidth: 600 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 180 }}>품목그룹</th>
                      {WEEK_SUFFIXES.map(s => (
                        <th key={s} colSpan={5} style={{ textAlign: 'center', color: 'var(--blue)' }}>
                          {s.replace('-', '') + '차'}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th></th>
                      {WEEK_SUFFIXES.map(s => DAY_NAMES.map(d => (
                        <th key={s + d} style={{ textAlign: 'center', fontSize: 11, width: 40, padding: '4px 2px' }}>{d}</th>
                      )))}
                    </tr>
                  </thead>
                  <tbody>
                    {prodGroups.map(pg => (
                      <tr key={pg.key}>
                        <td style={{ fontWeight: 600, fontSize: 12 }}>{pg.label}</td>
                        {WEEK_SUFFIXES.map(s => DAY_NAMES.map(d => {
                          const key = `${pg.key}|${s}`;
                          const checked = (shipDayConfigs[key] || '').split(',').includes(d);
                          return (
                            <td key={s + d} style={{ textAlign: 'center', padding: '3px 2px' }}>
                              <input type="checkbox" checked={checked}
                                onChange={() => toggleShipDay(pg.key, s, d)}
                                style={{ cursor: 'pointer', width: 16, height: 16 }} />
                            </td>
                          );
                        }))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
          <div className="distribution-workspace-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,20%) minmax(0,1fr)', gap: 5 }}>
            <div>
              {sortDistributionCustomers(custList).map(c => (
                <button type="button" key={c.CustKey} onClick={() => loadTab2Items(c.CustKey)} aria-pressed={tab2CustKey === c.CustKey}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px', background: tab2CustKey === c.CustKey ? 'var(--blue-bg)' : 'var(--surface)', border: '1px solid var(--border)' }}>{c.CustName}</button>
              ))}
            </div>
            <div style={{ minWidth: 0, overflowX: 'auto' }}>
              {tab2Loading ? '출고일 조회 중…' : !tab2CustKey ? '업체를 선택하세요' : (
                <table className="tbl">
                  <thead><tr><th>품목</th><th>출고수량</th><th style={{ padding: 0 }}>{dateHeader}</th></tr></thead>
                  <tbody>
                    {tab2Items.filter(item => Number(item.출고수량) > 0).map(item => (
                      <tr key={item.ProdKey}>
                        <td>{item.ProdName}</td>
                        <td className="num">{fmt(item.출고수량)} {item.OutUnit}</td>
                        <td>
                          {item._exeWeekGrid && <div style={{ fontSize: 11 }}>{DAY_NAMES_TAB2.filter(d => Number(item._dayByKr[d]) > 0).map(d => `${String(item._ymdByKr?.[d] || '').slice(0, 10)}(${d}) ${fmt(item._dayByKr[d])}`).join(' · ')}</div>}
                          {dateButton(tab2CustKey, item, item.ProdName)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 3 && (
        <div style={{ border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 8px 8px', background: 'var(--surface)' }}>
          <div style={{ padding: '8px 14px', background: '#F8FAFC', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>
              {countryFlowerFromGroup(prodGroup, prodGroups)
                ? `품목그룹 ${selectedProdGroupLabel} — 출고>0 집계 (nenova.exe GetPivotData)`
                : '품목그룹을 선택하고 조회하세요'}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={loadPivotRows} disabled={pivotLoading || !countryFlowerFromGroup(prodGroup, prodGroups)}>새로고침</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {pivotLoading ? (
              <div className="skeleton" style={{ margin: 16, height: 200, borderRadius: 8 }} />
            ) : (
              <table className="tbl" style={{ minWidth: 800, fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>국가</th><th>꽃</th><th>품목</th><th>거래처</th><th>지역</th><th>담당</th>
                    <th style={{ textAlign: 'right' }}>주문</th><th style={{ textAlign: 'right' }}>출고</th>
                  </tr>
                </thead>
                <tbody>
                  {pivotRows.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>데이터 없음</td></tr>
                  ) : pivotRows.map((r, i) => (
                    <tr key={`${r.CustName}-${r.ProdName}-${i}`}>
                      <td>{r.CounName}</td>
                      <td>{r.FlowerName}</td>
                      <td className="name">{r.ProdName}</td>
                      <td className="name">{r.CustName}</td>
                      <td>{r.CustArea}</td>
                      <td>{r.Manager}</td>
                      <td className="num">{(r.oOutQuantity ?? 0).toLocaleString()}</td>
                      <td className="num" style={{ fontWeight: 700, color: 'var(--blue)' }}>{(r.sOutQuantity ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
