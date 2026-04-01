import { useState, useEffect } from 'react';
import { apiGet } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

export default function Codes() {
  const { t } = useLang();
  const [tab, setTab] = useState(0);
  const [data, setData] = useState({ countries: [], flowers: [], farms: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet('/api/master', { entity: 'codes' })
      .then(d => setData({ countries: d.countries || [], flowers: d.flowers || [], farms: d.farms || [] }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const tabs = ['국가', '꽃', '농장'];

  return (
    <div>
      <div className="tabs">
        {tabs.map((t, i) => <div key={t} className={`tab-item ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>{['🌍', '🌸', '🌾'][i]} {t}</div>)}
      </div>
      <div className="card">
        <div className="card-header">
          <span className="card-title">{tabs[tab]} 목록</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn btn-primary btn-sm">💾 저장 / Guardar</button>
            <button className="btn btn-secondary btn-sm" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기 / Cerrar</button>
          </div>
        </div>
        {loading ? <div className="skeleton" style={{ margin: 16, height: 300, borderRadius: 8 }}></div> : (
          <>
            {tab === 0 && (
              <table className="tbl">
                <thead><tr><th>No</th><th>국가명</th><th style={{ textAlign: 'center' }}>꽃선택여부</th><th style={{ textAlign: 'center' }}>주문코드여부</th><th style={{ textAlign: 'right' }}>순번</th></tr></thead>
                <tbody>
                  {data.countries.map(c => (
                    <tr key={c.CounKey}>
                      <td style={{ fontFamily: 'var(--mono)', color: 'var(--text3)', fontSize: 12 }}>{c.CounKey}</td>
                      <td className="name">{c.CounName}</td>
                      <td style={{ textAlign: 'center' }}><input type="checkbox" defaultChecked={c.isSelectFlower} /></td>
                      <td style={{ textAlign: 'center' }}><input type="checkbox" defaultChecked={c.isUseOrderCode} /></td>
                      <td className="num"><input type="number" defaultValue={c.Sort} style={{ width: 60, height: 24, border: '1px solid var(--border2)', borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 4px', background: 'var(--bg)' }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 1 && (
              <table className="tbl">
                <thead><tr><th>꽃 종류명</th><th style={{ textAlign: 'right' }}>정렬순번</th></tr></thead>
                <tbody>
                  {data.flowers.map(f => (
                    <tr key={f.FlowerKey}>
                      <td><input className="form-control" defaultValue={f.FlowerName} style={{ height: 28, fontSize: 13, width: 180 }} /></td>
                      <td className="num"><input type="number" defaultValue={f.Sort} style={{ width: 60, height: 24, border: '1px solid var(--border2)', borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 4px', background: 'var(--bg)' }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 2 && (
              <table className="tbl">
                <thead><tr><th>농장명</th><th>국가</th></tr></thead>
                <tbody>
                  {data.farms.map(f => (
                    <tr key={f.FarmKey}>
                      <td><input className="form-control" defaultValue={f.FarmName} style={{ height: 28, fontSize: 13, width: 200 }} /></td>
                      <td><span className="badge badge-gray">{f.CounName}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
