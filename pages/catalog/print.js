import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { fmtNum } from '../../lib/catalogUtils';

const STORAGE_KEY = 'nenovaCatalogDraft';

export default function CatalogPrintPage() {
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setDraft(JSON.parse(raw));
    } catch (_) { /* ignore */ }
  }, []);

  const pages = useMemo(() => {
    if (!draft?.lines?.length) return [];
    const per = draft.perPage || 8;
    const cols = per === 6 ? 3 : 4;
    const rows = per === 6 ? 2 : 2;
    const chunk = cols * rows;
    const out = [];
    for (let i = 0; i < draft.lines.length; i += chunk) {
      out.push(draft.lines.slice(i, i + chunk));
    }
    return out;
  }, [draft]);

  const handlePrint = () => window.print();

  if (!draft) {
    return (
      <div style={{ padding: 24, fontFamily: 'Malgun Gothic, sans-serif' }}>
        <p>카탈로그 데이터가 없습니다. 카탈로그 작성 화면에서 품목을 선택한 뒤 인쇄하세요.</p>
      </div>
    );
  }

  return (
    <>
      <Head><title>{draft.catalogTitle || '카탈로그'} — 인쇄</title></Head>

      <div className="print-toolbar no-print">
        <button type="button" onClick={handlePrint}>🖨 인쇄 / PDF 저장</button>
        <span>{draft.lines.length}품목 · {pages.length}페이지</span>
      </div>

      {pages.map((pageLines, pi) => (
        <section key={pi} className="catalog-print-page">
          <header className="catalog-print-header">
            <div className="brand">NENOVA</div>
            <h1>{draft.catalogTitle || '카탈로그'}</h1>
            <div className="sub">
              {draft.custName && <span>{draft.custName}</span>}
              {draft.weekStart && (
                <span>{draft.orderYear} · {draft.weekStart}{draft.weekEnd && draft.weekEnd !== draft.weekStart ? ` ~ ${draft.weekEnd}` : ''}</span>
              )}
            </div>
          </header>
          <div className={`catalog-print-grid per-${draft.perPage || 8}`}>
            {pageLines.map(line => (
              <article key={line.id} className="catalog-print-item">
                <div className="thumb">
                  {line.imageUrl ? (
                    <img src={line.imageUrl} alt="" className="thumb-img" />
                  ) : (
                    line.flowerName?.slice(0, 2) || '품'
                  )}
                </div>
                <div className="names">
                  <div className="ko">{line.catalogName}</div>
                  <div className="meta">{line.counName} · {line.flowerName}</div>
                </div>
                <div className="price">
                  {fmtNum(line.salePrice) ? (
                    <><span className="amt">{fmtNum(line.salePrice)}</span><span className="unit">원 /{line.outUnit || '단'}</span></>
                  ) : (
                    <span className="amt pending">단가 문의</span>
                  )}
                </div>
              </article>
            ))}
          </div>
          <footer className="catalog-print-footer">페이지 {pi + 1} / {pages.length}</footer>
        </section>
      ))}

      <style jsx global>{`
        body { margin: 0; background: #e8e8e8; font-family: 'Malgun Gothic', 'Segoe UI', sans-serif; }
        .no-print { }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
          .catalog-print-page { page-break-after: always; box-shadow: none !important; margin: 0 !important; }
        }
        .print-toolbar {
          position: sticky; top: 0; z-index: 10;
          display: flex; align-items: center; gap: 12px;
          padding: 10px 16px; background: #333; color: #fff;
        }
        .print-toolbar button {
          padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;
          background: #0066cc; color: #fff; font-weight: 600;
        }
        .catalog-print-page {
          width: 297mm; min-height: 210mm; margin: 12px auto; padding: 12mm 14mm;
          background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.15);
          box-sizing: border-box;
        }
        .catalog-print-header { text-align: center; margin-bottom: 10mm; border-bottom: 2px solid #1a3a6b; padding-bottom: 6mm; }
        .catalog-print-header .brand { font-size: 11pt; letter-spacing: 4px; color: #1a3a6b; font-weight: 900; text-align: left; }
        .catalog-print-header h1 { font-size: 18pt; margin: 4px 0; color: #111; }
        .catalog-print-header .sub { font-size: 10pt; color: #666; display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; }
        .catalog-print-grid {
          display: grid; gap: 6mm;
        }
        .catalog-print-grid.per-8 { grid-template-columns: repeat(4, 1fr); }
        .catalog-print-grid.per-6 { grid-template-columns: repeat(3, 1fr); }
        .catalog-print-item {
          border: 1px solid #ccc; border-radius: 4px; padding: 4mm; text-align: center;
          display: flex; flex-direction: column; align-items: center; min-height: 42mm;
        }
        .catalog-print-item .thumb {
          width: 28mm; height: 22mm; background: #f5f5f5; border-radius: 3px;
          display: flex; align-items: center; justify-content: center;
          font-size: 14pt; font-weight: 700; color: #888; margin-bottom: 3mm;
          overflow: hidden;
        }
        .catalog-print-item .thumb-img {
          width: 100%; height: 100%; object-fit: contain; background: #fff;
        }
        .catalog-print-item .ko { font-size: 11pt; font-weight: 700; line-height: 1.3; }
        .catalog-print-item .meta { font-size: 8pt; color: #888; margin-top: 1mm; }
        .catalog-print-item .price { margin-top: auto; padding-top: 2mm; }
        .catalog-print-item .amt { font-size: 13pt; font-weight: 800; color: #0066cc; font-variant-numeric: tabular-nums; }
        .catalog-print-item .amt.pending { font-size: 10pt; color: #999; font-weight: 600; }
        .catalog-print-item .unit { font-size: 8pt; color: #666; margin-left: 2px; }
        .catalog-print-footer { text-align: center; font-size: 9pt; color: #aaa; margin-top: 8mm; }
      `}</style>
    </>
  );
}
