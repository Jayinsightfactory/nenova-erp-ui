import { useEffect, useRef, useState } from 'react';
import CatalogImagePicker from './CatalogImagePicker';
import { fetchCatalogImages } from '../../lib/catalogImageClient';
import { absCatalogUrl, pickPrimaryImageRecord } from '../../lib/catalogUtils';

// One instance per page, loading only the pointed/focused product. No ERP writes.
export default function ProductCatalogPhoto({ target, onClose }) {
  const [images, setImages] = useState([]);
  const [status, setStatus] = useState('loading');
  const wrapper = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const { product, editing, left, top } = target;
  const prodKey = product.ProdKey;
  useEffect(() => {
    let current = true;
    setImages([]);
    setStatus('loading');
    fetchCatalogImages(prodKey).then(data => {
      if (current) { setImages(data.images || []); setStatus('ready'); }
    }).catch(error => { if (current) setStatus(error.message); });
    return () => { current = false; };
  }, [prodKey]);
  useEffect(() => {
    if (editing && status === 'ready') wrapper.current?.querySelector('button')?.focus();
  }, [editing, status]);
  useEffect(() => {
    const previous = document.activeElement;
    if (editing) wrapper.current?.querySelector('button')?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (editing && event.key === 'Tab') {
        const controls = [...(wrapper.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])].filter(el => el.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (editing && previous?.isConnected) previous.focus();
    };
  }, [editing]);
  const image = pickPrimaryImageRecord({ [String(prodKey)]: images }, prodKey);
  if (editing) return <div ref={wrapper}>
    {status !== 'ready' && <div role="status" style={{ position:'fixed', top:8, left:8, zIndex:10001, background:'#fff', padding:8 }}>{status === 'loading' ? '사진 불러오는 중…' : status}</div>}
    {status === 'ready' && <CatalogImagePicker open prodKey={prodKey} prodLabel={product.DisplayName || product.ProdName}
      images={images} selectedImageId={image?.id} onClose={onClose}
      onImagesChange={(_, list) => setImages(list)} />}
    {status !== 'loading' && status !== 'ready' && <button onClick={onClose}>닫기</button>}
  </div>;
  return <div id="product-catalog-photo" role="tooltip" style={{ position:'fixed', left, top, zIndex:10000, width:'min(280px, calc(100vw - 16px))', padding:10, background:'#fff', color:'#172554', border:'1px solid #94a3b8', borderRadius:8, boxShadow:'0 4px 18px #0003', pointerEvents:'none' }}>
    <strong>{product.DisplayName || product.ProdName}</strong>
    {status === 'ready' && image ? <img src={absCatalogUrl(image.url)} alt={product.ProdName} style={{ width:'100%', height:220, objectFit:'contain', display:'block' }} />
      : <p>{status === 'loading' ? '사진 불러오는 중…' : status === 'ready' ? '연결된 카탈로그 사진이 없습니다.' : `사진 조회 실패: ${status}`}</p>}
    <small>클릭 또는 Enter: 카탈로그 공용 사진 관리</small>
  </div>;
}
