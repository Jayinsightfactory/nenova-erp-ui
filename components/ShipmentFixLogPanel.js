import {
  parseStockCalcProgressFromLogs,
  summarizeCategoryFixProgress,
} from '../lib/shipmentFixLogUtils.js';

export {
  parseCategoryFromFixDetail,
  parseStockCalcProgressFromDetail,
  parseStockCalcProgressFromLogs,
  summarizeCategoryFixProgress,
} from '../lib/shipmentFixLogUtils.js';

export default function ShipmentFixLogPanel({
  logs = [],
  action = 'unfix',
  emptyText = '서버 로그 수신 대기 중입니다.',
  helpText,
}) {
  const prog = parseStockCalcProgressFromLogs(logs);
  const categories = summarizeCategoryFixProgress(logs, action);
  const defaultHelp = action === 'unfix'
    ? '카테고리별 usp_ShipmentFixCancel → 품목별 usp_StockCalculation 순차 실행. item_error 로그의 pk= 품목을 확인하세요.'
    : '카테고리별 usp_ShipmentFix → 품목별 usp_StockCalculation 순차 실행.';

  return (
    <div style={{ border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden', flex:'1 1 auto', display:'flex', flexDirection:'column', minHeight:0 }}>
      <div style={{ padding:'7px 10px', background:'#fafafa', borderBottom:'1px solid #e0e0e0', fontSize:12, fontWeight:800, color:'#333', flex:'0 0 auto' }}>
        {action === 'unfix' ? '확정취소' : '확정'} 서버 로그
        {prog?.total ? (
          <span style={{ marginLeft:8, fontWeight:700, color: prog.isError ? '#c62828' : '#1565c0' }}>
            · 재고 재계산 {prog.done}/{prog.total}
            {prog.prodKey ? ` (pk=${prog.prodKey})` : ''}
          </span>
        ) : null}
      </div>
      {categories.length > 0 && (
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', padding:'8px 10px', background:'#fff', borderBottom:'1px solid #eee' }}>
          {categories.map((c) => {
            const bg = c.status === 'done' ? '#e8f5e9' : c.status === 'error' ? '#ffebee' : c.status === 'running' ? '#fff8e1' : '#f5f5f5';
            const color = c.status === 'done' ? '#2e7d32' : c.status === 'error' ? '#c62828' : c.status === 'running' ? '#ef6c00' : '#777';
            const mark = c.status === 'done' ? '✓' : c.status === 'error' ? '✗' : c.status === 'running' ? '…' : '○';
            return (
              <span key={c.label} style={{ background:bg, color, padding:'3px 8px', borderRadius:12, fontSize:11, fontWeight:700 }}>
                {mark} {c.label}
              </span>
            );
          })}
        </div>
      )}
      <div style={{ flex:'1 1 auto', minHeight:140, maxHeight:'none', overflowY:'auto', background:'#fff' }}>
        {logs.length === 0 ? (
          <div style={{ padding:'10px', fontSize:12, color:'#777' }}>{emptyText}</div>
        ) : logs.map((l, i) => {
          const isError = Boolean(l.IsError) || String(l.Step || '').includes('_error');
          return (
            <div key={`${l.CreateDtm}-${l.Step}-${i}`} style={{
              display:'grid',
              gridTemplateColumns:'82px 150px 1fr',
              gap:8,
              alignItems:'start',
              padding:'6px 10px',
              borderBottom:'1px solid #f1f1f1',
              fontSize:11,
              color: isError ? '#c62828' : '#333',
            }}>
              <span style={{ color:'#777', fontFamily:'var(--mono)' }}>{String(l.CreateDtm || '').slice(11, 19)}</span>
              <span style={{ fontWeight:800 }}>{l.Step || '-'}</span>
              <span style={{ wordBreak:'break-word', whiteSpace:'pre-wrap' }}>{l.Detail || ''}</span>
            </div>
          );
        })}
      </div>
      <div style={{ padding:'8px 10px', fontSize:11, color:'#666', lineHeight:1.55, background:'#fcfcfc', borderTop:'1px solid #eee' }}>
        {helpText || defaultHelp}
      </div>
    </div>
  );
}
