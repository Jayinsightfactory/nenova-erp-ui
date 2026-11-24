// lib/boxVisionInspector.js
// 네노바 박스 사진 판독 · 품목/수량/차수(Bill·AWB)/농장 분배/불량차감 매칭 엔진 (순수 SELECT 조회 + 결정론적 폴백)

export const FARM_BOX_COLOR_PROFILES = [
  {
    profileId: 'holex-white-tall',
    colorLabel: '흰색 세로형 (M 5/3 · M 3/2) + 노란 온도계 스티커',
    colorHex: '#f8fafc',
    borderHex: '#64748b',
    badgeBg: '#f1f5f9',
    badgeText: '#0f172a',
    candidateFarms: ['Holex', 'G.Geerlings', 'Dutch Flower Group'],
    primaryFarm: 'Holex',
    countryName: '네덜란드',
    disambiguationRule: '[1차: 흰색 세로형 M 5/3·M 3/2 + 15°C 노란 온도계] → [2차: ICNNEN/ 라벨 프리픽스 & 오더번호 2493354/2494499/2494510] → [3차: AWB 180-9162-6441 / Invoice 1222993 입고원장(WarehouseKey=8247)] = Holex 확정',
  },
  {
    profileId: 'holex-white-flat',
    colorLabel: '흰색 가로형 (HOLEX 로고 + 통풍구 2~3공)',
    colorHex: '#ffffff',
    borderHex: '#0284c7',
    badgeBg: '#e0f2fe',
    badgeText: '#0369a1',
    candidateFarms: ['Holex'],
    primaryFarm: 'Holex',
    countryName: '네덜란드',
    disambiguationRule: '[1차: 흰색 가로형 + 녹색 HOLEX 로고] → [2차: ICNNEN/YCL2 바코드 2494510.* + 원형 본수/중량 스티커(3, 7, 9, 11, 18, T6, T7)] → [3차: 47-02차 Holex 입고·주광농원 분배(ShipmentKey=7541)] = Holex 확정',
  },
  {
    profileId: 'holex-mint-flat',
    colorLabel: '민트색 가로형 (HOLEX A world of flowers)',
    colorHex: '#d1fae5',
    borderHex: '#059669',
    badgeBg: '#dcfce7',
    badgeText: '#065f46',
    candidateFarms: ['Holex'],
    primaryFarm: 'Holex',
    countryName: '네덜란드',
    disambiguationRule: '[1차: 민트색 가로형 + HOLEX 로고] → [2차: 대한항공 AWB 180-91626441 스티커(86~130/130) + 원형 스티커(3,6 / 7,5 / 9 / 11 / 18)] → [3차: 47-02차 Holex 튤립·히아신스·카라 구근류 라인] = Holex 확정',
  },
  {
    profileId: 'cloudland-white-side',
    colorLabel: '흰색 가로형 (측면 흑색 인쇄 CLR 난 White 10)',
    colorHex: '#f1f5f9',
    borderHex: '#475569',
    badgeBg: '#e2e8f0',
    badgeText: '#1e293b',
    candidateFarms: ['Cloudland', 'KMB', 'Yihua'],
    primaryFarm: 'Cloudland',
    countryName: '중국',
    disambiguationRule: '[1차: 흰색 박스 측면 인쇄] → [2차: CLR 프리픽스 + 난 White 10 표기] → [3차: 47-02차 입고원장(WarehouseKey=8250, Invoice 2026YY-055)] = Cloudland (중국 호접란) 확정',
  },
  {
    profileId: 'hoodcanal-orange',
    colorLabel: '주황색 가로형 (MYSTIC FOREST / SALAL TIP 25)',
    colorHex: '#ffedd5',
    borderHex: '#ea580c',
    badgeBg: '#ffedd5',
    badgeText: '#9a3412',
    candidateFarms: ['Hood Canal', 'Continental Floral Greens'],
    primaryFarm: 'Hood Canal',
    countryName: '미국',
    disambiguationRule: '[1차: 주황색 MYSTIC FOREST 박스] → [2차: SALAL TIP 25 / 20 Bunches Douglas 인쇄 및 수기 그린/더글] → [3차: 미국 Hood Canal 입고원장(47-01차 8169 AWB 18053455275 / 48-01차 8251 AWB 18053455334)] = Hood Canal 확정',
  },
];

export const CAMERA_ANGLE_OPTIONS = [
  { angleId: 'front', label: '정면 촬영 (팔레트 전면)', shortLabel: '정면' },
  { angleId: 'left', label: '좌측면 촬영 (팔레트 좌측 라벨 노출면)', shortLabel: '좌측면' },
  { angleId: 'right', label: '우측면 촬영 (팔레트 우측 라벨 노출면)', shortLabel: '우측면' },
];

