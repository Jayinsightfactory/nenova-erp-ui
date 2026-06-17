import { useEffect, useState } from 'react';
import Head from 'next/head';
import CatalogPreviewPages, { CATALOG_PREVIEW_STYLES, useCatalogPages } from '../../components/catalog/CatalogPreviewPages';
import { absCatalogUrl } from '../../lib/catalogUtils';

const STORAGE_KEY = 'nenovaCatalogDraft';

export default function CatalogPrintPage() {
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.lines) {
        parsed.lines = parsed.lines.map(l => ({
          ...l,
          imageUrl: absCatalogUrl(l.imageUrl),
          imagePosX: l.imagePosX ?? 50,
          imagePosY: l.imagePosY ?? 50,
        }));
      }
      setDraft(parsed);
    } catch { /* ignore */ }
  }, []);

  const pages = useCatalogPages(draft);

  if (!draft) {
    return (
      <div style={{ padding: 24, fontFamily: 'Malgun Gothic, sans-serif' }}>
        <p>카탈로그 데이터가 없습니다. 카탈로그 작성 화면에서 품목을 선택한 뒤 인쇄하세요.</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{draft.catalogTitle || 'NENOVA 카탈로그'}</title>
        <style>{CATALOG_PREVIEW_STYLES}</style>
      </Head>

      <div className="print-toolbar no-print">
        <button type="button" onClick={() => window.print()}>🖨 인쇄 / PDF 저장 (16:9)</button>
        <span>{draft.lines.length}품목 · {pages.length}슬라이드 · 16:9 ({draft.perPage || 8}개형)</span>
      </div>

      <CatalogPreviewPages draft={draft} mode="print" />

      <style jsx global>{`
        .print-toolbar {
          position: sticky; top: 0; z-index: 10;
          display: flex; align-items: center; gap: 12px;
          padding: 10px 16px; background: #333; color: #fff;
        }
        .print-toolbar button {
          padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;
          background: #0066cc; color: #fff; font-weight: 600;
        }
      `}</style>
    </>
  );
}
