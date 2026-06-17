import { useMemo } from 'react';
import {
  formatOriginLabel,
  layoutCssVars,
} from '../../lib/catalogLayout';
import { catalogImageStyle } from '../../lib/catalogImagePosition';
import { resolveCatalogPages } from '../../lib/catalogSlides';
import { absCatalogUrl } from '../../lib/catalogUtils';
import { buildCatalogCellLines, hasCatalogCellText, normalizeCatalogFields } from '../../lib/catalogLineText';

export function useCatalogPages(draft) {
  return useMemo(() => {
    if (!draft?.lines?.length) return [];
    return resolveCatalogPages({
      lines: draft.lines,
      composerSlides: draft.composerSlides,
      perPage: draft.perPage || 8,
      imagesByProd: draft.imagesByProd,
    });
  }, [draft]);
}

export default function CatalogPreviewPages({ draft }) {
  const pages = useCatalogPages(draft);
  if (!draft?.lines?.length) return null;

  const per = draft.perPage || 8;
  const slideStyle = layoutCssVars(per, draft.spacing || 'wide');
  const fields = normalizeCatalogFields(draft);

  return (
    <>
      {pages.map((page, pi) => (
        <section
          key={`${page.titleBig}-${page.titleSmall}-${pi}`}
          className="catalog-slide"
          style={slideStyle}
        >
          <div className="catalog-slide-hdr">
            <span className="title-big">{page.titleBig}</span>
            {page.titleSmall ? (
              <span className="title-small">{formatOriginLabel(page.titleSmall)}</span>
            ) : null}
          </div>
          <img className="catalog-slide-logo" src="/nenova-logo.png" alt="" />

          <div className={`catalog-slide-grid per-${per}`}>
            {page.lines.map(line => {
              const cellLines = buildCatalogCellLines(line, fields);
              return (
                <article key={line.id} className="catalog-slide-item">
                  <div className="catalog-slide-img">
                    {line.imageUrl ? (
                      <img src={absCatalogUrl(line.imageUrl)} alt="" style={catalogImageStyle(line)} />
                    ) : (
                      <span className="catalog-slide-ph">{line.engName?.slice(0, 2) || '품'}</span>
                    )}
                  </div>
                  {hasCatalogCellText(line, fields) ? (
                    <div className="catalog-slide-names">
                      {cellLines.map(row => (
                        <div
                          key={`${line.id}-${row.kind}`}
                          className={
                            row.kind === 'price' ? 'price-name'
                              : row.kind.startsWith('extra') ? 'extra-name'
                                : 'eng-name'
                          }
                          style={row.kind.startsWith('extra') ? { fontSize: '10pt', color: '#000' } : undefined}
                        >
                          {row.text}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <style jsx global>{`
        .catalog-slide {
          width: var(--slide-w);
          height: var(--slide-h);
          margin: 12px auto;
          padding: 0;
          background: #fff;
          box-shadow: 0 2px 14px rgba(0,0,0,0.18);
          box-sizing: border-box;
          position: relative;
          overflow: hidden;
          font-family: 'Malgun Gothic', 'Segoe UI', sans-serif;
        }
        .catalog-slide-hdr {
          position: absolute;
          left: var(--hdr-left);
          top: var(--hdr-top);
          z-index: 2;
          max-width: calc(var(--slide-w) - var(--hdr-left) - var(--logo-w) - 0.6cm);
          line-height: 1.15;
        }
        .catalog-slide-hdr .title-big {
          font-size: var(--hdr-big-pt);
          font-weight: 700;
          color: #000;
        }
        .catalog-slide-hdr .title-small {
          font-size: var(--hdr-sub-pt);
          font-weight: 700;
          color: #000;
          margin-left: 0.35em;
        }
        .catalog-slide-logo {
          position: absolute;
          left: var(--logo-left);
          top: var(--logo-top);
          width: var(--logo-w);
          height: var(--logo-h);
          object-fit: contain;
          object-position: top right;
          z-index: 2;
        }
        .catalog-slide-grid {
          position: absolute;
          left: var(--grid-side);
          right: var(--grid-side);
          top: var(--grid-top);
          bottom: 0.3cm;
          display: grid;
          grid-template-columns: repeat(var(--grid-cols), 1fr);
          grid-template-rows: repeat(var(--grid-rows), 1fr);
          column-gap: var(--grid-hgap);
          row-gap: var(--grid-vgap);
        }
        .catalog-slide-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          min-height: 0;
          text-align: center;
        }
        .catalog-slide-img {
          width: var(--cell-img);
          height: var(--cell-img);
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #fff;
          overflow: hidden;
        }
        .catalog-slide-img img {
          width: 100%;
          height: 100%;
        }
        .catalog-slide-ph {
          font-size: 14pt;
          font-weight: 700;
          color: #bbb;
        }
        .catalog-slide-names {
          width: 100%;
          min-height: var(--txt-h);
          margin-top: var(--txt-gap);
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          gap: 0.05cm;
        }
        .catalog-slide-names .eng-name,
        .catalog-slide-names .kor-name {
          font-size: 14pt;
          font-weight: 700;
          color: #000;
          line-height: 1.2;
          word-break: keep-all;
          overflow-wrap: anywhere;
        }
        .catalog-slide-names .price-name {
          font-size: 12pt;
          font-weight: 700;
          color: #000;
          line-height: 1.2;
          margin-top: 0.05cm;
        }
        @media print {
          .catalog-slide {
            page-break-after: always;
            page-break-inside: avoid;
            box-shadow: none !important;
            margin: 0 auto !important;
          }
          .catalog-slide:last-child {
            page-break-after: auto;
          }
        }
      `}</style>
    </>
  );
}

export const CATALOG_PREVIEW_STYLES = `
  body { margin: 0; background: #e8e8e8; font-family: 'Malgun Gothic', 'Segoe UI', sans-serif; }
  @page { size: 33.867cm 19.05cm; margin: 0; }
  @media print {
    .no-print { display: none !important; }
    html, body { background: #fff; margin: 0; padding: 0; }
    .catalog-slide {
      break-inside: avoid;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
`;