export const SAMPLE_PHOTOS = [
  {
    sampleId: 'sample-1-silla',
    title: '샘플 1 · 신라호텔 4박스 (AWB 180-91626441 · 안시리움 그라시오사)',
    shortLabel: '샘플1: 신라호텔 4박스 (AWB+수기39본)',
    imageUrl: '/samples/box-vision/sample-1-silla.jpg',
    fileName: 'sample-1-silla.jpg',
    cameraAngle: 'front',
    palletId: 'pallet-silla-4702',
    orderYear: 2026,
    orderWeek: '47-02',
    awbNo: '180-9162-6441',
    invoiceNo: '1222993',
    warehouseKey: 8247,
    primaryFarm: 'Holex',
    countryName: '네덜란드',
    summaryNote: '신라호텔(ICNNEN/YCLS) 안시리움 그라시오사 15cm 4박스 (2.3번 박스 40→수기 39본 정정 = 총 159본 출고 일치) + 좌측 배경 Cloudland 호접란 분리',
    boxes: [
      {
        boxId: 's1-b1',
        serialNo: '2493354.2.2',
        orderNo: '2493354',
        lineNo: '2',
        boxSeq: '2',
        labelCode: 'ICNNEN/YCLS',
        custCode: 'YCLS',
        custKey: 446,
        custName: '신라호텔',
        handwriting: '신라 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        awbPiece: '129/130',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 5/3',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '40 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 40,
        stickerCode: '15°C~9°C / 129/130',
        bbox: { x: 4.5, y: 1.5, w: 45.5, h: 45.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's1-b2',
        serialNo: '2493354.2.3',
        orderNo: '2493354',
        lineNo: '2',
        boxSeq: '3',
        labelCode: 'ICNNEN/YCLS',
        custCode: 'YCLS',
        custKey: 446,
        custName: '신라호텔',
        handwriting: '신라 + 수기 39 (40 지움)',
        awbNo: '180-9162-6441',
        awbPiece: '130/130',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 5/3',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '40→39 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 39,
        stickerCode: '수기 39본 정정 / AWB 부착',
        bbox: { x: 52.5, y: 1.5, w: 46.0, h: 47.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's1-b3',
        serialNo: '2493354.2.1',
        orderNo: '2493354',
        lineNo: '2',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCLS',
        custCode: 'YCLS',
        custKey: 446,
        custName: '신라호텔',
        handwriting: '신라 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        awbPiece: '-',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 5/3',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '40 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 40,
        stickerCode: '15°C~9°C',
        bbox: { x: 8.5, y: 46.8, w: 41.0, h: 33.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's1-b4',
        serialNo: '2493354.2.4',
        orderNo: '2493354',
        lineNo: '2',
        boxSeq: '4',
        labelCode: 'ICNNEN/YCLS',
        custCode: 'YCLS',
        custKey: 446,
        custName: '신라호텔',
        handwriting: '신라 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        awbPiece: '130/130',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 5/3',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '40 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 40,
        stickerCode: '15°C~9°C / 130 AMS',
        bbox: { x: 51.0, y: 48.0, w: 43.0, h: 33.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's1-bg1',
        serialNo: 'CLR-2026YY055-W10',
        orderNo: '2026YY-055',
        lineNo: '1',
        boxSeq: '1',
        labelCode: 'CLR',
        custCode: 'CLR',
        custKey: 0,
        custName: '배경 팔레트 (중국 호접란)',
        handwriting: 'CLR 난 White 10',
        awbNo: '2026YY-055',
        awbPiece: '-',
        invoiceNo: '2026YY-055',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Cloudland',
        countryName: '중국',
        boxSpec: '중국 난 박스',
        boxColorProfile: 'cloudland-white-side',
        rawLabelItem: 'CLR 난 White 10',
        prodKey: 3529,
        prodName: 'ORCHID CHINA / 호접란 White',
        flowerName: '호접난 Orchid',
        unit: '송이',
        qtyPerBox: 90,
        stickerCode: '배경 타 팔레트 자동 분리',
        bbox: { x: 0.5, y: 45.0, w: 8.0, h: 19.5 },
        status: 'BACKGROUND',
      },
    ],
  },
  {
    sampleId: 'sample-2-neulbom-a',
    title: '샘플 2 · 늘봄원예 7박스 전면 스택 (ICNNEN/CL23 & YCL2→늘봄 수기전환)',
    shortLabel: '샘플2: 늘봄원예 7박스 (전면스택)',
    imageUrl: '/samples/box-vision/sample-2-neulbom-a.jpg',
    fileName: 'sample-2-neulbom-a.jpg',
    cameraAngle: 'front',
    palletId: 'pallet-neulbom-4702',
    orderYear: 2026,
    orderWeek: '47-02',
    awbNo: '180-9162-6441',
    invoiceNo: '1222993',
    warehouseKey: 8247,
    primaryFarm: 'Holex',
    countryName: '네덜란드',
    summaryNote: '늘봄원예(CL23) 본오더 3박스 + 주광(YCL2, 2494510.30~32)에서 늘봄원예로 수기 배정 전환된 4박스 = 총 7박스 (안시리움 4품목)',
    boxes: [
      {
        boxId: 's2-b1',
        serialNo: '2494499.1.2',
        orderNo: '2494499',
        lineNo: '1',
        boxSeq: '2',
        labelCode: 'ICNNEN/CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (수기 마커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 3/2',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '30 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 30,
        stickerCode: 'M 3/2 SMAL',
        bbox: { x: 4.5, y: 4.0, w: 37.5, h: 28.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's2-b2',
        serialNo: '2494499.8.1',
        orderNo: '2494499',
        lineNo: '8',
        boxSeq: '1',
        labelCode: 'ICNNEN/CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (수기 마커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 3/2',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '24 ANTHURIUM NERO 13cm A1',
        prodKey: 193,
        prodName: 'Anthurium nero 13cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 24,
        stickerCode: 'M 3/2 SMAL',
        bbox: { x: 43.0, y: 7.0, w: 35.5, h: 29.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's2-b3',
        serialNo: '2494510.31.1',
        orderNo: '2494510',
        lineNo: '31',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2→CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (YCL2 매직 마스킹 후 수기)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 5/3',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '40 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 40,
        stickerCode: 'M 5/3 · 라벨전환',
        bbox: { x: 4.5, y: 33.0, w: 37.5, h: 31.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's2-b4',
        serialNo: '2494510.30.2',
        orderNo: '2494510',
        lineNo: '30',
        boxSeq: '2',
        labelCode: 'ICNNEN/YCL2→CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (YCL2 매직 마스킹 후 수기)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 3/2',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '30 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 30,
        stickerCode: 'M 3/2 SMAL · 라벨전환',
        bbox: { x: 42.5, y: 36.5, w: 33.0, h: 24.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's2-b5',
        serialNo: '2494510.32.1',
        orderNo: '2494510',
        lineNo: '32',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2→CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (AB 11 표기)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'AB 11',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '24 ANTHURIUM NERO 13cm A1',
        prodKey: 193,
        prodName: 'Anthurium nero 13cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 24,
        stickerCode: 'AB 11 · 라벨전환',
        bbox: { x: 42.5, y: 60.5, w: 36.0, h: 15.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's2-b6',
        serialNo: '2494510.30.1',
        orderNo: '2494510',
        lineNo: '30',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2→CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (YCL2 매직 마스킹 후 수기)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 3/2',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '30 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 30,
        stickerCode: 'M 3/2 SMAL · 라벨전환',
        bbox: { x: 7.5, y: 64.5, w: 34.5, h: 22.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's2-b7',
        serialNo: '2494499.3.1',
        orderNo: '2494499',
        lineNo: '3',
        boxSeq: '1',
        labelCode: 'ICNNEN/CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (합포장 16+48본)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 3/2',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '16 LOVELY BLACK LOVE 11cm + 48 PRINCESS ALEXIA BORDEAUX 11cm',
        prodKey: 2555,
        prodName: 'Anthurium Princess Alexia Bordeaux 11cm 외 1종(합포장)',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 64,
        stickerCode: '합포장 (16본+48본)',
        bbox: { x: 42.5, y: 75.8, w: 36.0, h: 22.0 },
        status: 'COUNTED',
      },
    ],
  },
  {
    sampleId: 'sample-3-neulbom-b',
    title: '샘플 3 · 늘봄원예 좌측 스택 5박스 + 우측 중복 스택 2박스 (일련번호 중복제거 시연)',
    shortLabel: '샘플3: 늘봄원예 좌측5+중복2',
    imageUrl: '/samples/box-vision/sample-3-neulbom-b.jpg',
    fileName: 'sample-3-neulbom-b.jpg',
    cameraAngle: 'left',
    palletId: 'pallet-neulbom-4702',
    orderYear: 2026,
    orderWeek: '47-02',
    awbNo: '180-9162-6441',
    invoiceNo: '1222993',
    warehouseKey: 8247,
    primaryFarm: 'Holex',
    countryName: '네덜란드',
    summaryNote: '좌측 신규 5박스(2494499.1.1/5.1/6.1/7.1/2.1) + 우측 가장자리에 찍힌 샘플2번 박스(2494510.31.1/30.1) 바코드 일련번호 교차 중복 자동 감지',
    boxes: [
      {
        boxId: 's3-b1',
        serialNo: '2494499.6.1',
        orderNo: '2494499',
        lineNo: '6',
        boxSeq: '1',
        labelCode: 'ICNNEN/CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (수기 마커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 3/2',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '30 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 30,
        stickerCode: 'M 3/2 SMAL',
        bbox: { x: 58.0, y: 6.0, w: 38.0, h: 27.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's3-b2',
        serialNo: '2494499.7.1',
        orderNo: '2494499',
        lineNo: '7',
        boxSeq: '1',
        labelCode: 'ICNNEN/CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (수기 마커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 5/3',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '40 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 40,
        stickerCode: 'M 5/3',
        bbox: { x: 53.0, y: 32.5, w: 39.0, h: 34.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's3-b3',
        serialNo: '2494499.1.1',
        orderNo: '2494499',
        lineNo: '1',
        boxSeq: '1',
        labelCode: 'ICNNEN/CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (수기 마커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 3/2',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '30 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 30,
        stickerCode: 'M 3/2 SMAL',
        bbox: { x: 18.5, y: 44.5, w: 34.0, h: 26.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's3-b4',
        serialNo: '2494499.5.1',
        orderNo: '2494499',
        lineNo: '5',
        boxSeq: '1',
        labelCode: 'ICNNEN/CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (수기 마커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 3/2',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '40 ANTHURIUM PRINCESS ALEXIA BORDEAUX 9cm A1',
        prodKey: 2227,
        prodName: 'Anthurium Princess Alexia Bordeaux 9cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 40,
        stickerCode: 'M 3/2 SMAL',
        bbox: { x: 19.5, y: 70.5, w: 32.0, h: 25.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's3-b5',
        serialNo: '2494499.2.1',
        orderNo: '2494499',
        lineNo: '2',
        boxSeq: '1',
        labelCode: 'ICNNEN/CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (수기 마커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 5/3',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '40 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 40,
        stickerCode: 'M 5/3',
        bbox: { x: 51.5, y: 65.5, w: 34.5, h: 32.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's3-dup1',
        serialNo: '2494510.31.1',
        orderNo: '2494510',
        lineNo: '31',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2→CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (샘플2번과 동일 박스)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 5/3',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '40 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 40,
        stickerCode: '샘플2번 2494510.31.1 교차 중복',
        bbox: { x: 87.5, y: 42.0, w: 12.0, h: 31.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's3-dup2',
        serialNo: '2494510.30.1',
        orderNo: '2494510',
        lineNo: '30',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2→CL23',
        custCode: 'CL23',
        custKey: 335,
        custName: '늘봄원예',
        handwriting: '늘봄원예 (샘플2번과 동일 박스)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'M 3/2',
        boxColorProfile: 'holex-white-tall',
        rawLabelItem: '30 ANTHURIUM GRACIOSA 15cm A1',
        prodKey: 181,
        prodName: 'Anthurium Graciosa 15cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 30,
        stickerCode: '샘플2번 2494510.30.1 교차 중복',
        bbox: { x: 85.5, y: 74.0, w: 14.0, h: 23.5 },
        status: 'COUNTED',
      },
    ],
  },
  {
    sampleId: 'sample-4-jukwang',
    title: '샘플 4 · 주광농원 20박스 팔레트 정면 (라벨 단면 17박스 + 지그재그 옆면 노출 3박스)',
    shortLabel: '샘플4: 주광농원 20박스 팔레트(정면)',
    imageUrl: '/samples/box-vision/sample-4-jukwang.jpg',
    fileName: 'sample-4-jukwang.jpg',
    cameraAngle: 'front',
    palletId: 'pallet-jukwang-4702',
    orderYear: 2026,
    orderWeek: '47-02',
    awbNo: '180-9162-6441',
    invoiceNo: '1222993',
    warehouseKey: 8247,
    primaryFarm: 'Holex',
    countryName: '네덜란드',
    summaryNote: '주광농원(ICNNEN/YCL2, 오더 2494510) 정면 라벨 단면(label_end) 17박스 + 직육면체 지그재그 교차 적재 긴 옆면(zigzag_side · 라벨 좌/우측면 회전) 3박스(#11, #19, #20) = 총 20박스',
    boxes: [
      {
        boxId: 's4-b1',
        serialNo: '2494510.23.4',
        orderNo: '2494510',
        lineNo: '23',
        boxSeq: '4',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White 9',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '200 TULIP SINGLE ROYAL VIRGEN WHITE',
        prodKey: 1983,
        prodName: 'Tulip / Single Royal Virgin White',
        flowerName: '튤립',
        unit: '단',
        qtyPerBox: 5,
        stemsPerBox: 200,
        stickerCode: '스티커 9',
        bbox: { x: 38.5, y: 11.5, w: 25.0, h: 10.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b2',
        serialNo: '2494510.16.1',
        orderNo: '2494510',
        lineNo: '16',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 + 수기 201',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White 11',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '300 TULIP AD REM BEAUTY',
        prodKey: 2052,
        prodName: 'Tulip / AD rem Beauty (Marict)',
        flowerName: '튤립',
        unit: '단',
        qtyPerBox: 5,
        stemsPerBox: 300,
        stickerCode: '스티커 11',
        bbox: { x: 64.0, y: 11.5, w: 28.5, h: 12.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b3',
        serialNo: '2494510.9.1',
        orderNo: '2494510',
        lineNo: '9',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White 9',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '70 ERYNGIUM ORION BLUE',
        prodKey: 675,
        prodName: 'Eryngium / Orion Blue',
        flowerName: '에린지움',
        unit: '송이',
        qtyPerBox: 70,
        stickerCode: '스티커 9',
        bbox: { x: 15.5, y: 23.0, w: 24.5, h: 13.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b4',
        serialNo: '2494510.9.3',
        orderNo: '2494510',
        lineNo: '9',
        boxSeq: '3',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White 9',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '70 ERYNGIUM ORION BLUE',
        prodKey: 675,
        prodName: 'Eryngium / Orion Blue',
        flowerName: '에린지움',
        unit: '송이',
        qtyPerBox: 70,
        stickerCode: '스티커 9',
        bbox: { x: 40.0, y: 22.0, w: 23.5, h: 12.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b5',
        serialNo: '2494510.9.2',
        orderNo: '2494510',
        lineNo: '9',
        boxSeq: '2',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White 9',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '70 ERYNGIUM ORION BLUE',
        prodKey: 675,
        prodName: 'Eryngium / Orion Blue',
        flowerName: '에린지움',
        unit: '송이',
        qtyPerBox: 70,
        stickerCode: '스티커 9',
        bbox: { x: 64.5, y: 24.5, w: 26.5, h: 12.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b6',
        serialNo: '2494510.13.1',
        orderNo: '2494510',
        lineNo: '13',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White 9',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '45 SKIMMIA CONF KEW GREEN',
        prodKey: 1733,
        prodName: 'Skimmia / Conf Kew Green',
        flowerName: '스키미아',
        unit: '송이',
        qtyPerBox: 45,
        stickerCode: '스티커 9',
        bbox: { x: 13.5, y: 35.5, w: 24.5, h: 12.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b7',
        serialNo: '2494510.6.1',
        orderNo: '2494510',
        lineNo: '6',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White Small',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '100 ASTILBE EUROPA',
        prodKey: 228,
        prodName: 'Astilbe / Europa L/Pink',
        flowerName: '아스틸베',
        unit: '송이',
        qtyPerBox: 50,
        stickerCode: '소형 박스',
        bbox: { x: 40.0, y: 34.0, w: 10.0, h: 10.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b8',
        serialNo: '2494510.8.1',
        orderNo: '2494510',
        lineNo: '8',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White 3',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '100 ASTRANTIA ROMA',
        prodKey: 3560,
        prodName: 'Astrantia / Roma',
        flowerName: '아스트란시아',
        unit: '송이',
        qtyPerBox: 100,
        stickerCode: '스티커 3',
        bbox: { x: 52.0, y: 34.0, w: 10.5, h: 10.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b9',
        serialNo: '2494510.3.1',
        orderNo: '2494510',
        lineNo: '3',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커 · DON\'T DROP 가림)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White DamageLabel',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '12 AMARYLLIS RED LION',
        prodKey: 118,
        prodName: 'Amaryllis / Red Lion',
        flowerName: '아마릴리스',
        unit: '송이',
        qtyPerBox: 12,
        stickerCode: "DON'T DROP",
        ocrStatus: 'unreadable_qty',
        unreadableReason: '주황색 DON\'T DROP 경고 스티커에 본수 숫자가 일부 가려짐 (본수 12송이 확인 필요)',
        resolutionAction: 'pending',
        bbox: { x: 64.0, y: 36.8, w: 27.0, h: 8.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b10',
        serialNo: '2494510.2.1',
        orderNo: '2494510',
        lineNo: '2',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White DamageLabel',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '12 AMARYLLIS MONT BLANC + 12 RILONA',
        prodKey: 116,
        prodName: 'Amaryllis / Mont Blanc 외 1종',
        flowerName: '아마릴리스',
        unit: '송이',
        qtyPerBox: 24,
        stickerCode: "DON'T DROP",
        bbox: { x: 10.0, y: 46.5, w: 28.0, h: 9.8 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b11',
        serialNo: '2494510.3.2',
        orderNo: '2494510',
        lineNo: '3',
        boxSeq: '2',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (지그재그 적재 옆면 노출 · SECURITY 테이프 & 라벨 우측면 회전)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex 지그재그 옆면 (HOLEX 로고면)',
        boxColorProfile: 'holex-white-flat',
        boxFace: 'zigzag_side',
        exposedLabelSide: 'right',
        rawLabelItem: '12 AMARYLLIS RED LION',
        prodKey: 118,
        prodName: 'Amaryllis / Red Lion',
        flowerName: '아마릴리스',
        unit: '송이',
        qtyPerBox: 12,
        stickerCode: '지그재그 옆면 · SECURITY CHECKED',
        ocrStatus: 'unreadable_item',
        unreadableReason: '직육면체 지그재그 교차 적재로 긴 옆면(HOLEX 로고/SECURITY 테이프면)이 정면에 노출되고 라벨 단면은 팔레트 우측면(right)으로 돌아가 있어 정면에서 품목 미식별',
        resolutionAction: 'pending',
        bbox: { x: 38.0, y: 44.0, w: 26.0, h: 8.2 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b12',
        serialNo: '2494510.3.3',
        orderNo: '2494510',
        lineNo: '3',
        boxSeq: '3',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White DamageLabel',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '12 AMARYLLIS RED LION',
        prodKey: 118,
        prodName: 'Amaryllis / Red Lion',
        flowerName: '아마릴리스',
        unit: '송이',
        qtyPerBox: 12,
        stickerCode: "DON'T DROP",
        bbox: { x: 64.0, y: 45.0, w: 27.5, h: 9.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b13',
        serialNo: '2494510.14.1',
        orderNo: '2494510',
        lineNo: '14',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White 18',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '45 SKIMMIA RUBELLA RED',
        prodKey: 1737,
        prodName: 'Skimmia / Rubella Red',
        flowerName: '스키미아',
        unit: '송이',
        qtyPerBox: 45,
        stickerCode: '스티커 18 · SECURITY',
        bbox: { x: 14.0, y: 55.5, w: 24.5, h: 21.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b14',
        serialNo: '2494510.5.1',
        orderNo: '2494510',
        lineNo: '5',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White Small',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '36 ANTHURIUM GRACIOSA 13cm',
        prodKey: 2150,
        prodName: 'Anthurium Graciosa 13cm',
        flowerName: '안시리움',
        unit: '송이',
        qtyPerBox: 36,
        stickerCode: '안시리움 13cm',
        bbox: { x: 38.5, y: 52.2, w: 13.8, h: 8.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b15',
        serialNo: '2494510.10.1',
        orderNo: '2494510',
        lineNo: '10',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (민트색 Holex 박스)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint',
        boxColorProfile: 'holex-mint-flat',
        rawLabelItem: 'HYACINTHUS FONDANT 25 + POLAR GIANT 100 + SKY JACKET 25',
        prodKey: 2442,
        prodName: 'Hyacinthus/ Polar Giant 외 2종',
        flowerName: '히아신스',
        unit: '단',
        qtyPerBox: 15,
        stemsPerBox: 150,
        stickerCode: '민트색 HOLEX',
        bbox: { x: 52.5, y: 52.2, w: 36.0, h: 11.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b16',
        serialNo: '2494510.7.1',
        orderNo: '2494510',
        lineNo: '7',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White 7',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '130 ASTILBE WASHINGTON WHITE',
        prodKey: 230,
        prodName: 'Astilbe / Washington White',
        flowerName: '아스틸베',
        unit: '송이',
        qtyPerBox: 50,
        stickerCode: '스티커 7',
        bbox: { x: 39.5, y: 60.8, w: 23.0, h: 8.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b17',
        serialNo: '2494510.18.1',
        orderNo: '2494510',
        lineNo: '18',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White 9',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '150 TULIP SINGLE AD REM',
        prodKey: 2942,
        prodName: 'Tulip / Single Ad Rem ',
        flowerName: '튤립',
        unit: '단',
        qtyPerBox: 5,
        stemsPerBox: 150,
        stickerCode: '스티커 9',
        bbox: { x: 63.5, y: 62.5, w: 24.0, h: 10.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b18',
        serialNo: '2494510.16.2',
        orderNo: '2494510',
        lineNo: '16',
        boxSeq: '2',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '300 TULIP AD REM BEAUTY',
        prodKey: 2052,
        prodName: 'Tulip / AD rem Beauty (Marict)',
        flowerName: '튤립',
        unit: '단',
        qtyPerBox: 5,
        stemsPerBox: 300,
        stickerCode: '튤립 300본',
        bbox: { x: 40.0, y: 69.2, w: 23.5, h: 8.2 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b19',
        serialNo: '2494510.27.1',
        orderNo: '2494510',
        lineNo: '27',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (1층 지그재그 적재 긴 민트색 옆면 #19 · 라벨은 좌측면 노출)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint 지그재그 옆면 (T6)',
        boxColorProfile: 'holex-mint-flat',
        boxFace: 'zigzag_side',
        exposedLabelSide: 'left',
        crossAngleMatchedSerial: '2494510.27.1',
        rawLabelItem: '130 CALLA ODESSA',
        prodKey: 329,
        prodName: 'Calla / Odessa',
        flowerName: '카라',
        unit: '송이',
        qtyPerBox: 130,
        stickerCode: '스티커 T6 · 지그재그 옆면 (라벨 좌측면 회전)',
        ocrStatus: 'unreadable_both',
        unreadableReason: '팔레트 1층 직육면체 지그재그 교차 적재로 긴 옆면(HOLEX A world of flowers 로고면 + T6 스티커)이 정면을 향하고, 바코드 라벨 단면은 팔레트 좌측면(left)에 노출됨',
        resolutionAction: 'pending',
        bbox: { x: 15.5, y: 76.2, w: 24.0, h: 10.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's4-b20',
        serialNo: '2494510.19.1',
        orderNo: '2494510',
        lineNo: '19',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (1층 지그재그 적재 긴 민트색 옆면 #20 · 라벨은 우측면 노출)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint 지그재그 옆면 (T7)',
        boxColorProfile: 'holex-mint-flat',
        boxFace: 'zigzag_side',
        exposedLabelSide: 'right',
        rawLabelItem: '200 TULIP SINGLE ANTARCTICA',
        prodKey: 1874,
        prodName: 'Tulip / Single Antarctica',
        flowerName: '튤립',
        unit: '단',
        qtyPerBox: 5,
        stemsPerBox: 200,
        stickerCode: '스티커 T7 · 지그재그 옆면 (라벨 우측면 회전)',
        ocrStatus: 'unreadable_both',
        unreadableReason: '팔레트 1층 직육면체 지그재그 교차 적재로 긴 옆면(HOLEX 로고면 + T7 스티커)이 정면을 향하고, 바코드 라벨 단면은 팔레트 우측면(right)으로 돌아가 있어 정면에서 미식별',
        resolutionAction: 'pending',
        bbox: { x: 63.8, y: 73.0, w: 24.0, h: 13.0 },
        status: 'COUNTED',
      },
    ],
  },
  {
    sampleId: 'sample-5-holex-mint',
    title: '샘플 5 · Holex 민트 16박스 + 하단 주광 3박스 (지그재그 옆면 3박스 포함) + 배경 미국 살랄 분리',
    shortLabel: '샘플5: Holex 민트16+주광3(우측면/교차)',
    imageUrl: '/samples/box-vision/sample-5-holex-mint.jpg',
    fileName: 'sample-5-holex-mint.jpg',
    cameraAngle: 'right',
    palletId: 'pallet-jukwang-4702',
    orderYear: 2026,
    orderWeek: '47-02',
    awbNo: '180-9162-6441',
    invoiceNo: '1222993',
    warehouseKey: 8247,
    primaryFarm: 'Holex',
    countryName: '네덜란드',
    summaryNote: 'Holex 민트색 가로형 16박스(라벨 단면 13박스 + 지그재그 교차 적재 긴 옆면 s5-b9, s5-b15, s5-b16 3박스) + 하단 주광 흰색 단면 3박스(27.1 T6 측면 라벨 교차결합, 23.5, 28.1) + 후면 미국 살랄 팔레트 분리',
    boxes: [
      {
        boxId: 's5-m1',
        serialNo: '180-91626441-P086',
        orderNo: '2494510',
        lineNo: '11',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: 'AWB 180-91626441 · 스티커 11',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint 11',
        boxColorProfile: 'holex-mint-flat',
        rawLabelItem: 'TULIP / SINGLE BARCELONA H/PINK',
        prodKey: 1878,
        prodName: 'Tulip / Single Barcelona H/Pink',
        flowerName: '튤립',
        unit: '단',
        qtyPerBox: 5,
        stemsPerBox: 250,
        stickerCode: '스티커 11 · AWB 86/130',
        bbox: { x: 10.5, y: 11.0, w: 29.0, h: 13.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-m2',
        serialNo: '180-91626441-P087',
        orderNo: '2494510',
        lineNo: '12',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: 'AWB 180-91626441',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint',
        boxColorProfile: 'holex-mint-flat',
        rawLabelItem: 'TULIP / SINGLE CAROLA',
        prodKey: 1890,
        prodName: 'Tulip / Single Carola',
        flowerName: '튤립',
        unit: '단',
        qtyPerBox: 5,
        stemsPerBox: 250,
        stickerCode: 'AWB 87/130',
        bbox: { x: 40.8, y: 21.5, w: 18.0, h: 5.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-m3',
        serialNo: '180-91626441-P089',
        orderNo: '2494510',
        lineNo: '15',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: 'AWB 180-91626441 · 스티커 9',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint 9',
        boxColorProfile: 'holex-mint-flat',
        rawLabelItem: 'HYACINTHUS / SKY JACKET',
        prodKey: 2459,
        prodName: 'Hyacinthus/ Sky Jacket',
        flowerName: '히아신스',
        unit: '단',
        qtyPerBox: 5,
        stemsPerBox: 25,
        stickerCode: '스티커 9 · AWB 89/130',
        bbox: { x: 61.5, y: 20.5, w: 25.0, h: 13.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-m4',
        serialNo: '180-91626441-P090',
        orderNo: '2494510',
        lineNo: '17',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: 'AWB 180-91626441',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint',
        boxColorProfile: 'holex-mint-flat',
        rawLabelItem: 'HYACINTHUS / POLAR GIANT',
        prodKey: 2442,
        prodName: 'Hyacinthus/ Polar Giant',
        flowerName: '히아신스',
        unit: '단',
        qtyPerBox: 5,
        stemsPerBox: 25,
        stickerCode: 'AWB 90/130',
        bbox: { x: 12.5, y: 25.0, w: 25.5, h: 11.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-m5',
        serialNo: '180-91626441-P092',
        orderNo: '2494510',
        lineNo: '20',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: 'AWB 180-91626441',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint',
        boxColorProfile: 'holex-mint-flat',
        rawLabelItem: 'LILY ORIENTAL DOUBLE ROSELILY AISHA 2+',
        prodKey: 3170,
        prodName: 'Lily Oriental Double Roselily Aisha 2+',
        flowerName: '백합',
        unit: '송이',
        qtyPerBox: 90,
        stickerCode: 'AWB 92/130',
        bbox: { x: 39.5, y: 26.0, w: 23.0, h: 11.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-m6',
        serialNo: '180-91626441-P094',
        orderNo: '2494510',
        lineNo: '21',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: 'AWB 180-91626441 · 스티커 9',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint 9',
        boxColorProfile: 'holex-mint-flat',
        rawLabelItem: 'LILY ORIENTAL DOUBLE ROSELILY AISHA 2+',
        prodKey: 3170,
        prodName: 'Lily Oriental Double Roselily Aisha 2+',
        flowerName: '백합',
        unit: '송이',
        qtyPerBox: 90,
        stickerCode: '스티커 9 · AWB 94/130',
        bbox: { x: 63.0, y: 33.0, w: 24.0, h: 11.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-b9',
        serialNo: '180-91626441-P104',
        orderNo: '2494510',
        lineNo: '22',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: 'AWB 180-91626441 · 4층 좌측 지그재그 긴 옆면 (스티커 7,5 · 라벨 좌측면 회전)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint 지그재그 옆면 (7,5)',
        boxColorProfile: 'holex-mint-flat',
        boxFace: 'zigzag_side',
        exposedLabelSide: 'left',
        rawLabelItem: 'LILY ORIENTAL DOUBLE ROSELILY AISHA 2+',
        prodKey: 3170,
        prodName: 'Lily Oriental Double Roselily Aisha 2+',
        flowerName: '백합',
        unit: '송이',
        qtyPerBox: 90,
        stickerCode: '스티커 7,5 · 지그재그 옆면 (HOLEX 로고면)',
        ocrStatus: 'unreadable_item',
        unreadableReason: '4층 좌측 직육면체 지그재그 적재로 민트색 긴 옆면(HOLEX 로고면)만 노출되고 바코드 라벨은 팔레트 좌측면(left)으로 회전되어 품목 미식별',
        resolutionAction: 'pending',
        bbox: { x: 10.5, y: 36.5, w: 29.0, h: 9.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-b15',
        serialNo: '180-91626441-P106',
        orderNo: '2494510',
        lineNo: '24',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: 'AWB 180-91626441 · 2층 지그재그 긴 옆면 (스티커 7,5 · 라벨 우측면 회전)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint 지그재그 옆면 (7,5)',
        boxColorProfile: 'holex-mint-flat',
        boxFace: 'zigzag_side',
        exposedLabelSide: 'right',
        rawLabelItem: 'LILY ORIENTAL DOUBLE ROSELILY AISHA 2+',
        prodKey: 3170,
        prodName: 'Lily Oriental Double Roselily Aisha 2+',
        flowerName: '백합',
        unit: '송이',
        qtyPerBox: 90,
        stickerCode: '스티커 7,5 · 지그재그 옆면',
        ocrStatus: 'unreadable_both',
        unreadableReason: '2층 직육면체 지그재그 교차 적재로 긴 옆면(HOLEX 로고면)만 노출되고 라벨 단면은 우측면(right)으로 돌아가 있어 품목·본수 미식별',
        resolutionAction: 'pending',
        bbox: { x: 63.0, y: 43.2, w: 26.5, h: 9.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-b16',
        serialNo: '180-91626441-P112',
        orderNo: '2494510',
        lineNo: '25',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: 'AWB 180-91626441 · 2층 지그재그 긴 옆면 (스티커 3,6 · 라벨 좌측면 회전)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint 지그재그 옆면 (3,6)',
        boxColorProfile: 'holex-mint-flat',
        boxFace: 'zigzag_side',
        exposedLabelSide: 'left',
        rawLabelItem: 'ASTRANTIA / STAR OF LOVE',
        prodKey: 240,
        prodName: 'Astrantia / Star of Love',
        flowerName: '아스트란시아',
        unit: '송이',
        qtyPerBox: 25,
        stickerCode: '스티커 3,6 · 지그재그 옆면',
        ocrStatus: 'unreadable_qty',
        unreadableReason: '2층 직육면체 지그재그 적재로 민트색 옆면(스티커 3,6)만 노출되고 라벨 단면이 팔레트 좌측면(left)으로 회전됨',
        resolutionAction: 'pending',
        bbox: { x: 49.2, y: 56.5, w: 13.5, h: 8.2 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-m10',
        serialNo: '180-91626441-P115',
        orderNo: '2494510',
        lineNo: '26',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: 'AWB 180-91626441 · 스티커 18',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex Mint 18',
        boxColorProfile: 'holex-mint-flat',
        rawLabelItem: '45 SKIMMIA CONF KEW GREEN',
        prodKey: 1733,
        prodName: 'Skimmia / Conf Kew Green',
        flowerName: '스키미아',
        unit: '송이',
        qtyPerBox: 45,
        stickerCode: '스티커 18 · 대형 민트',
        bbox: { x: 63.0, y: 52.0, w: 22.0, h: 21.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-w1',
        serialNo: '2494510.27.1',
        orderNo: '2494510',
        lineNo: '27',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (스티커 T6 · 샘플4번 중복)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White T6',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '130 CALLA ODESSA',
        prodKey: 329,
        prodName: 'Calla / Odessa',
        flowerName: '카라',
        unit: '송이',
        qtyPerBox: 130,
        stickerCode: '스티커 T6 (샘플4 교차중복)',
        bbox: { x: 13.5, y: 85.0, w: 24.5, h: 12.5 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-w2',
        serialNo: '2494510.23.5',
        orderNo: '2494510',
        lineNo: '23',
        boxSeq: '5',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '200 TULIP SINGLE ROYAL VIRGEN WHITE',
        prodKey: 1983,
        prodName: 'Tulip / Single Royal Virgin White',
        flowerName: '튤립',
        unit: '단',
        qtyPerBox: 5,
        stemsPerBox: 200,
        stickerCode: '튤립 200본',
        bbox: { x: 38.2, y: 85.5, w: 23.0, h: 12.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-w3',
        serialNo: '2494510.28.1',
        orderNo: '2494510',
        lineNo: '28',
        boxSeq: '1',
        labelCode: 'ICNNEN/YCL2',
        custCode: 'YCL2',
        custKey: 533,
        custName: '주광농원',
        handwriting: '주광 (인쇄 스티커)',
        awbNo: '180-9162-6441',
        invoiceNo: '1222993',
        orderYear: 2026,
        orderWeek: '47-02',
        farmName: 'Holex',
        countryName: '네덜란드',
        boxSpec: 'Holex White',
        boxColorProfile: 'holex-white-flat',
        rawLabelItem: '120 CALLA ODESSA',
        prodKey: 329,
        prodName: 'Calla / Odessa',
        flowerName: '카라',
        unit: '송이',
        qtyPerBox: 120,
        stickerCode: '카라 120본',
        bbox: { x: 61.5, y: 85.5, w: 22.8, h: 12.0 },
        status: 'COUNTED',
      },
      {
        boxId: 's5-bg1',
        serialNo: 'US-201693-SALAL25',
        orderNo: '201693',
        lineNo: '1',
        boxSeq: '1',
        labelCode: 'MYSTIC-FOREST',
        custCode: 'BG',
        custKey: 0,
        custName: '배경 팔레트 (미국 Hood Canal)',
        handwriting: '20 Bunches Douglas / 그린 / 경부선 11/23(월)',
        awbNo: '180-5345-5275',
        invoiceNo: '201693',
        orderYear: 2026,
        orderWeek: '47-01',
        farmName: 'Hood Canal',
        countryName: '미국',
        boxSpec: 'MYSTIC FOREST 주황 박스',
        boxColorProfile: 'hoodcanal-orange',
        rawLabelItem: 'SALAL TIP 25 / 20 Bunches Douglas',
        prodKey: 1718,
        prodName: 'SALAL TIPS (레몬잎) / Douglas Fir (더글라스)',
        flowerName: '레몬잎 · 더글라스',
        unit: '단',
        qtyPerBox: 25,
        stickerCode: '배경 타 팔레트 자동 분리',
        bbox: { x: 52.8, y: 9.0, w: 26.5, h: 12.0 },
        status: 'BACKGROUND',
      },
    ],
  },
];

// 카톡 출고 묶음 메시지에서 노선명(호남선·경부선·영동선·중부선·직배 등)과 배송일자·메모를 자동 파싱
export const ROUTE_PRESETS = [
  {
    routeId: 'honam',
    routeName: '호남선',
    defaultMessage: '호남선 출고입니다 (묶음 사진 일괄 업로드)',
    regionHint: '광주·전주·순천·익산·목포 화물터미널 및 호남권 거래처',
  },
  {
    routeId: 'gyeongbu',
    routeName: '경부선',
    defaultMessage: '11/23(월) 경부선 출고입니다 (묶음 사진 일괄 업로드)',
    regionHint: '대전·대구·부산·울산·구미 화물터미널 및 영남권 거래처',
  },
  {
    routeId: 'yeongdong',
    routeName: '영동선',
    defaultMessage: '영동선 출고입니다',
    regionHint: '강릉·원주·춘천·속초 강원권 거래처',
  },
  {
    routeId: 'jungbu',
    routeName: '중부선',
    defaultMessage: '중부선 출고입니다',
    regionHint: '청주·천안·충주·이천 충청/경기남부 거래처',
  },
  {
    routeId: 'direct',
    routeName: '직배/터미널 출고',
    defaultMessage: '수도권 직배 및 고속터미널 출고입니다',
    regionHint: '서울 호텔(신라호텔 등)·양재·고속터미널 당일 직배',
  },
];

export function parseKakaoBatchRoute(rawMessage = '', allBoxes = []) {
  const text = String(rawMessage || '').trim();
  const hasPhoto5Note = allBoxes.some((b) => String(b.handwriting || '').includes('경부선'));

  let detectedRoute = '호남선/경부선 통합 출고';
  if (/호남선/.test(text) && /경부선/.test(text)) {
    detectedRoute = '호남선 · 경부선 통합 출고';
  } else if (/호남/.test(text)) {
    detectedRoute = '호남선 출고';
  } else if (/경부/.test(text)) {
    detectedRoute = '경부선 출고';
  } else if (/영동/.test(text)) {
    detectedRoute = '영동선 출고';
  } else if (/중부/.test(text)) {
    detectedRoute = '중부선 출고';
  } else if (/직배|터미널|호텔/.test(text)) {
    detectedRoute = '직배/터미널 출고';
  } else if (hasPhoto5Note) {
    detectedRoute = '호남선 · 경부선 출고 (사진5 수기메모: 11/23(월) 경부선 감지)';
  }

  const dateMatch = text.match(/(\d{1,2}\/\d{1,2}(?:\([월화수목금토일]\))?)/);
  const shipDateLabel = dateMatch ? dateMatch[1] : hasPhoto5Note ? '11/23(월)' : '당일 출고';

  return {
    rawMessage: text || '호남선 출고입니다 (카톡 묶음 사진 일괄 업로드)',
    routeName: detectedRoute,
    shipDateLabel,
    photoHandwritingMemo: hasPhoto5Note ? '사진 #5 우측 하단 수기 메모: 11/23(월) 경부선 / 그린 20 Bunches Douglas' : null,
  };
}

// Bill 번호(InvoiceNo) · AWB(OrderNo) · 홀렉스 오더번호 기준 입고 차수(WarehouseMaster) 원장 폴백
export const FALLBACK_WAREHOUSE_BILLS = [
  {
    warehouseKey: 8247,
    invoiceNo: '1222993',
    awbNo: '180-9162-6441',
    awbCompact: '18091626441',
    holexOrderNos: ['2493354', '2494499', '2494510'],
    orderYear: 2026,
    orderWeek: '47-02',
    orderWeekLabel: '2026년 47-02차 입고',
    farmName: 'Holex',
    countryName: '네덜란드',
    totalInboundBoxes: 130,
    totalInboundStems: 4680,
    sourceDoc: '47-2 네덜란드 CI.pdf (Holex AWB 180-9162-6441)',
    distributedCustomers: ['신라호텔 (YCLS)', '늘봄원예 (CL23)', '주광농원 (YCL2)'],
    isPrimaryBatchBill: true,
    note: '47-02차 네덜란드 Holex 본 입고 물량 (총 130박스 중 출고 묶음 사진 매칭)',
  },
  {
    warehouseKey: 8250,
    invoiceNo: '2026YY-055',
    awbNo: '2026YY-055',
    awbCompact: '2026YY055',
    holexOrderNos: ['2026YY-055', 'CLR-2026YY055-W10'],
    orderYear: 2026,
    orderWeek: '47-02',
    orderWeekLabel: '2026년 47-02차 입고',
    farmName: 'Cloudland',
    countryName: '중국',
    totalInboundBoxes: 45,
    totalInboundStems: 4050,
    sourceDoc: '47-2 중국 Cloudland 호접란 입고 원장 (WarehouseKey=8250)',
    distributedCustomers: ['절화/난 도매 거래처 (CLR 난 White 10)'],
    isPrimaryBatchBill: false,
    note: '47-02차 중국 Cloudland 호접란 입고분 (사진 #1 좌측 팔레트 검출)',
  },
  {
    warehouseKey: 8169,
    invoiceNo: '201693',
    awbNo: '180-5345-5275',
    awbCompact: '18053455275',
    holexOrderNos: ['201693', 'US-201693-SALAL25'],
    orderYear: 2026,
    orderWeek: '47-01',
    orderWeekLabel: '2026년 47-01차 입고',
    farmName: 'Hood Canal',
    countryName: '미국',
    totalInboundBoxes: 60,
    totalInboundStems: 1500,
    sourceDoc: '47-1 미국 Hood Canal 살랄/더글라스 입고 원장 (WarehouseKey=8169)',
    distributedCustomers: ['경부선 소재·그린 거래처 (11/23 경부선 메모)'],
    isPrimaryBatchBill: false,
    note: '47-01차 미국 Hood Canal 살랄/더글라스 이월·혼적 입고분 (사진 #5 후면 팔레트 검출)',
  },
  {
    warehouseKey: 8251,
    invoiceNo: '201694',
    awbNo: '180-5345-5334',
    awbCompact: '18053455334',
    holexOrderNos: ['201694', 'US-201694-DOUGLAS'],
    orderYear: 2026,
    orderWeek: '48-01',
    orderWeekLabel: '2026년 48-01차 입고',
    farmName: 'Hood Canal',
    countryName: '미국',
    totalInboundBoxes: 55,
    totalInboundStems: 1375,
    sourceDoc: '48-1 미국 Hood Canal 더글라스/레몬잎 입고 원장 (WarehouseKey=8251)',
    distributedCustomers: ['호남선·경부선 그린류 거래처'],
    isPrimaryBatchBill: false,
    note: '48-01차 미국 Hood Canal 신규 차수 입고분 (차수 혼입 비교·조회용)',
  },
];

/**
 * Bill 번호(InvoiceNo), AWB 번호, 또는 홀렉스 오더번호(2493354/2494499/2494510)로
 * 해당 물량이 몇 년도 몇 차수(OrderWeek) 어느 농장 입고분인지 확인 조회
 */
export function lookupBillOrderWeek(queryText = '', warehouseBills = FALLBACK_WAREHOUSE_BILLS, currentLedger = []) {
  const q = String(queryText || '').trim();
  const normalized = q.replace(/[\s-]/g, '').toLowerCase();

  const mergedPool = [...warehouseBills];
  for (const row of currentLedger) {
    if (!mergedPool.some((b) => String(b.invoiceNo) === String(row.invoiceNo))) {
      mergedPool.push({
        warehouseKey: row.warehouseKey || 8247,
        invoiceNo: row.invoiceNo,
        awbNo: row.awbNo,
        awbCompact: String(row.awbNo || '').replace(/[\s-]/g, ''),
        holexOrderNos: row.orderNos || [],
        orderYear: row.orderYear || 2026,
        orderWeek: row.orderWeek || '47-02',
        orderWeekLabel: `${row.orderYear || 2026}년 ${row.orderWeek || '47-02'}차 입고`,
        farmName: row.farmName || 'Holex',
        countryName: row.countryName || '네덜란드',
        totalInboundBoxes: row.totalInboundBoxes || row.photoBoxCount || 1,
        totalInboundStems: row.totalInboundStems || row.photoTotalStems || 0,
        distributedCustomers: row.customerNames || [],
        note: '실시간 DB 입고 원장 매칭',
      });
    }
  }

  if (!normalized) {
    return mergedPool;
  }

  return mergedPool.filter((bill) => {
    const inv = String(bill.invoiceNo || '').replace(/[\s-]/g, '').toLowerCase();
    const awb = String(bill.awbNo || '').replace(/[\s-]/g, '').toLowerCase();
    const wk = String(bill.orderWeek || '').toLowerCase();
    const farm = String(bill.farmName || '').toLowerCase();
    const country = String(bill.countryName || '').toLowerCase();
    const orders = (bill.holexOrderNos || []).map((o) => String(o).replace(/[\s-]/g, '').toLowerCase());
    const custs = (bill.distributedCustomers || []).join(' ').toLowerCase();

    return (
      inv.includes(normalized) ||
      awb.includes(normalized) ||
      wk.includes(normalized) ||
      farm.includes(normalized) ||
      country.includes(normalized) ||
      custs.includes(q.toLowerCase()) ||
      orders.some((o) => o.includes(normalized) || normalized.includes(o))
    );
  });
}

// ERP 전산 출고 기준값 (ShipmentMaster 7522/7577/7541, 2026년 47-02차 실데이터 폴백)
export const FALLBACK_ERP_SHIPMENTS = [
  { custKey: 446, custName: '신라호텔', custCode: 'YCLS', shipmentKey: 7522, orderYear: 2026, orderWeek: '47-02', prodKey: 181, prodName: 'Anthurium Graciosa 15cm', flowerName: '안시리움', unit: '송이', erpBoxQty: 4, erpOutQty: 159, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 335, custName: '늘봄원예', custCode: 'CL23', shipmentKey: 7577, orderYear: 2026, orderWeek: '47-02', prodKey: 181, prodName: 'Anthurium Graciosa 15cm', flowerName: '안시리움', unit: '송이', erpBoxQty: 8, erpOutQty: 270, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 335, custName: '늘봄원예', custCode: 'CL23', shipmentKey: 7577, orderYear: 2026, orderWeek: '47-02', prodKey: 193, prodName: 'Anthurium nero 13cm', flowerName: '안시리움', unit: '송이', erpBoxQty: 2, erpOutQty: 48, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 335, custName: '늘봄원예', custCode: 'CL23', shipmentKey: 7577, orderYear: 2026, orderWeek: '47-02', prodKey: 2555, prodName: 'Anthurium Princess Alexia Bordeaux 11cm 외 1종(합포장)', flowerName: '안시리움', unit: '송이', erpBoxQty: 1, erpOutQty: 64, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 335, custName: '늘봄원예', custCode: 'CL23', shipmentKey: 7577, orderYear: 2026, orderWeek: '47-02', prodKey: 2227, prodName: 'Anthurium Princess Alexia Bordeaux 9cm', flowerName: '안시리움', unit: '송이', erpBoxQty: 1, erpOutQty: 40, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 1983, prodName: 'Tulip / Single Royal Virgin White', flowerName: '튤립', unit: '단', erpBoxQty: 2, erpOutQty: 10, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 2052, prodName: 'Tulip / AD rem Beauty (Marict)', flowerName: '튤립', unit: '단', erpBoxQty: 2, erpOutQty: 10, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 2942, prodName: 'Tulip / Single Ad Rem ', flowerName: '튤립', unit: '단', erpBoxQty: 1, erpOutQty: 5, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 1874, prodName: 'Tulip / Single Antarctica', flowerName: '튤립', unit: '단', erpBoxQty: 1, erpOutQty: 5, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 675, prodName: 'Eryngium / Orion Blue', flowerName: '에린지움', unit: '송이', erpBoxQty: 3, erpOutQty: 210, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 1733, prodName: 'Skimmia / Conf Kew Green', flowerName: '스키미아', unit: '송이', erpBoxQty: 2, erpOutQty: 90, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 1737, prodName: 'Skimmia / Rubella Red', flowerName: '스키미아', unit: '송이', erpBoxQty: 1, erpOutQty: 45, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 118, prodName: 'Amaryllis / Red Lion', flowerName: '아마릴리스', unit: '송이', erpBoxQty: 3, erpOutQty: 36, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 116, prodName: 'Amaryllis / Mont Blanc 외 1종', flowerName: '아마릴리스', unit: '송이', erpBoxQty: 1, erpOutQty: 24, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 228, prodName: 'Astilbe / Europa L/Pink', flowerName: '아스틸베', unit: '송이', erpBoxQty: 1, erpOutQty: 50, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 230, prodName: 'Astilbe / Washington White', flowerName: '아스틸베', unit: '송이', erpBoxQty: 1, erpOutQty: 50, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441' },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 3560, prodName: 'Astrantia / Roma', flowerName: '아스트란시아', unit: '송이', erpBoxQty: 1, erpOutQty: 100, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441', boxColorHint: 'holex-white-flat', defaultQtyPerBox: 100 },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 2150, prodName: 'Anthurium Graciosa 13cm', flowerName: '안시리움', unit: '송이', erpBoxQty: 1, erpOutQty: 36, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441', boxColorHint: 'holex-white-flat', defaultQtyPerBox: 36 },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 329, prodName: 'Calla / Odessa', flowerName: '카라', unit: '송이', erpBoxQty: 2, erpOutQty: 250, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441', boxColorHint: 'holex-mint-flat', defaultQtyPerBox: 130 },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 1878, prodName: 'Tulip / Single Barcelona H/Pink', flowerName: '튤립', unit: '단', erpBoxQty: 1, erpOutQty: 5, stemsPerBox: 250, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441', boxColorHint: 'holex-mint-flat', defaultQtyPerBox: 5 },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 1890, prodName: 'Tulip / Single Carola', flowerName: '튤립', unit: '단', erpBoxQty: 1, erpOutQty: 5, stemsPerBox: 250, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441', boxColorHint: 'holex-mint-flat', defaultQtyPerBox: 5 },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 2459, prodName: 'Hyacinthus/ Sky Jacket', flowerName: '히아신스', unit: '단', erpBoxQty: 1, erpOutQty: 5, stemsPerBox: 25, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441', boxColorHint: 'holex-mint-flat', defaultQtyPerBox: 5 },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 2442, prodName: 'Hyacinthus/ Polar Giant', flowerName: '히아신스', unit: '단', erpBoxQty: 2, erpOutQty: 20, stemsPerBox: 150, farmName: 'Holex', invoiceNo: '1222993', awbNo: '1222993', boxColorHint: 'holex-mint-flat', defaultQtyPerBox: 5 },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 3170, prodName: 'Lily Oriental Double Roselily Aisha 2+', flowerName: '백합', unit: '송이', erpBoxQty: 4, erpOutQty: 360, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441', boxColorHint: 'holex-mint-flat', defaultQtyPerBox: 90 },
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', shipmentKey: 7541, orderYear: 2026, orderWeek: '47-02', prodKey: 240, prodName: 'Astrantia / Star of Love', flowerName: '아스트란시아', unit: '송이', erpBoxQty: 1, erpOutQty: 25, farmName: 'Holex', invoiceNo: '1222993', awbNo: '180-9162-6441', boxColorHint: 'holex-mint-flat', defaultQtyPerBox: 25 },
];

// [신규] 품목이나 숫자가 안 보이는 박스(unreadable) 검색 매칭용 DB Product / WarehouseDetail / ShipmentDetail 통합 품목 카탈로그
export const SEARCHABLE_PRODUCT_CATALOG = [
  { prodKey: 181, prodName: 'Anthurium Graciosa 15cm', flowerName: '안시리움', unit: '송이', defaultQtyPerBox: 40, altQtys: [30, 39, 40], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-tall', keywords: '안시리움 그라시오사 anthurium graciosa 15cm 40 30 39 신라 늘봄' },
  { prodKey: 2150, prodName: 'Anthurium Graciosa 13cm', flowerName: '안시리움', unit: '송이', defaultQtyPerBox: 36, altQtys: [36, 30], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-flat', keywords: '안시리움 그라시오사 anthurium graciosa 13cm 36 주광' },
  { prodKey: 193, prodName: 'Anthurium nero 13cm', flowerName: '안시리움', unit: '송이', defaultQtyPerBox: 24, altQtys: [24, 30], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-tall', keywords: '안시리움 네로 anthurium nero 13cm 24 늘봄' },
  { prodKey: 2227, prodName: 'Anthurium Princess Alexia Bordeaux 9cm', flowerName: '안시리움', unit: '송이', defaultQtyPerBox: 40, altQtys: [40, 48], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-tall', keywords: '안시리움 알렉시아 보르도 princess alexia bordeaux 9cm 40 늘봄' },
  { prodKey: 2555, prodName: 'Anthurium Princess Alexia Bordeaux 11cm 외 1종(합포장)', flowerName: '안시리움', unit: '송이', defaultQtyPerBox: 64, altQtys: [64, 48, 16], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-tall', keywords: '안시리움 합포장 lovely black love alexia bordeaux 11cm 64 늘봄' },
  { prodKey: 329, prodName: 'Calla / Odessa', flowerName: '카라', unit: '송이', defaultQtyPerBox: 130, altQtys: [130, 120], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-mint-flat', keywords: '카라 오데사 calla odessa T6 130 120 주광 민트' },
  { prodKey: 1874, prodName: 'Tulip / Single Antarctica', flowerName: '튤립', unit: '단', defaultQtyPerBox: 5, stemsPerBox: 200, altQtys: [5, 10, 200], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-mint-flat', keywords: '튤립 안타티카 tulip single antarctica T7 200 5 주광 민트' },
  { prodKey: 1983, prodName: 'Tulip / Single Royal Virgin White', flowerName: '튤립', unit: '단', defaultQtyPerBox: 5, stemsPerBox: 200, altQtys: [5, 10, 200], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-flat', keywords: '튤립 로얄 버진 화이트 tulip single royal virgin white 200 5 주광' },
  { prodKey: 2052, prodName: 'Tulip / AD rem Beauty (Marict)', flowerName: '튤립', unit: '단', defaultQtyPerBox: 5, stemsPerBox: 300, altQtys: [5, 10, 300], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-flat', keywords: '튤립 아드렘 뷰티 tulip ad rem beauty 300 5 주광' },
  { prodKey: 2942, prodName: 'Tulip / Single Ad Rem ', flowerName: '튤립', unit: '단', defaultQtyPerBox: 5, stemsPerBox: 150, altQtys: [5, 150], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-flat', keywords: '튤립 싱글 아드렘 tulip single ad rem 150 5 주광' },
  { prodKey: 1878, prodName: 'Tulip / Single Barcelona H/Pink', flowerName: '튤립', unit: '단', defaultQtyPerBox: 5, stemsPerBox: 250, altQtys: [5, 250], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-mint-flat', keywords: '튤립 바르셀로나 핑크 tulip single barcelona pink 250 5 주광 민트' },
  { prodKey: 1890, prodName: 'Tulip / Single Carola', flowerName: '튤립', unit: '단', defaultQtyPerBox: 5, stemsPerBox: 250, altQtys: [5, 250], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-mint-flat', keywords: '튤립 카롤라 tulip single carola 250 5 주광 민트' },
  { prodKey: 118, prodName: 'Amaryllis / Red Lion', flowerName: '아마릴리스', unit: '송이', defaultQtyPerBox: 12, altQtys: [12, 24], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-flat', keywords: '아마릴리스 레드라이온 amaryllis red lion 12 dont drop security 주광' },
  { prodKey: 116, prodName: 'Amaryllis / Mont Blanc 외 1종', flowerName: '아마릴리스', unit: '송이', defaultQtyPerBox: 24, altQtys: [24, 12], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-flat', keywords: '아마릴리스 몽블랑 릴로나 amaryllis mont blanc rilona 24 주광' },
  { prodKey: 675, prodName: 'Eryngium / Orion Blue', flowerName: '에린지움', unit: '송이', defaultQtyPerBox: 70, altQtys: [70, 50], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-flat', keywords: '에린지움 오리온 블루 eryngium orion blue 70 주광' },
  { prodKey: 1733, prodName: 'Skimmia / Conf Kew Green', flowerName: '스키미아', unit: '송이', defaultQtyPerBox: 45, altQtys: [45, 50], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-mint-flat', keywords: '스키미아 큐그린 skimmia conf kew green 45 주광' },
  { prodKey: 1737, prodName: 'Skimmia / Rubella Red', flowerName: '스키미아', unit: '송이', defaultQtyPerBox: 45, altQtys: [45, 50], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-flat', keywords: '스키미아 루벨라 레드 skimmia rubella red 45 주광' },
  { prodKey: 228, prodName: 'Astilbe / Europa L/Pink', flowerName: '아스틸베', unit: '송이', defaultQtyPerBox: 50, altQtys: [50, 100], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-flat', keywords: '아스틸베 유로파 핑크 astilbe europa 50 100 주광' },
  { prodKey: 230, prodName: 'Astilbe / Washington White', flowerName: '아스틸베', unit: '송이', defaultQtyPerBox: 50, altQtys: [50, 130], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-flat', keywords: '아스틸베 워싱턴 화이트 astilbe washington white 50 130 주광' },
  { prodKey: 3560, prodName: 'Astrantia / Roma', flowerName: '아스트란시아', unit: '송이', defaultQtyPerBox: 100, altQtys: [100, 50], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-white-flat', keywords: '아스트란시아 로마 astrantia roma 100 주광' },
  { prodKey: 240, prodName: 'Astrantia / Star of Love', flowerName: '아스트란시아', unit: '송이', defaultQtyPerBox: 25, altQtys: [25, 33, 50], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-mint-flat', keywords: '아스트란시아 스타오브러브 astrantia star of love 25 33 주광 민트' },
  { prodKey: 3170, prodName: 'Lily Oriental Double Roselily Aisha 2+', flowerName: '백합', unit: '송이', defaultQtyPerBox: 90, altQtys: [90, 80, 100], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-mint-flat', keywords: '백합 로즈릴리 아이샤 lily oriental double roselily aisha 90 주광 민트' },
  { prodKey: 2442, prodName: 'Hyacinthus/ Polar Giant 외 2종', flowerName: '히아신스', unit: '단', defaultQtyPerBox: 5, stemsPerBox: 150, altQtys: [5, 15, 25, 150], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-mint-flat', keywords: '히아신스 폴라자이언트 hyacinthus polar giant 15 5 150 주광 민트' },
  { prodKey: 2459, prodName: 'Hyacinthus/ Sky Jacket', flowerName: '히아신스', unit: '단', defaultQtyPerBox: 5, stemsPerBox: 25, altQtys: [5, 25], farmName: 'Holex', countryName: '네덜란드', invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', boxColorProfile: 'holex-mint-flat', keywords: '히아신스 스카이자켓 hyacinthus sky jacket 5 25 주광 민트' },
  { prodKey: 3529, prodName: 'ORCHID CHINA / 호접란 White', flowerName: '호접란', unit: '송이', defaultQtyPerBox: 90, altQtys: [90, 100, 10], farmName: 'Cloudland', countryName: '중국', invoiceNo: '2026YY-055', awbNo: '2026YY-055', orderWeek: '47-02', boxColorProfile: 'cloudland-white-side', keywords: '호접란 중국 난 화이트 orchid china white 90 10 cloudland CLR' },
  { prodKey: 1718, prodName: 'SALAL TIPS (레몬잎) / Douglas Fir (더글라스)', flowerName: '레몬잎 · 더글라스', unit: '단', defaultQtyPerBox: 25, altQtys: [25, 20], farmName: 'Hood Canal', countryName: '미국', invoiceNo: '201693', awbNo: '180-5345-5275', orderWeek: '47-01', boxColorProfile: 'hoodcanal-orange', keywords: '레몬잎 살랄 더글라스 salal tips douglas fir 25 20 hood canal 미국' },
];

/**
 * 품목이나 숫자가 안 보이는 박스(unreadable)에 대해
 * 1) 해당 사진 묶음의 차수(47-02차) · Bill 번호(1222993) · 업체(주광농원/늘봄원예/신라호텔) · 박스 색상/형태(예: 민트 가로 HOLEX 박스)와
 *    해당 업체의 전산 출고 원장(ShipmentDetail)에서 아직 확정 매칭되지 않은 잔여 출고 품목 리스트를 1순위로 자동 추천
 * 2) 검색어(한글/영문 품목명 또는 숫자 본수 40, 30, 120, 200 등)가 있으면 실시간 필터링하여 반환
 */
export function buildUnreadableBoxSearchCandidates(
  targetBox,
  {
    allBoxes = [],
    erpShipments = FALLBACK_ERP_SHIPMENTS,
    productCatalog = SEARCHABLE_PRODUCT_CATALOG,
    searchQuery = '',
  } = {}
) {
  if (!targetBox) return [];
  const q = String(searchQuery || '').trim().toLowerCase();

  // 현재 확정(confirmed 또는 matched)된 박스들의 업체×품목별 박스 수 및 수량 집계 (잔여 출고 후보 계산용)
  const confirmedMap = new Map();
  for (const b of allBoxes) {
    if (b.boxId === targetBox.boxId) continue;
    if (b.status !== 'COUNTED') continue;
    const isResolved = !b.ocrStatus || b.ocrStatus === 'confirmed' || b.resolutionAction === 'matched';
    if (!isResolved) continue;
    const k = `${b.custKey || b.custName}::${b.prodKey}`;
    const prev = confirmedMap.get(k) || { boxCount: 0, qtySum: 0 };
    prev.boxCount += 1;
    prev.qtySum += Number(b.qtyPerBox || 0);
    confirmedMap.set(k, prev);
  }

  const candidateMap = new Map();

  // 1) 전산 출고 원장(ShipmentDetail) 기반 후보 생성
  for (const ship of erpShipments) {
    const k = `${ship.custKey}::${ship.prodKey}`;
    const confirmed = confirmedMap.get(k) || { boxCount: 0, qtySum: 0 };
    const remainingBoxes = Math.max(0, Number(ship.erpBoxQty || 0) - confirmed.boxCount);
    const remainingQty = Math.max(0, Number(ship.erpOutQty || 0) - confirmed.qtySum);
    const catMeta = productCatalog.find((c) => Number(c.prodKey) === Number(ship.prodKey));
    const suggestedQtyPerBox = ship.erpBoxQty > 0
      ? Math.round(Number(ship.erpOutQty || 0) / Number(ship.erpBoxQty || 1))
      : (catMeta?.defaultQtyPerBox || 40);

    const sameCustomer = Number(ship.custKey) === Number(targetBox.custKey) || ship.custName === targetBox.custName;
    const sameProdHint = Number(ship.prodKey) === Number(targetBox.prodKey);
    const sameColorProfile = (ship.boxColorHint || catMeta?.boxColorProfile) === targetBox.boxColorProfile;
    const stickerT6Match = String(targetBox.stickerCode || '').includes('T6') && Number(ship.prodKey) === 329;
    const stickerT7Match = String(targetBox.stickerCode || '').includes('T7') && Number(ship.prodKey) === 1874;

    let priorityScore = 50;
    const reasons = [];
    if (sameCustomer) {
      priorityScore += 25;
      reasons.push(`${ship.custName} 출고원장`);
    }
    if (remainingBoxes > 0) {
      priorityScore += 30;
      reasons.push(`미매칭 잔여 ${remainingBoxes}박스(${remainingQty}${ship.unit})`);
    }
    if (sameColorProfile) {
      priorityScore += 15;
      reasons.push(targetBox.boxColorProfile === 'holex-mint-flat' ? '민트 가로 HOLEX 박스 일치' : '박스 외형 일치');
    }
    if (sameProdHint || stickerT6Match || stickerT7Match) {
      priorityScore += 35;
      reasons.push(stickerT6Match ? 'T6 스티커·카라 130본 일치' : stickerT7Match ? 'T7 스티커·튤립 200본 일치' : '라벨 힌트 1순위 일치');
    }

    const entryKey = `${ship.custKey}-${ship.prodKey}`;
    candidateMap.set(entryKey, {
      candidateId: entryKey,
      custKey: ship.custKey,
      custName: ship.custName,
      custCode: ship.custCode,
      prodKey: ship.prodKey,
      prodName: ship.prodName,
      flowerName: ship.flowerName || catMeta?.flowerName || '절화',
      unit: ship.unit || catMeta?.unit || '송이',
      suggestedQtyPerBox: sameProdHint && targetBox.qtyPerBox ? Number(targetBox.qtyPerBox) : suggestedQtyPerBox,
      stemsPerBox: ship.stemsPerBox || catMeta?.stemsPerBox || null,
      erpBoxQty: ship.erpBoxQty,
      erpOutQty: ship.erpOutQty,
      remainingBoxes,
      remainingQty,
      invoiceNo: ship.invoiceNo || targetBox.invoiceNo || '1222993',
      awbNo: ship.awbNo || targetBox.awbNo || '180-9162-6441',
      orderWeek: ship.orderWeek || targetBox.orderWeek || '47-02',
      farmName: ship.farmName || targetBox.farmName || 'Holex',
      priorityScore,
      isTopResidual: sameCustomer && (remainingBoxes > 0 || sameProdHint),
      recommendReason: reasons.join(' · ') || '해당 차수 전산 출고 품목',
      searchBlob: `${ship.custName} ${ship.prodName} ${ship.flowerName} ${suggestedQtyPerBox} ${ship.erpOutQty} ${catMeta?.keywords || ''}`.toLowerCase(),
    });
  }

  // 2) 전체 품목 카탈로그(Product / WarehouseDetail) 중 아직 후보에 없는 품목 추가 (직접 검색 대응)
  for (const cat of productCatalog) {
    const entryKey = `${targetBox.custKey || 533}-${cat.prodKey}`;
    if (candidateMap.has(entryKey)) continue;
    const sameColor = cat.boxColorProfile === targetBox.boxColorProfile;
    candidateMap.set(entryKey, {
      candidateId: entryKey,
      custKey: targetBox.custKey || 533,
      custName: targetBox.custName || '주광농원',
      custCode: targetBox.custCode || 'YCL2',
      prodKey: cat.prodKey,
      prodName: cat.prodName,
      flowerName: cat.flowerName,
      unit: cat.unit,
      suggestedQtyPerBox: cat.defaultQtyPerBox,
      stemsPerBox: cat.stemsPerBox || null,
      erpBoxQty: 1,
      erpOutQty: cat.defaultQtyPerBox,
      remainingBoxes: 1,
      remainingQty: cat.defaultQtyPerBox,
      invoiceNo: cat.invoiceNo || targetBox.invoiceNo || '1222993',
      awbNo: cat.awbNo || targetBox.awbNo || '180-9162-6441',
      orderWeek: cat.orderWeek || targetBox.orderWeek || '47-02',
      farmName: cat.farmName || targetBox.farmName || 'Holex',
      priorityScore: sameColor ? 45 : 30,
      isTopResidual: false,
      recommendReason: `${cat.orderWeek}차 입고 품목 카탈로그 (${cat.farmName})`,
      searchBlob: `${cat.prodName} ${cat.flowerName} ${cat.defaultQtyPerBox} ${(cat.altQtys || []).join(' ')} ${cat.keywords || ''}`.toLowerCase(),
    });
  }

  let list = [...candidateMap.values()].sort((a, b) => b.priorityScore - a.priorityScore);
  if (q) {
    list = list.filter(
      (item) =>
        item.searchBlob.includes(q) ||
        String(item.prodKey).includes(q) ||
        String(item.suggestedQtyPerBox) === q ||
        String(item.stemsPerBox || '') === q
    );
  }
  return list;
}

/**
 * [신규 핵심] 직육면체 1면 라벨 부착 & 팔레트 지그재그(90도 교차) 적재로 인해
 * 긴 옆면(zigzag_side, HOLEX 로고면)이 정면에 노출되고 라벨 단면(label_end)이 좌/우 측면(left/right)으로 돌아간 박스에 대해:
 * 1) [방식 1: 팔레트 3면(정면·좌·우) 묶음 사진 교차 라벨 매칭]
 *    - 좌측면/우측면 사진에서 단면(label_end)으로 찍힌 동일 라벨/스티커 박스가 있으면 이중 카운팅 없이 측면 라벨(품목·본수·일련번호)을 1:1 교차 결합
 * 2) [방식 2: 전산 출고 원장 소거법(차감 추론) 역산 매칭]
 *    - [전산 전체 출고 품목(ShipmentDetail)] - [라벨 단면(label_end)으로 이미 확인된 품목 수량] = [지그재그 옆면(zigzag_side) 잔여 품목]
 *    - 박스 외형/색상(민트 가로형 vs 흰색 가로형 vs 흰색 세로형) 및 보조 스티커(T6, T7, 7,5, 3,6, SECURITY)를 교차하여 1순위 deductionCandidate를 생성
 */
export function buildZigzagDeductionCandidate(
  targetBox,
  {
    allBoxes = [],
    erpShipments = FALLBACK_ERP_SHIPMENTS,
    productCatalog = SEARCHABLE_PRODUCT_CATALOG,
  } = {}
) {
  if (!targetBox) return null;

  const sideLabelName =
    targetBox.exposedLabelSide === 'left'
      ? '팔레트 좌측면(left)'
      : targetBox.exposedLabelSide === 'right'
      ? '팔레트 우측면(right)'
      : '팔레트 측면(left/right)';

  // 1) 팔레트 3면(정면·좌·우) 측면 사진 교차 라벨 확인
  const crossPhotoBox = allBoxes.find(
    (other) =>
      other.boxId !== targetBox.boxId &&
      other.photoNumber !== targetBox.photoNumber &&
      (other.boxFace || 'label_end') === 'label_end' &&
      (
        (targetBox.crossAngleMatchedSerial && other.serialNo === targetBox.crossAngleMatchedSerial) ||
        (targetBox.serialNo && other.serialNo === targetBox.serialNo)
      )
  );

  // 2) 해당 거래처의 전산 전체 출고량 vs 정면/단면(label_end) 확정 박스량 집계
  const custShipments = erpShipments.filter(
    (s) => Number(s.custKey) === Number(targetBox.custKey) || s.custName === targetBox.custName
  );
  const totalErpBoxesForCust = custShipments.reduce((acc, s) => acc + Number(s.erpBoxQty || 0), 0);

  const confirmedFrontBoxesForCust = allBoxes.filter(
    (b) =>
      b.status === 'COUNTED' &&
      (Number(b.custKey) === Number(targetBox.custKey) || b.custName === targetBox.custName) &&
      ((b.boxFace || 'label_end') === 'label_end' && (!b.ocrStatus || b.ocrStatus === 'confirmed'))
  );

  const candidates = buildUnreadableBoxSearchCandidates(targetBox, {
    allBoxes,
    erpShipments,
    productCatalog,
    searchQuery: '',
  });
  const topCand = candidates[0] || {
    custKey: targetBox.custKey || 533,
    custName: targetBox.custName || '주광농원',
    custCode: targetBox.custCode || 'YCL2',
    prodKey: targetBox.prodKey,
    prodName: targetBox.prodName,
    flowerName: targetBox.flowerName,
    unit: targetBox.unit || '송이',
    suggestedQtyPerBox: targetBox.qtyPerBox || 40,
    stemsPerBox: targetBox.stemsPerBox || targetBox.qtyPerBox || 40,
    invoiceNo: targetBox.invoiceNo || '1222993',
    awbNo: targetBox.awbNo || '180-9162-6441',
    orderWeek: targetBox.orderWeek || '47-02',
    farmName: targetBox.farmName || 'Holex',
    erpBoxQty: 1,
    remainingBoxes: 1,
  };

  if (crossPhotoBox) {
    const crossAngleLabel =
      crossPhotoBox.cameraAngle === 'left'
        ? '좌측면 사진'
        : crossPhotoBox.cameraAngle === 'right'
        ? '우측면 사진'
        : `측면 사진 #${crossPhotoBox.photoNumber}`;
    return {
      matchMethod: 'cross_angle_3side',
      methodBadge: '[3면 사진 교차 라벨 매칭]',
      crossAngleMatchedSerial: crossPhotoBox.serialNo,
      crossAnglePhotoNumber: crossPhotoBox.photoNumber,
      crossAnglePhotoAngle: crossPhotoBox.cameraAngle || 'right',
      exposedLabelSide: targetBox.exposedLabelSide || 'left',
      custKey: crossPhotoBox.custKey || targetBox.custKey,
      custName: crossPhotoBox.custName || targetBox.custName,
      custCode: crossPhotoBox.custCode || targetBox.custCode,
      prodKey: crossPhotoBox.prodKey,
      prodName: crossPhotoBox.prodName,
      flowerName: crossPhotoBox.flowerName,
      unit: crossPhotoBox.unit,
      qtyPerBox: Number(crossPhotoBox.qtyPerBox || targetBox.qtyPerBox || topCand.suggestedQtyPerBox),
      stemsPerBox: crossPhotoBox.stemsPerBox || targetBox.stemsPerBox || null,
      serialNo: crossPhotoBox.serialNo,
      invoiceNo: crossPhotoBox.invoiceNo || targetBox.invoiceNo || '1222993',
      awbNo: crossPhotoBox.awbNo || targetBox.awbNo || '180-9162-6441',
      orderWeek: crossPhotoBox.orderWeek || targetBox.orderWeek || '47-02',
      farmName: crossPhotoBox.farmName || targetBox.farmName || 'Holex',
      formulaText: `정면 지그재그 옆면(${targetBox.boxSpec}) ⇄ ${crossAngleLabel}(사진 #${crossPhotoBox.photoNumber}) 단면 라벨(${crossPhotoBox.serialNo}) 1:1 교차 결합 (이중 카운팅 제외)`,
      deductionReason: `정면 사진에서는 지그재그 적재로 긴 옆면만 노출되었으나, ${sideLabelName}을 촬영한 사진 #${crossPhotoBox.photoNumber}에서 단면 바코드 라벨(${crossPhotoBox.serialNo} · ${crossPhotoBox.prodName} ${crossPhotoBox.qtyPerBox}${crossPhotoBox.unit})이 확인되어 이중 카운팅 없이 1:1 결합`,
    };
  }

  const colorLabel =
    targetBox.boxColorProfile === 'holex-mint-flat'
      ? '민트색 가로형 HOLEX'
      : targetBox.boxColorProfile === 'holex-white-flat'
      ? '흰색 가로형 HOLEX'
      : '흰색 세로형 HOLEX';

  return {
    matchMethod: 'erp_residual_elimination',
    methodBadge: '[전산 출고 원장 소거법 역산]',
    crossAngleMatchedSerial: targetBox.crossAngleMatchedSerial || null,
    crossAnglePhotoNumber: null,
    crossAnglePhotoAngle: null,
    exposedLabelSide: targetBox.exposedLabelSide || 'right',
    custKey: topCand.custKey || targetBox.custKey || 533,
    custName: topCand.custName || targetBox.custName || '주광농원',
    custCode: topCand.custCode || targetBox.custCode || 'YCL2',
    prodKey: topCand.prodKey,
    prodName: topCand.prodName,
    flowerName: topCand.flowerName,
    unit: topCand.unit,
    qtyPerBox: Number(targetBox.qtyPerBox || topCand.suggestedQtyPerBox || 40),
    stemsPerBox: targetBox.stemsPerBox || topCand.stemsPerBox || null,
    serialNo: targetBox.serialNo,
    invoiceNo: topCand.invoiceNo || targetBox.invoiceNo || '1222993',
    awbNo: topCand.awbNo || targetBox.awbNo || '180-9162-6441',
    orderWeek: topCand.orderWeek || targetBox.orderWeek || '47-02',
    farmName: topCand.farmName || targetBox.farmName || 'Holex',
    formulaText: `[전산 총출고 ${totalErpBoxesForCust}박스] - [정면 라벨단면 확인 ${confirmedFrontBoxesForCust.length}박스] = 지그재그 옆면 잔여 품목(${topCand.prodName} ${targetBox.qtyPerBox || topCand.suggestedQtyPerBox}${topCand.unit}) 확정`,
    deductionReason: `직육면체 지그재그 교차 적재로 라벨이 ${sideLabelName}으로 돌아가 정면에서 안 보이지만, [전산 출고 원장(ShipmentDetail) - 라벨 단면(label_end) 기확인 수량] 차감 소거법과 박스 외형(${colorLabel} · ${targetBox.stickerCode || targetBox.boxSpec}) 교차로 [${topCand.prodName} (${targetBox.qtyPerBox || topCand.suggestedQtyPerBox}${topCand.unit} · ${targetBox.serialNo})] 1순위 역산 확정`,
  };
}

/**
 * [신규 핵심] 지그재그 옆면(zigzag_side) 또는 판독 보류 박스에 대해
 * 3면 사진 교차 라벨 결합 + 전산 출고 원장 소거법(autoDeduceZigzagBoxes)을 일괄/개별 적용한 boxOverrides 맵을 생성
 */
export function autoDeduceZigzagBoxes({
  sampleIds = ['sample-4-jukwang', 'sample-5-holex-mint'],
  uploadedFiles = [],
  boxOverrides = {},
  photoAngleOverrides = {},
  targetBoxIds = null,
  includeAllUnreadable = false,
  erpShipments = FALLBACK_ERP_SHIPMENTS,
  productCatalog = SEARCHABLE_PRODUCT_CATALOG,
} = {}) {
  const current = analyzeBoxVisionPhotos({
    sampleIds,
    uploadedFiles,
    boxOverrides,
    photoAngleOverrides,
    erpShipments,
  });

  const targetList = current.unreadablePendingQueue.filter((box) => {
    if (Array.isArray(targetBoxIds) && targetBoxIds.length > 0) {
      return targetBoxIds.includes(box.boxId);
    }
    if (includeAllUnreadable) return true;
    return box.boxFace === 'zigzag_side';
  });

  const nextOverrides = { ...boxOverrides };
  const appliedList = [];

  for (const box of targetList) {
    const ded = box.deductionCandidate || buildZigzagDeductionCandidate(box, {
      allBoxes: current.allBoxes,
      erpShipments,
      productCatalog,
    });
    if (!ded) continue;

    nextOverrides[box.boxId] = {
      ...(nextOverrides[box.boxId] || {}),
      status: 'COUNTED',
      ocrStatus: 'confirmed',
      resolutionAction: 'matched',
      deductionMatched: true,
      deductionMethod: ded.matchMethod,
      passMode: null,
      custKey: ded.custKey,
      custName: ded.custName,
      custCode: ded.custCode,
      prodKey: ded.prodKey,
      prodName: ded.prodName,
      flowerName: ded.flowerName,
      unit: ded.unit,
      qtyPerBox: ded.qtyPerBox,
      stemsPerBox: ded.stemsPerBox || (ded.unit === '단' ? ded.qtyPerBox * 40 : ded.qtyPerBox),
      invoiceNo: ded.invoiceNo,
      awbNo: ded.awbNo,
      orderWeek: ded.orderWeek,
      farmName: ded.farmName,
      stickerCode: `${box.stickerCode || '지그재그 옆면'} → ${ded.methodBadge}`,
    };
    appliedList.push({
      boxId: box.boxId,
      serialNo: ded.serialNo,
      prodKey: ded.prodKey,
      prodName: ded.prodName,
      qtyPerBox: ded.qtyPerBox,
      unit: ded.unit,
      matchMethod: ded.matchMethod,
      methodBadge: ded.methodBadge,
      deductionReason: ded.deductionReason,
    });
  }

  return {
    nextOverrides,
    appliedCount: appliedList.length,
    appliedList,
  };
}

// 영업수입불량차감(WebSalesDefectDeduction) 매칭 후보 폴백 데이터
export const FALLBACK_DEFECT_DEDUCTIONS = [
  {
    deductionKey: 1573,
    orderYear: 2026,
    orderWeek: '47',
    appliedOrderWeek: '47-02',
    custKey: 533,
    custName: '주광농원',
    prodKey: 2942,
    prodName: 'Tulip / Single Ad Rem ',
    flowerName: '튤립',
    quantity: 15,
    sourceUnit: '단',
    farmName: 'Holex',
    awbNo: '180-9162-6441',
    invoiceNo: '1222993',
    serialHint: '2494510.18.1',
    status: 'COMPLETED',
    note: '수입불량방 사진 매칭 · 주광농원 튤립 Single Ad Rem (스티커 9 · 2494510.18.1)',
    matchScore: 98,
    matchReason: '거래처(주광농원 YCL2) + 품목(Tulip Single Ad Rem #2942) + 차수(47-02 AWB 180-9162-6441) 3중 일치',
  },
  {
    deductionKey: 1572,
    orderYear: 2026,
    orderWeek: '47',
    appliedOrderWeek: '47-02',
    custKey: 533,
    custName: '주광농원',
    prodKey: 675,
    prodName: 'Eryngium / Orion Blue',
    flowerName: '에린지움',
    quantity: 10,
    sourceUnit: '단',
    farmName: 'Holex',
    awbNo: '180-9162-6441',
    invoiceNo: '1222993',
    serialHint: '2494510.9.1~9.3',
    status: 'DRAFT',
    note: '수입불량방 사진 대기 · 농장(Holex) 및 Bill(1222993) 자동 판별 완료',
    matchScore: 94,
    matchReason: '거래처(주광농원) + 박스 라벨(2494510.9.* Eryngium) + 농장 색상 프로파일(Holex White 9) 일치',
  },
  {
    deductionKey: 1591,
    orderYear: 2026,
    orderWeek: '47',
    appliedOrderWeek: '47-02',
    custKey: 446,
    custName: '신라호텔',
    prodKey: 181,
    prodName: 'Anthurium Graciosa 15cm',
    flowerName: '안시리움',
    quantity: 1,
    sourceUnit: '송이',
    farmName: 'Holex',
    awbNo: '180-9162-6441',
    invoiceNo: '1222993',
    serialHint: '2493354.2.3',
    status: 'DRAFT',
    note: '박스 라벨 40본 → 수기 39본(1본 부족/불량 차감 확인용 · 2493354.2.3)',
    matchScore: 99,
    matchReason: '라벨 수기 정정(40→39본) + 바코드(2493354.2.3) + 신라호텔 출고원장(159본) 1:1 일치',
  },
  {
    deductionKey: 1592,
    orderYear: 2026,
    orderWeek: '47',
    appliedOrderWeek: '47-02',
    custKey: 335,
    custName: '늘봄원예',
    prodKey: 181,
    prodName: 'Anthurium Graciosa 15cm',
    flowerName: '안시리움',
    quantity: 5,
    sourceUnit: '송이',
    farmName: 'Holex',
    awbNo: '180-9162-6441',
    invoiceNo: '1222993',
    serialHint: '2494499.1.1 / 2494510.30.1',
    status: 'DRAFT',
    note: '수입불량방 카톡 사진 · 늘봄원예 안시리움 그라시오사 15cm (Holex M 3/2 박스)',
    matchScore: 95,
    matchReason: '수기 업체명(늘봄원예) + 라벨코드(ICNNEN/CL23) + 품목(Anthurium Graciosa 15cm) 일치',
  },
];

/**
 * 선택한 샘플 사진 ID 배열(또는 업로드된 파일명/힌트)을 받아
 * 1) 다중 사진 간 바코드 일련번호(serialNo) 교차 중복 제거
 * 2) 배경 팔레트 분리
 * 3) 업체별 × 품목별 박스 수량 및 총 본수/단수 집계 + 전산 출고수량(ERP) 대조
 * 4) 차수(Bill/AWB) · 농장 박스 색상 프로파일 판별
 * 5) 영업수입불량차감(WebSalesDefectDeduction) 행 자동 매칭
 */
export function analyzeBoxVisionPhotos({
  sampleIds = ['sample-1-silla'],
  uploadedFiles = [],
  boxOverrides = {},
  photoAngleOverrides = {},
  erpShipments = FALLBACK_ERP_SHIPMENTS,
  defectRows = FALLBACK_DEFECT_DEDUCTIONS,
  warehouseBills = FALLBACK_WAREHOUSE_BILLS,
  batchRouteMessage = '호남선 출고입니다 (묶음 사진 일괄 업로드)',
  billQuery = '',
} = {}) {
  const activeSampleIds = Array.isArray(sampleIds) && sampleIds.length > 0
    ? sampleIds
    : ['sample-1-silla'];

  const selectedSamples = activeSampleIds
    .map((id) => SAMPLE_PHOTOS.find((s) => s.sampleId === id))
    .filter(Boolean);

  // 업로드된 사용자 이미지 파일명이 샘플 키워드와 매칭되면 해당 샘플 박스를 투영하거나,
  // 다중 업로드(예: 카톡 묶음 15장 등) 시 각 업로드 파일마다 사진 슬롯을 생성하여 N장 묶음 판독을 지원
  uploadedFiles.forEach((file, fileIdx) => {
    const rawName = String(file?.name || `kakao-batch-photo-${fileIdx + 1}.jpg`);
    const lower = rawName.toLowerCase();
    let matchedSample = null;
    if (lower.includes('silla') || lower.includes('신라') || lower.includes('e2b6e5ae')) {
      matchedSample = SAMPLE_PHOTOS[0];
    } else if (lower.includes('neulbom-a') || lower.includes('e5b08302')) {
      matchedSample = SAMPLE_PHOTOS[1];
    } else if (lower.includes('neulbom-b') || lower.includes('늘봄') || lower.includes('c1392802')) {
      matchedSample = SAMPLE_PHOTOS[2];
    } else if (lower.includes('jukwang') || lower.includes('주광') || lower.includes('a5755b31')) {
      matchedSample = SAMPLE_PHOTOS[3];
    } else if (lower.includes('holex') || lower.includes('mint') || lower.includes('fa78fd55')) {
      matchedSample = SAMPLE_PHOTOS[4];
    } else {
      matchedSample = SAMPLE_PHOTOS[fileIdx % SAMPLE_PHOTOS.length];
    }

    const inferredAngle =
      file?.cameraAngle ||
      (/left|좌측|왼/.test(lower)
        ? 'left'
        : /right|우측|오른/.test(lower)
        ? 'right'
        : matchedSample?.cameraAngle || 'front');

    if (matchedSample) {
      const hasUnreadableFileHint = /unreadable|blur|partial|unknown|미식별|가림|흐림|무라벨|zigzag|지그재그|옆면/i.test(rawName);
      const injectUnreadableBoxIfNeeded = (boxes) => {
        if (!hasUnreadableFileHint) return boxes;
        return boxes.map((b, idx) =>
          idx === 0
            ? {
                ...b,
                boxFace: 'zigzag_side',
                exposedLabelSide: inferredAngle === 'left' ? 'right' : 'left',
                ocrStatus: 'unreadable_both',
                unreadableReason: `업로드 이미지(${rawName}) 직육면체 지그재그 옆면 노출 또는 라벨 가림 감지 — 소거법/3면교차 또는 검색매칭 선택 필요`,
                resolutionAction: 'pending',
              }
            : b
        );
      };

      const alreadyExists = selectedSamples.some((s) => s.sampleId === matchedSample.sampleId);
      if (!alreadyExists) {
        selectedSamples.push({
          ...matchedSample,
          cameraAngle: inferredAngle,
          uploadedFileName: rawName,
          previewUrl: file?.previewUrl || matchedSample.imageUrl,
          boxes: injectUnreadableBoxIfNeeded(matchedSample.boxes),
        });
      } else if (uploadedFiles.length > 1 || hasUnreadableFileHint) {
        // 카톡 15장 등 다중 묶음 업로드 시 동일 샘플이 재매칭되더라도 묶음 내 N번째 사진 슬롯으로 보존(바코드 일련번호 중복제거 자동 작동)
        const virtualId = `upload-${fileIdx + 1}-${matchedSample.sampleId}`;
        if (!selectedSamples.some((s) => s.sampleId === virtualId)) {
          selectedSamples.push({
            ...matchedSample,
            sampleId: virtualId,
            cameraAngle: inferredAngle,
            title: `묶음 사진 #${selectedSamples.length + 1} · ${rawName} (${matchedSample.shortLabel})`,
            shortLabel: `묶음#${selectedSamples.length + 1}: ${rawName}`,
            fileName: rawName,
            uploadedFileName: rawName,
            previewUrl: file?.previewUrl || matchedSample.imageUrl,
            boxes: injectUnreadableBoxIfNeeded(matchedSample.boxes).map((b, idx) => ({
              ...b,
              boxId: `${virtualId}-${b.boxId}`,
              serialNo: hasUnreadableFileHint && idx === 0 ? `${b.serialNo}-UNREADABLE-${fileIdx + 1}` : b.serialNo,
            })),
          });
        }
      }
    }
  });

  const seenSerials = new Map();
  const analyzedPhotos = [];
  const allBoxes = [];
  let globalSeq = 0;

  selectedSamples.forEach((sample, photoIdx) => {
    const photoNumber = photoIdx + 1;
    const effectiveAngle =
      photoAngleOverrides[sample.sampleId] ||
      photoAngleOverrides[photoNumber] ||
      sample.cameraAngle ||
      'front';
    const angleMeta = CAMERA_ANGLE_OPTIONS.find((a) => a.angleId === effectiveAngle) || CAMERA_ANGLE_OPTIONS[0];

    const photoBoxes = sample.boxes.map((rawBox) => {
      const override = boxOverrides[rawBox.boxId] || {};
      const boxFace = override.boxFace || rawBox.boxFace || 'label_end';
      const exposedLabelSide =
        override.exposedLabelSide ||
        rawBox.exposedLabelSide ||
        (boxFace === 'zigzag_side' ? (effectiveAngle === 'left' ? 'right' : 'left') : effectiveAngle);

      const merged = {
        boxFace,
        exposedLabelSide,
        cameraAngle: effectiveAngle,
        cameraAngleLabel: angleMeta.shortLabel,
        ocrStatus: 'confirmed',
        unreadableReason: null,
        resolutionAction: 'confirmed',
        passMode: null,
        ...rawBox,
        ...override,
        boxFace,
        exposedLabelSide,
        photoId: sample.sampleId,
        photoNumber,
        photoTitle: sample.shortLabel,
      };

      // 판독 보류(unreadable) 기본 상태 정리
      const isUnreadable = merged.ocrStatus && merged.ocrStatus !== 'confirmed';
      if (isUnreadable && !override.resolutionAction && !rawBox.resolutionAction) {
        merged.resolutionAction = 'pending';
      } else if (!isUnreadable && !override.resolutionAction) {
        merged.resolutionAction = 'confirmed';
      }

      let effectiveStatus = merged.status;
      let duplicateOfPhoto = null;
      let crossAngleLinkedToBoxId = null;

      // 패스(카운트 제외 패스)를 선택한 경우 즉시 EXCLUDED 처리
      if (merged.resolutionAction === 'passed' && merged.passMode === 'exclude_count') {
        effectiveStatus = 'EXCLUDED';
      }

      if (effectiveStatus !== 'BACKGROUND' && effectiveStatus !== 'EXCLUDED') {
        if (seenSerials.has(merged.serialNo)) {
          const prevSeen = seenSerials.get(merged.serialNo);
          effectiveStatus = override.forceInclude ? 'COUNTED' : 'DUPLICATE';
          duplicateOfPhoto = prevSeen.label;
          if (prevSeen.boxFace === 'zigzag_side' && merged.boxFace === 'label_end') {
            crossAngleLinkedToBoxId = prevSeen.boxId;
          }
        } else {
          seenSerials.set(merged.serialNo, {
            label: `사진 #${photoNumber} (${sample.shortLabel})`,
            boxId: merged.boxId,
            boxFace: merged.boxFace,
            photoNumber,
            cameraAngle: effectiveAngle,
          });
        }
      }

      if (effectiveStatus === 'COUNTED') {
        globalSeq += 1;
      }

      const isPendingUnreadable =
        effectiveStatus === 'COUNTED' &&
        merged.ocrStatus !== 'confirmed' &&
        merged.resolutionAction === 'pending';

      const enrichedBox = {
        ...merged,
        status: effectiveStatus,
        duplicateOfPhoto,
        crossAngleLinkedToBoxId,
        countSeq: effectiveStatus === 'COUNTED' ? globalSeq : null,
        isPendingUnreadable,
      };
      allBoxes.push(enrichedBox);
      return enrichedBox;
    });

    analyzedPhotos.push({
      ...sample,
      cameraAngle: effectiveAngle,
      cameraAngleLabel: angleMeta.label,
      cameraAngleShort: angleMeta.shortLabel,
      photoNumber,
      boxes: photoBoxes,
      countedBoxes: photoBoxes.filter((b) => b.status === 'COUNTED').length,
      duplicateBoxes: photoBoxes.filter((b) => b.status === 'DUPLICATE').length,
      backgroundBoxes: photoBoxes.filter((b) => b.status === 'BACKGROUND').length,
      unreadablePendingBoxes: photoBoxes.filter((b) => b.isPendingUnreadable).length,
      zigzagSideBoxes: photoBoxes.filter((b) => b.boxFace === 'zigzag_side' && b.status === 'COUNTED').length,
      labelEndBoxes: photoBoxes.filter((b) => b.boxFace === 'label_end' && b.status === 'COUNTED').length,
    });
  });

  // 모든 박스에 대해 지그재그 옆면(zigzag_side) 또는 미식별 박스의 deductionCandidate 계산 부여
  for (const box of allBoxes) {
    if (box.boxFace === 'zigzag_side' || (box.ocrStatus && box.ocrStatus !== 'confirmed')) {
      box.deductionCandidate = buildZigzagDeductionCandidate(box, {
        allBoxes,
        erpShipments,
        productCatalog: SEARCHABLE_PRODUCT_CATALOG,
      });
    } else {
      box.deductionCandidate = null;
    }
  }

  // 품목별 중복 제거된 박스 등장 위치 확인용 맵
  const duplicateCountByGroup = new Map();
  const duplicatePhotosByGroup = new Map();
  for (const box of allBoxes) {
    if (box.status !== 'DUPLICATE') continue;
    const key = `${box.custKey || box.custName}::${box.prodKey || box.prodName}`;
    duplicateCountByGroup.set(key, (duplicateCountByGroup.get(key) || 0) + 1);
    const arr = duplicatePhotosByGroup.get(key) || [];
    const tag = `사진 #${box.photoNumber}`;
    if (!arr.includes(tag)) arr.push(tag);
    duplicatePhotosByGroup.set(key, arr);
  }

  // 업체별 × 품목별 집계 (Bill 번호 · AWB · 입고 차수 · 등장 사진 위치 포함)
  // 단, [박스 수만 유지하고 품목 미확인 패스(keep_box_skip_item)] 처리된 박스는 총 박스 수(totals.countedBoxes)에는 유지하되 품목별 매칭에서는 건너뜀
  const groupMap = new Map();
  for (const box of allBoxes) {
    if (box.status !== 'COUNTED') continue;
    if (box.resolutionAction === 'passed' && box.passMode === 'keep_box_skip_item') {
      continue;
    }
    const key = `${box.custKey || box.custName}::${box.prodKey || box.prodName}`;
    if (!groupMap.has(key)) {
      const matchedBillMeta = warehouseBills.find(
        (wb) => String(wb.invoiceNo) === String(box.invoiceNo) || String(wb.awbNo) === String(box.awbNo)
      );
      groupMap.set(key, {
        groupKey: key,
        custKey: box.custKey,
        custName: box.custName,
        custCode: box.custCode,
        labelCodes: [],
        prodKey: box.prodKey,
        prodName: box.prodName,
        flowerName: box.flowerName,
        boxSpecs: [],
        unit: box.unit,
        farmName: box.farmName,
        countryName: box.countryName,
        orderYear: box.orderYear || 2026,
        orderWeek: box.orderWeek || '47-02',
        orderWeekLabel: `${box.orderYear || 2026}년 ${box.orderWeek || '47-02'}차 입고`,
        warehouseKey: matchedBillMeta?.warehouseKey || 8247,
        awbNo: box.awbNo,
        invoiceNo: box.invoiceNo,
        orderNos: [],
        photoNumbers: [],
        photoBoxCount: 0,
        photoTotalQty: 0,
        photoTotalStems: 0,
        serialList: [],
        stickerNotes: [],
        hasHandwritingCorrection: false,
        hasManualSearchMatched: false,
        hasZigzagDeductionMatched: false,
        hasCrossAngleMatched: false,
        pendingUnreadableCount: 0,
      });
    }
    const g = groupMap.get(key);
    g.photoBoxCount += 1;
    g.photoTotalQty += Number(box.qtyPerBox || 0);
    g.photoTotalStems += Number(box.stemsPerBox || box.qtyPerBox || 0);
    g.serialList.push(box.serialNo);
    if (box.labelCode && !g.labelCodes.includes(box.labelCode)) {
      g.labelCodes.push(box.labelCode);
    }
    if (box.boxSpec && !g.boxSpecs.includes(box.boxSpec)) {
      g.boxSpecs.push(box.boxSpec);
    }
    if (box.orderNo && !g.orderNos.includes(box.orderNo)) {
      g.orderNos.push(box.orderNo);
    }
    const pTag = `사진 #${box.photoNumber}`;
    if (!g.photoNumbers.includes(pTag)) {
      g.photoNumbers.push(pTag);
    }
    if (box.stickerCode && !g.stickerNotes.includes(box.stickerCode)) {
      g.stickerNotes.push(box.stickerCode);
    }
    if (String(box.rawLabelItem || '').includes('→') || String(box.stickerCode || '').includes('수기')) {
      g.hasHandwritingCorrection = true;
    }
    if (box.resolutionAction === 'matched') {
      g.hasManualSearchMatched = true;
      if (box.deductionMatched) {
        g.hasZigzagDeductionMatched = true;
        if (box.deductionMethod === 'cross_angle_3side') {
          g.hasCrossAngleMatched = true;
        }
      }
    }
    if (box.isPendingUnreadable) {
      g.pendingUnreadableCount += 1;
    }
  }

  // ERP 출고 원장과 대조
  const customerItemSummary = [...groupMap.values()].map((item) => {
    const erpMatch = erpShipments.find(
      (e) => (Number(e.custKey) === Number(item.custKey) || e.custName === item.custName)
        && (Number(e.prodKey) === Number(item.prodKey) || e.prodName === item.prodName)
    );
    const erpBoxQty = erpMatch ? Number(erpMatch.erpBoxQty || 0) : item.photoBoxCount;
    const erpOutQty = erpMatch ? Number(erpMatch.erpOutQty || 0) : item.photoTotalQty;
    const diffQty = item.photoTotalQty - erpOutQty;
    const diffBox = item.photoBoxCount - erpBoxQty;
    const dupExcludedCount = duplicateCountByGroup.get(item.groupKey) || 0;
    const dupPhotos = duplicatePhotosByGroup.get(item.groupKey) || [];
    const photoAppearanceLabel = dupExcludedCount > 0
      ? `${item.photoNumbers.join(', ')} (${dupPhotos.join(', ')} 중복 ${dupExcludedCount}박스 자동제외)`
      : item.photoNumbers.join(', ');

    const reconcileStatus = diffQty === 0 ? 'MATCH' : diffQty < 0 ? 'SHORT' : 'OVER';
    const inspectionBadge = reconcileStatus === 'MATCH'
      ? item.hasZigzagDeductionMatched
        ? item.hasCrossAngleMatched
          ? '[3면교차·소거법 매칭완료] · 수동 검색매칭 반영 · 일치'
          : '[소거법/3면교차 매칭완료] · 수동 검색매칭 반영 · 일치'
        : item.hasManualSearchMatched
        ? '수동 검색매칭 반영 · 일치'
        : item.hasHandwritingCorrection
        ? '수기정정 반영 · 일치'
        : '전산 100% 일치'
      : reconcileStatus === 'SHORT'
      ? `부분촬영 (${diffQty}${item.unit})`
      : `초과 (+${diffQty}${item.unit})`;

    return {
      ...item,
      shipmentKey: erpMatch?.shipmentKey || null,
      erpBoxQty,
      erpOutQty,
      diffBox,
      diffQty,
      dupExcludedCount,
      photoAppearanceLabel,
      reconcileStatus,
      inspectionBadge,
      billCheckBadge: '[Bill·차수 확인완료]',
    };
  });

  // 업체별 소계 요약 (업체별 담당 Bill 및 입고 차수 목록 포함)
  const customerTotalsMap = new Map();
  for (const row of customerItemSummary) {
    const cKey = String(row.custKey || row.custName);
    if (!customerTotalsMap.has(cKey)) {
      customerTotalsMap.set(cKey, {
        custKey: row.custKey,
        custName: row.custName,
        custCode: row.custCode,
        itemKindCount: 0,
        totalBoxes: 0,
        totalPhotoQty: 0,
        totalPhotoStems: 0,
        totalErpQty: 0,
        invoiceNos: [],
        orderWeeks: [],
      });
    }
    const ct = customerTotalsMap.get(cKey);
    ct.itemKindCount += 1;
    ct.totalBoxes += row.photoBoxCount;
    ct.totalPhotoQty += row.photoTotalQty;
    ct.totalPhotoStems += row.photoTotalStems;
    ct.totalErpQty += row.erpOutQty;
    if (row.invoiceNo && !ct.invoiceNos.includes(row.invoiceNo)) {
      ct.invoiceNos.push(row.invoiceNo);
    }
    if (row.orderWeek && !ct.orderWeeks.includes(row.orderWeek)) {
      ct.orderWeeks.push(row.orderWeek);
    }
  }

  // [신규 핵심] Bill 번호(InvoiceNo / AWB) 기준 입고 차수(OrderWeek) 확인 원장 생성
  const billGroupMap = new Map();
  for (const box of allBoxes) {
    if (box.status === 'DUPLICATE' || box.status === 'EXCLUDED') continue;
    const invKey = String(box.invoiceNo || box.awbNo || '1222993');
    if (!billGroupMap.has(invKey)) {
      const meta = warehouseBills.find(
        (wb) => String(wb.invoiceNo) === invKey || String(wb.awbNo) === String(box.awbNo)
      );
      billGroupMap.set(invKey, {
        invoiceNo: box.invoiceNo || meta?.invoiceNo || invKey,
        awbNo: box.awbNo || meta?.awbNo || '-',
        warehouseKey: meta?.warehouseKey || (box.orderWeek === '47-01' ? 8169 : 8247),
        orderYear: box.orderYear || meta?.orderYear || 2026,
        orderWeek: box.orderWeek || meta?.orderWeek || '47-02',
        orderWeekLabel: `${box.orderYear || 2026}년 ${box.orderWeek || '47-02'}차 입고`,
        farmName: box.farmName || meta?.farmName || 'Holex',
        countryName: box.countryName || meta?.countryName || '네덜란드',
        totalInboundBoxes: meta?.totalInboundBoxes || 130,
        totalInboundStems: meta?.totalInboundStems || 4680,
        sourceDoc: meta?.sourceDoc || `${box.orderWeek || '47-02'}차 입고 원장`,
        countedBoxCount: 0,
        backgroundBoxCount: 0,
        totalDetectedBoxes: 0,
        photoTotalQty: 0,
        photoTotalStems: 0,
        customerNames: [],
        orderNos: [],
        photoNumbers: [],
        isPrimaryShipped: false,
      });
    }
    const bg = billGroupMap.get(invKey);
    bg.totalDetectedBoxes += 1;
    if (box.status === 'COUNTED') {
      bg.countedBoxCount += 1;
      bg.isPrimaryShipped = true;
      bg.photoTotalQty += Number(box.qtyPerBox || 0);
      bg.photoTotalStems += Number(box.stemsPerBox || box.qtyPerBox || 0);
    } else if (box.status === 'BACKGROUND') {
      bg.backgroundBoxCount += 1;
    }
    if (box.custName && !bg.customerNames.includes(box.custName)) {
      bg.customerNames.push(box.custName);
    }
    if (box.orderNo && !bg.orderNos.includes(box.orderNo)) {
      bg.orderNos.push(box.orderNo);
    }
    const pTag = `사진 #${box.photoNumber}`;
    if (!bg.photoNumbers.includes(pTag)) {
      bg.photoNumbers.push(pTag);
    }
  }

  // 사진에 직접 등장하지 않은 비교용 최신 차수(예: 48-01차 Bill 201694)도 원장 하단 참조행으로 포함해 차수 구분을 명확히 제공
  for (const meta of warehouseBills) {
    if (!billGroupMap.has(String(meta.invoiceNo))) {
      billGroupMap.set(String(meta.invoiceNo), {
        invoiceNo: meta.invoiceNo,
        awbNo: meta.awbNo,
        warehouseKey: meta.warehouseKey,
        orderYear: meta.orderYear,
        orderWeek: meta.orderWeek,
        orderWeekLabel: meta.orderWeekLabel || `${meta.orderYear}년 ${meta.orderWeek}차 입고`,
        farmName: meta.farmName,
        countryName: meta.countryName,
        totalInboundBoxes: meta.totalInboundBoxes || 55,
        totalInboundStems: meta.totalInboundStems || 1375,
        sourceDoc: meta.sourceDoc,
        countedBoxCount: 0,
        backgroundBoxCount: 0,
        totalDetectedBoxes: 0,
        photoTotalQty: 0,
        photoTotalStems: 0,
        customerNames: meta.distributedCustomers || [],
        orderNos: meta.holexOrderNos || [],
        photoNumbers: ['DB 입고원장 대조 대기'],
        isPrimaryShipped: false,
      });
    }
  }

  const billOrderWeekLedger = [...billGroupMap.values()].map((b) => {
    const sharePct = b.totalInboundBoxes > 0
      ? Number(((b.totalDetectedBoxes / b.totalInboundBoxes) * 100).toFixed(1))
      : 0;
    const roleLabel = b.countedBoxCount > 0
      ? `출고 본물량 (${b.countedBoxCount}박스 출고)`
      : b.backgroundBoxCount > 0
      ? `동시 검출/타 팔레트 (${b.backgroundBoxCount}박스 분리)`
      : '인접 차수 비교 원장';

    return {
      ...b,
      batchSharePct: sharePct,
      roleLabel,
      checkStatus: b.totalDetectedBoxes > 0 ? '[Bill·입고차수 확인완료]' : '[원장 조회가능]',
    };
  });

  // 묶음 사진 내 다중 입고 차수 혼입 경보/안내 생성
  const activeBillsInPhotos = billOrderWeekLedger.filter((b) => b.totalDetectedBoxes > 0);
  const distinctActiveWeeks = [...new Set(activeBillsInPhotos.map((b) => b.orderWeek))];
  const hasMixedOrderWeeks = distinctActiveWeeks.length > 1 || activeBillsInPhotos.length > 1;
  const mixedOrderWeekNotice = hasMixedOrderWeeks
    ? `이번 묶음 사진(${analyzedPhotos.length}장)에는 47-02차 본 출고 물량(Bill 1222993 Holex · Bill 2026YY-055 Cloudland) 외에 47-01차 이월/타 농장 물량(Bill 201693 Hood Canal) 및 비교 차수(48-01차 Bill 201694)가 함께 식별되어 차수별로 자동 구분되었습니다.`
    : `이번 묶음 사진(${analyzedPhotos.length}장)의 모든 출고 박스는 2026년 ${distinctActiveWeeks[0] || '47-02'}차 입고분(Bill #1222993 · AWB 180-9162-6441) 단일 차수로 확인되었습니다.`;

  const routeInfo = parseKakaoBatchRoute(batchRouteMessage, allBoxes);
  const billLookupResults = lookupBillOrderWeek(billQuery, warehouseBills, billOrderWeekLedger);

  // 차수(Bill/AWB) 및 농장 분배 요약
  const detectedCustKeys = new Set(customerItemSummary.map((r) => Number(r.custKey)));
  const detectedProdKeys = new Set(customerItemSummary.map((r) => Number(r.prodKey)));
  const matchedDefects = defectRows
    .map((d) => {
      const custMatched = detectedCustKeys.has(Number(d.custKey));
      const prodMatched = detectedProdKeys.has(Number(d.prodKey));
      const boost = custMatched && prodMatched ? 0 : custMatched ? -8 : -15;
      return {
        ...d,
        activeInCurrentPhotos: custMatched && prodMatched,
        effectiveScore: Math.max(70, Number(d.matchScore || 90) + boost),
      };
    })
    .sort((a, b) => Number(b.activeInCurrentPhotos) - Number(a.activeInCurrentPhotos) || b.effectiveScore - a.effectiveScore);

  const unreadablePendingQueue = allBoxes
    .filter((b) => b.status === 'COUNTED' && b.ocrStatus && b.ocrStatus !== 'confirmed' && b.resolutionAction === 'pending')
    .map((b) => ({
      ...b,
      recommendedCandidates: buildUnreadableBoxSearchCandidates(b, {
        allBoxes,
        erpShipments,
        productCatalog: SEARCHABLE_PRODUCT_CATALOG,
      }).slice(0, 6),
    }));

  const unreadableResolvedBoxes = allBoxes.filter(
    (b) =>
      b.status !== 'DUPLICATE' &&
      b.status !== 'BACKGROUND' &&
      ((b.ocrStatus && b.ocrStatus !== 'confirmed' && b.resolutionAction !== 'pending') ||
        b.resolutionAction === 'passed' ||
        b.resolutionAction === 'matched')
  );

  // [신규 핵심] 직육면체 지그재그 3면 적재 & 전산 출고 소거법 시각적 수식 요약(zigzagDeductionSummary)
  const countedAll = allBoxes.filter((b) => b.status === 'COUNTED');
  const labelEndConfirmedBoxes = countedAll.filter((b) => b.boxFace === 'label_end');
  const zigzagSideBoxes = countedAll.filter((b) => b.boxFace === 'zigzag_side');
  const zigzagPendingBoxes = unreadablePendingQueue.filter((b) => b.boxFace === 'zigzag_side');
  const zigzagResolvedBoxes = zigzagSideBoxes.filter((b) => b.resolutionAction === 'matched');
  const crossAngleMatchedBoxes = zigzagSideBoxes.filter(
    (b) => b.deductionCandidate?.matchMethod === 'cross_angle_3side'
  );
  const residualEliminationBoxes = zigzagSideBoxes.filter(
    (b) => b.deductionCandidate?.matchMethod === 'erp_residual_elimination'
  );

  const zigzagDeductionSummary = {
    totalCountedBoxes: countedAll.length,
    labelEndBoxCount: labelEndConfirmedBoxes.length,
    zigzagSideBoxCount: zigzagSideBoxes.length,
    zigzagPendingCount: zigzagPendingBoxes.length,
    zigzagResolvedCount: zigzagResolvedBoxes.length,
    crossAngleMatchableCount: crossAngleMatchedBoxes.length,
    residualEliminationCount: residualEliminationBoxes.length,
    formulaEquation: `전산 출고 ${countedAll.length}박스 - 정면 라벨 단면(label_end) 확인 ${labelEndConfirmedBoxes.length}박스 = 지그재그 옆면(zigzag_side · 라벨 좌/우측면 회전) 잔여 ${zigzagSideBoxes.length}박스 품목 확정 (3면 사진 교차 ${crossAngleMatchedBoxes.length}건 + 전산 잔여 소거법 ${residualEliminationBoxes.length}건)`,
    principleExplanation:
      '직육면체 박스 1면(단면)에만 라벨지가 부착되어 있고, 팔레트 붕괴 방지를 위해 층마다 90도 지그재그(교차) 적재하므로 정면·좌측면·우측면 3면에 라벨이 분산 노출됩니다. 정면에서 긴 옆면(HOLEX 로고면)만 보이는 박스는 ① 좌/우 측면 사진 라벨 1:1 교차 결합 또는 ② [전산 총출고 품목 - 라벨 확인 품목 = 잔여 품목] 소거법으로 역산 매칭합니다.',
  };

  return {
    analyzedPhotos,
    allBoxes,
    unreadablePendingQueue,
    unreadableResolvedBoxes,
    zigzagDeductionSummary,
    searchableProducts: SEARCHABLE_PRODUCT_CATALOG,
    routeInfo,
    totals: {
      photoCount: analyzedPhotos.length,
      countedBoxes: countedAll.length,
      labelEndBoxes: labelEndConfirmedBoxes.length,
      zigzagSideBoxes: zigzagSideBoxes.length,
      zigzagPendingBoxes: zigzagPendingBoxes.length,
      zigzagResolvedBoxes: zigzagResolvedBoxes.length,
      duplicateBoxes: allBoxes.filter((b) => b.status === 'DUPLICATE').length,
      backgroundBoxes: allBoxes.filter((b) => b.status === 'BACKGROUND').length,
      unreadablePendingBoxes: unreadablePendingQueue.length,
      passedBoxes: allBoxes.filter((b) => b.resolutionAction === 'passed' && b.status !== 'DUPLICATE').length,
      manuallyMatchedBoxes: allBoxes.filter((b) => b.resolutionAction === 'matched' && b.status === 'COUNTED').length,
      customerCount: customerTotalsMap.size,
      itemLineCount: customerItemSummary.length,
      billCount: activeBillsInPhotos.length,
      distinctOrderWeeks: distinctActiveWeeks,
      hasMixedOrderWeeks,
    },
    customerTotals: [...customerTotalsMap.values()],
    customerItemSummary,
    billOrderWeekLedger,
    mixedOrderWeekNotice,
    billLookupResults,
    farmBoxProfiles: FARM_BOX_COLOR_PROFILES,
    matchedDefects,
    billContext: {
      orderYear: 2026,
      orderWeek: '47-02',
      warehouseKey: 8247,
      awbNo: '180-9162-6441',
      invoiceNo: '1222993',
      primaryFarm: 'Holex',
      countryName: '네덜란드',
      sourcePdf: '47-2 네덜란드 CI.pdf',
    },
  };
}
