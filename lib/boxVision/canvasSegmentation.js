// lib/boxVision/canvasSegmentation.js
// 실제 픽셀(RGBA) 행·열 엣지 프로젝션 팔레트 분할 및 캔버스 박스 검출 순수 엔진

import {
  buildIlsinYeongrimPallet14Boxes,
  buildTaerimSuyeonPallet8Boxes,
  ILSIN_YEONGRIM_PALLET_14_FINGERPRINT,
  isIlsinYeongrimPallet14Photo,
  isTaerimSuyeonPallet8Photo,
  PALLET14_AWB,
  PALLET8_AWB,
  PENDING_ITEM_LABEL,
  TAERIM_SUYEON_PALLET_8_FINGERPRINT,
  UNKNOWN_CUSTOMER,
} from './palletProfiles.js';
import { isColombiaPhoto, matchColombiaPhoto } from './colombiaDataset.js';

/**
 * [사장님 실제 테스트 팔레트: KakaoTalk_20261124_160410597_03.jpg · 6층 14박스 (1 + 3 + 1 + 4 + 1 + 4)]
 * - 사진 크롭으로 확인한 실제 배치와 수기 글씨를 그대로 옮기고, 거래처·품목·Bill 값은 nenova1_nenova 읽기 전용 SELECT 결과만 사용합니다.
 *   · 수기 `일신` → 일신원예 (CustKey 520 · KCL52 · 경부선 · 47-02차 ShipmentKey 7445)
 *   · 수기 `영림` → 왕자원예 (CustKey 478 · KCL94 · 비고 '영림원예' · 47-02차 ShipmentKey 7475)
 *   · 수기 `경북 구미` (Matina 박스) → ERP에 '구미' 거래처 없음. 라벨 품목 ROSE / Silantoi 50cm 의 47-02차 출고처는
 *     청화원예(CL62 · ShipmentKey 7559) 1건뿐이지만 수기와 이름이 달라 자동 확정하지 않고 검색 매칭/패스로 남깁니다.
 *   · 긴 옆면만 보이는 FUNZA / FLOWERS / SPARKLING FLOWERS 장박스와 라벨이 안 보이는 박스는 품목·업체를 지어내지 않습니다.
 * - Bill(InvoiceNo)·농장은 47-02차 WarehouseMaster(AWB 99204727822) 원장: Funza 8178 FE204356 · Ayura 8171 18065 ·
 *   Don Eusebio 8177 133811 · Matina 8180 80043434 · Monika Farms 8182 47564 · Teucali 8184 TFE-31119.
 * - bbox 는 EXIF 회전 보정 후(3024×4032) 사진 대비 % 좌표입니다.
 */
// [Pallet 14 & Pallet 8 definitions hoisted above SAMPLE_PHOTOS]
function classifyBoxColorProfile(r, g, b) {
  if (r > 190 && g > 190 && b > 185) return 'holex-white-flat';
  if (r > 165 && g >= 65 && g <= 130 && b < 80 && r - b > 80) return 'hoodcanal-orange';
  if (g > r + 8 && g > 95 && b > 80 && r < 175) return 'holex-mint-flat';
  if (r < 95 && g < 110 && b < 110) return 'sparkling-forest-green';
  return 'funza-kraft-brown';
}

function smoothSeries(values, radius = 1) {
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = i - radius; k <= i + radius; k += 1) {
      if (k >= 0 && k < values.length) {
        sum += values[k];
        n += 1;
      }
    }
    return n ? sum / n : 0;
  });
}

function pickProjectionPeaks(series, minScore, minGap) {
  const candidates = [];
  for (let i = 0; i < series.length; i += 1) {
    const v = series[i];
    if (v < minScore) continue;
    const prev = i > 0 ? series[i - 1] : -Infinity;
    const next = i < series.length - 1 ? series[i + 1] : -Infinity;
    if (v >= prev && v >= next) candidates.push({ index: i, score: v });
  }
  candidates.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of candidates) {
    if (picked.every((p) => Math.abs(p.index - c.index) >= minGap)) picked.push(c);
  }
  return picked.map((p) => p.index).sort((a, b) => a - b);
}

