import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import CatalogPreviewPages, { CATALOG_PREVIEW_STYLES } from '../../components/catalog/CatalogPreviewPages';
import { absCatalogUrl } from '../../lib/catalogUtils';

const STORAGE_KEY = 'nenovaCatalogDraft';

export default function CatalogPreviewPage() {
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    const read = () => {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) { setDraft(null); return; }
        const parsed = JSON.parse(raw);
        if (parsed.lines) {
          parsed.lines = parsed.lines.map(l => ({
            ...l,
            imageUrl: absCatalogUrl(l.imageUrl),
          }));
        }
        setDraft(parsed);
      } catch {
        setDraft(null);
      }
    };
    read();
    window.addEventListener('storage', read);
    const t = setInterval(read, 1500);
    return () => {
      window.removeEventListener('storage', read);
      clearInterval(t);
    };
  }, []);

  const pageCount = draft?.lines?.length
    ? Math.ceil(draft.lines.length / ((draft.perPage || 8) === 6 ? 6 : 8))
    : 0;

  return (
    <>
      <Head>
        <title>{draft?.catalogTitle || '카탈로그'} — 미리보기</title>
        <style>{CATALOG_PREVIEW_STYLES}</style>
      </Head>

      <div className="preview-toolbar no-print">
        <Link href="/catalog" className="preview-link">← 편집</Link>
        <strong>카탈로그 미리보기</strong>
        <span>{draft?.lines?.length || 0}품목 · {pageCount}페이지 · A4 가로</span>
        <button type="button" onClick={() => window.open('/catalog/print', 'catalogPrint', 'width=1100,height=820')}>
          🖨 인쇄/PDF
        </button>
      </div>

      {!draft?.lines?.length ? (
        <div style={{ padding: 32, textAlign: 'center', fontFamily: 'Malgun Gothic, sans-serif' }}>
          <p>담긴 품목이 없습니다.</p>
          <p style={{ color: '#666', fontSize: 14 }}>카탈로그 작성 화면에서 품목을 선택하면 여기에 실시간 반영됩니다.</p>
          <Link href="/catalog">카탈로그 작성으로 이동</Link>
        </div>
      ) : (
        <CatalogPreviewPages draft={draft} mode="preview" />
      )}

      <style jsx global>{`
        .preview-toolbar {
          position: sticky; top: 0; z-index: 10;
          display: flex; align-items: center; gap: 14px;
          padding: 10px 16px; background: #1a3a6b; color: #fff;
          font-family: 'Malgun Gothic', sans-serif; font-size: 13px;
        }
        .preview-toolbar button {
          margin-left: auto; padding: 8px 14px; border: none; border-radius: 4px;
          background: #0066cc; color: #fff; font-weight: 600; cursor: pointer;
        }
        .preview-link { color: #aad4ff; text-decoration: none; }
        .preview-link:hover { text-decoration: underline; }
      `}</style>
    </>
  );
}
