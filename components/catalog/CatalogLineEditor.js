import { resolveCatalogProductNames } from '../../lib/catalogNameResolve';
import { fmtArrivalCostMeta, fmtArrivalDisplay, fmtPct, marginPct } from '../../lib/catalogUtils';

const KOR_SOURCE_LABEL = {
  catalog: '저장',
  display: 'DB',
  mapping: '매칭',
  suggest: '자동',
  none: '',
};

export default function CatalogLineEditor({
  lines,
  products,
  selectedLineId,
  onSelectLine,
  onUpdateLine,
  onRemoveLine,
  onApplyKor,
  onApplyKorAll,
  renderThumb,
  findProd,
  openPicker,
  costContext,
}) {
  return (
    <div className="catalog-line-editor">
      <div className="catalog-line-editor-toolbar">
        <span className="editor-title">⑤ 품목 텍스트 편집 ({lines.length})</span>
        <span className="editor-hint">
          PPT 슬롯에 배치된 품목만 · 상단 PPT표시 체크는 슬롯·인쇄·PPT에 즉시 반영
          {costContext?.displayWeek ? ` · 기준 ${costContext.displayWeek}` : ''}
          {costContext?.vatLabel ? ` · ${costContext.vatLabel}` : ''}
        </span>
        <button type="button" className="btn btn-sm btn-primary" onClick={onApplyKorAll} disabled={!lines.length}>
          한글명 일괄적용(매칭)
        </button>
      </div>
      <div className="catalog-line-editor-scroll">
        <table className="tbl catalog-line-table">
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              <th style={{ width: 40 }}>Img</th>
              <th style={{ minWidth: 100 }}>영문명</th>
              <th style={{ minWidth: 100 }}>한글명</th>
              <th style={{ width: 88 }}>단가</th>
              <th style={{ minWidth: 72 }}>기타1</th>
              <th style={{ minWidth: 72 }}>기타2</th>
              <th style={{ minWidth: 72 }}>기타3</th>
              <th style={{ width: 108 }}>도착원가</th>
              <th style={{ width: 48 }}>마진</th>
              <th style={{ width: 28 }} />
            </tr>
          </thead>
          <tbody>
            {!lines.length && (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', color: 'var(--text3)', padding: 20 }}>
                  PPT 슬라이드 칸에 배치된 품목만 표시됩니다
                </td>
              </tr>
            )}
            {lines.map(line => {
              const prod = findProd(products, line.prodKey) || line;
              const m = marginPct(line.arrivalCost, line.salePrice);
              const hint = resolveCatalogProductNames(prod, prod?.mappingKorName);
              const sourceLabel = KOR_SOURCE_LABEL[hint.korSource] || '';
              const active = selectedLineId === line.id;
              return (
                <tr
                  key={line.id}
                  className={active ? 'line-row active' : 'line-row'}
                  onClick={() => onSelectLine?.(line.id)}
                >
                  <td style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 10 }}>
                    {sourceLabel}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    {renderThumb(
                      { ...prod, ProdKey: line.prodKey, FlowerName: line.flowerName },
                      { size: 32, lineId: line.id, onClick: () => openPicker(prod, line.id) },
                    )}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <input
                      className="form-control"
                      style={{ width: '100%', fontSize: 11 }}
                      value={line.engName || ''}
                      placeholder={hint.engName || '영문명'}
                      onChange={e => onUpdateLine(line.id, { engName: e.target.value })}
                    />
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="kor-cell">
                      <input
                        className="form-control"
                        style={{ width: '100%', fontSize: 11 }}
                        value={line.korName || ''}
                        placeholder={hint.korName || hint.suggestedKor || '한글명'}
                        onChange={e => onUpdateLine(line.id, { korName: e.target.value })}
                      />
                      <button
                        type="button"
                        className="btn btn-sm"
                        title={`매칭 적용: ${hint.korName || hint.mappingKorName || hint.suggestedKor || '—'}`}
                        onClick={() => onApplyKor(line.id)}
                      >
                        ↵
                      </button>
                    </div>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <input
                      type="number"
                      className="form-control num"
                      style={{ width: '100%', fontSize: 11, textAlign: 'right' }}
                      value={line.salePrice || ''}
                      onChange={e => onUpdateLine(line.id, { salePrice: Number(e.target.value) || 0 })}
                    />
                  </td>
                  {[1, 2, 3].map(n => (
                    <td key={n} onClick={e => e.stopPropagation()}>
                      <input
                        className="form-control"
                        style={{ width: '100%', fontSize: 11 }}
                        value={line[`extra${n}`] || ''}
                        placeholder={`기타${n}`}
                        onChange={e => onUpdateLine(line.id, { [`extra${n}`]: e.target.value })}
                      />
                    </td>
                  ))}
                  <td className="arrival-cell" onClick={e => e.stopPropagation()}>
                    <div className="arrival-amt num">
                      {fmtArrivalDisplay(line.arrivalCost, line.arrivalUnit || line.saleUnit)}
                    </div>
                    <div className="arrival-meta">
                      {fmtArrivalCostMeta(
                        { ...prod, arrivalWeek: line.arrivalWeek, arrivalSource: line.arrivalSource, arrivalIsFallback: line.arrivalIsFallback },
                        costContext,
                      ).text}
                    </div>
                  </td>
                  <td className="num" style={{ fontSize: 10, color: m != null && m < 15 ? 'var(--red)' : 'var(--green)' }}>
                    {m != null ? fmtPct(m) : '—'}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => onRemoveLine(line.id)}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .catalog-line-editor {
          display: flex;
          flex-direction: column;
          min-height: 0;
          flex: 1;
          border-top: 2px solid var(--border2);
        }
        .catalog-line-editor-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          background: var(--header-bg);
          flex-shrink: 0;
          flex-wrap: wrap;
        }
        .editor-title { font-size: 12px; font-weight: 700; }
        .editor-hint { font-size: 10px; color: var(--text3); flex: 1; }
        .catalog-line-editor-scroll {
          flex: 1;
          min-height: 0;
          overflow: auto;
        }
        .catalog-line-table { font-size: 11px; }
        .catalog-line-table th {
          position: sticky;
          top: 0;
          background: var(--header-bg);
          z-index: 1;
          font-size: 10px;
        }
        .line-row { cursor: pointer; }
        .line-row.active { background: var(--blue-bg); }
        .line-row:hover { background: var(--blue-bg); }
        .kor-cell { display: flex; gap: 2px; align-items: center; }
        .kor-cell .btn { padding: 2px 6px; font-size: 11px; flex-shrink: 0; }
        .arrival-cell { font-size: 10px; vertical-align: top; }
        .arrival-amt { color: var(--amber); font-weight: 600; white-space: nowrap; }
        .arrival-meta { color: var(--text3); font-size: 9px; line-height: 1.2; margin-top: 2px; white-space: nowrap; }
      `}</style>
    </div>
  );
}
