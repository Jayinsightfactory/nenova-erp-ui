import { useCallback, useEffect, useState } from 'react';
import {
  catalogImagePanRange,
  catalogImageStageStyle,
  catalogImageStyle,
  resolveCatalogImageTransform,
} from '../../lib/catalogImagePosition';

/** 편집기·미리보기·PPT 미러 공용 이미지 렌더 — 로드된 비율로 캔버스와 동일 배치 */
export default function CatalogSlideImage({
  source,
  src,
  alt = '',
  className = '',
  onPanRange,
}) {
  const [aspect, setAspect] = useState(null);

  const handleLoad = useCallback((e) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (w > 0 && h > 0) setAspect(w / h);
  }, []);

  useEffect(() => {
    setAspect(null);
  }, [src]);

  const { scale } = resolveCatalogImageTransform(source);
  useEffect(() => {
    if (!aspect || !onPanRange) return;
    onPanRange(catalogImagePanRange(aspect, scale));
  }, [aspect, scale, onPanRange]);

  if (!src) return null;

  return (
    <div className={`catalog-slide-img-inner ${className}`.trim()}>
      <div className="catalog-img-stage" style={catalogImageStageStyle(source)}>
        <img
          src={src}
          alt={alt}
          style={catalogImageStyle(source, aspect)}
          draggable={false}
          onLoad={handleLoad}
        />
      </div>
    </div>
  );
}
