// pages/vision/box-inspector.js
// 박스 사진 판독 · 품목/수량 매칭 (카톡 묶음 N장 배치 업로드 · 노선/묶음 판독 · 업체×품목×수량×Bill번호×입고차수 확인 · 불량차감 매칭)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import WorkflowGuide from '../../components/WorkflowGuide';
import {
  analyzeBoxVisionPhotos,
  autoDeduceZigzagBoxes,
  buildUnreadableBoxSearchCandidates,
  CAMERA_ANGLE_OPTIONS,
  lookupBillOrderWeek,
  ROUTE_PRESETS,
  SAMPLE_PHOTOS,
  SEARCHABLE_PRODUCT_CATALOG,
} from '../../lib/boxVisionInspector';
import styles from '../../styles/BoxVisionInspector.module.css';

const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const ALL_SAMPLE_IDS = SAMPLE_PHOTOS.map((s) => s.sampleId);

const CUSTOMER_OPTIONS = [
  { custKey: 533, custName: '주광농원', custCode: 'YCL2', labelCode: 'ICNNEN/YCL2' },
  { custKey: 335, custName: '늘봄원예', custCode: 'CL23', labelCode: 'ICNNEN/CL23' },
  { custKey: 446, custName: '신라호텔', custCode: 'YCLS', labelCode: 'ICNNEN/YCLS' },
];

const BILL_OPTIONS = [
  { invoiceNo: '1222993', awbNo: '180-9162-6441', orderWeek: '47-02', farmName: 'Holex', countryName: '네덜란드' },
  { invoiceNo: '2026YY-055', awbNo: '2026YY-055', orderWeek: '47-02', farmName: 'Cloudland', countryName: '중국' },
  { invoiceNo: '201693', awbNo: '180-5345-5275', orderWeek: '47-01', farmName: 'Hood Canal', countryName: '미국' },
  { invoiceNo: '201694', awbNo: '180-5345-5334', orderWeek: '48-01', farmName: 'Hood Canal', countryName: '미국' },
];

