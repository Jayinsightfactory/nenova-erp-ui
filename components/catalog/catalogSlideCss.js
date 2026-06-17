/** PPT / 인쇄 / 편집기 공용 슬라이드·칸 CSS (layoutCssVars 필요) */
export const CATALOG_SLIDE_CSS = `
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
  .catalog-slide-img-inner {
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .catalog-slide-img-inner img {
    display: block;
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
  .catalog-slide-names .extra-name {
    font-size: 10pt;
    font-weight: 700;
    color: #000;
    line-height: 1.2;
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
`;
