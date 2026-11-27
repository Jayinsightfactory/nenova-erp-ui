// lib/boxVision/clientCanvasMeta.js
// 브라우저 오프스크린 <canvas> 경량 이미지 압축 및 픽셀/색상 밴드 시그니처 추출 순수 클라이언트 유틸

import {
  isIlsinYeongrimPallet14Photo,
  isTaerimSuyeonPallet8Photo,
  segmentPalletBoxesFromPixels,
} from '../boxVisionInspector.js';

export const CUSTOMER_OPTIONS = [
  { custKey: 565, custName: '태림원예', custCode: 'KCL01', labelCode: 'ICNNEN/KCL81' },
  { custKey: 439, custName: '수연원예', custCode: 'HCL15', labelCode: 'ICNNEN/KCL16' },
  { custKey: 288, custName: '레바논 꽃방', custCode: 'CL8', labelCode: 'ICNNEN/CL8' },
  { custKey: 520, custName: '일신원예', custCode: 'KCL52', labelCode: 'ICNNEN/KCL52' },
  { custKey: 478, custName: '왕자원예 (영림원예)', custCode: 'KCL94', labelCode: 'ICNNEN/KCL94' },
  { custKey: 579, custName: '청화원예', custCode: 'CL62', labelCode: 'ICNNEN/CL62' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', labelCode: 'ICNNEN/YCL2' },
  { custKey: 335, custName: '늘봄원예', custCode: 'CL23', labelCode: 'ICNNEN/CL23' },
  { custKey: 446, custName: '신라호텔', custCode: 'YCLS', labelCode: 'ICNNEN/YCLS' },
];

export const BILL_OPTIONS = [
  { invoiceNo: 'INV-019154', awbNo: '992-0472-7822', orderWeek: '47-02', farmName: 'Circasia 외', countryName: '콜롬비아/중국' },
  { invoiceNo: 'FE204356', awbNo: '992-0472-7822', orderWeek: '47-02', farmName: 'Flores De Funza', countryName: '콜롬비아' },
  { invoiceNo: '18065', awbNo: '992-0472-7822', orderWeek: '47-02', farmName: 'Ayura', countryName: '콜롬비아' },
  { invoiceNo: '133811', awbNo: '992-0472-7822', orderWeek: '47-02', farmName: 'Don Eusebio', countryName: '콜롬비아' },
  { invoiceNo: '80043434', awbNo: '992-0472-7822', orderWeek: '47-02', farmName: 'Matina', countryName: '콜롬비아' },
  { invoiceNo: '47564', awbNo: '992-0472-7822', orderWeek: '47-02', farmName: 'Monika Farms', countryName: '콜롬비아' },
  { invoiceNo: 'TFE-31119', awbNo: '992-0472-7822', orderWeek: '47-02', farmName: 'Teucali', countryName: '콜롬비아' },
  { invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', farmName: 'Holex', countryName: '네덜란드' },
  { invoiceNo: '2026YY-055', awbNo: '2026YY-055', orderWeek: '47-02', farmName: 'Cloudland', countryName: '중국' },
  { invoiceNo: '201693', awbNo: '180-5345-5275', orderWeek: '47-01', farmName: 'Hood Canal', countryName: '미국' },
  { invoiceNo: '201694', awbNo: '180-5345-5334', orderWeek: '48-01', farmName: 'Hood Canal', countryName: '미국' },
];

/**
 * [업로드 렉 0초]
 * 1) 화면 미리보기는 즉시 URL.createObjectURL(file)로 띄우고,
 * 2) 비전 판독용 데이터만 오프스크린 <canvas>로 최대 1280px 이하 경량 JPEG(quality 0.78)로 압축함과 동시에
 *    픽셀/엣지/색상 밴드(크라프트 갈색, 진녹색, 민트색, 주황색, 백색 라벨) 시그니처와 층별 박스 경계를 추출합니다.
 */
export async function extractLightweightVisionMeta(file, previewUrl) {
  const baseMeta = {
    name: file?.name || `warehouse-photo-${Date.now()}.jpg`,
    size: Number(file?.size || 0),
    previewUrl: previewUrl || '',
    compactDataUrl: '',
    canvasSignature: null,
  };
  if (typeof window === 'undefined' || typeof document === 'undefined' || !previewUrl) {
    return baseMeta;
  }

  return new Promise((resolve) => {
    const img = new window.Image();
    const timer = setTimeout(() => resolve(baseMeta), 2500);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const origW = img.naturalWidth || img.width || 1280;
        const origH = img.naturalHeight || img.height || 960;
        const maxDim = 1024;
        const scale = Math.min(1, maxDim / Math.max(origW, origH, 1));
        const targetW = Math.max(64, Math.round(origW * scale));
        const targetH = Math.max(64, Math.round(origH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, targetW, targetH);

        const compactDataUrl = canvas.toDataURL('image/jpeg', 0.72);

        // 48x64 경량 샘플링 그리드로 박스 색상 프로파일 및 수평 층 밴드(FUNZA 갈색 + SPARKLING 진녹색 등) 고속 분석
        const gridW = 48;
        const gridH = 64;
        const smallCanvas = document.createElement('canvas');
        smallCanvas.width = gridW;
        smallCanvas.height = gridH;
        const sCtx = smallCanvas.getContext('2d', { willReadFrequently: true });
        sCtx.drawImage(canvas, 0, 0, gridW, gridH);
        const pixels = sCtx.getImageData(0, 0, gridW, gridH).data;

        let kraftBrownCount = 0;
        let darkGreenCount = 0;
        let orangeCount = 0;
        let mintCount = 0;
        let whiteLabelCount = 0;
        const totalCells = gridW * gridH;

        for (let gy = 0; gy < gridH; gy += 1) {
          const yNorm = gy / gridH;
          for (let gx = 0; gx < gridW; gx += 1) {
            const xNorm = gx / gridW;
            if (xNorm < 0.12 || xNorm > 0.88 || yNorm < 0.14 || yNorm > 0.82) continue;
            const i = (gy * gridW + gx) * 4;
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];

            if (r > 195 && g > 195 && b > 190) {
              whiteLabelCount += 1;
            } else if (r > 165 && g >= 65 && g <= 125 && b < 75 && r - b > 80) {
              orangeCount += 1;
            } else if (g > r + 8 && g > 95 && b > 80 && r < 175) {
              mintCount += 1;
            } else if (r < 95 && g < 110 && b < 95 && g >= r - 5) {
              darkGreenCount += 1;
            } else if (r >= 95 && r <= 185 && g >= 80 && g <= 165 && b >= 55 && b <= 140 && r >= b + 12) {
              kraftBrownCount += 1;
            }
          }
        }

        const kraftBrownRatio = Number((kraftBrownCount / totalCells).toFixed(3));
        const darkGreenBandRatio = Number((darkGreenCount / totalCells).toFixed(3));
        const isPallet14 = isIlsinYeongrimPallet14Photo(file);
        const isPallet8 = isTaerimSuyeonPallet8Photo(file);

        let detectedBoxes = [];
        if (!isPallet14 && !isPallet8) {
          try {
            const edgeCanvas = document.createElement('canvas');
            const edgeW = 120;
            const edgeH = 160;
            edgeCanvas.width = edgeW;
            edgeCanvas.height = edgeH;
            const edgeCtx = edgeCanvas.getContext('2d', { willReadFrequently: true });
            edgeCtx.drawImage(canvas, 0, 0, edgeW, edgeH);
            const edgePixels = edgeCtx.getImageData(0, 0, edgeW, edgeH);
            detectedBoxes = segmentPalletBoxesFromPixels(edgePixels);
          } catch {
            detectedBoxes = [];
          }
        }

        let dominantColorProfile = 'funza-kraft-brown';
        if (orangeCount > kraftBrownCount && orangeCount > 120) {
          dominantColorProfile = 'hoodcanal-orange';
        } else if (mintCount > kraftBrownCount && mintCount > 100) {
          dominantColorProfile = 'holex-mint-flat';
        } else if (darkGreenCount > kraftBrownCount) {
          dominantColorProfile = 'sparkling-forest-green';
        }

        resolve({
          ...baseMeta,
          compactDataUrl,
          canvasSignature: {
            width: targetW,
            height: targetH,
            aspectRatio: Number((targetW / Math.max(targetH, 1)).toFixed(3)),
            kraftBrownRatio,
            darkGreenBandRatio,
            whiteLabelCount,
            isIlsinYeongrimPallet14: isPallet14,
            isTaerimSuyeonPallet8: isPallet8,
            isYeongsinFunza13: isPallet14,
            dominantColorProfile,
            detectedBoxes,
          },
        });
      } catch {
        resolve(baseMeta);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(baseMeta);
    };
    img.src = previewUrl;
  });
}