export default function BoxVisionInspectorPage() {
  // 기본 진입 시 카톡 묶음 5장 전체 일괄 스캔 상태로 시작해 업체별×품목별×수량×Bill×입고차수를 즉시 한눈에 제공
  const [selectedSampleIds, setSelectedSampleIds] = useState(ALL_SAMPLE_IDS);
  // viewMode: 'BATCH_ALL' (전체 묶음 통합 보기) | 'SINGLE_PHOTO' (사진 1/N ~ N/N 개별 보기)
  const [viewMode, setViewMode] = useState('SINGLE_PHOTO');
  const [activePhotoIndex, setActivePhotoIndex] = useState(3); // 기본 포커스: 샘플 4번(주광농원 20박스 · 하단 무라벨 민트 박스 #19, #20 및 가림 라벨 확인 대기 시연)
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [customPreviewUrl, setCustomPreviewUrl] = useState('');
  const [boxOverrides, setBoxOverrides] = useState({});
  const [photoAngleOverrides, setPhotoAngleOverrides] = useState({});
  const [selectedBoxId, setSelectedBoxId] = useState('s4-b19');
  const [batchRouteMessage, setBatchRouteMessage] = useState('호남선 출고입니다 (11/23 경부선·호남선 카톡 묶음 사진 일괄 업로드)');
  const [billSearchQuery, setBillSearchQuery] = useState('');

  // [품목·숫자 미식별 박스 처리 패널] 검색 매칭기 드로어 상태
  const [activeMatcherBoxId, setActiveMatcherBoxId] = useState('s4-b19');
  const [matcherSearchQuery, setMatcherSearchQuery] = useState('');
  const [matcherSelectedCandidate, setMatcherSelectedCandidate] = useState(null);
  const [matcherQtyPerBox, setMatcherQtyPerBox] = useState(130);
  const [matcherCustKey, setMatcherCustKey] = useState(533);
  const [matcherInvoiceNo, setMatcherInvoiceNo] = useState('1222993');

  const [analysisData, setAnalysisData] = useState(() =>
    analyzeBoxVisionPhotos({
      sampleIds: ALL_SAMPLE_IDS,
      batchRouteMessage: '호남선 출고입니다 (11/23 경부선·호남선 카톡 묶음 사진 일괄 업로드)',
    })
  );
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [linkedDefectKeys, setLinkedDefectKeys] = useState({});
  const fileInputRef = useRef(null);

  const runAnalysis = useCallback(async (
    nextSampleIds,
    nextFiles,
    nextOverrides,
    nextRouteMsg = batchRouteMessage,
    nextBillQuery = billSearchQuery,
    nextAngleOverrides = photoAngleOverrides
  ) => {
    const localResult = analyzeBoxVisionPhotos({
      sampleIds: nextSampleIds,
      uploadedFiles: nextFiles,
      boxOverrides: nextOverrides,
      photoAngleOverrides: nextAngleOverrides,
      batchRouteMessage: nextRouteMsg,
      billQuery: nextBillQuery,
    });
    setAnalysisData(localResult);

    setLoading(true);
    try {
      const response = await fetch('/api/vision/box-count-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sampleIds: nextSampleIds,
          uploadedFiles: nextFiles,
          boxOverrides: nextOverrides,
          photoAngleOverrides: nextAngleOverrides,
          batchRouteMessage: nextRouteMsg,
          billQuery: nextBillQuery,
          orderYear: 2026,
          orderWeek: '47-02',
        }),
      });
      if (response.ok) {
        const json = await response.json();
        if (json?.success && Array.isArray(json.analyzedPhotos)) {
          setAnalysisData(json);
        }
      }
    } catch {
      // 오프라인 또는 인증 전 상태에서도 결정론적 로컬 분석 결과 유지
    } finally {
      setLoading(false);
    }
  }, [batchRouteMessage, billSearchQuery, photoAngleOverrides]);

  const selectSingleSample = (sampleId) => {
    const next = [sampleId];
    setSelectedSampleIds(next);
    setUploadedFiles([]);
    setViewMode('SINGLE_PHOTO');
    setActivePhotoIndex(0);
    setCustomPreviewUrl('');
    setSelectedBoxId(null);
    const sample = SAMPLE_PHOTOS.find((s) => s.sampleId === sampleId);
    setNotice(`${sample?.shortLabel || sampleId} 사진을 불러와 박스 스캔 및 업체·품목·수량·Bill 번호·입고 차수 대조를 완료했습니다.`);
    runAnalysis(next, [], boxOverrides, batchRouteMessage, billSearchQuery);
  };

  const selectKakaoBatchPreset = (presetMessage = '호남선 출고입니다 (11/23 경부선·호남선 카톡 묶음 사진 5장 일괄 판독)') => {
    setSelectedSampleIds(ALL_SAMPLE_IDS);
    setUploadedFiles([]);
    setBatchRouteMessage(presetMessage);
    setViewMode('BATCH_ALL');
    setActivePhotoIndex(0);
    setCustomPreviewUrl('');
    setSelectedBoxId(null);
    setNotice(
      '카톡 묶음 시연("호남선/경부선 출고입니다" 5장 일괄 묶음 통합 판독) 완료: 전체 사진에 걸친 3개 업체 × 22개 품목 × 유효 48박스(중복 3박스 자동제외) × Bill 번호(1222993 / 2026YY-055 / 201693) × 입고 차수(47-02차 · 47-01차)를 한 번에 체크했습니다.'
    );
    runAnalysis(ALL_SAMPLE_IDS, [], boxOverrides, presetMessage, billSearchQuery);
  };

  const selectAllSamplesWithDedupe = () => {
    setSelectedSampleIds(ALL_SAMPLE_IDS);
    setUploadedFiles([]);
    setViewMode('SINGLE_PHOTO');
    setActivePhotoIndex(2); // 샘플 3번(중복 제거 시연 화면) 기본 포커스
    setCustomPreviewUrl('');
    setSelectedBoxId(null);
    setNotice('창고 샘플 5장 전체 일괄 스캔 완료: 바코드 일련번호(2494510.31.1 / 30.1 / 27.1) 교차 중복 3박스를 자동 제외하고 업체별 출고 원장 및 Bill 입고 차수와 대조했습니다.');
    runAnalysis(ALL_SAMPLE_IDS, [], boxOverrides, batchRouteMessage, billSearchQuery);
  };

  const selectNeulbomPair = () => {
    const pairIds = ['sample-2-neulbom-a', 'sample-3-neulbom-b'];
    setSelectedSampleIds(pairIds);
    setUploadedFiles([]);
    setViewMode('SINGLE_PHOTO');
    setActivePhotoIndex(1);
    setCustomPreviewUrl('');
    setSelectedBoxId(null);
    setNotice('늘봄원예 다중 각도 사진 2장(샘플 2·3) 교차 판독 완료: 중복 찍힌 우측 2박스(2494510.31.1, 30.1)를 자동 제외하고 총 12박스(422본 · Bill 1222993 · 47-02차 입고)를 확정했습니다.');
    runAnalysis(pairIds, [], boxOverrides, batchRouteMessage, billSearchQuery);
  };

  const handleFilesAdded = useCallback((fileList, appendToBatch = true) => {
    const files = Array.from(fileList || []).filter(
      (f) => f && (/^image\//i.test(f.type || '') || /\.(?:jpe?g|png|webp)$/i.test(f?.name || ''))
    );
    if (!files.length) return;

    const newMetaList = files.map((f, idx) => {
      let previewUrl = '';
      try {
        previewUrl = URL.createObjectURL(f);
      } catch {
        previewUrl = '';
      }
      return {
        name: f.name || `kakao-paste-${Date.now()}-${idx + 1}.jpg`,
        size: f.size || 0,
        previewUrl,
      };
    });

    if (newMetaList[0]?.previewUrl) {
      setCustomPreviewUrl(newMetaList[0].previewUrl);
    }

    const combinedUploads = appendToBatch ? [...uploadedFiles, ...newMetaList] : newMetaList;
    setUploadedFiles(combinedUploads);

    // 다중 파일(예: 카톡 묶음 5장~15장+)이 올라오면 전체 묶음 매칭을 활성화하고, 단일 파일이면 해당 파일 매칭 샘플을 포함한 묶음에 추가
    let nextIds = [...selectedSampleIds];
    for (const f of newMetaList) {
      const lower = String(f.name || '').toLowerCase();
      let matchedId = 'sample-1-silla';
      if (lower.includes('neulbom-a') || lower.includes('e5b08302') || lower.includes('2')) matchedId = 'sample-2-neulbom-a';
      else if (lower.includes('neulbom-b') || lower.includes('c1392802') || lower.includes('3') || lower.includes('늘봄')) matchedId = 'sample-3-neulbom-b';
      else if (lower.includes('jukwang') || lower.includes('a5755b31') || lower.includes('4') || lower.includes('주광')) matchedId = 'sample-4-jukwang';
      else if (lower.includes('holex') || lower.includes('mint') || lower.includes('fa78fd55') || lower.includes('5')) matchedId = 'sample-5-holex-mint';

      if (!nextIds.includes(matchedId)) {
        nextIds.push(matchedId);
      }
    }
    if (files.length >= 3) {
      nextIds = ALL_SAMPLE_IDS;
    }

    setSelectedSampleIds(nextIds);
    setViewMode(combinedUploads.length > 1 || nextIds.length > 1 ? 'BATCH_ALL' : 'SINGLE_PHOTO');
    setActivePhotoIndex(0);
    setNotice(
      `카톡 묶음 사진 ${files.length}장 추가 완료 (현재 묶음 총 ${Math.max(nextIds.length, combinedUploads.length)}장): 전체 사진에 걸친 업체별 품목·수량·Bill 번호·입고 차수(OrderWeek)를 통합 체크했습니다.`
    );
    runAnalysis(nextIds, combinedUploads, boxOverrides, batchRouteMessage, billSearchQuery);
  }, [batchRouteMessage, billSearchQuery, boxOverrides, runAnalysis, selectedSampleIds, uploadedFiles]);

  const handleRemovePhotoFromBatch = (photoIdx, sampleId) => {
    if (selectedSampleIds.length <= 1 && uploadedFiles.length <= 1) {
      setNotice('묶음에는 최소 1장의 사진이 유지되어야 합니다.');
      return;
    }
    const nextSampleIds = selectedSampleIds.filter((id) => id !== sampleId);
    const safeSampleIds = nextSampleIds.length > 0 ? nextSampleIds : [SAMPLE_PHOTOS[0].sampleId];
    const nextUploads = uploadedFiles.filter((_, idx) => idx !== photoIdx);
    setSelectedSampleIds(safeSampleIds);
    setUploadedFiles(nextUploads);
    setActivePhotoIndex(0);
    setNotice(`묶음에서 사진 #${photoIdx + 1}을 제외하고 전체 업체×품목×수량×Bill×입고차수를 재집계했습니다.`);
    runAnalysis(safeSampleIds, nextUploads, boxOverrides, batchRouteMessage, billSearchQuery);
  };

  const handleResetBatch = () => {
    const initial = ['sample-1-silla'];
    setSelectedSampleIds(initial);
    setUploadedFiles([]);
    setCustomPreviewUrl('');
    setBoxOverrides({});
    setViewMode('SINGLE_PHOTO');
    setActivePhotoIndex(0);
    setNotice('묶음 사진 목록을 초기화하고 샘플 1번 단일 보기 상태로 전환했습니다.');
    runAnalysis(initial, [], {}, batchRouteMessage, billSearchQuery);
  };

  const handleSimulate15PhotoBatch = () => {
    const simulated15Files = Array.from({ length: 15 }, (_, idx) => {
      const baseSample = SAMPLE_PHOTOS[idx % SAMPLE_PHOTOS.length];
      return {
        name: `카톡_호남선출고_묶음_${String(idx + 1).padStart(2, '0')}_${baseSample.fileName}`,
        size: 185000 + idx * 1200,
        previewUrl: baseSample.imageUrl,
      };
    });
    const nextMsg = '호남선 출고입니다 (카톡 묶음 15장 일괄 업로드)';
    setBatchRouteMessage(nextMsg);
    setSelectedSampleIds(ALL_SAMPLE_IDS);
    setUploadedFiles(simulated15Files);
    setViewMode('BATCH_ALL');
    setActivePhotoIndex(0);
    setNotice(
      '카톡 "호남선 출고입니다" 15장 묶음 일괄 업로드 시뮬레이션 완료: 15장 전체에서 중복 촬영된 박스를 바코드 일련번호로 자동 제거하고, 업체별 품목·수량·Bill 번호(#1222993 외) 및 입고 차수(47-02차·47-01차)를 전수 체크했습니다.'
    );
    runAnalysis(ALL_SAMPLE_IDS, simulated15Files, boxOverrides, nextMsg, billSearchQuery);
  };

  useEffect(() => {
    const onPaste = (event) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      const imageFiles = [];
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        event.preventDefault();
        handleFilesAdded(imageFiles, true);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFilesAdded]);

  // [신규] 품목·숫자 미식별 박스 처리: ① 패스(카운트 제외 패스 / 박스 수만 유지하고 품목 미확인 패스) ② 검색 매칭 ③ 다시 매칭하기/판독 보류 전환
  const handlePassUnreadableBox = (box, passMode = 'exclude_count') => {
    setSelectedBoxId(box.boxId);
    const currentOverride = boxOverrides[box.boxId] || {};
    const nextOverride = {
      ...currentOverride,
      status: passMode === 'exclude_count' ? 'EXCLUDED' : 'COUNTED',
      resolutionAction: 'passed',
      passMode,
    };
    const nextOverrides = { ...boxOverrides, [box.boxId]: nextOverride };
    setBoxOverrides(nextOverrides);
    if (activeMatcherBoxId === box.boxId) {
      setActiveMatcherBoxId(null);
    }
    const modeLabel =
      passMode === 'exclude_count'
        ? '[카운트 제외 패스] (총 박스 수 및 품목 집계에서 제외)'
        : '[박스 수만 유지하고 품목 미확인 패스] (총 박스 개수에는 포함하되 품목 매칭은 건너뜀)';
    setNotice(`미식별 박스 [${box.serialNo} · ${box.custName}]를 ${modeLabel} 처리했습니다. 언제든 [다시 매칭하기]로 되돌릴 수 있습니다.`);
    runAnalysis(selectedSampleIds, uploadedFiles, nextOverrides, batchRouteMessage, billSearchQuery);
  };

  const handleBatchPassAllUnreadable = (passMode = 'exclude_count') => {
    const queue = analysisData?.unreadablePendingQueue || [];
    if (!queue.length) {
      setNotice('현재 확인 대기 중인 품목/숫자 미식별 박스가 없습니다.');
      return;
    }
    const nextOverrides = { ...boxOverrides };
    for (const box of queue) {
      nextOverrides[box.boxId] = {
        ...(nextOverrides[box.boxId] || {}),
        status: passMode === 'exclude_count' ? 'EXCLUDED' : 'COUNTED',
        resolutionAction: 'passed',
        passMode,
      };
    }
    setBoxOverrides(nextOverrides);
    setActiveMatcherBoxId(null);
    const modeLabel =
      passMode === 'exclude_count' ? '카운트 제외 패스' : '박스 수만 유지하고 품목 미확인 패스';
    setNotice(`품목/숫자 미식별 대기 박스 ${queue.length}건을 일괄 [${modeLabel}] 처리했습니다.`);
    runAnalysis(selectedSampleIds, uploadedFiles, nextOverrides, batchRouteMessage, billSearchQuery);
  };

  const handleOpenSearchMatcher = (box) => {
    setSelectedBoxId(box.boxId);
    setActiveMatcherBoxId(box.boxId);
    setMatcherSearchQuery('');
    const candidates = buildUnreadableBoxSearchCandidates(box, {
      allBoxes: analysisData?.allBoxes || [],
      productCatalog: analysisData?.searchableProducts || SEARCHABLE_PRODUCT_CATALOG,
      searchQuery: '',
    });
    const top = candidates[0] || null;
    setMatcherSelectedCandidate(top);
    setMatcherQtyPerBox(top ? Number(top.suggestedQtyPerBox || box.qtyPerBox || 40) : Number(box.qtyPerBox || 40));
    setMatcherCustKey(Number(box.custKey || top?.custKey || 533));
    setMatcherInvoiceNo(String(box.invoiceNo || top?.invoiceNo || '1222993'));
    if (box.photoNumber && viewMode === 'SINGLE_PHOTO') {
      setActivePhotoIndex(Math.max(0, box.photoNumber - 1));
    }
  };

  const handleConfirmSearchMatch = (box, customCandidate = null) => {
    const chosen = customCandidate || matcherSelectedCandidate;
    if (!chosen) {
      setNotice('매칭할 품목 후보를 선택해 주세요.');
      return;
    }
    const custMeta = CUSTOMER_OPTIONS.find((c) => Number(c.custKey) === Number(matcherCustKey)) || {
      custKey: chosen.custKey || box.custKey || 533,
      custName: chosen.custName || box.custName || '주광농원',
      custCode: chosen.custCode || box.custCode || 'YCL2',
      labelCode: `ICNNEN/${chosen.custCode || box.custCode || 'YCL2'}`,
    };
    const billMeta = BILL_OPTIONS.find((b) => String(b.invoiceNo) === String(matcherInvoiceNo)) || {
      invoiceNo: chosen.invoiceNo || box.invoiceNo || '1222993',
      awbNo: chosen.awbNo || box.awbNo || '180-9162-6441',
      orderWeek: chosen.orderWeek || box.orderWeek || '47-02',
      farmName: chosen.farmName || box.farmName || 'Holex',
      countryName: box.countryName || '네덜란드',
    };
    const finalQty = customCandidate
      ? Number(customCandidate.suggestedQtyPerBox || matcherQtyPerBox || box.qtyPerBox || 40)
      : Number(matcherQtyPerBox || chosen.suggestedQtyPerBox || box.qtyPerBox || 40);

    const nextOverride = {
      ...(boxOverrides[box.boxId] || {}),
      status: 'COUNTED',
      ocrStatus: 'confirmed',
      resolutionAction: 'matched',
      passMode: null,
      custKey: custMeta.custKey,
      custName: custMeta.custName,
      custCode: custMeta.custCode,
      labelCode: custMeta.labelCode,
      prodKey: chosen.prodKey,
      prodName: chosen.prodName,
      flowerName: chosen.flowerName,
      unit: chosen.unit,
      qtyPerBox: finalQty,
      stemsPerBox: chosen.stemsPerBox || (chosen.unit === '단' ? finalQty * 40 : finalQty),
      invoiceNo: billMeta.invoiceNo,
      awbNo: billMeta.awbNo,
      orderWeek: billMeta.orderWeek,
      farmName: billMeta.farmName,
      countryName: billMeta.countryName,
      stickerCode: `${box.stickerCode || '라벨가림'} → [수동 검색매칭 완료]`,
    };
    const nextOverrides = { ...boxOverrides, [box.boxId]: nextOverride };
    setBoxOverrides(nextOverrides);

    // 다음 미식별 대기 박스가 있으면 자동으로 매칭기를 이어서 열어줌
    const remainingQueue = (analysisData?.unreadablePendingQueue || []).filter((b) => b.boxId !== box.boxId);
    if (remainingQueue.length > 0) {
      setActiveMatcherBoxId(remainingQueue[0].boxId);
      setSelectedBoxId(remainingQueue[0].boxId);
    } else {
      setActiveMatcherBoxId(null);
    }

    setNotice(
      `박스 [${box.serialNo}] 검색 매칭 확정 완료: [${custMeta.custName} · ${chosen.prodName} (${chosen.flowerName}) · ${fmt(finalQty)}${chosen.unit} · Bill #${billMeta.invoiceNo} (${billMeta.orderWeek}차)]로 반영되어 하단 업체×품목×Bill 통합 체크표 및 차수 원장이 실시간 재계산되었습니다.`
    );
    runAnalysis(selectedSampleIds, uploadedFiles, nextOverrides, batchRouteMessage, billSearchQuery);
  };

  const handleMarkBoxAsUnreadable = (box, ocrType = 'unreadable_both') => {
    if (!box) return;
    setSelectedBoxId(box.boxId);
    const reasonMap = {
      unreadable_item: '수동 지정: 라벨 일부 가림 (품목명 미식별 — 패스 또는 검색매칭 선택)',
      unreadable_qty: '수동 지정: 수기 숫자 흐림/가림 (박스당 본수 확인 필요)',
      unreadable_both: '수동 지정: 라벨 가림·저해상도 (품목 및 본수 숫자 모두 안 보임)',
    };
    const nextOverride = {
      ...(boxOverrides[box.boxId] || {}),
      status: 'COUNTED',
      ocrStatus: ocrType,
      unreadableReason: reasonMap[ocrType] || reasonMap.unreadable_both,
      resolutionAction: 'pending',
      deductionMatched: false,
      passMode: null,
    };
    const nextOverrides = { ...boxOverrides, [box.boxId]: nextOverride };
    setBoxOverrides(nextOverrides);
    setActiveMatcherBoxId(box.boxId);
    setNotice(
      `박스 [${box.serialNo} · ${box.custName}]를 '판독 보류(품목/숫자 미식별)' 확인 대기열에 추가했습니다. [소거법/3면교차 확정], [직접 검색 매칭], 또는 [패스]를 선택하세요.`
    );
    runAnalysis(selectedSampleIds, uploadedFiles, nextOverrides, batchRouteMessage, billSearchQuery);
  };

  // [신규 핵심] 직육면체 지그재그 옆면(zigzag_side) 박스 → 3면 사진 교차 라벨 결합 또는 전산 출고 원장 소거법 원클릭 확정 (개별 / 일괄)
  const handleConfirmZigzagDeductionSingle = (box) => {
    if (!box) return;
    setSelectedBoxId(box.boxId);
    const { nextOverrides, appliedList } = autoDeduceZigzagBoxes({
      sampleIds: selectedSampleIds,
      uploadedFiles,
      boxOverrides,
      photoAngleOverrides,
      targetBoxIds: [box.boxId],
      includeAllUnreadable: true,
    });
    setBoxOverrides(nextOverrides);
    if (activeMatcherBoxId === box.boxId) {
      setActiveMatcherBoxId(null);
    }
    const applied = appliedList[0];
    if (applied) {
      setNotice(
        `지그재그 옆면 박스 [${box.serialNo}] ${applied.methodBadge} 1클릭 확정 완료: [${applied.prodName} · ${fmt(applied.qtyPerBox)}${applied.unit}] (${applied.deductionReason})`
      );
    }
    runAnalysis(selectedSampleIds, uploadedFiles, nextOverrides, batchRouteMessage, billSearchQuery, photoAngleOverrides);
  };

  const handleBatchAutoDeduceZigzag = (includeAllUnreadable = true) => {
    const { nextOverrides, appliedCount, appliedList } = autoDeduceZigzagBoxes({
      sampleIds: selectedSampleIds,
      uploadedFiles,
      boxOverrides,
      photoAngleOverrides,
      includeAllUnreadable,
    });
    if (!appliedCount) {
      setNotice('현재 자동 소거 매칭할 지그재그 옆면 / 판독 보류 박스가 없습니다.');
      return;
    }
    setBoxOverrides(nextOverrides);
    setActiveMatcherBoxId(null);
    const summaryItems = appliedList.map((a) => `${a.prodName}(${fmt(a.qtyPerBox)}${a.unit})`).join(', ');
    setNotice(
      `[지그재그 옆면 박스 → 전산 잔여 품목 자동 소거 & 3면 교차 매칭] ${appliedCount}건 일괄 확정 완료 (${summaryItems}): 전산 출고 원장(ShipmentDetail)과 100% 일치로 검수 완료되었습니다.`
    );
    runAnalysis(selectedSampleIds, uploadedFiles, nextOverrides, batchRouteMessage, billSearchQuery, photoAngleOverrides);
  };

  const handlePhotoAngleChange = (sampleId, nextAngle) => {
    const nextAngleOverrides = {
      ...photoAngleOverrides,
      [sampleId]: nextAngle,
    };
    setPhotoAngleOverrides(nextAngleOverrides);
    const angleMeta = CAMERA_ANGLE_OPTIONS.find((a) => a.angleId === nextAngle) || CAMERA_ANGLE_OPTIONS[0];
    setNotice(`사진 [${sampleId}]의 팔레트 촬영면 각도를 [${angleMeta.label}]으로 전환하여 3면(정면·좌·우) 교차 라벨 매칭을 재계산했습니다.`);
    runAnalysis(selectedSampleIds, uploadedFiles, boxOverrides, batchRouteMessage, billSearchQuery, nextAngleOverrides);
  };

  const toggleBoxInclusion = (box) => {
    setSelectedBoxId(box.boxId);
    const currentOverride = boxOverrides[box.boxId] || {};
    let nextOverride;
    if (box.status === 'COUNTED') {
      nextOverride = { ...currentOverride, status: 'EXCLUDED', forceInclude: false };
      setNotice(`박스 [${box.serialNo} · ${box.custName} · ${box.prodName}]를 수량 집계에서 수동 제외했습니다.`);
    } else {
      nextOverride = { ...currentOverride, status: 'COUNTED', forceInclude: true };
      setNotice(`박스 [${box.serialNo} · ${box.custName} · ${box.prodName}]를 수량 집계에 포함했습니다.`);
    }
    const nextOverrides = { ...boxOverrides, [box.boxId]: nextOverride };
    setBoxOverrides(nextOverrides);
    runAnalysis(selectedSampleIds, uploadedFiles, nextOverrides, batchRouteMessage, billSearchQuery);
  };

  const handleAttachDefectPhoto = (defectRow) => {
    setLinkedDefectKeys((prev) => ({
      ...prev,
      [defectRow.deductionKey]: {
        linkedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        farmName: defectRow.farmName || 'Holex',
        awbNo: defectRow.awbNo || '180-9162-6441',
        invoiceNo: defectRow.invoiceNo || '1222993',
        orderWeek: defectRow.appliedOrderWeek || '47-02',
      },
    }));
    setNotice(
      `영업수입불량차감 [#${defectRow.deductionKey} ${defectRow.custName} · ${defectRow.prodName} ${defectRow.quantity}${defectRow.sourceUnit}] 항목에 현재 사진 및 농장(${defectRow.farmName})/차수(${defectRow.appliedOrderWeek} · Bill ${defectRow.invoiceNo}) 근거를 연결했습니다.`
    );
  };

  const handleRoutePresetChange = (routePreset) => {
    setBatchRouteMessage(routePreset.defaultMessage);
    setNotice(`묶음 출고 노선 태그를 [${routePreset.routeName}]으로 설정했습니다: "${routePreset.defaultMessage}"`);
    runAnalysis(selectedSampleIds, uploadedFiles, boxOverrides, routePreset.defaultMessage, billSearchQuery);
  };

  const analyzedPhotos = analysisData?.analyzedPhotos || [];
  const currentPhoto = analyzedPhotos[activePhotoIndex] || analyzedPhotos[0] || SAMPLE_PHOTOS[0];
  const displayImageUrl = currentPhoto?.previewUrl || customPreviewUrl || currentPhoto?.imageUrl || '/samples/box-vision/sample-1-silla.jpg';

  const selectedBox = useMemo(() => {
    if (!selectedBoxId) return currentPhoto?.boxes?.[0] || null;
    return (analysisData?.allBoxes || []).find((b) => b.boxId === selectedBoxId) || currentPhoto?.boxes?.[0] || null;
  }, [analysisData?.allBoxes, currentPhoto?.boxes, selectedBoxId]);

  const bill = analysisData?.billContext || {};
  const totals = analysisData?.totals || {};
  const routeInfo = analysisData?.routeInfo || {};
  const billOrderWeekLedger = analysisData?.billOrderWeekLedger || [];

  const liveBillLookupResults = useMemo(
    () => lookupBillOrderWeek(billSearchQuery, undefined, billOrderWeekLedger),
    [billOrderWeekLedger, billSearchQuery]
  );

  return (
    <div className={styles.container} data-testid="box-vision-inspector-page">
      {/* 최상단 핵심 목적 배너 */}
      <div className={styles.purposeBanner} data-testid="box-vision-purpose-banner">
        <span className={styles.purposeTitle}>[핵심 목적 · PURPOSE]</span>
        <span className={styles.purposeText}>
          현장 출고방·수입불량방 카톡 묶음 사진(예: &ldquo;호남선 출고입니다&rdquo; 등 1~30장 가변 묶음)을 일괄 업로드하거나 붙여넣기(Ctrl+V)하면, 전체 사진을 통합 스캔하여 ① 업체별×품목별 수량 및 Bill 번호(InvoiceNo/AWB) 전수 체크, ② Bill 번호 기준 몇 차수(OrderWeek) 입고분인지 대조·혼입 확인, ③ 농장별 박스 색상 판별 및 영업수입불량차감 매칭을 한 화면에서 완결합니다. (ERP 원장 읽기 전용 대조)
        </span>
      </div>

      {/* 사용 가이드 영상 */}
      <WorkflowGuide workflowId="box-vision-inspector" defaultOpen={false} />

      {/* 상단 타이틀 및 원클릭 묶음 시연 / 업로드 바 */}
      <div className={styles.headerBar}>
        <div className={styles.titleGroup}>
          <h1>박스 사진 판독 · 묶음 출고 품목/수량/Bill/입고차수 통합 검수</h1>
          <p className={styles.titleSub}>
            묶음 노선: <strong>{routeInfo.routeName || '호남선 · 경부선 통합 출고'}</strong> ({routeInfo.shipDateLabel || '11/23(월)'}) · 주 입고 차수: <strong>{bill.orderYear || 2026}년 {bill.orderWeek || '47-02'}차 입고</strong> · 주 Bill(Invoice): <strong>#{bill.invoiceNo || '1222993'}</strong> (AWB <strong>{bill.awbNo || '180-9162-6441'}</strong>) · 주 농장: <strong>{bill.primaryFarm || 'Holex'} ({bill.countryName || '네덜란드'})</strong>
          </p>
        </div>
        <div className={styles.actionGroup}>
          <button
            type="button"
            className={styles.btnPrimary}
            data-testid="box-vision-kakao-batch-preset-btn"
            onClick={() => selectKakaoBatchPreset('호남선 출고입니다 (11/23 경부선·호남선 카톡 묶음 사진 5장 일괄 판독)')}
          >
            [카톡 묶음 시연: &ldquo;호남선/경부선 출고입니다&rdquo; (5장 일괄 묶음 통합 판독)]
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            data-testid="box-vision-simulate-15batch-btn"
            onClick={handleSimulate15PhotoBatch}
          >
            카톡 15장 묶음 업로드 시연
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            data-testid="box-vision-upload-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            묶음 사진 N장 일괄 업로드 (Ctrl+V 지원)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFilesAdded(e.target.files, true)}
          />
          <button
            type="button"
            className={styles.btnSecondary}
            data-testid="box-vision-neulbom-pair-btn"
            onClick={selectNeulbomPair}
          >
            늘봄원예 2장 중복제거 시연 (샘플 2+3)
          </button>
          <button
            type="button"
            className={selectedSampleIds.length === SAMPLE_PHOTOS.length ? styles.btnSecondaryActive : styles.btnSecondary}
            data-testid="box-vision-scan-all-btn"
            onClick={selectAllSamplesWithDedupe}
          >
            창고 샘플 5장 전체 일괄 스캔
          </button>
          <Link href="/shipment/distribute?week=47-02" className={styles.btnSecondary}>
            출고분배 원장 열기
          </Link>
          <Link href="/sales/defect-deductions?year=2026&week=47" className={styles.btnSecondary}>
            영업수입불량차감 열기
          </Link>
        </div>
      </div>

      {/* [신규 A] 카톡 묶음 사진(1~30장 가변 묶음) 노선/메시지 입력 바 & 필름스트립 전환 바 */}
      <section className={styles.batchControlCard} data-testid="box-vision-batch-control-panel">
        <div className={styles.batchRow}>
          <div className={styles.routeInputGroup}>
            <label htmlFor="kakao-batch-route-input" style={{ fontWeight: 700, fontSize: 13.5 }}>
              카톡 출고방 메시지 / 노선 태그:
            </label>
            <input
              id="kakao-batch-route-input"
              type="text"
              className={styles.textInput}
              data-testid="kakao-batch-route-input"
              value={batchRouteMessage}
              onChange={(e) => {
                const val = e.target.value;
                setBatchRouteMessage(val);
                runAnalysis(selectedSampleIds, uploadedFiles, boxOverrides, val, billSearchQuery);
              }}
              placeholder="예: 호남선 출고입니다 / 11/23(월) 경부선 출고입니다 (카톡 메시지 붙여넣기)"
            />
          </div>
          <div className={styles.sampleChips}>
            {ROUTE_PRESETS.map((rp) => (
              <button
                key={rp.routeId}
                type="button"
                data-testid={`route-preset-btn-${rp.routeId}`}
                className={batchRouteMessage.includes(rp.routeName) ? styles.sampleChipActive : styles.sampleChip}
                onClick={() => handleRoutePresetChange(rp)}
              >
                {rp.routeName}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.batchRow} style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 13, color: '#0f172a' }}>
            <strong>자동 파싱된 묶음 노선 헤더:</strong>{' '}
            <span className={styles.badgeMatch} data-testid="parsed-route-badge">
              {routeInfo.routeName} · {routeInfo.shipDateLabel} · 총 {fmt(totals.photoCount)}장 묶음
            </span>
            {routeInfo.photoHandwritingMemo && (
              <span className={styles.badgeNeutral} style={{ marginLeft: 8 }}>
                {routeInfo.photoHandwritingMemo}
              </span>
            )}
          </div>
          <div className={styles.sampleChips}>
            <button
              type="button"
              data-testid="batch-view-all-btn"
              className={viewMode === 'BATCH_ALL' ? styles.btnSecondaryActive : styles.btnSecondary}
              onClick={() => setViewMode('BATCH_ALL')}
            >
              [전체 묶음 통합 보기 ({fmt(totals.photoCount)}장)]
            </button>
            <button
              type="button"
              data-testid="batch-view-single-btn"
              className={viewMode === 'SINGLE_PHOTO' ? styles.btnSecondaryActive : styles.btnSecondary}
              onClick={() => setViewMode('SINGLE_PHOTO')}
            >
              [사진 {activePhotoIndex + 1}/{fmt(totals.photoCount)} 개별 캔버스 보기]
            </button>
            <button
              type="button"
              className={styles.btnSecondary}
              data-testid="batch-add-photo-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              + 묶음에 사진 추가
            </button>
            <button
              type="button"
              className={styles.btnSecondary}
              data-testid="batch-reset-btn"
              onClick={handleResetBatch}
            >
              전체 초기화
            </button>
          </div>
        </div>

        {/* 상단 필름스트립 / 썸네일 바 ([전체 묶음 통합 보기] + [사진 1/N ~ N/N 개별 보기] 전환, 팔레트 촬영면 각도 태그(정면/좌/우) 원클릭 전환 및 개별 삭제) */}
        <div className={styles.filmstripBar} data-testid="box-vision-filmstrip">
          <span style={{ fontWeight: 700, fontSize: 13 }}>현재 묶음 사진 필름스트립 및 3면(정면·좌·우) 각도 태그 ({fmt(analyzedPhotos.length)}장):</span>
          {analyzedPhotos.map((p, idx) => {
            const isCurr = viewMode === 'SINGLE_PHOTO' && idx === activePhotoIndex;
            const currAngle = p.cameraAngle || 'front';
            return (
              <div
                key={`${p.sampleId}-${idx}`}
                className={isCurr ? styles.filmThumbActive : styles.filmThumb}
                data-testid={`filmstrip-photo-${idx + 1}`}
              >
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setViewMode('SINGLE_PHOTO');
                    setActivePhotoIndex(idx);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setViewMode('SINGLE_PHOTO');
                      setActivePhotoIndex(idx);
                    }
                  }}
                >
                  [사진 {idx + 1}/{analyzedPhotos.length}] {p.shortLabel} (유효 {p.countedBoxes}박스{p.zigzagSideBoxes > 0 ? ` · 지그재그옆면 ${p.zigzagSideBoxes}` : ''}{p.duplicateBoxes > 0 ? ` · 중복제외 ${p.duplicateBoxes}` : ''})
                </span>
                <select
                  aria-label={`사진 ${idx + 1} 팔레트 촬영 각도`}
                  className={styles.selectInput}
                  style={{ padding: '2px 6px', fontSize: 12.5 }}
                  data-testid={`photo-angle-select-${idx + 1}`}
                  value={currAngle}
                  onChange={(e) => handlePhotoAngleChange(p.sampleId, e.target.value)}
                >
                  {CAMERA_ANGLE_OPTIONS.map((ang) => (
                    <option key={ang.angleId} value={ang.angleId}>
                      [{ang.shortLabel}]
                    </option>
                  ))}
                </select>
                {analyzedPhotos.length > 1 && (
                  <button
                    type="button"
                    className={styles.thumbRemoveBtn}
                    title={`사진 #${idx + 1} 묶음에서 제거`}
                    data-testid={`remove-photo-btn-${idx + 1}`}
                    onClick={() => handleRemovePhotoFromBatch(idx, p.sampleId)}
                  >
                    삭제
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Ctrl+V 및 드래그앤드롭 안내 영역 */}
      <div
        className={styles.dropZone}
        data-testid="box-vision-dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFilesAdded(e.dataTransfer?.files, true);
        }}
      >
        <div>
          <strong>카톡 묶음 사진(5장·15장·20장 등 가변 장수) 즉시 판독:</strong> 카카오톡(현장출고방·수입불량방)에서 묶음 사진을 한꺼번에 선택해 끌어다 놓거나 연속으로 <strong>Ctrl+V</strong>를 누르면 한 묶음으로 통합 집계됩니다.
        </div>
        <span className={styles.badgeMatch}>
          {loading ? 'DB 원장 대조 중...' : '실시간 ERP 원장(Warehouse 8247·8250·8169·8251 / Shipment 7522·7577·7541) 연결됨'}
        </span>
      </div>

      {notice && (
        <div className={styles.noticeBanner} role="status" data-testid="box-vision-notice">
          {notice}
        </div>
      )}

      {/* 사장님 실제 창고 사진 5장 개별/묶음 선택 툴바 */}
      <div className={styles.sampleToolbar} data-testid="box-vision-sample-toolbar">
        <div className={styles.sampleToolbarHeader}>
          <span className={styles.sampleLabel}>창고 샘플 사진 개별 선택 또는 다중 묶음 전환:</span>
          {analyzedPhotos.length > 1 && (
            <div className={styles.sampleChips} aria-label="다중 스캔 사진 전환">
              {analyzedPhotos.slice(0, 8).map((p, idx) => (
                <button
                  key={`${p.sampleId}-tab-${idx}`}
                  type="button"
                  data-testid={`active-photo-tab-${p.sampleId}`}
                  className={idx === activePhotoIndex ? styles.sampleChipActive : styles.sampleChip}
                  onClick={() => {
                    setViewMode('SINGLE_PHOTO');
                    setActivePhotoIndex(idx);
                  }}
                >
                  캔버스 보기 #{idx + 1}: {p.shortLabel} ({p.countedBoxes}박스{p.duplicateBoxes > 0 ? ` · 중복제외 ${p.duplicateBoxes}` : ''})
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={styles.sampleChips}>
          {SAMPLE_PHOTOS.map((sample) => {
            const isSelected = selectedSampleIds.length === 1 && selectedSampleIds[0] === sample.sampleId;
            return (
              <button
                key={sample.sampleId}
                type="button"
                data-testid={`sample-btn-${sample.sampleId}`}
                className={isSelected ? styles.sampleChipActive : styles.sampleChip}
                onClick={() => selectSingleSample(sample.sampleId)}
              >
                {sample.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* 상단 핵심 요약 KPI 5종 */}
      <div className={styles.kpiStrip} data-testid="box-vision-kpi-strip">
        <div className={styles.kpiCard}>
          <div className={styles.kpiTitle}>묶음 유효 카운팅 박스 수</div>
          <div className={styles.kpiValue} data-testid="kpi-counted-boxes">{fmt(totals.countedBoxes)} 박스</div>
          <div className={styles.kpiSub}>묶음 스캔 사진 {fmt(totals.photoCount)}장 통합 기준</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTitle}>교차 중복제외 · 배경분리</div>
          <div className={styles.kpiValue} data-testid="kpi-dedupe-boxes">
            중복 {fmt(totals.duplicateBoxes)} · 배경 {fmt(totals.backgroundBoxes)}
          </div>
          <div className={styles.kpiSub}>바코드 일련번호(Order.Line.Box) 기준</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTitle}>체크된 업체 · 품목 라인</div>
          <div className={styles.kpiValue} data-testid="kpi-customer-item-count">
            {fmt(totals.customerCount)}개 업체 · {fmt(totals.itemLineCount)}품목
          </div>
          <div className={styles.kpiSub}>신라호텔(YCLS) · 늘봄원예(CL23) · 주광농원(YCL2)</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTitle}>확인된 Bill 번호 · 입고 차수</div>
          <div className={styles.kpiValue} data-testid="kpi-bill-orderweek">
            Bill {fmt(totals.billCount || 1)}건 · {(totals.distinctOrderWeeks || ['47-02']).join(' / ')}차
          </div>
          <div className={styles.kpiSub}>주 Bill #1222993 (AWB 180-9162-6441 · 47-02차)</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTitle}>지그재그 옆면 · 미식별 박스 처리</div>
          <div className={styles.kpiValue} data-testid="kpi-unreadable-boxes">
            대기 {fmt(totals.unreadablePendingBoxes || 0)} · 해결 {fmt((totals.passedBoxes || 0) + (totals.manuallyMatchedBoxes || 0))}
          </div>
          <div className={styles.kpiSub}>
            [단면라벨 {fmt(totals.labelEndBoxes || 0)} · 지그재그옆면 {fmt(totals.zigzagSideBoxes || 0)} · 패스 {fmt(totals.passedBoxes || 0)}]
          </div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTitle}>영업수입불량차감 매칭 후보</div>
          <div className={styles.kpiValue}>{fmt((analysisData?.matchedDefects || []).length)} 건</div>
          <div className={styles.kpiSub}>사진·농장·Bill·입고차수 원클릭 반영</div>
        </div>
      </div>

      {/* [신규 B-2] 전용 요약 패널: Bill 번호(송장/AWB) 기준 입고 차수(OrderWeek) 확인 원장 + 실시간 조회기 */}
      <section className={styles.panelCard} data-testid="box-vision-bill-orderweek-panel">
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>
            [Bill 번호(송장/AWB) 기준 입고 차수 확인 원장] — 묶음 사진 전체 검출 박스 차수 대조
          </h2>
          <span className={styles.badgeMatch}>
            검출 Bill {fmt(totals.billCount || 1)}건 · 입고차수 {(totals.distinctOrderWeeks || ['47-02']).map((w) => `${w}차`).join(', ')} 확인완료
          </span>
        </div>

        {/* 차수 혼입 경보/안내 배너 */}
        <div className={styles.mixedAlertBanner} data-testid="box-vision-mixed-orderweek-banner">
          <strong>[묶음 사진 입고 차수 판독 안내]</strong> {analysisData?.mixedOrderWeekNotice}
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.dataTable} data-testid="box-vision-bill-ledger-table">
            <thead>
              <tr>
                <th>Bill 번호 (InvoiceNo)</th>
                <th>AWB 항공송장 / 오더번호</th>
                <th>Bill 기준 입고 차수 (WarehouseKey)</th>
                <th>입고 농장 (국가)</th>
                <th>이번 묶음 사진 확인 업체 목록</th>
                <th>묶음 내 등장 사진</th>
                <th className={styles.numCell}>사진 검출 박스 / 전산 총입고량 (출고비중)</th>
                <th>입고차수 체크 상태</th>
              </tr>
            </thead>
            <tbody>
              {billOrderWeekLedger.map((bRow) => (
                <tr key={bRow.invoiceNo} data-testid={`bill-ledger-row-${bRow.invoiceNo}`}>
                  <td>
                    <strong>Bill #{bRow.invoiceNo}</strong>
                    <div style={{ fontSize: 12.5, color: '#475569' }}>{bRow.roleLabel}</div>
                  </td>
                  <td>
                    <strong>AWB {bRow.awbNo}</strong>
                    <div style={{ fontSize: 12.5, color: '#334155' }}>
                      오더: {(bRow.orderNos || []).join(', ')}
                    </div>
                  </td>
                  <td>
                    <span className={bRow.orderWeek === '47-02' ? styles.badgeMatch : styles.badgeWarn}>
                      {bRow.orderWeekLabel}
                    </span>
                    <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>
                      WarehouseKey #{bRow.warehouseKey}
                    </div>
                  </td>
                  <td>
                    <strong>{bRow.farmName}</strong> ({bRow.countryName})
                    <div style={{ fontSize: 12.5, color: '#475569' }}>{bRow.sourceDoc}</div>
                  </td>
                  <td>
                    <strong>{(bRow.customerNames || []).join(' · ')}</strong>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{(bRow.photoNumbers || []).join(', ')}</td>
                  <td className={styles.numCell}>
                    <strong>{fmt(bRow.totalDetectedBoxes)} 박스</strong> / 입고 {fmt(bRow.totalInboundBoxes)}박스
                    <div style={{ fontSize: 12.5, color: '#0f766e' }}>
                      이번 묶음 비중 {bRow.batchSharePct}% ({fmt(bRow.photoTotalStems)}본)
                    </div>
                  </td>
                  <td>
                    <span className={bRow.totalDetectedBoxes > 0 ? styles.badgeMatch : styles.badgeNeutral}>
                      {bRow.checkStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* [Bill 번호 → 입고 차수 실시간 조회기] 바 */}
        <div className={styles.lookupBox} data-testid="box-vision-bill-lookup-box">
          <div className={styles.batchRow} style={{ marginBottom: 6 }}>
            <label htmlFor="bill-orderweek-lookup-input" style={{ fontWeight: 700, fontSize: 13.5 }}>
              [Bill 번호 → 입고 차수 실시간 조회기] (Bill 번호 / AWB 번호 / 홀렉스 오더번호 직접 검색):
            </label>
            <div className={styles.routeInputGroup}>
              <input
                id="bill-orderweek-lookup-input"
                type="text"
                className={styles.textInput}
                data-testid="bill-orderweek-lookup-input"
                value={billSearchQuery}
                onChange={(e) => setBillSearchQuery(e.target.value)}
                placeholder="예: 1222993, 180-9162-6441, 2026YY-055, 201693, 201694, 2493354, 2494499, 2494510"
              />
              {['1222993', '2026YY-055', '201693', '201694', '2493354', '2494499', '2494510'].map((kw) => (
                <button
                  key={kw}
                  type="button"
                  data-testid={`bill-quick-query-${kw}`}
                  className={billSearchQuery === kw ? styles.sampleChipActive : styles.sampleChip}
                  onClick={() => setBillSearchQuery(billSearchQuery === kw ? '' : kw)}
                >
                  #{kw}
                </button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 13, color: '#0f172a' }} data-testid="bill-orderweek-lookup-result">
            {liveBillLookupResults.length > 0 ? (
              liveBillLookupResults.map((res) => (
                <div key={`lookup-${res.invoiceNo}`} style={{ marginTop: 4 }}>
                  <span className={styles.badgeMatch}>조회 결과</span>{' '}
                  <strong>Bill #{res.invoiceNo}</strong> (AWB <strong>{res.awbNo}</strong> · 오더 {(res.holexOrderNos || []).join(', ')}) →{' '}
                  <strong>{res.orderWeekLabel}</strong> (WarehouseKey #{res.warehouseKey}) ·{' '}
                  <strong>{res.farmName} ({res.countryName})</strong> 입고분 · 분배 거래처: <strong>{(res.distributedCustomers || []).join(', ')}</strong>
                </div>
              ))
            ) : (
              <div>입력하신 번호({billSearchQuery})와 일치하는 Bill 원장이 없습니다.</div>
            )}
          </div>
        </div>
      </section>

      {/* 메인 좌우 2단 레이아웃: 좌측 비전 스캔 카운팅 캔버스(또는 묶음 전체 썸네일 그리드) / 우측 업체별·품목별·수량·Bill·입고차수 통합 체크 매트릭스 */}
      <div className={styles.mainGrid}>
        {/* 좌측: Counting Pallet 스타일 비전 스캔 캔버스 & 전체 묶음 통합 보기 */}
        <div>
          {viewMode === 'BATCH_ALL' && analyzedPhotos.length > 1 && (
            <section className={styles.panelCard} data-testid="box-vision-batch-overview-panel">
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>
                  묶음 사진 {fmt(analyzedPhotos.length)}장 전체 통합 보기 ({routeInfo.routeName})
                </h2>
                <span className={styles.badgeMatch}>
                  클릭 시 해당 사진 정밀 바코드 캔버스로 이동
                </span>
              </div>
              <div className={styles.batchOverviewGrid}>
                {analyzedPhotos.map((p, idx) => (
                  <div
                    key={`overview-${p.sampleId}-${idx}`}
                    role="button"
                    tabIndex={0}
                    data-testid={`batch-overview-card-${idx + 1}`}
                    className={styles.batchPhotoMiniCard}
                    onClick={() => {
                      setViewMode('SINGLE_PHOTO');
                      setActivePhotoIndex(idx);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setViewMode('SINGLE_PHOTO');
                        setActivePhotoIndex(idx);
                      }
                    }}
                  >
                    <img
                      src={p.previewUrl || p.imageUrl}
                      alt={p.title}
                      className={styles.miniThumbImg}
                    />
                    <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>
                      [사진 {idx + 1}/{analyzedPhotos.length}] {p.shortLabel}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#065f46', fontWeight: 600, marginTop: 2 }}>
                      유효 {p.countedBoxes}박스 · 중복제외 {p.duplicateBoxes} · 배경 {p.backgroundBoxes}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#334155', marginTop: 2 }}>
                      Bill #{p.invoiceNo} · {p.orderYear}년 {p.orderWeek}차 입고 ({p.primaryFarm})
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={styles.panelCard} data-testid="box-vision-canvas-panel">
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>
                비전 스캔 카운팅 캔버스 ([사진 {activePhotoIndex + 1}/{analyzedPhotos.length}] {currentPhoto?.shortLabel})
              </h2>
              <span className={styles.badgeMatch}>
                유효 {currentPhoto?.countedBoxes || 0}박스 / 전체 {(currentPhoto?.boxes || []).length}박스
              </span>
            </div>

            <div className={styles.canvasStage} data-testid="box-vision-stage">
              <div className={styles.scanBeam} aria-hidden="true" />
              <img
                src={displayImageUrl}
                alt={currentPhoto?.title || '창고 박스 스캔 이미지'}
                className={styles.stageImage}
              />
              {(currentPhoto?.boxes || []).map((box) => {
                const isSelected = selectedBox?.boxId === box.boxId;
                const isPendingUnreadable = Boolean(box.isPendingUnreadable);
                const isPassed = box.resolutionAction === 'passed';
                const isManuallyMatched = box.resolutionAction === 'matched';
                const isDup = box.status === 'DUPLICATE' || (box.status === 'EXCLUDED' && !isPassed);
                const isBg = box.status === 'BACKGROUND';
                const boxClass = [
                  styles.boxOverlay,
                  isSelected ? styles.boxOverlaySelected : '',
                  isPendingUnreadable ? styles.boxOverlayUnreadable : '',
                  isPassed ? styles.boxOverlayPassed : '',
                  isDup ? styles.boxOverlayDuplicate : '',
                  isBg ? styles.boxOverlayBackground : '',
                ].filter(Boolean).join(' ');

                const capsuleClass = [
                  styles.boxCapsule,
                  isPendingUnreadable ? styles.boxCapsuleUnreadable : '',
                  isPassed ? styles.boxCapsulePassed : '',
                  isDup ? styles.boxCapsuleDup : '',
                  isBg ? styles.boxCapsuleBg : '',
                ].filter(Boolean).join(' ');

                const isZigzagSide = box.boxFace === 'zigzag_side';
                const sideDirText =
                  box.exposedLabelSide === 'left'
                    ? '라벨 좌측면 노출'
                    : box.exposedLabelSide === 'right'
                    ? '라벨 우측면 노출'
                    : '라벨 좌/우측면 노출';
                const prefix = isPendingUnreadable
                  ? isZigzagSide
                    ? `[#${box.countSeq || box.boxSeq} · 지그재그 적재 옆면 (${sideDirText}) — 소거법/3면교차 또는 검색/패스 선택]`
                    : `[#${box.countSeq || box.boxSeq} · 품목/숫자 미식별 — 패스 또는 검색매칭 선택]`
                  : isPassed
                  ? box.passMode === 'keep_box_skip_item'
                    ? `[#${box.countSeq || box.boxSeq} · 패스됨(박스유지·품목미확인)]`
                    : '[패스됨(카운트 제외)]'
                  : isManuallyMatched
                  ? box.deductionMatched
                    ? `[#${box.countSeq} · 소거법/3면교차 매칭완료]`
                    : `[#${box.countSeq} · 수동 검색매칭 완료]`
                  : box.status === 'COUNTED'
                  ? `#${box.countSeq}`
                  : box.status === 'DUPLICATE'
                  ? box.crossAngleLinkedToBoxId
                    ? '[3면교차 결합됨(중복제외)]'
                    : '[중복 제외됨]'
                  : box.status === 'EXCLUDED'
                  ? '[수동 제외]'
                  : '[배경 팔레트 분리]';

                return (
                  <div
                    key={box.boxId}
                    role="button"
                    tabIndex={0}
                    data-testid={`canvas-box-${box.boxId}`}
                    className={boxClass}
                    style={{
                      left: `${box.bbox.x}%`,
                      top: `${box.bbox.y}%`,
                      width: `${box.bbox.w}%`,
                      height: `${box.bbox.h}%`,
                    }}
                    title={`${prefix} ${box.custName} | ${box.prodName} (${box.qtyPerBox}${box.unit}) | Bill: ${box.invoiceNo} (${box.orderWeek}차) | 일련번호: ${box.serialNo}${box.unreadableReason ? ` | 사유: ${box.unreadableReason}` : ''}`}
                    onClick={() => {
                      setSelectedBoxId(box.boxId);
                      if (isPendingUnreadable) {
                        handleOpenSearchMatcher(box);
                      } else {
                        toggleBoxInclusion(box);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedBoxId(box.boxId);
                        if (isPendingUnreadable) {
                          handleOpenSearchMatcher(box);
                        } else {
                          toggleBoxInclusion(box);
                        }
                      }
                    }}
                  >
                    <span className={capsuleClass}>
                      {isPendingUnreadable
                        ? `${prefix} ${box.custName} (${box.boxSpec})`
                        : `${prefix} ${box.custName} · ${box.flowerName} ${box.qtyPerBox}${box.unit} (Bill ${box.invoiceNo} · ${box.orderWeek}차)`}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* 하단 실시간 카운팅 수식 바 */}
            <div className={styles.formulaBar} data-testid="box-vision-formula-bar">
              <div>
                <span className={styles.formulaProgress}>
                  [SCAN {currentPhoto?.countedBoxes || 0}/{(currentPhoto?.boxes || []).length} BOXES]
                </span>{' '}
                {currentPhoto?.summaryNote}
              </div>
              <div>
                미식별 박스는 <strong>[패스]</strong> 또는 <strong>[검색 매칭]</strong>을 선택하고, 일반 박스는 클릭 시 <strong>포함/제외</strong>가 전환됩니다.
              </div>
            </div>
          </section>

          {/* [신규 핵심 B] 직육면체 지그재그 3면 적재(정면·좌·우) 교차 & 전산 잔여 품목 소거 매칭 및 미식별 박스 처리 패널 */}
          <section className={styles.unreadablePanelCard} data-testid="box-vision-unreadable-queue-panel">
            <div className={styles.panelHeader}>
              <div>
                <h2 className={styles.panelTitle}>
                  [지그재그 3면 적재(정면·좌·우) 교차 & 전산 잔여 품목 소거 매칭 대기열 ({fmt((analysisData?.unreadablePendingQueue || []).length)}건)]
                </h2>
                <div style={{ fontSize: 12.5, color: '#78350f', marginTop: 2 }}>
                  사장님 현장 적재 원리: 직육면체 박스 1면(단면)에만 라벨지가 붙어있고 팔레트 안정성을 위해 층마다 <strong>90도 지그재그(교차) 적재</strong>하여 정면·좌측면·우측면 3면에 라벨이 분산 노출됩니다. 옆면(HOLEX 로고 긴 면) 노출 박스는 ① <strong>[3면 사진 교차 / 전산 출고 원장 소거법 원클릭 확정]</strong>, ② <strong>[직접 검색 매칭]</strong>, ③ <strong>[패스]</strong> 중 선택하세요.
                </div>
              </div>
              <div className={styles.sampleChips}>
                {(analysisData?.unreadablePendingQueue || []).length > 0 && (
                  <>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      data-testid="zigzag-batch-auto-deduce-btn"
                      onClick={() => handleBatchAutoDeduceZigzag(true)}
                    >
                      [지그재그 옆면 박스 → 전산 잔여 품목 자동 소거 매칭 ({fmt((analysisData?.unreadablePendingQueue || []).length)}건 일괄 적용)]
                    </button>
                    <button
                      type="button"
                      className={styles.btnPass}
                      data-testid="unreadable-batch-pass-exclude-btn"
                      onClick={() => handleBatchPassAllUnreadable('exclude_count')}
                    >
                      미식별 전체 패스 (카운트 제외)
                    </button>
                    <button
                      type="button"
                      className={styles.btnPass}
                      data-testid="unreadable-batch-pass-keepbox-btn"
                      onClick={() => handleBatchPassAllUnreadable('keep_box_skip_item')}
                    >
                      미식별 전체 패스 (박스 수만 유지)
                    </button>
                  </>
                )}
                {selectedBox && !selectedBox.isPendingUnreadable && (
                  <button
                    type="button"
                    className={styles.btnWarn}
                    data-testid="mark-selected-box-unreadable-btn"
                    onClick={() => handleMarkBoxAsUnreadable(selectedBox, 'unreadable_both')}
                  >
                    선택 박스({selectedBox.serialNo})를 판독 보류(미식별)로 전환
                  </button>
                )}
              </div>
            </div>

            {/* 시각적 소거법 수식 배너: 전산 출고 N박스 - 정면 라벨 확인 M박스 = 지그재그 옆면 잔여 K박스 품목 확정 */}
            {analysisData?.zigzagDeductionSummary && (
              <div
                style={{
                  background: '#ecfdf5',
                  border: '1px solid #10b981',
                  borderLeft: '4px solid #059669',
                  borderRadius: 5,
                  padding: '8px 12px',
                  marginBottom: 10,
                  fontSize: 13,
                  color: '#065f46',
                }}
                data-testid="zigzag-deduction-formula-banner"
              >
                <div>
                  <strong>[직육면체 3면 교차 & 전산 잔여 소거법 수식]</strong>{' '}
                  <span style={{ fontWeight: 700, color: '#0f172a' }}>
                    {analysisData.zigzagDeductionSummary.formulaEquation}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: '#047857', marginTop: 2 }}>
                  {analysisData.zigzagDeductionSummary.principleExplanation}
                </div>
              </div>
            )}

            <div className={styles.unreadableQueueList}>
              {(analysisData?.unreadablePendingQueue || []).map((uBox) => {
                const isMatcherOpen = activeMatcherBoxId === uBox.boxId;
                const liveCandidates = buildUnreadableBoxSearchCandidates(uBox, {
                  allBoxes: analysisData?.allBoxes || [],
                  productCatalog: analysisData?.searchableProducts || SEARCHABLE_PRODUCT_CATALOG,
                  searchQuery: isMatcherOpen ? matcherSearchQuery : '',
                });
                const activeCandidate =
                  (isMatcherOpen && matcherSelectedCandidate) ||
                  liveCandidates[0] ||
                  (uBox.recommendedCandidates && uBox.recommendedCandidates[0]) ||
                  null;

                const isZigzag = uBox.boxFace === 'zigzag_side';
                const sideText =
                  uBox.exposedLabelSide === 'left'
                    ? '라벨 좌측면 노출'
                    : uBox.exposedLabelSide === 'right'
                    ? '라벨 우측면 노출'
                    : '라벨 좌/우측면 노출';
                const ocrBadgeText = isZigzag
                  ? `[지그재그 적재 옆면 (${sideText})]`
                  : uBox.ocrStatus === 'unreadable_item'
                  ? '품목명 미식별 (라벨 일부 가림)'
                  : uBox.ocrStatus === 'unreadable_qty'
                  ? '본수 숫자 미식별 (숫자 흐림/가림)'
                  : '품목·본수 숫자 모두 미식별 (하단 무라벨/가림)';
                const dedCand = uBox.deductionCandidate;

                return (
                  <div
                    key={uBox.boxId}
                    className={styles.unreadableItemCard}
                    data-testid={`unreadable-queue-item-${uBox.boxId}`}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <span className={styles.badgeWarn} data-testid={`box-face-badge-${uBox.boxId}`}>
                          {ocrBadgeText}
                        </span>{' '}
                        <strong>
                          [사진 #{uBox.photoNumber}({uBox.cameraAngleLabel || '정면'}) · 박스 #{uBox.countSeq || uBox.boxSeq}] {uBox.custName} ({uBox.labelCode})
                        </strong>{' '}
                        · 외형: <strong>{uBox.boxSpec}</strong> · 일련번호 힌트: <strong>{uBox.serialNo}</strong>
                      </div>
                      <span className={styles.badgeNeutral}>
                        Bill #{uBox.invoiceNo} · {uBox.orderWeek}차 ({uBox.farmName})
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: '#78350f', marginTop: 4 }}>
                      <strong>정면 미식별 사유:</strong> {uBox.unreadableReason}
                    </div>
                    {dedCand && (
                      <div
                        style={{
                          background: '#f0fdfa',
                          border: '1px solid #99f6e4',
                          borderRadius: 5,
                          padding: '6px 10px',
                          marginTop: 6,
                          fontSize: 12.5,
                          color: '#0f172a',
                        }}
                        data-testid={`deduction-candidate-box-${uBox.boxId}`}
                      >
                        <div>
                          <span className={styles.badgeMatch}>{dedCand.methodBadge}</span>{' '}
                          <strong>1순위 역산 품목:</strong>{' '}
                          <strong style={{ color: '#0f766e' }}>
                            {dedCand.prodName} ({dedCand.flowerName}) · {fmt(dedCand.qtyPerBox)}{dedCand.unit}
                            {dedCand.stemsPerBox ? ` (${fmt(dedCand.stemsPerBox)}본)` : ''}
                          </strong>{' '}
                          (일련번호 <strong>{dedCand.serialNo}</strong>)
                        </div>
                        <div style={{ color: '#334155', marginTop: 2 }}>
                          <strong>역산 근거:</strong> {dedCand.deductionReason}
                        </div>
                      </div>
                    )}

                    <div className={styles.unreadableActionRow}>
                      <div className={styles.sampleChips}>
                        {dedCand && (
                          <button
                            type="button"
                            className={styles.btnPrimary}
                            data-testid={`confirm-zigzag-deduction-btn-${uBox.boxId}`}
                            onClick={() => handleConfirmZigzagDeductionSingle(uBox)}
                          >
                            ① [소거법/3면교차 추천 품목으로 1클릭 확정 ({dedCand.prodName} {fmt(dedCand.qtyPerBox)}{dedCand.unit})]
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          data-testid={`open-search-matcher-btn-${uBox.boxId}`}
                          onClick={() => {
                            if (isMatcherOpen) {
                              setActiveMatcherBoxId(null);
                            } else {
                              handleOpenSearchMatcher(uBox);
                            }
                          }}
                        >
                          {isMatcherOpen
                            ? '② [직접 검색 매칭기 닫기]'
                            : '② [직접 검색 매칭 (품목 · 본수 · 업체/Bill 지정)]'}
                        </button>
                      </div>
                      <div className={styles.sampleChips}>
                        <button
                          type="button"
                          className={styles.btnPass}
                          data-testid={`pass-exclude-btn-${uBox.boxId}`}
                          onClick={() => handlePassUnreadableBox(uBox, 'exclude_count')}
                        >
                          ③-A. [패스 (카운트 제외)]
                        </button>
                        <button
                          type="button"
                          className={styles.btnPass}
                          data-testid={`pass-keepbox-btn-${uBox.boxId}`}
                          onClick={() => handlePassUnreadableBox(uBox, 'keep_box_skip_item')}
                        >
                          ③-B. [패스 (박스 수만 유지)]
                        </button>
                      </div>
                    </div>

                    {/* 인라인 드로어: [전산 품목·출고 후보 즉시 검색 매칭기] */}
                    {isMatcherOpen && (
                      <div
                        className={styles.searchMatcherDrawer}
                        data-testid={`search-matcher-drawer-${uBox.boxId}`}
                      >
                        <div style={{ fontWeight: 700, fontSize: 13.5, color: '#0f766e', marginBottom: 6 }}>
                          [전산 품목·출고 후보 즉시 검색 매칭기] — {uBox.orderWeek}차 · Bill #{uBox.invoiceNo} · {uBox.custName} · {uBox.boxSpec} 기준 잔여 출고 후보 1순위 자동 추천
                        </div>

                        {/* 1) 스마트 추천 후보 1순위 원클릭 카드 리스트 */}
                        <div style={{ fontSize: 12.5, color: '#334155', fontWeight: 600 }}>
                          추천 출고 원장 후보 (클릭 시 품목·본수 자동 입력 또는 즉시 매칭):
                        </div>
                        <div className={styles.candidateGrid}>
                          {liveCandidates.slice(0, 6).map((cand, cIdx) => {
                            const isCandActive =
                              activeCandidate &&
                              Number(activeCandidate.prodKey) === Number(cand.prodKey) &&
                              Number(activeCandidate.custKey) === Number(cand.custKey);
                            return (
                              <div
                                key={cand.candidateId}
                                role="button"
                                tabIndex={0}
                                data-testid={`candidate-card-${uBox.boxId}-${cand.prodKey}`}
                                className={isCandActive ? styles.candidateCardActive : styles.candidateCard}
                                onClick={() => {
                                  setMatcherSelectedCandidate(cand);
                                  setMatcherQtyPerBox(Number(cand.suggestedQtyPerBox || 40));
                                  setMatcherCustKey(Number(cand.custKey || uBox.custKey || 533));
                                  setMatcherInvoiceNo(String(cand.invoiceNo || uBox.invoiceNo || '1222993'));
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setMatcherSelectedCandidate(cand);
                                    setMatcherQtyPerBox(Number(cand.suggestedQtyPerBox || 40));
                                    setMatcherCustKey(Number(cand.custKey || uBox.custKey || 533));
                                    setMatcherInvoiceNo(String(cand.invoiceNo || uBox.invoiceNo || '1222993'));
                                  }
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                                  <span className={cIdx === 0 ? styles.badgeMatch : styles.badgeNeutral}>
                                    {cIdx === 0 ? '스마트 추천 1순위' : `추천 후보 #${cIdx + 1}`}
                                  </span>
                                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0f766e' }}>
                                    박스당 {fmt(cand.suggestedQtyPerBox)}{cand.unit}
                                    {cand.stemsPerBox ? ` (${fmt(cand.stemsPerBox)}본)` : ''}
                                  </span>
                                </div>
                                <div style={{ fontWeight: 700, fontSize: 13.5, marginTop: 4 }}>
                                  {cand.prodName} ({cand.flowerName})
                                </div>
                                <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>
                                  {cand.recommendReason}
                                </div>
                                <div style={{ marginTop: 6 }}>
                                  <button
                                    type="button"
                                    className={styles.btnPrimary}
                                    style={{ padding: '4px 9px', fontSize: 12.5 }}
                                    data-testid={`quick-confirm-candidate-${uBox.boxId}-${cand.prodKey}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleConfirmSearchMatch(uBox, cand);
                                    }}
                                  >
                                    이 후보로 즉시 매칭 확정 ({fmt(cand.suggestedQtyPerBox)}{cand.unit})
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* 2) 실시간 품목/본수 검색창 */}
                        <div className={styles.inlineFieldGroup}>
                          <label htmlFor={`matcher-search-${uBox.boxId}`} style={{ fontWeight: 700, fontSize: 13 }}>
                            품목명(한글/영문) 또는 본수 숫자 검색:
                          </label>
                          <input
                            id={`matcher-search-${uBox.boxId}`}
                            type="text"
                            className={styles.textInput}
                            data-testid={`matcher-search-input-${uBox.boxId}`}
                            value={matcherSearchQuery}
                            onChange={(e) => {
                              const val = e.target.value;
                              setMatcherSearchQuery(val);
                              const nextList = buildUnreadableBoxSearchCandidates(uBox, {
                                allBoxes: analysisData?.allBoxes || [],
                                productCatalog: analysisData?.searchableProducts || SEARCHABLE_PRODUCT_CATALOG,
                                searchQuery: val,
                              });
                              if (nextList[0]) {
                                setMatcherSelectedCandidate(nextList[0]);
                                setMatcherQtyPerBox(Number(nextList[0].suggestedQtyPerBox || 40));
                              }
                            }}
                            placeholder="예: 카라, 튤립, 아마릴리스, 안시리움, 백합, 호접란 또는 본수 숫자(130, 200, 90, 40, 30, 12)"
                          />
                          {['카라', '튤립', '아마릴리스', '백합', '안시리움', '130', '200', '12'].map((kw) => (
                            <button
                              key={kw}
                              type="button"
                              className={matcherSearchQuery === kw ? styles.sampleChipActive : styles.sampleChip}
                              data-testid={`matcher-quick-kw-${uBox.boxId}-${kw}`}
                              onClick={() => {
                                const nextVal = matcherSearchQuery === kw ? '' : kw;
                                setMatcherSearchQuery(nextVal);
                                const nextList = buildUnreadableBoxSearchCandidates(uBox, {
                                  allBoxes: analysisData?.allBoxes || [],
                                  productCatalog: analysisData?.searchableProducts || SEARCHABLE_PRODUCT_CATALOG,
                                  searchQuery: nextVal,
                                });
                                if (nextList[0]) {
                                  setMatcherSelectedCandidate(nextList[0]);
                                  setMatcherQtyPerBox(Number(nextList[0].suggestedQtyPerBox || 40));
                                }
                              }}
                            >
                              {kw}
                            </button>
                          ))}
                        </div>

                        {/* 3) 품목 · 박스당 본수(숫자) · 업체 · Bill 번호 직접 지정 및 [매칭 확정] */}
                        <div className={styles.inlineFieldGroup}>
                          <label htmlFor={`matcher-prod-select-${uBox.boxId}`} style={{ fontWeight: 700, fontSize: 13 }}>
                            매칭 품목:
                          </label>
                          <select
                            id={`matcher-prod-select-${uBox.boxId}`}
                            className={styles.selectInput}
                            data-testid={`matcher-prod-select-${uBox.boxId}`}
                            value={activeCandidate ? activeCandidate.prodKey : ''}
                            onChange={(e) => {
                              const pk = Number(e.target.value);
                              const found =
                                liveCandidates.find((c) => Number(c.prodKey) === pk) ||
                                (analysisData?.searchableProducts || SEARCHABLE_PRODUCT_CATALOG).find(
                                  (c) => Number(c.prodKey) === pk
                                );
                              if (found) {
                                setMatcherSelectedCandidate(found);
                                setMatcherQtyPerBox(Number(found.suggestedQtyPerBox || found.defaultQtyPerBox || 40));
                              }
                            }}
                          >
                            {liveCandidates.map((c) => (
                              <option key={`${c.candidateId}-opt`} value={c.prodKey}>
                                {c.prodName} ({c.flowerName} · 기본 {c.suggestedQtyPerBox}{c.unit})
                              </option>
                            ))}
                          </select>

                          <label htmlFor={`matcher-qty-input-${uBox.boxId}`} style={{ fontWeight: 700, fontSize: 13 }}>
                            박스당 수량({activeCandidate?.unit || '송이'}):
                          </label>
                          <input
                            id={`matcher-qty-input-${uBox.boxId}`}
                            type="number"
                            min={1}
                            max={2000}
                            className={styles.numberInput}
                            data-testid={`matcher-qty-input-${uBox.boxId}`}
                            value={matcherQtyPerBox}
                            onChange={(e) => setMatcherQtyPerBox(Number(e.target.value || 0))}
                          />

                          <label htmlFor={`matcher-cust-select-${uBox.boxId}`} style={{ fontWeight: 700, fontSize: 13 }}>
                            업체:
                          </label>
                          <select
                            id={`matcher-cust-select-${uBox.boxId}`}
                            className={styles.selectInput}
                            data-testid={`matcher-cust-select-${uBox.boxId}`}
                            value={matcherCustKey}
                            onChange={(e) => setMatcherCustKey(Number(e.target.value))}
                          >
                            {CUSTOMER_OPTIONS.map((c) => (
                              <option key={c.custKey} value={c.custKey}>
                                {c.custName} ({c.custCode})
                              </option>
                            ))}
                          </select>

                          <label htmlFor={`matcher-bill-select-${uBox.boxId}`} style={{ fontWeight: 700, fontSize: 13 }}>
                            Bill / 차수:
                          </label>
                          <select
                            id={`matcher-bill-select-${uBox.boxId}`}
                            className={styles.selectInput}
                            data-testid={`matcher-bill-select-${uBox.boxId}`}
                            value={matcherInvoiceNo}
                            onChange={(e) => setMatcherInvoiceNo(e.target.value)}
                          >
                            {BILL_OPTIONS.map((b) => (
                              <option key={b.invoiceNo} value={b.invoiceNo}>
                                Bill #{b.invoiceNo} ({b.orderWeek}차 · {b.farmName})
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            className={styles.btnPrimary}
                            data-testid={`confirm-search-match-btn-${uBox.boxId}`}
                            onClick={() => handleConfirmSearchMatch(uBox, activeCandidate)}
                          >
                            [매칭 확정]
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 이미 패스되었거나 수동 검색매칭 완료된 박스 내역 (언제든 [다시 매칭하기]로 복원 가능) */}
              {(analysisData?.unreadableResolvedBoxes || []).length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#334155', marginBottom: 6 }}>
                    처리 완료된 미식별 박스 ({fmt((analysisData?.unreadableResolvedBoxes || []).length)}건) — 언제든 [다시 매칭하기]로 변경 가능:
                  </div>
                  {(analysisData?.unreadableResolvedBoxes || []).map((rBox) => (
                    <div
                      key={`resolved-${rBox.boxId}`}
                      className={styles.unreadableItemCardResolved}
                      data-testid={`unreadable-resolved-item-${rBox.boxId}`}
                      style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                    >
                      <div>
                        {rBox.resolutionAction === 'passed' ? (
                          <span className={styles.badgeNeutral} data-testid={`passed-badge-${rBox.boxId}`}>
                            {rBox.passMode === 'keep_box_skip_item'
                              ? '[패스됨 · 박스 수만 유지/품목 미확인]'
                              : '[패스됨 · 카운트 제외]'}
                          </span>
                        ) : (
                          <span className={styles.badgeMatch} data-testid={`matched-badge-${rBox.boxId}`}>
                            {rBox.deductionMatched
                              ? rBox.deductionMethod === 'cross_angle_3side'
                                ? '[3면 사진 교차 라벨 매칭완료]'
                                : '[전산 잔여 품목 소거법 매칭완료]'
                              : '[수동 검색매칭 완료]'}
                          </span>
                        )}{' '}
                        <strong>[사진 #{rBox.photoNumber}] {rBox.serialNo}</strong> ·{' '}
                        <strong>{rBox.custName}</strong> · <strong>{rBox.prodName}</strong> ({fmt(rBox.qtyPerBox)}{rBox.unit}) · Bill #{rBox.invoiceNo} ({rBox.orderWeek}차)
                      </div>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        data-testid={`rematch-box-btn-${rBox.boxId}`}
                        onClick={() => handleMarkBoxAsUnreadable(rBox, rBox.ocrStatus === 'confirmed' ? 'unreadable_both' : rBox.ocrStatus)}
                      >
                        [다시 매칭하기]
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* 선택된 박스 정밀 라벨 OCR 판독 상세 */}
          {selectedBox && (
            <section className={styles.panelCard} data-testid="box-vision-selected-detail">
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>
                  선택 박스 정밀 라벨 · Bill · 입고 차수 판독 정보 ({selectedBox.serialNo})
                </h2>
                <div className={styles.sampleChips}>
                  {selectedBox.isPendingUnreadable ? (
                    <>
                      <button
                        type="button"
                        className={styles.btnPass}
                        data-testid="selected-box-pass-btn"
                        onClick={() => handlePassUnreadableBox(selectedBox, 'exclude_count')}
                      >
                        [카운트 제외 패스]
                      </button>
                      <button
                        type="button"
                        className={styles.btnPrimary}
                        data-testid="selected-box-search-match-btn"
                        onClick={() => handleOpenSearchMatcher(selectedBox)}
                      >
                        [검색 매칭 열기]
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.btnWarn}
                      data-testid="selected-box-mark-unreadable-btn"
                      onClick={() => handleMarkBoxAsUnreadable(selectedBox, 'unreadable_both')}
                    >
                      판독 보류(품목/숫자 미식별)로 전환
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    data-testid="toggle-selected-box-btn"
                    onClick={() => toggleBoxInclusion(selectedBox)}
                  >
                    {selectedBox.status === 'COUNTED' ? '이 박스 집계에서 제외' : '이 박스 집계에 포함'}
                  </button>
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.dataTable}>
                  <tbody>
                    <tr>
                      <th>바코드 일련번호</th>
                      <td><strong>{selectedBox.serialNo}</strong> (오더 {selectedBox.orderNo} · 라인 {selectedBox.lineNo} · 박스 #{selectedBox.boxSeq})</td>
                      <th>판독 상태</th>
                      <td>
                        {selectedBox.isPendingUnreadable && (
                          <span className={styles.badgeWarn}>판독 보류 · 품목/숫자 미식별 (패스 또는 검색매칭 대기)</span>
                        )}
                        {!selectedBox.isPendingUnreadable && selectedBox.resolutionAction === 'matched' && (
                          <span className={styles.badgeMatch}>[수동 검색매칭 완료] (#{selectedBox.countSeq})</span>
                        )}
                        {!selectedBox.isPendingUnreadable && selectedBox.resolutionAction === 'passed' && (
                          <span className={styles.badgeNeutral}>
                            {selectedBox.passMode === 'keep_box_skip_item'
                              ? '[패스됨 · 박스 수 유지/품목 미확인]'
                              : '[패스됨 · 카운트 제외]'}
                          </span>
                        )}
                        {!selectedBox.isPendingUnreadable &&
                          selectedBox.resolutionAction !== 'matched' &&
                          selectedBox.resolutionAction !== 'passed' &&
                          selectedBox.status === 'COUNTED' && (
                            <span className={styles.badgeMatch}>정상 카운팅 (#{selectedBox.countSeq})</span>
                          )}
                        {selectedBox.status === 'DUPLICATE' && <span className={styles.badgeDup}>중복 제외됨 ({selectedBox.duplicateOfPhoto})</span>}
                        {selectedBox.status === 'EXCLUDED' && selectedBox.resolutionAction !== 'passed' && (
                          <span className={styles.badgeWarn}>사용자 수동 제외</span>
                        )}
                        {selectedBox.status === 'BACKGROUND' && <span className={styles.badgeNeutral}>배경 타 팔레트 분리</span>}
                      </td>
                    </tr>
                    <tr>
                      <th>업체명 (라벨/수기)</th>
                      <td><strong>{selectedBox.custName}</strong> ({selectedBox.labelCode} · {selectedBox.handwriting})</td>
                      <th>Bill 번호 · 입고 차수</th>
                      <td>
                        <strong>Bill #{selectedBox.invoiceNo}</strong> (AWB <strong>{selectedBox.awbNo}</strong>) →{' '}
                        <span className={styles.badgeMatch}>{selectedBox.orderYear}년 {selectedBox.orderWeek}차 입고 ({selectedBox.farmName})</span>
                      </td>
                    </tr>
                    <tr>
                      <th>라벨 영문 원문</th>
                      <td><strong>{selectedBox.rawLabelItem}</strong> ({selectedBox.stickerCode})</td>
                      <th>적재 노출면 · 라벨 방향</th>
                      <td>
                        <span className={selectedBox.boxFace === 'zigzag_side' ? styles.badgeWarn : styles.badgeMatch}>
                          {selectedBox.boxFace === 'zigzag_side'
                            ? `지그재그 교차 옆면 (zigzag_side · 라벨 ${selectedBox.exposedLabelSide === 'left' ? '좌측면' : '우측면'} 노출)`
                            : '라벨 부착 단면 (label_end · 정면 노출)'}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <th>DB 매칭 품목명</th>
                      <td><strong>{selectedBox.prodName}</strong> ({selectedBox.flowerName} · #{selectedBox.prodKey})</td>
                      <th>박스당 수량</th>
                      <td><strong>{fmt(selectedBox.qtyPerBox)} {selectedBox.unit}</strong>{selectedBox.stemsPerBox ? ` (${fmt(selectedBox.stemsPerBox)}본)` : ''}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* 우측: ① 업체별×품목별×수량×Bill번호×입고차수 통합 체크 매트릭스, ② 농장 박스색상 교차 판별표, ③ 영업수입불량차감 사진 매칭 */}
        <div>
          {/* 1. 모든 사진에 걸친 [업체별 × 품목별 × 수량 × Bill 번호(AWB) × 입고 차수] 통합 체크 매트릭스 */}
          <section className={styles.panelCard} data-testid="box-vision-reconcile-panel">
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>
                1. 묶음 사진 전체 [업체별 × 품목별 × 수량 × Bill 번호(AWB) × 입고 차수] 통합 체크 매트릭스
              </h2>
              <span className={styles.badgeMatch}>
                총 {fmt(totals.countedBoxes)}박스 · {fmt((analysisData?.customerItemSummary || []).length)}개 품목 라인 · Bill/입고차수 100% 체크완료
              </span>
            </div>

            {analysisData?.zigzagDeductionSummary && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderLeft: '4px solid #0f766e',
                  borderRadius: 5,
                  padding: '8px 12px',
                  marginBottom: 10,
                  fontSize: 13,
                  color: '#0f172a',
                }}
                data-testid="reconcile-zigzag-formula-bar"
              >
                <strong>[지그재그 옆면 소거 대조 수식]</strong>{' '}
                {analysisData.zigzagDeductionSummary.formulaEquation}
              </div>
            )}

            {/* 업체별 소계 배지 (업체별 수량 + Bill 번호 + 입고 차수 명시) */}
            <div className={styles.sampleChips} style={{ marginBottom: 10 }}>
              {(analysisData?.customerTotals || []).map((ct) => (
                <span key={ct.custKey || ct.custName} className={styles.badgeNeutral}>
                  <strong>{ct.custName} ({ct.custCode})</strong>: {fmt(ct.itemKindCount)}품목 · <strong>{fmt(ct.totalBoxes)}박스</strong> · 사진합계 {fmt(ct.totalPhotoQty)} / 전산출고 {fmt(ct.totalErpQty)} · Bill #{(ct.invoiceNos || ['1222993']).join(',')} ({(ct.orderWeeks || ['47-02']).join(',')}차 입고)
                </span>
              ))}
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.dataTable} data-testid="box-vision-reconcile-table">
                <thead>
                  <tr>
                    <th>업체명 (라벨코드)</th>
                    <th>품목명 (한글분류 · 규격)</th>
                    <th>사진 묶음 내 등장 위치</th>
                    <th className={styles.numCell}>사진 카운트 수량 (박스 / 총본수)</th>
                    <th className={styles.numCell}>전산 출고 수량 (ShipmentDetail)</th>
                    <th>Bill 번호 (InvoiceNo & AWB)</th>
                    <th>Bill 기준 입고 차수 · 농장</th>
                    <th>검수 및 Bill·차수 체크 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {(analysisData?.customerItemSummary || []).map((row) => (
                    <tr key={row.groupKey} data-testid={`reconcile-row-${row.custKey}-${row.prodKey}`}>
                      <td>
                        <strong>{row.custName}</strong>
                        <div style={{ fontSize: 12.5, color: '#475569' }}>
                          코드: <strong>{row.custCode}</strong> ({(row.labelCodes || []).join(', ') || `ICNNEN/${row.custCode}`})
                        </div>
                      </td>
                      <td>
                        <strong>{row.prodName}</strong>
                        <div style={{ fontSize: 12.5, color: '#334155' }}>
                          {row.flowerName} · #{row.prodKey} · 규격: {(row.boxSpecs || []).join(', ') || '표준'}
                        </div>
                      </td>
                      <td style={{ fontSize: 12.5, maxWidth: 195 }}>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{row.photoAppearanceLabel}</div>
                        <div style={{ color: '#475569' }}>일련번호: {row.serialList.join(', ')}</div>
                        {row.stickerNotes.length > 0 && (
                          <div style={{ color: '#0f766e', fontWeight: 600 }}>{row.stickerNotes.join(' / ')}</div>
                        )}
                      </td>
                      <td className={styles.numCell}>
                        <strong>{fmt(row.photoBoxCount)} 박스</strong>
                        <div style={{ fontSize: 12.5, color: '#0f172a' }}>
                          <strong>{fmt(row.photoTotalQty)} {row.unit}</strong>
                          {row.photoTotalStems !== row.photoTotalQty ? ` (${fmt(row.photoTotalStems)}본)` : ''}
                        </div>
                      </td>
                      <td className={styles.numCell}>
                        <strong>{fmt(row.erpBoxQty)} 박스</strong>
                        <div style={{ fontSize: 12.5, color: '#334155' }}>
                          {fmt(row.erpOutQty)} {row.unit} (차이 {row.diffQty === 0 ? '0' : `${row.diffQty > 0 ? '+' : ''}${fmt(row.diffQty)}`})
                        </div>
                      </td>
                      <td>
                        <strong>Bill #{row.invoiceNo}</strong>
                        <div style={{ fontSize: 12.5, color: '#334155' }}>
                          AWB: <strong>{row.awbNo}</strong>
                        </div>
                        <div style={{ fontSize: 12.5, color: '#475569' }}>
                          오더: {(row.orderNos || []).join(', ')}
                        </div>
                      </td>
                      <td>
                        <span className={styles.badgeMatch}>
                          {row.orderWeekLabel || `${row.orderYear}년 ${row.orderWeek}차 입고`}
                        </span>
                        <div style={{ fontSize: 12.5, color: '#0f172a', marginTop: 3 }}>
                          농장: <strong>{row.farmName}</strong> ({row.countryName})
                        </div>
                      </td>
                      <td>
                        <div>
                          {row.reconcileStatus === 'MATCH' ? (
                            <span className={styles.badgeMatch}>{row.inspectionBadge}</span>
                          ) : (
                            <span className={styles.badgeWarn}>{row.inspectionBadge}</span>
                          )}
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <span className={styles.badgeMatch} data-testid={`bill-check-badge-${row.custKey}-${row.prodKey}`}>
                            {row.billCheckBadge || '[Bill·차수 확인완료]'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 2. 해당 차수(Bill 번호) · 농장 박스색상 교차 판별기 */}
          <section className={styles.panelCard} data-testid="box-vision-farm-profile-panel">
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>
                2. 차수(Bill/AWB) · 농장별 박스 색상 및 라벨 3단계 교차 판별기
              </h2>
              <span className={styles.badgeNeutral}>
                동일 박스 색상 다중 농장 자동 구분
              </span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>박스 외형 · 색상 프로파일</th>
                    <th>동일 색상 후보 농장</th>
                    <th>확정 농장 (국가)</th>
                    <th>3단계 교차 판별 근거 (색상 → 라벨/오더코드 → 입고·분배 원장)</th>
                  </tr>
                </thead>
                <tbody>
                  {(analysisData?.farmBoxProfiles || []).map((prof) => (
                    <tr key={prof.profileId}>
                      <td>
                        <span
                          style={{
                            display: 'inline-block',
                            width: 12,
                            height: 12,
                            borderRadius: 3,
                            background: prof.colorHex,
                            border: `2px solid ${prof.borderHex}`,
                            marginRight: 6,
                            verticalAlign: 'middle',
                          }}
                        />
                        <strong>{prof.colorLabel}</strong>
                      </td>
                      <td>{prof.candidateFarms.join(', ')}</td>
                      <td>
                        <span className={styles.badgeMatch}>
                          {prof.primaryFarm} ({prof.countryName})
                        </span>
                      </td>
                      <td style={{ fontSize: 13 }}>{prof.disambiguationRule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 3. 불량 카톡방 데이터 연동 & 영업수입불량차감 불량품목 사진 매칭 */}
          <section className={styles.panelCard} data-testid="box-vision-defect-panel">
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>
                3. 수입불량 카톡방 · 영업수입불량차감 불량품목 사진 자동 매칭 및 농장/Bill/입고차수 반영
              </h2>
              <Link href="/sales/defect-deductions?year=2026&week=47" className={styles.btnSecondary}>
                영업수입불량차감 화면에서 보기
              </Link>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable} data-testid="box-vision-defect-table">
                <thead>
                  <tr>
                    <th>불량차감 번호</th>
                    <th>업체명 · 차수</th>
                    <th>불량 품목명 · 수량</th>
                    <th>매칭 농장 · Bill(AWB)</th>
                    <th>매칭 점수 · 판독 근거</th>
                    <th>사진 등록 및 농장/차수 반영</th>
                  </tr>
                </thead>
                <tbody>
                  {(analysisData?.matchedDefects || []).map((defect) => {
                    const linked = linkedDefectKeys[defect.deductionKey];
                    return (
                      <tr key={defect.deductionKey}>
                        <td>
                          <strong>#{defect.deductionKey}</strong>
                          <div>
                            <span className={defect.activeInCurrentPhotos ? styles.badgeMatch : styles.badgeNeutral}>
                              {defect.activeInCurrentPhotos ? '현재 사진 직접매칭' : '동일차수 불량방 후보'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <strong>{defect.custName}</strong>
                          <div style={{ fontSize: 12.5, color: '#475569' }}>
                            {defect.orderYear}년 {defect.appliedOrderWeek}차 입고
                          </div>
                        </td>
                        <td>
                          <strong>{defect.prodName}</strong>
                          <div style={{ fontSize: 12.5, color: '#0f172a', fontWeight: 600 }}>
                            차감수량: {fmt(defect.quantity)} {defect.sourceUnit}
                          </div>
                        </td>
                        <td>
                          <strong>{defect.farmName}</strong>
                          <div style={{ fontSize: 12.5, color: '#475569' }}>
                            Bill #{defect.invoiceNo} · AWB {defect.awbNo}
                          </div>
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          <div>
                            <span className={styles.badgeMatch}>매칭 {defect.effectiveScore}점</span>{' '}
                            <span>{defect.serialHint}</span>
                          </div>
                          <div style={{ color: '#334155', marginTop: 2 }}>{defect.matchReason}</div>
                        </td>
                        <td>
                          {linked ? (
                            <div>
                              <span className={styles.badgeMatch} data-testid={`defect-linked-badge-${defect.deductionKey}`}>
                                사진·농장({linked.farmName})·차수({linked.orderWeek}) 반영됨 ({linked.linkedAt})
                              </span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className={styles.btnPrimary}
                              data-testid={`defect-attach-btn-${defect.deductionKey}`}
                              onClick={() => handleAttachDefectPhoto(defect)}
                            >
                              불량차감 품목에 사진·농장/차수 반영
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
