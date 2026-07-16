import { useMemo } from 'react';
import {
  estimateCatalogAutoTxtHcm,
  formatOriginLabel,
  layoutCssVars,
} from '../../lib/catalogLayout';
import { normalizeCatalogLineForRender } from '../../lib/catalogImagePosition';
import CatalogSlideImage from './CatalogSlideImage';
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

function CatalogSlidePage({ page, slideStyle, fields }) {
  const slots = page.slots || page.lines || [];

  return (
    <section className="catalog-slide" style={slideStyle}>
      <div className="catalog-slide-hdr">
        <span className="title-big">{page.titleBig}</span>
        {page.titleSmall ? (
          <span className="title-small">{formatOriginLabel(page.titleSmall)}</span>
        ) : null}
      </div>
      <img className="catalog-slide-logo" src="/nenova-logo.png" alt="" />

      <div className="catalog-slide-grid">
        {slots.map((line, idx) => {
          if (!line) {
            return <div key={`empty-${idx}`} className="catalog-slide-item catalog-slide-item-empty" aria-hidden />;
          }
          const renderLine = normalizeCatalogLineForRender(line);
          const cellLines = buildCatalogCellLines(renderLine, fields);
          return (
            <article key={line.id} className="catalog-slide-item">
              <div className="catalog-slide-img">
                {renderLine.imageUrl ? (
                  <CatalogSlideImage source={renderLine} src={absCatalogUrl(renderLine.imageUrl)} />
                ) : (
                  <span className="catalog-slide-ph">{renderLine.engName?.slice(0, 2) || '품'}</span>
                )}
              </div>
              {hasCatalogCellText(renderLine, fields) ? (
                <div className="catalog-slide-names">
                  {cellLines.map(row => (
                    <div
                      key={`${line.id}-${row.kind}`}
                      className={
                        row.kind === 'price' ? 'price-name'
                          : row.kind.startsWith('extra') ? 'extra-name'
                            : row.kind === 'kor' ? 'kor-name' : 'eng-name'
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
  );
}

export default function CatalogPreviewPages({ draft, mode }) {
  const pages = useCatalogPages(draft);
  if (!draft?.lines?.length) return null;

  const per = draft.perPage || 8;
  const fields = normalizeCatalogFields(draft);
  // 텍스트 줄수 기준 자동 여백 — 편집 화면·PPT와 동일 계산
  const allPlaced = pages.flatMap(pg => (pg.slots || pg.lines || []).filter(Boolean));
  const autoTxtH = estimateCatalogAutoTxtHcm(allPlaced, fields, per, draft.spacing || 'wide');
  const slideStyle = layoutCssVars(per, draft.spacing || 'wide', { txtHcm: autoTxtH });
  const isPreview = mode === 'preview';

  const slides = pages.map((page, pi) => (
    <CatalogSlidePage
      key={`${page.titleBig}-${page.titleSmall}-${pi}`}
      page={page}
      slideStyle={slideStyle}
      fields={fields}
    />
  ));

  return (
    <>
      {isPreview ? (
        <div className="catalog-preview-shell">
          <div className="catalog-preview-fit">{slides}</div>
        </div>
      ) : slides}

      <style jsx global>{`
        ${CATALOG_SLIDE_CSS}
        .catalog-slide-item-empty {
          visibility: hidden;
          pointer-events: none;
        }
        .catalog-preview-shell {
          display: flex;
          justify-content: center;
          padding: 16px;
          box-sizing: border-box;
          min-height: calc(100vh - 52px);
        }
        .catalog-preview-fit {
          zoom: 0.48;
          margin: 0 auto;
          width: fit-content;
        }
        @supports not (zoom: 1) {
          .catalog-preview-fit {
            transform: scale(0.48);
            transform-origin: top center;
          }
        }
      `}</style>
    </>
  );
}

export const CATALOG_PREVIEW_STYLES = `
  body { margin: 0; background: #e8e8e8; font-family: 'Malgun Gothic', 'Segoe UI', sans-serif; }
  @page { size: 33.867cm 19.05cm landscape; margin: 0; }
  @media print {
    .no-print { display: none !important; }
    html, body { background: #fff; margin: 0; padding: 0; }
    .catalog-slide {
      width: 33.867cm !important;
      height: 19.05cm !important;
      break-inside: avoid;
      page-break-after: always;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .catalog-slide:last-child {
      page-break-after: auto;
    }
  }
`;