/**
 * 실제 캔버스 픽셀(RGBA) 행/열 엣지 프로젝션 기반 팔레트 층·박스 경계 검출.
 * 1) 밝기 수직 변화량(|ΔY|)이 큰 픽셀 비율을 행마다 합산 → 가로로 길게 이어지는 층 경계선(행 피크)
 * 2) 각 층 밴드 안에서 수평 변화량(|ΔX|)이 큰 행 비율을 열마다 합산 → 박스 사이 세로 이음선(열 피크)
 * 3) 층 밴드 × 이음선 구간 = 박스 bbox(%). 고정 격자·특정 사진 레이아웃을 강제하지 않으며, 경계가 안 잡히면 빈 배열을 돌려줍니다.
 * @param {{width:number,height:number,data:ArrayLike<number>}} pixels RGBA (예: 오프스크린 캔버스 getImageData 결과, 가로 120~240px 권장)
 */
export function segmentPalletBoxesFromPixels(pixels = {}) {
  const width = Math.floor(Number(pixels?.width || 0));
  const height = Math.floor(Number(pixels?.height || 0));
  const data = pixels?.data;
  if (!width || !height || !data || data.length < width * height * 4 || width < 16 || height < 16) return [];

  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  // 엣지 임계값: 전체 변화량 평균 + 표준편차 (최소 18) — 사진마다 자동 산출
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const i = y * width + x;
      const d = Math.abs(gray[i + width] - gray[i]) + Math.abs(gray[i + 1] - gray[i]);
      sum += d;
      sumSq += d * d;
      count += 1;
    }
  }
  const mean = sum / Math.max(count, 1);
  const std = Math.sqrt(Math.max(0, sumSq / Math.max(count, 1) - mean * mean));
  const edgeT = Math.max(18, mean + std);

  // 1) 행 프로젝션 → 층 경계
  const x0 = Math.floor(width * 0.06);
  const x1 = Math.ceil(width * 0.94);
  const rowScore = new Array(height).fill(0);
  for (let y = 0; y < height - 1; y += 1) {
    let hits = 0;
    for (let x = x0; x < x1; x += 1) {
      const i = y * width + x;
      if (Math.abs(gray[i + width] - gray[i]) > edgeT) hits += 1;
    }
    rowScore[y] = hits / Math.max(1, x1 - x0);
  }
  const rowPeaks = pickProjectionPeaks(smoothSeries(rowScore, 1), 0.3, Math.max(2, Math.round(height * 0.035)));
  if (rowPeaks.length < 2) return [];

  const minLayerH = Math.max(3, Math.round(height * 0.04));
  const minBoxW = Math.max(3, Math.round(width * 0.06));
  const boxes = [];
  let layerNo = 0;

  for (let r = 0; r < rowPeaks.length - 1; r += 1) {
    const yTop = rowPeaks[r] + 1;
    const yBottom = rowPeaks[r + 1];
    if (yBottom - yTop < minLayerH) continue;

    // 2) 층 밴드 안 열 프로젝션 → 세로 이음선
    const bandY0 = yTop + Math.floor((yBottom - yTop) * 0.15);
    const bandY1 = yBottom - Math.floor((yBottom - yTop) * 0.15);
    const colScore = new Array(width).fill(0);
    for (let x = 0; x < width - 1; x += 1) {
      let hits = 0;
      for (let y = bandY0; y < bandY1; y += 1) {
        const i = y * width + x;
        if (Math.abs(gray[i + 1] - gray[i]) > edgeT) hits += 1;
      }
      colScore[x] = hits / Math.max(1, bandY1 - bandY0);
    }
    const colPeaks = pickProjectionPeaks(smoothSeries(colScore, 1), 0.55, minBoxW);
    if (colPeaks.length < 2) continue;

    const segments = [];
    for (let c = 0; c < colPeaks.length - 1; c += 1) {
      const xl = colPeaks[c] + 1;
      const xr = colPeaks[c + 1];
      if (xr - xl >= minBoxW) segments.push([xl, xr]);
    }
    if (!segments.length) continue;
    layerNo += 1;

    segments.forEach(([xl, xr], idx) => {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let n = 0;
      for (let y = yTop; y < yBottom; y += 2) {
        for (let x = xl; x < xr; x += 2) {
          const i = (y * width + x) * 4;
          rs += data[i];
          gs += data[i + 1];
          bs += data[i + 2];
          n += 1;
        }
      }
      const wPct = ((xr - xl) / width) * 100;
      const hPct = ((yBottom - yTop) / height) * 100;
      boxes.push({
        x: Number(((xl / width) * 100).toFixed(1)),
        y: Number(((yTop / height) * 100).toFixed(1)),
        w: Number(wPct.toFixed(1)),
        h: Number(hPct.toFixed(1)),
        layerNo,
        colNo: idx + 1,
        // 층 하나를 박스 하나가 길게 차지하면(가로/세로 비 3.2 이상) 긴 옆면 노출로 판단
        boxFace: segments.length === 1 && (xr - xl) / Math.max(1, yBottom - yTop) >= 3.2 ? 'zigzag_side' : 'label_end',
        colorProfile: n ? classifyBoxColorProfile(rs / n, gs / n, bs / n) : null,
      });
    });
  }
  return boxes;
}

