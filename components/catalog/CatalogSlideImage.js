import { catalogImageStageStyle, catalogImageStyle } from '../../lib/catalogImagePosition';

/** 편집기·미리보기·PPT 미러 공용 이미지 렌더 */
export default function CatalogSlideImage({ source, src, alt = '', className = '' }) {
  if (!src) return null;
  return (
    <div className={`catalog-slide-img-inner ${className}`.trim()}>
      <div className="catalog-img-stage" style={catalogImageStageStyle(source)}>
        <img src={src} alt={alt} style={catalogImageStyle(source)} draggable={false} />
      </div>
    </div>
  );
}
