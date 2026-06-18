import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  catalogImagePanRange,
  catalogImageStageStyle,
  catalogImageStyle,
  resolveCatalogImageTransform,
} from '../../lib/catalogImagePosition';

function readImageAspect(el) {
  const w = el?.naturalWidth;
  const h = el?.naturalHeight;
  if (w > 0 && h > 0) return w / h;
  return null;
}

/** 편집기·미리보기·PPT 미러 공용 이미지 렌더 — 로드된 비율로 캔버스와 동일 배치 */
export default function CatalogSlideImage({
  source,
  src,
  alt = '',
  className = '',
  onPanRange,
}) {
  const [aspect, setAspect] = useState(null);
  const imgRef = useRef(null);

  const applyAspect = useCallback((el) => {
    const next = readImageAspect(el);
    if (next) setAspect(next);
  }, []);

  useEffect(() => {
    setAspect(null);
  }, [src]);

  // 캐시된 이미지는 onLoad가 안 뜰 수 있음 — ref·Image()로 비율 확보
  useEffect(() => {
    if (!src || typeof window === 'undefined') return;
    applyAspect(imgRef.current);
    let cancelled = false;
    const probe = new window.Image();
    const onReady = () => {
      if (!cancelled) applyAspect(probe);
    };
    probe.onload = onReady;
    probe.src = src;
    if (probe.complete) onReady();
    return () => { cancelled = true; };
  }, [src, applyAspect]);

  const transform = useMemo(() => resolveCatalogImageTransform(source), [source]);
  const { scale } = transform;

  useEffect(() => {
    if (!aspect || !onPanRange) return;
    onPanRange(catalogImagePanRange(aspect, scale));
  }, [aspect, scale, onPanRange]);

  if (!src) return null;

  return (
    <div className={`catalog-slide-img-inner ${className}`.trim()}>
      <div className="catalog-img-stage" style={catalogImageStageStyle(source)}>
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          style={catalogImageStyle(source, aspect)}
          draggable={false}
          onLoad={(e) => applyAspect(e.currentTarget)}
        />
      </div>
    </div>
  );
}
