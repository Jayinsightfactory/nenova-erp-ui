import { useState } from 'react';
import { CATALOG_STYLE_STORAGE_KEY, normalizeCatalogLayoutSettings } from '../../lib/catalogLayout';
import { normalizeCatalogFields } from '../../lib/catalogLineText';

export default function CatalogStyleSettings({ fields, onChange }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const f = normalizeCatalogFields(fields);
  const layout = normalizeCatalogLayoutSettings(f.layout);
  const update = (patch) => { onChange({ ...f, layout: normalizeCatalogLayoutSettings({ ...layout, ...patch }) }); setMessage(''); };
  const saveDefaults = () => {
    try {
      localStorage.setItem(CATALOG_STYLE_STORAGE_KEY, JSON.stringify({ fontSizes: f.fontSizes, layout }));
      setMessage('이 브라우저의 기본값으로 저장했습니다. 저장본은 해당 저장본의 설정이 우선합니다.');
    } catch { setMessage('기본값 저장 실패: 브라우저 저장 공간을 확인해주세요.'); }
  };
  const loadDefaults = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(CATALOG_STYLE_STORAGE_KEY) || 'null');
      if (!saved) { setMessage('저장한 기본값이 없습니다.'); return; }
      onChange({ ...f, fontSizes: normalizeCatalogFields(saved).fontSizes, layout: normalizeCatalogLayoutSettings(saved.layout) });
      setMessage('저장한 기본값을 현재 카탈로그에 적용했습니다.');
    } catch { setMessage('저장한 기본값을 읽지 못했습니다.'); }
  };
  return <>
    <button type="button" className="btn btn-primary" aria-expanded={open} onClick={() => setOpen(!open)}>슬라이드 설정</button>
    {open && <aside className="catalog-style-settings" aria-label="슬라이드 이미지·글씨 설정">
      <header><strong>슬라이드 이미지·글씨 설정</strong><button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>닫기</button></header>
      <p>현재 카탈로그 전체에 즉시 적용 · 미리보기/인쇄/PPT 동일</p>
      <h3>이미지 영역</h3>
      <label>칸 모양<select aria-label="이미지 칸 모양" value={layout.frame} onChange={e => update({ frame: e.target.value })}><option value="square">정사각형 유지</option><option value="fill">남는 영역 채우기</option></select></label>
      <button type="button" className="btn btn-sm" onClick={() => update({ frame: 'fill', top: 0, bottom: 0, side: 0, hgap: 0, vgap: 0, txtGap: 0, imageSize: 100, imageX: 50, imageY: 0, showHeader: false })}>여백 없이 이미지 최대화</button>
      <p>채우기는 사진 비율을 유지하며 가장자리를 자릅니다. 사진 내부 위치는 이미지 클릭 후 조절하세요.</p>
      {[
        ['imageSize', '이미지 크기', 20, layout.frame === 'square' ? 200 : 100], ['imageX', '가로 위치', 0, 100], ['imageY', '세로 위치', 0, 100],
      ].map(([key, label, min, max]) => <label key={key}>{label}<input aria-label={label} type="range" min={min} max={max} value={layout[key]} onChange={e => update({ [key]: Number(e.target.value) })}/><output>{layout[key]}%</output></label>)}
      <p>위치: 가로 0% 왼쪽 / 100% 오른쪽, 세로 0% 위 / 100% 아래. 꽉 찬 축은 크기를 줄이면 이동 공간이 생깁니다.</p>
      <p role="status">100%까지 사진 칸 크기를 조절합니다. 100% 초과는 정사각형 안의 사진을 확대하며 가장자리가 잘립니다. 글씨와는 최소 간격만 유지합니다.</p>
      <h3>슬라이드 여백·간격 (cm)</h3>
      <label className="check"><input type="checkbox" checked={layout.showHeader} onChange={e => update({ showHeader: e.target.checked })}/>제목·원산지·로고 표시</label>
      <div className="number-grid">{[
        ['top', '위 여백', 3.5, 6], ['bottom', '아래 여백', 0.3, 4], ['side', '좌우 여백', 0.4, 6],
        ['hgap', '가로 간격', 0.3, 2], ['vgap', '세로 간격', 0.3, 2], ['txtGap', '사진·글씨 간격', 0.05, 1],
      ].map(([key, label, fallback, max]) => <label key={key}>{label}<input aria-label={label} type="number" min="0" max={max} step="0.05" placeholder={`자동 ${fallback}`} value={layout[key] ?? ''} onChange={e => update({ [key]: e.target.value === '' ? null : Number(e.target.value) })}/></label>)}</div>
      {layout.showHeader && layout.top !== null && layout.top < 3.5 && <p role="status">위 여백이 작으면 제목·로고가 이미지에 겹칠 수 있습니다. 제목 표시를 끄거나 위 여백을 늘려주세요.</p>}
      <h3>항목별 기본 글씨 크기 (pt)</h3>
      <div className="number-grid">{[['eng','영문명'],['kor','한글명'],['price','단가'],['extra1','기타1'],['extra2','기타2'],['extra3','기타3']].map(([key,label]) => <label key={key}>{label}<input aria-label={`${label} 글씨 크기`} type="number" min="6" max="48" step="1" value={fields?.fontSizes?.[key] ?? f.fontSizes[key]} onChange={e => onChange({ ...f, fontSizes: { ...f.fontSizes, [key]: e.target.value } })} onBlur={() => onChange(f)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/></label>)}</div>
      <p>현재 항목과 앞으로 입력하는 항목에 모두 적용됩니다. 항목 표시 여부는 상단 PPT표시에서 선택하세요.</p>
      <footer><button type="button" className="btn btn-primary" onClick={saveDefaults}>기본값 저장</button><button type="button" className="btn" onClick={loadDefaults}>기본값 불러오기</button><button type="button" className="btn" onClick={() => { onChange({ ...f, fontSizes: normalizeCatalogFields().fontSizes, layout: undefined }); setMessage('현재 설정을 초기화했습니다. 저장된 기본값은 유지됩니다.'); }}>초기 설정</button></footer>
      <p role="status">{message}</p>
    </aside>}
    <style jsx>{`
      .catalog-style-settings { position: fixed; top: 110px; left: 16px; bottom: 16px; width: 340px; max-width: calc(100vw - 32px); overflow-y: auto; z-index: 1100; background: white; color: #172033; border: 1px solid #94a3b8; border-radius: 8px; padding: 14px; box-sizing: border-box; box-shadow: 0 8px 28px #0003; }
      header { display:flex; align-items:center; justify-content:space-between; gap:8px; position:sticky; top:-14px; background:white; padding:8px 0; z-index:1; }
      h3 { font-size: 13px; margin: 16px 0 8px; border-top: 1px solid #e2e8f0; padding-top:10px; }
      p { font-size: 11px; line-height: 1.5; margin:8px 0; color:#526174; }
      label { display:flex; align-items:center; gap:6px; font-size:12px; margin:8px 0; }
      input[type=range] { flex:1; min-width:40px; }
      output { min-width:36px; }
      select { max-width:190px; padding:5px; }
      .number-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 12px; }
      .number-grid label { flex-direction:column; align-items:stretch; margin:2px 0; }
      input[type=number] { min-width:0; width:100%; box-sizing:border-box; padding:6px; border:1px solid #b8c5d6; border-radius:4px; }
      footer { display:flex; flex-wrap:wrap; gap:6px; margin-top:14px; }
      @media(max-height:650px) { .catalog-style-settings { top:55px; } }
    `}</style>
  </>;
}
