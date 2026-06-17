import { useMemo } from 'react';
import {
  formatOriginLabel,
  layoutCssVars,
} from '../../lib/catalogLayout';
import { catalogImageStyle } from '../../lib/catalogImagePosition';
import { resolveCatalogPages } from '../../lib/catalogSlides';
import { absCatalogUrl } from '../../lib/catalogUtils';
import { buildCatalogCellLines, hasCatalogCellText, normalizeCatalogFields } from '../../lib/catalogLineText';
import { CATALOG_SLIDE_CSS } from './catalogSlideCss';

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
                      <div className="catalog-slide-img-inner">
                        <img src={absCatalogUrl(line.imageUrl)} alt="" style={catalogImageStyle(line)} />
                      </div>
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
        ${CATALOG_SLIDE_CSS}
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