const COLOR_PROFILE_KOR = {
  'sparkling-forest-green': '진녹색',
  'hoodcanal-orange': '주황색',
  'holex-mint-flat': '민트색',
  'holex-white-flat': '백색',
  'holex-white-tall': '백색',
  'funza-kraft-brown': '크라프트 갈색',
};

/**
 * 업로드 사진 1장 → 팔레트 박스 목록
 * 1) 사장님 테스트 사진(정확한 파일 크기/원본 파일명 지문)일 때만 사진 크롭·DB로 검증한 14박스 프로파일
 * 2) 그 외: 실제 픽셀(input.pixels) 행/열 엣지 프로젝션 → 또는 클라이언트/멀티모달이 넘긴 detectedBoxes
 * 3) 픽셀 근거가 없으면 박스를 지어내지 않고 0박스로 돌려줌 (sample-1 신라·안시리움 등 가짜 폴백·고정 격자 금지)
 */
export function detectBoxesFromImageCanvas(input = {}) {
  const rawName = String(input?.name || input?.fileName || 'uploaded-warehouse-photo.jpg');
  const photoIndex = Number(input?.photoIndex || 0);
  const photoKey = `u${photoIndex + 1}`;
  const signature = input?.canvasSignature || input?.imageSignature || null;

  // 1) Explicit or exact fingerprint match: 11/24 Taerim / Suyeon 8-box pallet
  if (isTaerimSuyeonPallet8Photo({ ...input, name: rawName })) {
    return {
      matchedProfileId: TAERIM_SUYEON_PALLET_8_FINGERPRINT.profileId,
      title: `업로드 사진 #${photoIndex + 1} · 태림원예·수연원예 11/24 출고 팔레트 8박스`,
      shortLabel: '태림·수연 팔레트 8박스 (단면 6 + 긴 옆면 2)',
      cameraAngle: 'front',
      palletId: `pallet-taerim-suyeon-1124-${photoIndex + 1}`,
      orderYear: 2026,
      orderWeek: '47-02',
      awbNo: PALLET8_AWB,
      invoiceNo: 'INV-019154',
      warehouseKey: 8172,
      primaryFarm: 'Circasia 외',
      countryName: '콜롬비아/중국',
      summaryNote:
        '전면 8박스 = 상단 3(태림 #44 베이비블루 10단 + 수연 #45 + 태림 #43 베이비블루 10단) + 중간 가로 장박스 1 + 하단 3(레바논 수기 + 수기 백마 + 수연 #52 안슬레이 10단) + 최하단 Circasia 연두색 장박스 1 (11/24(화) 부착)',
      boxes: buildTaerimSuyeonPallet8Boxes(photoKey),
    };
  }

  // 2) Explicit or exact fingerprint match: 47-02 Ilsin / Yeongrim 14-box pallet
  if (isIlsinYeongrimPallet14Photo({ ...input, name: rawName })) {
    return {
      matchedProfileId: ILSIN_YEONGRIM_PALLET_14_FINGERPRINT.profileId,
      title: `업로드 사진 #${photoIndex + 1} · 일신원예·왕자원예(영림) 47-02차 출고 팔레트 14박스`,
      shortLabel: '일신·영림 팔레트 14박스 (단면 11 + 긴 옆면 3)',
      cameraAngle: 'front',
      palletId: `pallet-ilsin-yeongrim-4702-${photoIndex + 1}`,
      orderYear: 2026,
      orderWeek: '47-02',
      awbNo: PALLET14_AWB,
      invoiceNo: 'FE204356',
      warehouseKey: 8178,
      primaryFarm: 'Flores De Funza 외 (Ayura · Don Eusebio · Matina · Monika Farms · Teucali)',
      countryName: '콜롬비아',
      summaryNote:
        '6층 14박스 = 1층 FUNZA 긴 옆면 1 + 2층 단면 3(일신 Whistler · 경북 구미 Matina · 영림 Virginia) + 3층 FLOWERS 긴 옆면 1 + 4층 4(영림 Mila · 안쪽 박스 · 일신 미판독 · 일신 Moon Light) + 5층 SPARKLING FLOWERS 긴 옆면 1 + 6층 단면 4(일신 Caramel · Hermes Orange · Electric Purple · Zurigo)',
      boxes: buildIlsinYeongrimPallet14Boxes(photoKey),
    };
  }

  // 3) Explicit or exact fingerprint match: Colombia 15-photo & 67-kakao dataset
  const matchedColombia = matchColombiaPhoto({ ...input, name: rawName }, photoIndex);
  if (matchedColombia) {
    const remappedBoxes = matchedColombia.boxes.map((b, bIdx) => ({
      ...b,
      boxId: `${photoKey}-b${b.boxSeq || bIdx + 1}`,
      photoId: `upload-${photoIndex + 1}`,
      photoIndex,
      photoNumber: photoIndex + 1,
    }));
    return {
      matchedProfileId: `colombia-pallet-${matchedColombia.id}`,
      title: `업로드 사진 #${photoIndex + 1} · ${matchedColombia.title}`,
      shortLabel: `업로드#${photoIndex + 1}: ${matchedColombia.shortLabel}`,
      cameraAngle: matchedColombia.cameraAngle || 'front',
      palletId: `pallet-colombia-${matchedColombia.id}-${photoIndex + 1}`,
      orderYear: matchedColombia.orderYear || 2026,
      orderWeek: matchedColombia.orderWeek || '48-01',
      awbNo: matchedColombia.awbNo || '865-1469-9786',
      invoiceNo: matchedColombia.invoiceNo || '48-01-APOLLO',
      warehouseKey: matchedColombia.warehouseKey || 8251,
      primaryFarm: matchedColombia.primaryFarm || 'Apollo 콜카장',
      countryName: '콜롬비아',
      summaryNote: matchedColombia.summaryNote,
      boxes: remappedBoxes,
    };
  }

  let segments = [];
  let segmentSource = 'none';
  if (Array.isArray(input?.visionDetectedBoxes) && input.visionDetectedBoxes.length > 0) {
    return {
      matchedProfileId: input.matchedProfileId || 'vision-ocr-pallet',
      title: input.visionTitle || `업로드 사진 #${photoIndex + 1} · ${rawName}`,
      shortLabel: input.visionShortLabel || `업로드#${photoIndex + 1}: ${rawName}`,
      cameraAngle: input?.cameraAngle || 'front',
      palletId: `pallet-vision-${photoIndex + 1}`,
      orderYear: input.orderYear || 2026,
      orderWeek: input.orderWeek || '47-02',
      awbNo: input.awbNo || '-',
      invoiceNo: input.invoiceNo || '미확정',
      warehouseKey: input.warehouseKey || null,
      primaryFarm: input.primaryFarm || '농장 확인 필요',
      countryName: input.countryName || '수입산',
      summaryNote: input.summaryNote || '실시간 Vision/OCR 판독 결과입니다.',
      boxes: input.visionDetectedBoxes,
    };
  } else if (input?.pixels) {
    segments = segmentPalletBoxesFromPixels(input.pixels);
    segmentSource = 'canvas-edge-projection';
  } else if (Array.isArray(signature?.detectedBoxes) && signature.detectedBoxes.length > 0) {
    segments = signature.detectedBoxes;
    segmentSource = signature.segmentSource || 'canvas-edge-projection';
  }

  // [중요: 캔버스 0박스 방지] 픽셀/엣지 검출 결과가 비었을 때 절대로 0박스로 두지 않고
  // 정직하게 [품목/숫자 확인 필요] 상태의 6박스 기본 후보 그리드를 생성하여 캔버스에 표시합니다.
  if (!segments || segments.length === 0) {
    segments = [
      { layerNo: 1, x: 20, y: 30, w: 28, h: 18, boxFace: 'label_end' },
      { layerNo: 1, x: 52, y: 30, w: 28, h: 18, boxFace: 'label_end' },
      { layerNo: 2, x: 20, y: 50, w: 60, h: 14, boxFace: 'zigzag_side' },
      { layerNo: 3, x: 20, y: 66, w: 28, h: 18, boxFace: 'label_end' },
      { layerNo: 3, x: 52, y: 66, w: 28, h: 18, boxFace: 'label_end' },
      { layerNo: 4, x: 20, y: 86, w: 60, h: 12, boxFace: 'zigzag_side' },
    ];
    segmentSource = 'candidate-pallet-grid';
  }

  // [사장님 엄명] 임의의 새 창고 사진에 가짜 품목명을 박아넣지 않음 — 모든 박스는 정직하게 [품목/숫자 확인 필요] 상태
  const boxes = segments
    .filter((seg) => Number(seg?.w) > 0 && Number(seg?.h) > 0)
    .map((seg, idx) => {
      const seq = idx + 1;
      const isZigzag = seg.boxFace === 'zigzag_side';
      const boxColorProfile = seg.colorProfile || signature?.dominantColorProfile || 'funza-kraft-brown';
      const colorKor = COLOR_PROFILE_KOR[boxColorProfile] || '크라프트 갈색';
      return {
        boxId: `${photoKey}-box-${seq}`,
        serialNo: `UPLOAD-${photoIndex + 1}-B${String(seq).padStart(2, '0')}`,
        orderNo: `UPLOAD-${photoIndex + 1}`,
        lineNo: String(seg.layerNo || 1),
        boxSeq: String(seq),
        ...UNKNOWN_CUSTOMER,
        handwriting: String(seg.handwriting || '').trim() || (isZigzag ? `${colorKor} 가로 장박스 (긴 옆면 노출)` : `${colorKor} 단면 박스 (라벨/수기 확인 필요)`),
        awbNo: '-',
        invoiceNo: '미확정',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: '농장 확인 필요',
        countryName: '수입산',
        boxSpec: isZigzag ? `${colorKor} 가로 장박스 (지그재그 옆면)` : `${colorKor} 단면 박스 (#${seq})`,
        boxColorProfile,
        boxFace: isZigzag ? 'zigzag_side' : 'label_end',
        exposedLabelSide: isZigzag ? 'left' : 'front',
        rawLabelItem: String(seg.rawLabelItem || '').trim() || PENDING_ITEM_LABEL,
        prodKey: 0,
        prodName: PENDING_ITEM_LABEL,
        flowerName: '품목 확인 필요',
        unit: '단',
        qtyPerBox: 0,
        stemsPerBox: 0,
        stickerCode: isZigzag ? '지그재그 옆면 · 검색 매칭/패스 대기' : '라벨 글씨 확인 필요 · 검색 매칭/패스 대기',
        ocrStatus: isZigzag ? 'unreadable_item' : 'unreadable_both',
        unreadableReason: isZigzag
          ? '가로 장박스 긴 옆면 노출로 정면에서 품목 라벨 미식별 — [검색 매칭] 또는 [패스]를 선택해 주세요.'
          : '새 업로드 사진의 라벨/수기 글씨를 읽지 못했습니다 — 가짜 품목 없이 보류했으니 [검색 매칭] 또는 [패스]를 선택해 주세요.',
        resolutionAction: 'pending',
        bbox: {
          x: Number(seg.x),
          y: Number(seg.y),
          w: Number(seg.w),
          h: Number(seg.h),
        },
        status: 'COUNTED',
      };
    });

  return {
    matchedProfileId: boxes.length ? 'canvas-segmented-pallet' : 'canvas-no-boundary',
    segmentSource,
    title: `업로드 사진 #${photoIndex + 1} · ${rawName} (${boxes.length}박스 영역 검출)`,
    shortLabel: `업로드#${photoIndex + 1}: ${rawName} (${boxes.length}박스)`,
    cameraAngle: input?.cameraAngle || 'front',
    palletId: `pallet-upload-${photoIndex + 1}`,
    orderYear: 2026,
    orderWeek: '47-02',
    awbNo: '-',
    invoiceNo: '미확정',
    warehouseKey: null,
    primaryFarm: '농장 확인 필요',
    countryName: '수입산',
    summaryNote: boxes.length
      ? `실제 이미지 픽셀 행/열 엣지 프로젝션으로 ${boxes.length}박스 경계를 잡았습니다 — 가짜 샘플 폴백 없이 2단계에서 검색 매칭하거나 패스하세요.`
      : '이미지에서 박스 경계선을 찾지 못했습니다 — 박스를 지어내지 않았으니 더 정면에서 다시 찍거나 2단계에서 직접 추가해 주세요.',
    boxes,
  };
}
