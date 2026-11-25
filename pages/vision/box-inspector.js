// pages/vision/box-inspector.js
// 박스 사진 판독 · 품목/수량 매칭 ([1단계: 사진 업로드 → 2단계: 미식별/옆면 박스 확인 → 3단계: 최종 업체별 결과표] 3단계 스텝 위저드)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
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

const STEP_ITEMS = [
  {
    step: 1,
    title: '1단계. 사진 올리기 (묶음 업로드)',
    sub: '출고 노선 선택 · 사진 붙여넣기(Ctrl+V) 또는 파일 선택',
  },
  {
    step: 2,
    title: '2단계. 미식별/옆면 박스 확인 (패스·매칭)',
    sub: '확인 필요한 박스만 추천 확정 · 검색 매칭 · 패스 선택',
  },
  {
    step: 3,
    title: '3단계. 업체별 품목·수량·Bill 결과표',
    sub: '업체별 출고 수량 대조 · Bill 번호 및 입고 차수 확인',
  },
];

export default function BoxVisionInspectorPage() {
  const router = useRouter();

  // [사장님 필수 지시] 첫 진입 시(또는 [+ 새 작업] 클릭 시) 이전 샘플이나 매칭 상태가 남아있지 않고
  // 완전히 깨끗한 빈 1단계(새 작업 화면: 사진 0장, 메모/검색 초기화 상태)에서 시작합니다.
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedSampleIds, setSelectedSampleIds] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [customPreviewUrl, setCustomPreviewUrl] = useState('');
  const [boxOverrides, setBoxOverrides] = useState({});
  const [photoAngleOverrides, setPhotoAngleOverrides] = useState({});
  const [selectedBoxId, setSelectedBoxId] = useState(null);
  const [batchRouteMessage, setBatchRouteMessage] = useState('호남선 출고입니다');
  const [billSearchQuery, setBillSearchQuery] = useState('');
  const [sampleMenuOpen, setSampleMenuOpen] = useState(false);

  // [2단계] 미식별·지그재그 옆면 박스 검색 매칭 드로어 및 정상 판독 접기 상태
  const [activeMatcherBoxId, setActiveMatcherBoxId] = useState(null);
  const [matcherSearchQuery, setMatcherSearchQuery] = useState('');
  const [matcherSelectedCandidate, setMatcherSelectedCandidate] = useState(null);
  const [matcherQtyPerBox, setMatcherQtyPerBox] = useState(130);
  const [matcherCustKey, setMatcherCustKey] = useState(533);
  const [matcherInvoiceNo, setMatcherInvoiceNo] = useState('1222993');
  const [showConfirmedBoxesCollapse, setShowConfirmedBoxesCollapse] = useState(false);
  const [showSelectedBoxDetail, setShowSelectedBoxDetail] = useState(false);

  // [3단계] 업체별 필터 칩 및 하단 보조 탭 상태 ('BILL_LEDGER' | 'DEFECT_AND_COLOR' | 'CLOSED')
  const [selectedCustomerFilter, setSelectedCustomerFilter] = useState('ALL');
  const [activeStep3SubTab, setActiveStep3SubTab] = useState('BILL_LEDGER');

  const [analysisData, setAnalysisData] = useState(() =>
    analyzeBoxVisionPhotos({
      sampleIds: [],
      uploadedFiles: [],
      batchRouteMessage: '호남선 출고입니다',
      allowEmpty: true,
    })
  );
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [linkedDefectKeys, setLinkedDefectKeys] = useState({});
  const fileInputRef = useRef(null);

  const runAnalysis = useCallback(
    async (
      nextSampleIds,
      nextFiles,
      nextOverrides,
      nextRouteMsg = batchRouteMessage,
      nextBillQuery = billSearchQuery,
      nextAngleOverrides = photoAngleOverrides
    ) => {
      const isEmptySession =
        (!Array.isArray(nextSampleIds) || nextSampleIds.length === 0) &&
        (!Array.isArray(nextFiles) || nextFiles.length === 0);

      const localResult = analyzeBoxVisionPhotos({
        sampleIds: nextSampleIds,
        uploadedFiles: nextFiles,
        boxOverrides: nextOverrides,
        photoAngleOverrides: nextAngleOverrides,
        batchRouteMessage: nextRouteMsg,
        billQuery: nextBillQuery,
        allowEmpty: isEmptySession,
      });
      setAnalysisData(localResult);

      if (isEmptySession) {
        return localResult;
      }

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
      return localResult;
    },
    [batchRouteMessage, billSearchQuery, photoAngleOverrides]
  );

  // [+ 새 작업 (초기화)] — 모든 업로드 사진, 선택 상태, 수동 매칭, 필터를 깨끗한 빈 초기 상태(사진 0장)로 리셋하고 1단계로 즉시 이동
  const handleStartNewWork = useCallback(
    ( updateUrlQuery = false ) => {
      setCurrentStep(1);
      setSelectedSampleIds([]);
      setUploadedFiles([]);
      setActivePhotoIndex(0);
      setCustomPreviewUrl('');
      setBoxOverrides({});
      setPhotoAngleOverrides({});
      setSelectedBoxId(null);
      setActiveMatcherBoxId(null);
      setMatcherSearchQuery('');
      setMatcherSelectedCandidate(null);
      setBatchRouteMessage('호남선 출고입니다');
      setBillSearchQuery('');
      setSelectedCustomerFilter('ALL');
      setSampleMenuOpen(false);
      setShowConfirmedBoxesCollapse(false);
      setShowSelectedBoxDetail(false);
      setLinkedDefectKeys({});
      setAnalysisData(
        analyzeBoxVisionPhotos({
          sampleIds: [],
          uploadedFiles: [],
          batchRouteMessage: '호남선 출고입니다',
          allowEmpty: true,
        })
      );
      setNotice('새 작업이 시작되었습니다. 출고 노선을 선택하고 새 사진 묶음을 올려주세요.');
      if (updateUrlQuery && router?.replace) {
        router.replace('/vision/box-inspector?new=1', undefined, { shallow: true }).catch(() => {});
      }
    },
    [router]
  );

  // [새 탭에서 새 작업 열기] — 현재 작업 결과표는 그대로 두고 새 브라우저 탭/창에서 다른 노선 동시 작업
  const handleOpenNewTabWork = () => {
    if (typeof window !== 'undefined') {
      window.open('/vision/box-inspector?new=1', '_blank', 'noopener,noreferrer');
    }
  };

  // URL 쿼리 ?new=1 또는 ?step=1|2|3 지원
  useEffect(() => {
    if (!router?.isReady) return;
    if (router.query?.new === '1') {
      handleStartNewWork(false);
    } else if (router.query?.step) {
      const targetStep = Number(router.query.step);
      if ([1, 2, 3].includes(targetStep)) {
        setCurrentStep(targetStep);
      }
    }
  }, [router?.isReady, router?.query?.new, router?.query?.step, handleStartNewWork]);

  // 샘플 프리셋 선택 시 즉시 사진 로드 후 미식별 박스가 있으면 2단계, 없으면 3단계(또는 지정 단계)로 이동
  const applySamplePresetAndAdvance = async ({
    sampleIds,
    files = [],
    routeMsg = batchRouteMessage,
    focusPhotoIndex = 0,
    noticeText = '',
    targetStep = 'AUTO',
  }) => {
    setSelectedSampleIds(sampleIds);
    setUploadedFiles(files);
    setBatchRouteMessage(routeMsg);
    setActivePhotoIndex(focusPhotoIndex);
    setCustomPreviewUrl('');
    setBoxOverrides({});
    setPhotoAngleOverrides({});
    setSelectedCustomerFilter('ALL');
    setSampleMenuOpen(false);

    const localResult = await runAnalysis(sampleIds, files, {}, routeMsg, billSearchQuery, {});
    const pendingList = localResult?.unreadablePendingQueue || [];
    if (pendingList.length > 0) {
      setSelectedBoxId(pendingList[0].boxId);
      setActiveMatcherBoxId(null);
      if (focusPhotoIndex === 0 && pendingList[0].photoNumber) {
        setActivePhotoIndex(Math.max(0, pendingList[0].photoNumber - 1));
      }
    } else {
      setSelectedBoxId(localResult?.allBoxes?.[0]?.boxId || null);
      setActiveMatcherBoxId(null);
    }

    const nextStep =
      targetStep === 'AUTO'
        ? pendingList.length > 0
          ? 2
          : 3
        : targetStep;
    setCurrentStep(nextStep);
    setNotice(noticeText);
  };

  const selectSingleSample = (sampleId) => {
    const sample = SAMPLE_PHOTOS.find((s) => s.sampleId === sampleId);
    applySamplePresetAndAdvance({
      sampleIds: [sampleId],
      files: [],
      focusPhotoIndex: 0,
      targetStep: 'AUTO',
      noticeText: `${sample?.shortLabel || sampleId} 샘플을 불러왔습니다.`,
    });
  };

  const selectKakaoBatchPreset = (
    presetMessage = '호남선 출고입니다 (11/23 경부선·호남선 카톡 묶음 사진 5장 일괄 판독)'
  ) => {
    applySamplePresetAndAdvance({
      sampleIds: ALL_SAMPLE_IDS,
      files: [],
      routeMsg: presetMessage,
      focusPhotoIndex: 3, // 미식별·지그재그 옆면 박스가 있는 사진 #4(주광농원 20박스) 기본 포커스
      targetStep: 2,
      noticeText:
        '카톡 5장 묶음(호남선/경부선) 샘플을 불러왔습니다. 2단계에서 미식별·옆면 박스를 확인해 주세요.',
    });
  };

  const selectAllSamplesWithDedupe = () => {
    applySamplePresetAndAdvance({
      sampleIds: ALL_SAMPLE_IDS,
      files: [],
      focusPhotoIndex: 3,
      targetStep: 2,
      noticeText:
        '창고 샘플 5장 전체 묶음을 불러왔습니다. 바코드 일련번호 중복 3박스는 자동 제외되었습니다.',
    });
  };

  const selectNeulbomPair = () => {
    const pairIds = ['sample-2-neulbom-a', 'sample-3-neulbom-b'];
    applySamplePresetAndAdvance({
      sampleIds: pairIds,
      files: [],
      focusPhotoIndex: 1,
      targetStep: 2,
      noticeText:
        '늘봄원예 2장(샘플 2+3) 묶음을 불러왔습니다. 중복 촬영된 우측 2박스를 자동 제외하고 12박스를 확인합니다.',
    });
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
    applySamplePresetAndAdvance({
      sampleIds: ALL_SAMPLE_IDS,
      files: simulated15Files,
      routeMsg: nextMsg,
      focusPhotoIndex: 3,
      targetStep: 2,
      noticeText:
        '카톡 15장 묶음 샘플을 불러왔습니다. 중복 촬영 박스를 제거하고 미식별·옆면 박스 확인 단계(2단계)로 이동했습니다.',
    });
  };

  const handleFilesAdded = useCallback(
    (fileList, appendToBatch = true) => {
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
      setActivePhotoIndex(0);
      setNotice(
        `사진 ${files.length}장이 추가되었습니다 (현재 총 ${Math.max(nextIds.length, combinedUploads.length)}장). 하단 [다음: 박스 판독 및 미식별 확인 (2단계로 이동) →] 버튼을 눌러 진행하세요.`
      );
      runAnalysis(nextIds, combinedUploads, boxOverrides, batchRouteMessage, billSearchQuery);
    },
    [batchRouteMessage, billSearchQuery, boxOverrides, runAnalysis, selectedSampleIds, uploadedFiles]
  );

  const handleRemovePhotoFromBatch = (photoIdx, sampleId) => {
    const nextSampleIds = selectedSampleIds.filter((id, idx) => id !== sampleId && idx !== photoIdx);
    const nextUploads = uploadedFiles.filter((_, idx) => idx !== photoIdx);
    if (nextSampleIds.length === 0 && nextUploads.length === 0) {
      handleStartNewWork(false);
      return;
    }
    setSelectedSampleIds(nextSampleIds);
    setUploadedFiles(nextUploads);
    setActivePhotoIndex(0);
    setNotice(`사진 #${photoIdx + 1}을 묶음에서 제외했습니다.`);
    runAnalysis(nextSampleIds, nextUploads, boxOverrides, batchRouteMessage, billSearchQuery);
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

  // [2단계] 미식별·옆면 박스 처리 핸들러
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
      passMode === 'exclude_count' ? '카운트 제외 패스' : '박스 수만 유지 패스';
    setNotice(`미식별 박스 [#${box.countSeq || box.boxSeq} · ${box.custName}]를 [${modeLabel}] 처리했습니다.`);
    runAnalysis(selectedSampleIds, uploadedFiles, nextOverrides, batchRouteMessage, billSearchQuery);
  };

  const handleBatchPassAllUnreadable = (passMode = 'exclude_count') => {
    const queue = analysisData?.unreadablePendingQueue || [];
    if (!queue.length) {
      setNotice('현재 남은 미식별 박스가 없습니다.');
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
      passMode === 'exclude_count' ? '카운트 제외 패스' : '박스 수만 유지 패스';
    setNotice(`남은 미식별 박스 ${queue.length}건을 전체 [${modeLabel}] 처리했습니다.`);
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
    if (box.photoNumber) {
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

    const remainingQueue = (analysisData?.unreadablePendingQueue || []).filter((b) => b.boxId !== box.boxId);
    if (remainingQueue.length > 0) {
      setSelectedBoxId(remainingQueue[0].boxId);
      setActiveMatcherBoxId(null);
    } else {
      setActiveMatcherBoxId(null);
    }

    setNotice(
      `박스 [#${box.countSeq || box.boxSeq}] 검색 매칭 완료: [${custMeta.custName} · ${chosen.prodName} · ${fmt(finalQty)}${chosen.unit}]`
    );
    runAnalysis(selectedSampleIds, uploadedFiles, nextOverrides, batchRouteMessage, billSearchQuery);
  };

  const handleMarkBoxAsUnreadable = (box, ocrType = 'unreadable_both') => {
    if (!box) return;
    setSelectedBoxId(box.boxId);
    const reasonMap = {
      unreadable_item: '수동 지정: 라벨 일부 가림 (품목명 미식별)',
      unreadable_qty: '수동 지정: 수기 숫자 흐림/가림 (박스당 본수 확인 필요)',
      unreadable_both: '수동 지정: 라벨 가림·저해상도 (품목 및 본수 숫자 확인 필요)',
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
    setCurrentStep(2);
    setNotice(`박스 [${box.serialNo}]를 확인 필요(미식별) 목록으로 되돌렸습니다.`);
    runAnalysis(selectedSampleIds, uploadedFiles, nextOverrides, batchRouteMessage, billSearchQuery);
  };

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
        `박스 [#${box.countSeq || box.boxSeq}] 추천 품목 1클릭 확정 완료: [${applied.prodName} · ${fmt(applied.qtyPerBox)}${applied.unit}]`
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
      setNotice('현재 자동 매칭할 지그재그 옆면 / 미식별 박스가 없습니다.');
      return;
    }
    setBoxOverrides(nextOverrides);
    setActiveMatcherBoxId(null);
    const summaryItems = appliedList.map((a) => `${a.prodName}(${fmt(a.qtyPerBox)}${a.unit})`).join(', ');
    setNotice(
      `지그재그 옆면·미식별 박스 ${appliedCount}건을 전산 잔여 품목(${summaryItems})으로 일괄 자동 매칭했습니다.`
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
    setNotice(`현재 사진의 촬영면을 [${angleMeta.shortLabel}]으로 변경했습니다.`);
    runAnalysis(selectedSampleIds, uploadedFiles, boxOverrides, batchRouteMessage, billSearchQuery, nextAngleOverrides);
  };

  const toggleBoxInclusion = (box) => {
    setSelectedBoxId(box.boxId);
    const currentOverride = boxOverrides[box.boxId] || {};
    let nextOverride;
    if (box.status === 'COUNTED') {
      nextOverride = { ...currentOverride, status: 'EXCLUDED', forceInclude: false };
      setNotice(`박스 [#${box.countSeq || box.boxSeq} · ${box.custName}]를 수량 집계에서 제외했습니다.`);
    } else {
      nextOverride = { ...currentOverride, status: 'COUNTED', forceInclude: true };
      setNotice(`박스 [${box.serialNo} · ${box.custName}]를 수량 집계에 포함했습니다.`);
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
      `영업수입불량차감 [#${defectRow.deductionKey} ${defectRow.custName} · ${defectRow.prodName}] 항목에 사진 및 Bill #${defectRow.invoiceNo}(${defectRow.appliedOrderWeek}차) 정보를 반영했습니다.`
    );
  };

  const handleRoutePresetChange = (routePreset) => {
    setBatchRouteMessage(routePreset.defaultMessage);
    runAnalysis(selectedSampleIds, uploadedFiles, boxOverrides, routePreset.defaultMessage, billSearchQuery);
  };

  const analyzedPhotos = analysisData?.analyzedPhotos || [];
  const hasPhotos = analyzedPhotos.length > 0;
  const currentPhoto = analyzedPhotos[activePhotoIndex] || analyzedPhotos[0] || null;
  const displayImageUrl =
    currentPhoto?.previewUrl || customPreviewUrl || currentPhoto?.imageUrl || '/samples/box-vision/sample-1-silla.jpg';

  const selectedBox = useMemo(() => {
    if (!selectedBoxId) return currentPhoto?.boxes?.[0] || null;
    return (analysisData?.allBoxes || []).find((b) => b.boxId === selectedBoxId) || currentPhoto?.boxes?.[0] || null;
  }, [analysisData?.allBoxes, currentPhoto?.boxes, selectedBoxId]);

  const bill = analysisData?.billContext || {};
  const totals = analysisData?.totals || {};
  const routeInfo = analysisData?.routeInfo || {};
  const billOrderWeekLedger = analysisData?.billOrderWeekLedger || [];
  const pendingQueue = analysisData?.unreadablePendingQueue || [];
  const resolvedQueue = analysisData?.unreadableResolvedBoxes || [];
  const confirmedNormalBoxesCount = Math.max(0, (totals.countedBoxes || 0) - pendingQueue.length);

  // [3단계] 업체 필터링된 결과 행 및 총 본수 합계
  const allCustomerItemRows = analysisData?.customerItemSummary || [];
  const filteredCustomerItemRows = useMemo(() => {
    if (selectedCustomerFilter === 'ALL') return allCustomerItemRows;
    return allCustomerItemRows.filter(
      (r) => String(r.custKey) === String(selectedCustomerFilter) || r.custName === selectedCustomerFilter
    );
  }, [allCustomerItemRows, selectedCustomerFilter]);

  const totalStemsSum = useMemo(
    () => allCustomerItemRows.reduce((acc, r) => acc + Number(r.photoTotalStems || r.photoTotalQty || 0), 0),
    [allCustomerItemRows]
  );

  const allReconciledMatch = useMemo(
    () => allCustomerItemRows.length > 0 && allCustomerItemRows.every((r) => r.reconcileStatus === 'MATCH'),
    [allCustomerItemRows]
  );

  const liveBillLookupResults = useMemo(
    () => lookupBillOrderWeek(billSearchQuery, undefined, billOrderWeekLedger),
    [billOrderWeekLedger, billSearchQuery]
  );

  const handleGoToStep = (nextStep) => {
    if ((nextStep === 2 || nextStep === 3) && !hasPhotos) {
      setNotice('먼저 1단계에서 사진을 업로드하거나 [샘플 사진으로 바로 테스트]를 선택해 주세요.');
      setCurrentStep(1);
      return;
    }
    setCurrentStep(nextStep);
  };

  return (
    <div className={styles.container} data-testid="box-vision-inspector-page">
      {/* 최상단 핵심 목적 배너 (2줄 이내 간결 유지) */}
      <div className={styles.purposeBanner} data-testid="box-vision-purpose-banner">
        <span className={styles.purposeTitle}>[핵심 목적 · PURPOSE]</span>
        <span className={styles.purposeText}>
          출고·수입불량 묶음 사진을 올려 [1단계: 사진 업로드 → 2단계: 미식별/옆면 박스 확인 → 3단계: 업체별 품목·수량·Bill·입고차수 결과표] 순서로 한 단계씩 깔끔하게 검수합니다. (ERP 원장 읽기 전용)
        </span>
      </div>

      {/* 사용 가이드 영상 */}
      <WorkflowGuide workflowId="box-vision-inspector" defaultOpen={false} />

      {/* 상단 헤더 바 (어느 단계에 있든 우측 상단에 [+ 새 작업 (초기화)] 및 [새 탭에서 새 작업 열기] 상시 노출) */}
      <div className={styles.headerBar}>
        <div className={styles.titleGroup}>
          <h1>박스 사진 판독 · 품목/수량/Bill/입고차수 단계별 검수</h1>
          <p className={styles.titleSub}>
            {hasPhotos ? (
              <>
                노선: <strong>{routeInfo.routeName || '호남선 출고'}</strong> ({routeInfo.shipDateLabel || '11/23(월)'}) · 사진 <strong>{fmt(totals.photoCount)}장</strong> · 유효 <strong>{fmt(totals.countedBoxes)}박스</strong> · 주 입고차수 <strong>{bill.orderYear || 2026}년 {bill.orderWeek || '47-02'}차</strong> (Bill <strong>#{bill.invoiceNo || '1222993'}</strong>)
              </>
            ) : (
              <>현재 새 작업 대기 중입니다 (사진 0장). 1단계에서 사진을 올리거나 샘플로 테스트를 시작하세요.</>
            )}
          </p>
        </div>

        <div className={styles.actionGroup}>
          <button
            type="button"
            className={styles.btnNewWork}
            data-testid="box-vision-new-work-btn"
            onClick={() => handleStartNewWork(true)}
          >
            + 새 작업 (초기화)
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            data-testid="box-vision-new-tab-work-btn"
            onClick={handleOpenNewTabWork}
          >
            새 탭에서 새 작업 열기
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFilesAdded(e.target.files, true)}
          />
          <Link href="/shipment/distribute?week=47-02" className={styles.btnSecondary}>
            출고분배 원장
          </Link>
        </div>
      </div>

      {/* 상단 3단계 진행 바 (Stepper) */}
      <nav className={styles.stepperBar} aria-label="박스 사진 판독 3단계 진행 바" data-testid="box-vision-stepper">
        {STEP_ITEMS.map((item) => {
          const isActive = currentStep === item.step;
          const isDone = hasPhotos && currentStep > item.step;
          const tabClass = isActive
            ? styles.stepTabActive
            : isDone
            ? styles.stepTabDone
            : styles.stepTab;

          const badgeText =
            item.step === 1
              ? hasPhotos
                ? `${fmt(totals.photoCount)}장`
                : '대기'
              : item.step === 2
              ? hasPhotos
                ? pendingQueue.length > 0
                  ? `미식별 ${fmt(pendingQueue.length)}건`
                  : '확인완료'
                : '-'
              : hasPhotos
              ? `${fmt(totals.customerCount)}개 업체 · ${fmt(totals.countedBoxes)}박스`
              : '-';

          return (
            <button
              key={item.step}
              type="button"
              className={tabClass}
              data-testid={`wizard-step-tab-${item.step}`}
              onClick={() => handleGoToStep(item.step)}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{item.title}</div>
                <div style={{ fontSize: 12.5, color: isActive ? '#065f46' : '#475569', marginTop: 2 }}>
                  {item.sub}
                </div>
              </div>
              <span className={isActive ? styles.stepNumberBadgeActive : styles.stepNumberBadge}>
                {badgeText}
              </span>
            </button>
          );
        })}
      </nav>

      {notice && (
        <div className={styles.noticeBanner} role="status" data-testid="box-vision-notice">
          {notice}
        </div>
      )}

      {/* =====================================================================
          [1단계] 사진 올리기 (묶음 업로드 — 복잡한 표 없이 사진 업로드에만 집중)
         ===================================================================== */}
      {currentStep === 1 && (
        <section className={styles.step1UploadCard} data-testid="wizard-step-1-panel">
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>1단계. 출고 노선 선택 및 묶음 사진 올리기</h2>
              <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>
                카톡 출고방·수입불량방 묶음 사진을 붙여넣기(Ctrl+V)하거나 파일을 선택해 올려주세요.
              </div>
            </div>

            {/* 우측 상단: [샘플 사진으로 바로 테스트 ▾] 드롭다운 & 빠른 시연 버튼 */}
            <div className={styles.sampleChips}>
              <button
                type="button"
                className={styles.btnPrimary}
                data-testid="box-vision-kakao-batch-preset-btn"
                onClick={() =>
                  selectKakaoBatchPreset('호남선 출고입니다 (11/23 경부선·호남선 카톡 묶음 사진 5장 일괄 판독)')
                }
              >
                5장 묶음 샘플(호남선/경부선) 바로 테스트
              </button>
              <div className={styles.sampleDropdownWrap}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  data-testid="sample-dropdown-toggle-btn"
                  onClick={() => setSampleMenuOpen((prev) => !prev)}
                >
                  샘플 사진으로 바로 테스트 ▾
                </button>
                {sampleMenuOpen && (
                  <div className={styles.sampleDropdownMenu} data-testid="sample-dropdown-menu">
                    <button
                      type="button"
                      className={styles.sampleChip}
                      data-testid="box-vision-scan-all-btn"
                      onClick={selectAllSamplesWithDedupe}
                    >
                      5장 묶음 (호남선/경부선 전체 스캔)
                    </button>
                    <button
                      type="button"
                      className={styles.sampleChip}
                      data-testid="box-vision-simulate-15batch-btn"
                      onClick={handleSimulate15PhotoBatch}
                    >
                      15장 묶음 (대량 중복제거 시연)
                    </button>
                    <button
                      type="button"
                      className={styles.sampleChip}
                      data-testid="box-vision-neulbom-pair-btn"
                      onClick={selectNeulbomPair}
                    >
                      늘봄 2장 (다각도 중복 2박스 제거)
                    </button>
                    {SAMPLE_PHOTOS.map((sample) => (
                      <button
                        key={sample.sampleId}
                        type="button"
                        className={styles.sampleChip}
                        data-testid={`sample-btn-${sample.sampleId}`}
                        onClick={() => selectSingleSample(sample.sampleId)}
                      >
                        {sample.shortLabel}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 1. 출고 노선/메모 한 줄 선택 */}
          <div className={styles.batchRow} data-testid="box-vision-batch-control-panel">
            <div className={styles.sampleChips}>
              <span style={{ fontWeight: 700, fontSize: 13.5, alignSelf: 'center', marginRight: 4 }}>
                출고 노선 선택:
              </span>
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
            <div className={styles.routeInputGroup}>
              <label htmlFor="kakao-batch-route-input" style={{ fontWeight: 700, fontSize: 13.5 }}>
                메모:
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
                  if (hasPhotos) {
                    runAnalysis(selectedSampleIds, uploadedFiles, boxOverrides, val, billSearchQuery);
                  }
                }}
                placeholder="예: 호남선 출고입니다 / 11/23 경부선 묶음 사진"
              />
            </div>
          </div>

          {/* 2. 큼직하고 직관적인 사진 드롭존 */}
          <div
            className={styles.heroDropZone}
            data-testid="box-vision-dropzone"
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFilesAdded(e.dataTransfer?.files, true);
            }}
          >
            <div className={styles.heroDropTitle}>
              여기에 묶음 사진을 끌어다 놓거나 화면에서 Ctrl+V로 붙여넣으세요
            </div>
            <div className={styles.heroDropSub}>
              카카오톡 출고방·불량방 사진 1장~30장 묶음을 한 번에 올릴 수 있습니다 (JPG · PNG · WEBP)
            </div>
            <button
              type="button"
              className={styles.btnPrimary}
              data-testid="box-vision-upload-btn"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              묶음 사진 파일 선택하기 (N장 일괄 업로드)
            </button>
          </div>

          {/* 3. 올라간 사진 썸네일 리스트 (N장) 또는 빈 상태 안내 + 하단 다음 단계 이동 버튼 */}
          {hasPhotos ? (
            <div data-testid="step1-uploaded-thumbnails">
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                  올라간 사진 목록 ({fmt(analyzedPhotos.length)}장 · 총 유효 {fmt(totals.countedBoxes)}박스 / 확인 필요 {fmt(pendingQueue.length)}건)
                </div>
                <div className={styles.sampleChips}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    data-testid="batch-add-photo-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    + 사진 더 추가
                  </button>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    data-testid="batch-reset-btn"
                    onClick={() => handleStartNewWork(false)}
                  >
                    전체 비우기 (새 작업)
                  </button>
                </div>
              </div>

              <div className={styles.batchOverviewGrid}>
                {analyzedPhotos.map((p, idx) => (
                  <div
                    key={`step1-thumb-${p.sampleId}-${idx}`}
                    className={styles.batchPhotoMiniCard}
                    data-testid={`step1-photo-card-${idx + 1}`}
                  >
                    <img
                      src={p.previewUrl || p.imageUrl}
                      alt={p.title}
                      className={styles.miniThumbImg}
                    />
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        marginTop: 6,
                      }}
                    >
                      <strong style={{ fontSize: 13 }}>
                        사진 {idx + 1}/{analyzedPhotos.length}
                      </strong>
                      <button
                        type="button"
                        className={styles.thumbRemoveBtn}
                        data-testid={`remove-photo-btn-${idx + 1}`}
                        onClick={() => handleRemovePhotoFromBatch(idx, p.sampleId)}
                      >
                        삭제
                      </button>
                    </div>
                    <div style={{ fontSize: 12.5, color: '#334155', marginTop: 2 }}>{p.shortLabel}</div>
                    <div style={{ fontSize: 12.5, color: '#065f46', fontWeight: 600, marginTop: 2 }}>
                      유효 {p.countedBoxes}박스
                      {p.unreadablePendingBoxes > 0 ? ` · 확인필요 ${p.unreadablePendingBoxes}건` : ''}
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.stepFooterBar}>
                <div style={{ fontSize: 13.5, color: '#0f172a' }}>
                  <strong>{fmt(analyzedPhotos.length)}장</strong> 사진 판독 준비 완료 (정상 판독{' '}
                  <strong>{fmt(confirmedNormalBoxesCount)}박스</strong> · 미식별/옆면 확인 필요{' '}
                  <strong>{fmt(pendingQueue.length)}건</strong>)
                </div>
                <div className={styles.sampleChips}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    data-testid="step1-direct-step3-btn"
                    onClick={() => setCurrentStep(3)}
                  >
                    결과표 바로 보기 (3단계)
                  </button>
                  <button
                    type="button"
                    className={styles.btnNextStep}
                    data-testid="step1-next-step2-btn"
                    onClick={() => setCurrentStep(2)}
                  >
                    다음: 박스 판독 및 미식별 확인 (2단계로 이동) →
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              className={styles.stepFooterBar}
              data-testid="step1-empty-state-bar"
              style={{ justifyContent: 'space-between' }}
            >
              <div style={{ fontSize: 13.5, color: '#475569' }}>
                아직 올라간 사진이 없습니다. 사진을 업로드하거나 우측 버튼으로 샘플 묶음을 불러와 바로 시작할 수 있습니다.
              </div>
              <div className={styles.sampleChips}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => selectSingleSample('sample-1-silla')}
                >
                  신라 4박스 샘플 불러오기
                </button>
                <button
                  type="button"
                  className={styles.btnNextStep}
                  onClick={() =>
                    selectKakaoBatchPreset('호남선 출고입니다 (11/23 경부선·호남선 카톡 묶음 사진 5장 일괄 판독)')
                  }
                >
                  5장 묶음 샘플 불러와 2단계 시작 →
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* =====================================================================
          [2단계] 미식별 · 지그재그 옆면 박스 확인 (좌측 50% 캔버스 / 우측 50% 미식별 처리 카드)
         ===================================================================== */}
      {currentStep === 2 && (
        <div data-testid="wizard-step-2-panel">
          {/* 상단 심플 필름스트립 (1/N ~ N/N 사진 전환 + 촬영면 정면/좌/우 심플 버튼) */}
          <section className={styles.batchControlCard} data-testid="box-vision-filmstrip">
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div className={styles.sampleChips}>
                <span style={{ fontWeight: 700, fontSize: 13.5, alignSelf: 'center', marginRight: 4 }}>
                  묶음 사진 선택 ({fmt(analyzedPhotos.length)}장):
                </span>
                {analyzedPhotos.map((p, idx) => {
                  const isCurr = idx === activePhotoIndex;
                  return (
                    <button
                      key={`step2-film-${p.sampleId}-${idx}`}
                      type="button"
                      className={isCurr ? styles.filmThumbActive : styles.filmThumb}
                      data-testid={`filmstrip-photo-${idx + 1}`}
                      onClick={() => setActivePhotoIndex(idx)}
                    >
                      사진 {idx + 1}/{analyzedPhotos.length} ({p.countedBoxes}박스
                      {p.unreadablePendingBoxes > 0 ? ` · 확인 ${p.unreadablePendingBoxes}` : ''})
                    </button>
                  );
                })}
              </div>

              {currentPhoto && (
                <div className={styles.sampleChips}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', alignSelf: 'center' }}>
                    촬영면:
                  </span>
                  {CAMERA_ANGLE_OPTIONS.map((ang) => {
                    const isAngleActive = (currentPhoto.cameraAngle || 'front') === ang.angleId;
                    return (
                      <button
                        key={ang.angleId}
                        type="button"
                        data-testid={`photo-angle-btn-${ang.angleId}`}
                        className={isAngleActive ? styles.sampleChipActive : styles.sampleChip}
                        style={{ padding: '4px 9px', fontSize: 12.5 }}
                        onClick={() => handlePhotoAngleChange(currentPhoto.sampleId, ang.angleId)}
                      >
                        {ang.shortLabel}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <div className={styles.step2SplitGrid}>
            {/* 좌측(50%): 사진 캔버스 (깔끔한 번호 중심 오버레이: #1 신라·안시리움 40송이 또는 [#19 확인필요]) */}
            <section className={styles.panelCard} data-testid="box-vision-canvas-panel">
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>
                  사진 {activePhotoIndex + 1}/{analyzedPhotos.length} · {currentPhoto?.shortLabel}
                </h2>
                <span className={styles.badgeMatch}>
                  유효 {currentPhoto?.countedBoxes || 0}박스 (확인필요 {currentPhoto?.unreadablePendingBoxes || 0}건)
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
                  const isDup = box.status === 'DUPLICATE' || (box.status === 'EXCLUDED' && !isPassed);
                  const isBg = box.status === 'BACKGROUND';

                  const boxClass = [
                    styles.boxOverlay,
                    isSelected ? styles.boxOverlaySelected : '',
                    isPendingUnreadable ? styles.boxOverlayUnreadable : '',
                    isPassed ? styles.boxOverlayPassed : '',
                    isDup ? styles.boxOverlayDuplicate : '',
                    isBg ? styles.boxOverlayBackground : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  const capsuleClass = [
                    styles.boxCapsule,
                    isPendingUnreadable ? styles.boxCapsuleUnreadable : '',
                    isPassed ? styles.boxCapsulePassed : '',
                    isDup ? styles.boxCapsuleDup : '',
                    isBg ? styles.boxCapsuleBg : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  // 사진이 가려지지 않게 짧은 번호 + 핵심 품목/본수 또는 [#19 확인필요]만 간결하게 표시
                  const seqNum = box.countSeq || box.boxSeq;
                  const shortCust = String(box.custName || '').replace(/호텔|농원|원예/g, '');
                  const shortOverlayLabel = isPendingUnreadable
                    ? `[#${seqNum} 확인필요]`
                    : isPassed
                    ? `[#${seqNum} 패스]`
                    : isDup
                    ? '[중복제외]'
                    : isBg
                    ? '[배경분리]'
                    : `#${seqNum} ${shortCust}·${box.flowerName} ${box.qtyPerBox}${box.unit}`;

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
                      title={`#${seqNum} ${box.custName} | ${box.prodName} (${box.qtyPerBox}${box.unit}) | Bill #${box.invoiceNo} (${box.orderWeek}차)`}
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
                      <span className={capsuleClass}>{shortOverlayLabel}</span>
                    </div>
                  );
                })}
              </div>

              <div className={styles.formulaBar} data-testid="box-vision-formula-bar">
                <div>
                  <span className={styles.formulaProgress}>
                    [유효 {currentPhoto?.countedBoxes || 0}박스 / 전체 {(currentPhoto?.boxes || []).length}박스]
                  </span>{' '}
                  박스 번호를 클릭하면 포함/제외 또는 매칭 창이 열립니다.
                </div>
                {selectedBox && (
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    style={{ padding: '3px 8px', fontSize: 12.5 }}
                    onClick={() => setShowSelectedBoxDetail((prev) => !prev)}
                  >
                    {showSelectedBoxDetail ? '선택 박스 상세 닫기' : `선택 박스(#${selectedBox.countSeq || selectedBox.boxSeq}) 상세`}
                  </button>
                )}
              </div>

              {showSelectedBoxDetail && selectedBox && (
                <div
                  style={{
                    marginTop: 8,
                    padding: '8px 10px',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: 5,
                    fontSize: 12.5,
                  }}
                  data-testid="box-vision-selected-detail"
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div>
                      <strong>일련번호 {selectedBox.serialNo}</strong> · {selectedBox.custName} ({selectedBox.labelCode}) ·{' '}
                      <strong>{selectedBox.prodName}</strong> ({fmt(selectedBox.qtyPerBox)}
                      {selectedBox.unit}) · Bill #{selectedBox.invoiceNo} ({selectedBox.orderWeek}차)
                    </div>
                    {!selectedBox.isPendingUnreadable && (
                      <button
                        type="button"
                        className={styles.btnWarn}
                        style={{ padding: '3px 8px', fontSize: 12.5 }}
                        data-testid="mark-selected-box-unreadable-btn"
                        onClick={() => handleMarkBoxAsUnreadable(selectedBox, 'unreadable_both')}
                      >
                        미식별로 전환
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* 우측(50%): 확인 필요한 박스 목록 (미식별 / 지그재그 옆면) 처리 카드 */}
            <section className={styles.unreadablePanelCard} data-testid="box-vision-unreadable-queue-panel">
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>
                    확인 필요한 박스 목록 (미식별 / 지그재그 옆면: {fmt(pendingQueue.length)}건)
                  </h2>
                  <div style={{ fontSize: 12.5, color: '#78350f', marginTop: 2 }}>
                    각 박스에 대해 <strong>[추천 품목 1클릭 확정]</strong> · <strong>[검색 매칭]</strong> · <strong>[패스]</strong> 중 하나만 선택하세요.
                  </div>
                </div>
              </div>

              {/* 정상 판독 완료 박스 한 줄 요약 (접어두기) */}
              <div
                style={{
                  background: '#ecfdf5',
                  border: '1px solid #86efac',
                  borderRadius: 5,
                  padding: '8px 12px',
                  marginBottom: 10,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 13,
                  color: '#065f46',
                }}
                data-testid="step2-confirmed-summary-bar"
              >
                <div>
                  <strong>정상 판독 {fmt(confirmedNormalBoxesCount)}박스 완료</strong>
                  {totals.duplicateBoxes > 0 ? ` (중복 ${fmt(totals.duplicateBoxes)}박스 자동제외)` : ''}
                </div>
                <button
                  type="button"
                  className={styles.sampleChip}
                  style={{ padding: '3px 8px', fontSize: 12.5 }}
                  onClick={() => setShowConfirmedBoxesCollapse((prev) => !prev)}
                >
                  {showConfirmedBoxesCollapse ? '정상 판독 내역 접기 ▲' : '정상 판독 내역 보기 ▼'}
                </button>
              </div>

              {showConfirmedBoxesCollapse && (
                <div
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 5,
                    padding: '8px 10px',
                    marginBottom: 10,
                    fontSize: 12.5,
                  }}
                >
                  {(analysisData?.customerTotals || []).map((ct) => (
                    <div key={ct.custKey || ct.custName} style={{ marginBottom: 4 }}>
                      <strong>{ct.custName}</strong>: {fmt(ct.itemKindCount)}품목 · {fmt(ct.totalBoxes)}박스 (Bill #
                      {(ct.invoiceNos || ['1222993']).join(',')} · {(ct.orderWeeks || ['47-02']).join(',')}차)
                    </div>
                  ))}
                </div>
              )}

              {/* 상단 원클릭 일괄 버튼 2개 */}
              {pendingQueue.length > 0 && (
                <div className={styles.sampleChips} style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    data-testid="zigzag-batch-auto-deduce-btn"
                    onClick={() => handleBatchAutoDeduceZigzag(true)}
                  >
                    지그재그 옆면 박스 → 전산 잔여 품목 자동 매칭 (일괄 {fmt(pendingQueue.length)}건)
                  </button>
                  <button
                    type="button"
                    className={styles.btnPass}
                    data-testid="unreadable-batch-pass-exclude-btn"
                    onClick={() => handleBatchPassAllUnreadable('exclude_count')}
                  >
                    남은 미식별 박스 전체 패스
                  </button>
                </div>
              )}

              {/* 미식별 / 옆면 박스 카드 리스트 */}
              <div className={styles.unreadableQueueList}>
                {pendingQueue.length === 0 ? (
                  <div
                    style={{
                      background: '#ffffff',
                      border: '1px solid #86efac',
                      borderLeft: '4px solid #059669',
                      borderRadius: 6,
                      padding: '14px 16px',
                      color: '#065f46',
                      fontSize: 13.5,
                      fontWeight: 600,
                    }}
                    data-testid="step2-all-resolved-banner"
                  >
                    모든 미식별·옆면 박스 확인이 완료되었습니다. 우측 하단 버튼을 눌러 3단계 최종 결과표로 이동하세요.
                  </div>
                ) : (
                  pendingQueue.map((uBox) => {
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
                    const dedCand = uBox.deductionCandidate;
                    const seqNum = uBox.countSeq || uBox.boxSeq;

                    return (
                      <div
                        key={uBox.boxId}
                        className={styles.unreadableItemCard}
                        data-testid={`unreadable-queue-item-${uBox.boxId}`}
                      >
                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 }}>
                          <div>
                            <span className={styles.badgeWarn} data-testid={`box-face-badge-${uBox.boxId}`}>
                              {isZigzag ? '지그재그 옆면' : '라벨 미식별'}
                            </span>{' '}
                            <strong>
                              #{seqNum} · {uBox.custName} (사진 #{uBox.photoNumber} · {uBox.boxSpec})
                            </strong>
                          </div>
                          <span className={styles.badgeNeutral}>
                            Bill #{uBox.invoiceNo} · {uBox.orderWeek}차
                          </span>
                        </div>

                        {dedCand && (
                          <div
                            style={{ fontSize: 13, color: '#0f766e', fontWeight: 600, marginTop: 5 }}
                            data-testid={`deduction-candidate-box-${uBox.boxId}`}
                          >
                            추천 품목: {dedCand.prodName} ({dedCand.flowerName}) · {fmt(dedCand.qtyPerBox)}
                            {dedCand.unit}
                            {dedCand.stemsPerBox ? ` (${fmt(dedCand.stemsPerBox)}본)` : ''}
                          </div>
                        )}

                        {/* 각 미식별 박스 카드마다 딱 3개 영역 버튼만 깔끔하게 배치 */}
                        <div className={styles.unreadableActionRow}>
                          <div className={styles.sampleChips}>
                            {dedCand && (
                              <button
                                type="button"
                                className={styles.btnPrimary}
                                data-testid={`confirm-zigzag-deduction-btn-${uBox.boxId}`}
                                onClick={() => handleConfirmZigzagDeductionSingle(uBox)}
                              >
                                추천 품목 1클릭 확정 ({dedCand.prodName} {fmt(dedCand.qtyPerBox)}
                                {dedCand.unit})
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
                              {isMatcherOpen ? '검색 매칭 닫기' : '검색 매칭'}
                            </button>
                            <button
                              type="button"
                              className={styles.btnPass}
                              data-testid={`pass-exclude-btn-${uBox.boxId}`}
                              onClick={() => handlePassUnreadableBox(uBox, 'exclude_count')}
                            >
                              패스 (카운트 제외)
                            </button>
                            <button
                              type="button"
                              className={styles.btnPass}
                              data-testid={`pass-keepbox-btn-${uBox.boxId}`}
                              onClick={() => handlePassUnreadableBox(uBox, 'keep_box_skip_item')}
                            >
                              패스 (박스 수만 유지)
                            </button>
                          </div>
                        </div>

                        {/* 심플한 품목·본수 검색 매칭창 */}
                        {isMatcherOpen && (
                          <div
                            className={styles.searchMatcherDrawer}
                            data-testid={`search-matcher-drawer-${uBox.boxId}`}
                          >
                            <div className={styles.inlineFieldGroup} style={{ marginTop: 0 }}>
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
                                placeholder="품목명(카라, 튤립, 백합 등) 또는 본수(130, 200 등) 검색"
                              />
                            </div>

                            <div className={styles.inlineFieldGroup}>
                              <select
                                id={`matcher-prod-select-${uBox.boxId}`}
                                aria-label="매칭 품목 선택"
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
                                    {c.prodName} ({c.flowerName} · 기본 {c.suggestedQtyPerBox}
                                    {c.unit})
                                  </option>
                                ))}
                              </select>

                              <input
                                id={`matcher-qty-input-${uBox.boxId}`}
                                aria-label="박스당 수량"
                                type="number"
                                min={1}
                                max={2000}
                                className={styles.numberInput}
                                data-testid={`matcher-qty-input-${uBox.boxId}`}
                                value={matcherQtyPerBox}
                                onChange={(e) => setMatcherQtyPerBox(Number(e.target.value || 0))}
                              />

                              <select
                                id={`matcher-cust-select-${uBox.boxId}`}
                                aria-label="업체 선택"
                                className={styles.selectInput}
                                data-testid={`matcher-cust-select-${uBox.boxId}`}
                                value={matcherCustKey}
                                onChange={(e) => setMatcherCustKey(Number(e.target.value))}
                              >
                                {CUSTOMER_OPTIONS.map((c) => (
                                  <option key={c.custKey} value={c.custKey}>
                                    {c.custName}
                                  </option>
                                ))}
                              </select>

                              <button
                                type="button"
                                className={styles.btnPrimary}
                                data-testid={`confirm-search-match-btn-${uBox.boxId}`}
                                onClick={() => handleConfirmSearchMatch(uBox, activeCandidate)}
                              >
                                매칭 확정
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                {/* 처리 완료된 박스 한 줄 복원 리스트 */}
                {resolvedQueue.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.5, color: '#475569', marginBottom: 4 }}>
                      방금 처리한 박스 ({fmt(resolvedQueue.length)}건):
                    </div>
                    {resolvedQueue.map((rBox) => (
                      <div
                        key={`resolved-${rBox.boxId}`}
                        className={styles.unreadableItemCardResolved}
                        data-testid={`unreadable-resolved-item-${rBox.boxId}`}
                        style={{
                          marginBottom: 4,
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                          fontSize: 12.5,
                        }}
                      >
                        <div>
                          <span className={rBox.resolutionAction === 'passed' ? styles.badgeNeutral : styles.badgeMatch}>
                            {rBox.resolutionAction === 'passed' ? '패스됨' : '매칭완료'}
                          </span>{' '}
                          <strong>#{rBox.countSeq || rBox.boxSeq}</strong> · {rBox.custName} ·{' '}
                          <strong>{rBox.prodName}</strong> ({fmt(rBox.qtyPerBox)}
                          {rBox.unit})
                        </div>
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          style={{ padding: '2px 8px', fontSize: 12.5 }}
                          data-testid={`rematch-box-btn-${rBox.boxId}`}
                          onClick={() =>
                            handleMarkBoxAsUnreadable(
                              rBox,
                              rBox.ocrStatus === 'confirmed' ? 'unreadable_both' : rBox.ocrStatus
                            )
                          }
                        >
                          다시 매칭
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 우측 하단: 큼직한 [확인 완료 → 3단계 최종 결과표 보기 →] 버튼 */}
              <div className={styles.stepFooterBar}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  data-testid="step2-back-step1-btn"
                  onClick={() => setCurrentStep(1)}
                >
                  ← 1단계(사진 추가/변경)
                </button>
                <button
                  type="button"
                  className={styles.btnNextStep}
                  data-testid="step2-next-step3-btn"
                  onClick={() => setCurrentStep(3)}
                >
                  확인 완료 → 3단계 최종 결과표 보기 →
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* =====================================================================
          [3단계] 최종 결과표 (업체별 품목·수량·Bill 번호 & 몇 차수 입고인지 한눈에 확인)
         ===================================================================== */}
      {currentStep === 3 && (
        <div data-testid="wizard-step-3-panel">
          {/* 상단 이동 & 새 작업 액션 바 */}
          <div
            className={styles.stepFooterBar}
            style={{ marginTop: 0, marginBottom: 12 }}
            data-testid="step3-top-nav-bar"
          >
            <div className={styles.sampleChips}>
              <button
                type="button"
                className={styles.btnSecondary}
                data-testid="step3-back-step2-btn"
                onClick={() => setCurrentStep(2)}
              >
                ← 2단계(사진/박스 수정)로 돌아가기
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                data-testid="step3-back-step1-btn"
                onClick={() => setCurrentStep(1)}
              >
                새 사진 묶음 올리기 (1단계)
              </button>
            </div>
            <div className={styles.sampleChips}>
              <button
                type="button"
                className={styles.btnNewWork}
                data-testid="step3-new-work-reset-btn"
                onClick={() => handleStartNewWork(true)}
              >
                + 새 작업 (초기화 후 1단계로)
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                data-testid="step3-new-tab-work-btn"
                onClick={handleOpenNewTabWork}
              >
                새 탭에서 새 작업 열기
              </button>
            </div>
          </div>

          {/* 1. 상단 핵심 요약 바 (4개 숫자 타일 + 업체 필터 칩) */}
          <div className={styles.kpiStrip} data-testid="box-vision-kpi-strip">
            <div className={styles.kpiCard}>
              <div className={styles.kpiTitle}>총 출고 박스 / 본수</div>
              <div className={styles.kpiValue} data-testid="kpi-counted-boxes">
                {fmt(totals.countedBoxes)}박스 / {fmt(totalStemsSum)}본
              </div>
              <div className={styles.kpiSub}>
                사진 {fmt(totals.photoCount)}장 통합 (중복 {fmt(totals.duplicateBoxes)}박스 제외)
              </div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiTitle}>전산 출고 대조 상태</div>
              <div className={styles.kpiValue} data-testid="kpi-customer-item-count">
                {allReconciledMatch ? '전산 100% 일치' : `${fmt(totals.itemLineCount)}품목 대조`}
              </div>
              <div className={styles.kpiSub}>
                {fmt(totals.customerCount)}개 업체 · {fmt(totals.itemLineCount)}개 품목 라인
              </div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiTitle}>확인된 Bill 번호 수</div>
              <div className={styles.kpiValue} data-testid="kpi-bill-orderweek">
                Bill {fmt(totals.billCount || 1)}건
              </div>
              <div className={styles.kpiSub}>
                주 Bill #{bill.invoiceNo || '1222993'} (AWB {bill.awbNo || '180-9162-6441'})
              </div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiTitle}>입고 차수</div>
              <div className={styles.kpiValue}>
                {(totals.distinctOrderWeeks || ['47-02']).map((w) => `${w}차`).join(' / ')}
              </div>
              <div className={styles.kpiSub}>
                {bill.primaryFarm || 'Holex'} ({bill.countryName || '네덜란드'}) 입고분
              </div>
            </div>
          </div>

          {/* 2. 메인 표: [업체별 × 품목별 × 수량 × Bill 번호 × 입고 차수 체크표] (핵심 7열) */}
          <section className={styles.panelCard} data-testid="box-vision-reconcile-panel">
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>
                업체별 × 품목별 × 수량 × Bill 번호 × 입고 차수 결과표
              </h2>
              {/* 업체별 필터 칩 */}
              <div className={styles.sampleChips} data-testid="step3-customer-filter-chips">
                <button
                  type="button"
                  data-testid="customer-filter-chip-ALL"
                  className={selectedCustomerFilter === 'ALL' ? styles.sampleChipActive : styles.sampleChip}
                  onClick={() => setSelectedCustomerFilter('ALL')}
                >
                  전체 업체 보기 ({fmt(totals.countedBoxes)}박스)
                </button>
                {(analysisData?.customerTotals || []).map((ct) => {
                  const isChipActive = String(selectedCustomerFilter) === String(ct.custKey);
                  return (
                    <button
                      key={ct.custKey || ct.custName}
                      type="button"
                      data-testid={`customer-filter-chip-${ct.custKey}`}
                      className={isChipActive ? styles.sampleChipActive : styles.sampleChip}
                      onClick={() =>
                        setSelectedCustomerFilter(isChipActive ? 'ALL' : ct.custKey)
                      }
                    >
                      {ct.custName} ({fmt(ct.totalBoxes)}박스)
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.dataTable} data-testid="box-vision-reconcile-table">
                <thead>
                  <tr>
                    <th>업체명</th>
                    <th>품목명(규격)</th>
                    <th className={styles.numCell}>사진 수량(박스/본수)</th>
                    <th className={styles.numCell}>전산 출고량</th>
                    <th>대조 상태</th>
                    <th>Bill 번호 (AWB)</th>
                    <th>Bill 기준 입고 차수 (농장)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomerItemRows.map((row) => (
                    <tr key={row.groupKey} data-testid={`reconcile-row-${row.custKey}-${row.prodKey}`}>
                      <td>
                        <strong>{row.custName}</strong>
                        <div style={{ fontSize: 12.5, color: '#475569' }}>
                          {row.custCode} ({row.photoAppearanceLabel})
                        </div>
                      </td>
                      <td>
                        <strong>{row.prodName}</strong>
                        <div style={{ fontSize: 12.5, color: '#334155' }}>
                          {row.flowerName} · 규격: {(row.boxSpecs || []).join(', ') || '표준'}
                        </div>
                      </td>
                      <td className={styles.numCell}>
                        <strong>{fmt(row.photoBoxCount)}박스</strong> /{' '}
                        <strong>
                          {fmt(row.photoTotalQty)}
                          {row.unit}
                        </strong>
                        {row.photoTotalStems !== row.photoTotalQty ? (
                          <div style={{ fontSize: 12.5, color: '#334155' }}>({fmt(row.photoTotalStems)}본)</div>
                        ) : null}
                      </td>
                      <td className={styles.numCell}>
                        <strong>{fmt(row.erpBoxQty)}박스</strong> / {fmt(row.erpOutQty)}
                        {row.unit}
                      </td>
                      <td>
                        <span className={row.reconcileStatus === 'MATCH' ? styles.badgeMatch : styles.badgeWarn}>
                          {row.inspectionBadge}
                        </span>
                      </td>
                      <td>
                        <strong>Bill #{row.invoiceNo}</strong>
                        <div style={{ fontSize: 12.5, color: '#475569' }}>AWB {row.awbNo}</div>
                      </td>
                      <td>
                        <span
                          className={styles.badgeMatch}
                          data-testid={`bill-check-badge-${row.custKey}-${row.prodKey}`}
                        >
                          {row.orderWeekLabel || `${row.orderYear}년 ${row.orderWeek}차 입고`}
                        </span>
                        <span style={{ fontSize: 12.5, color: '#0f172a', marginLeft: 6 }}>
                          ({row.farmName} · {row.countryName})
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 3. 하단 보조 탭 (서브탭 A: Bill 번호별 입고 차수 요약 & 조회기 / 서브탭 B: 불량차감 사진 매칭 & 농장 박스 색상 사전) */}
          <div className={styles.subTabBar} data-testid="step3-subtab-bar">
            <button
              type="button"
              data-testid="step3-subtab-bill"
              className={activeStep3SubTab === 'BILL_LEDGER' ? styles.subTabBtnActive : styles.subTabBtn}
              onClick={() =>
                setActiveStep3SubTab(activeStep3SubTab === 'BILL_LEDGER' ? 'CLOSED' : 'BILL_LEDGER')
              }
            >
              보조탭 A. Bill 번호별 입고 차수 요약 & Bill 번호 직접 조회기
            </button>
            <button
              type="button"
              data-testid="step3-subtab-defect-color"
              className={activeStep3SubTab === 'DEFECT_AND_COLOR' ? styles.subTabBtnActive : styles.subTabBtn}
              onClick={() =>
                setActiveStep3SubTab(
                  activeStep3SubTab === 'DEFECT_AND_COLOR' ? 'CLOSED' : 'DEFECT_AND_COLOR'
                )
              }
            >
              보조탭 B. 불량차감 사진 매칭 ({fmt((analysisData?.matchedDefects || []).length)}건) & 농장 박스 색상 사전
            </button>
          </div>

          {activeStep3SubTab === 'BILL_LEDGER' && (
            <section className={styles.panelCard} data-testid="box-vision-bill-orderweek-panel">
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>
                  Bill 번호별 입고 차수 요약 및 실시간 Bill 조회기
                </h2>
                <span className={styles.badgeMatch}>{analysisData?.mixedOrderWeekNotice}</span>
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.dataTable} data-testid="box-vision-bill-ledger-table">
                  <thead>
                    <tr>
                      <th>Bill 번호</th>
                      <th>AWB 송장번호</th>
                      <th>Bill 기준 입고 차수</th>
                      <th>입고 농장 (국가)</th>
                      <th>해당 업체</th>
                      <th className={styles.numCell}>사진 검출 박스 / 입고량</th>
                      <th>확인 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billOrderWeekLedger.map((bRow) => (
                      <tr key={bRow.invoiceNo} data-testid={`bill-ledger-row-${bRow.invoiceNo}`}>
                        <td>
                          <strong>Bill #{bRow.invoiceNo}</strong>
                        </td>
                        <td>AWB {bRow.awbNo}</td>
                        <td>
                          <span className={bRow.orderWeek === '47-02' ? styles.badgeMatch : styles.badgeWarn}>
                            {bRow.orderWeekLabel}
                          </span>
                        </td>
                        <td>
                          <strong>{bRow.farmName}</strong> ({bRow.countryName})
                        </td>
                        <td>{(bRow.customerNames || []).join(' · ')}</td>
                        <td className={styles.numCell}>
                          <strong>{fmt(bRow.totalDetectedBoxes)}박스</strong> / 입고 {fmt(bRow.totalInboundBoxes)}박스
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

              <div className={styles.lookupBox} data-testid="box-vision-bill-lookup-box">
                <div className={styles.batchRow} style={{ marginBottom: 6 }}>
                  <label htmlFor="bill-orderweek-lookup-input" style={{ fontWeight: 700, fontSize: 13.5 }}>
                    Bill 번호 / AWB / 오더번호 직접 조회:
                  </label>
                  <div className={styles.routeInputGroup}>
                    <input
                      id="bill-orderweek-lookup-input"
                      type="text"
                      className={styles.textInput}
                      data-testid="bill-orderweek-lookup-input"
                      value={billSearchQuery}
                      onChange={(e) => setBillSearchQuery(e.target.value)}
                      placeholder="예: 1222993, 180-9162-6441, 2026YY-055, 201693, 2494510"
                    />
                    {['1222993', '2026YY-055', '201693', '201694', '2494510'].map((kw) => (
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
                  {liveBillLookupResults.map((res) => (
                    <div key={`lookup-${res.invoiceNo}`} style={{ marginTop: 4 }}>
                      <span className={styles.badgeMatch}>조회 결과</span>{' '}
                      <strong>Bill #{res.invoiceNo}</strong> (AWB <strong>{res.awbNo}</strong>) →{' '}
                      <strong>{res.orderWeekLabel}</strong> · <strong>{res.farmName} ({res.countryName})</strong> · 거래처:{' '}
                      {(res.distributedCustomers || []).join(', ')}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {activeStep3SubTab === 'DEFECT_AND_COLOR' && (
            <div data-testid="step3-defect-and-color-wrap">
              <section className={styles.panelCard} data-testid="box-vision-defect-panel">
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>
                    영업수입불량차감 불량품목 사진 매칭 및 농장/Bill/차수 반영
                  </h2>
                  <Link href="/sales/defect-deductions?year=2026&week=47" className={styles.btnSecondary}>
                    영업수입불량차감 화면 열기
                  </Link>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.dataTable} data-testid="box-vision-defect-table">
                    <thead>
                      <tr>
                        <th>차감번호</th>
                        <th>업체명 · 차수</th>
                        <th>불량 품목명 · 수량</th>
                        <th>매칭 농장 · Bill</th>
                        <th>판독 근거</th>
                        <th>반영</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(analysisData?.matchedDefects || []).map((defect) => {
                        const linked = linkedDefectKeys[defect.deductionKey];
                        return (
                          <tr key={defect.deductionKey}>
                            <td>
                              <strong>#{defect.deductionKey}</strong>
                            </td>
                            <td>
                              <strong>{defect.custName}</strong> ({defect.appliedOrderWeek}차)
                            </td>
                            <td>
                              <strong>{defect.prodName}</strong> ({fmt(defect.quantity)} {defect.sourceUnit})
                            </td>
                            <td>
                              <strong>{defect.farmName}</strong> · Bill #{defect.invoiceNo}
                            </td>
                            <td style={{ fontSize: 12.5 }}>{defect.matchReason}</td>
                            <td>
                              {linked ? (
                                <span
                                  className={styles.badgeMatch}
                                  data-testid={`defect-linked-badge-${defect.deductionKey}`}
                                >
                                  반영됨 ({linked.linkedAt})
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className={styles.btnPrimary}
                                  data-testid={`defect-attach-btn-${defect.deductionKey}`}
                                  onClick={() => handleAttachDefectPhoto(defect)}
                                >
                                  사진·농장/차수 반영
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

              <section className={styles.panelCard} data-testid="box-vision-farm-profile-panel">
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>농장별 박스 색상 및 라벨 3단계 판별 사전</h2>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>박스 외형 · 색상</th>
                        <th>확정 농장 (국가)</th>
                        <th>판별 근거</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(analysisData?.farmBoxProfiles || []).map((prof) => (
                        <tr key={prof.profileId}>
                          <td>
                            <strong>{prof.colorLabel}</strong>
                          </td>
                          <td>
                            <span className={styles.badgeMatch}>
                              {prof.primaryFarm} ({prof.countryName})
                            </span>
                          </td>
                          <td style={{ fontSize: 12.5 }}>{prof.disambiguationRule}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* 하단 이동 & 새 작업 액션 바 */}
          <div className={styles.stepFooterBar} data-testid="step3-bottom-nav-bar">
            <div className={styles.sampleChips}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setCurrentStep(2)}
              >
                ← 2단계(사진/박스 수정)로 돌아가기
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setCurrentStep(1)}
              >
                새 사진 묶음 올리기 (1단계)
              </button>
            </div>
            <div className={styles.sampleChips}>
              <button
                type="button"
                className={styles.btnNewWork}
                onClick={() => handleStartNewWork(true)}
              >
                + 새 작업 (초기화 후 다시 작업)
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={handleOpenNewTabWork}
              >
                새 탭에서 새 작업 열기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
