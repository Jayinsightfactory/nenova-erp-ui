// pages/vision/box-inspector.js
// 박스 사진 판독 · 품목/수량 매칭 ([1단계: 사진 업로드 → 2단계: 미식별/옆면 박스 확인 → 3단계: 최종 업체별 결과표] 3단계 스텝 위저드)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import WorkflowGuide from '../../components/WorkflowGuide';
import BoxVisionStep2ReviewPanel from '../../components/vision/BoxVisionStep2ReviewPanel';
import BoxVisionStep3ResultsPanel from '../../components/vision/BoxVisionStep3ResultsPanel';
import {
  addManualBox,
  analyzeBoxVisionPhotos,
  autoDeduceZigzagBoxes,
  buildUnreadableBoxSearchCandidates,
  CAMERA_ANGLE_OPTIONS,
  lookupBillOrderWeek,
  ROUTE_PRESETS,
  SAMPLE_PHOTOS,
  SEARCHABLE_PRODUCT_CATALOG,
} from '../../lib/boxVisionInspector';
import {
  BILL_OPTIONS,
  CUSTOMER_OPTIONS,
  extractLightweightVisionMeta,
} from '../../lib/boxVision/clientCanvasMeta';
import styles from '../../styles/BoxVisionInspector.module.css';

const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const ALL_SAMPLE_IDS = SAMPLE_PHOTOS.map((s) => s.sampleId);

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
  const [manualBoxes, setManualBoxes] = useState([]);
  const [isManualDrawMode, setIsManualDrawMode] = useState(false);
  const [redrawingBoxId, setRedrawingBoxId] = useState(null);
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
  const appendModeRef = useRef(false);

  const runAnalysis = useCallback(
    async (
      nextSampleIds,
      nextFiles,
      nextOverrides,
      nextRouteMsg = batchRouteMessage,
      nextBillQuery = billSearchQuery,
      nextAngleOverrides = photoAngleOverrides,
      nextManualBoxes = manualBoxes
    ) => {
      const isEmptySession =
        (!Array.isArray(nextSampleIds) || nextSampleIds.length === 0) &&
        (!Array.isArray(nextFiles) || nextFiles.length === 0);

      const localResult = analyzeBoxVisionPhotos({
        sampleIds: nextSampleIds,
        uploadedFiles: nextFiles,
        boxOverrides: nextOverrides,
        photoAngleOverrides: nextAngleOverrides,
        manualBoxes: nextManualBoxes,
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
        // [수정 1] 수 MB 원본 Base64 대신 오프스크린 캔버스로 추출한 경량 메타데이터(canvasSignature)만 전송
        const lightweightFiles = (nextFiles || []).map((f) => ({
          name: f.name,
          size: f.size,
          previewUrl: f.previewUrl,
          cameraAngle: f.cameraAngle,
          canvasSignature: f.canvasSignature || null,
          visionDetectedBoxes: f.visionDetectedBoxes || null,
          compactDataUrl: f.compactDataUrl || undefined,
        }));

        const response = await fetch('/api/vision/box-count-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sampleIds: nextSampleIds,
            uploadedFiles: lightweightFiles,
            boxOverrides: nextOverrides,
            photoAngleOverrides: nextAngleOverrides,
            manualBoxes: nextManualBoxes,
            batchRouteMessage: nextRouteMsg,
            billQuery: nextBillQuery,
            orderYear: 2026,
            orderWeek: '47-02',
          }),
        });
        if (response.ok) {
          const json = await response.json();
          if (json?.success && Array.isArray(json.analyzedPhotos)) {
            const mergedPhotos = json.analyzedPhotos.map((p, idx) => ({
              ...p,
              previewUrl: p.previewUrl || nextFiles[idx]?.previewUrl || customPreviewUrl,
              imageUrl: p.imageUrl || p.previewUrl || nextFiles[idx]?.previewUrl || customPreviewUrl,
            }));
            setAnalysisData({ ...json, analyzedPhotos: mergedPhotos });
            setActivePhotoIndex((prev) => Math.min(prev, Math.max(0, mergedPhotos.length - 1)));
          }
        }
      } catch {
        // 오프라인 또는 인증 전 상태에서도 결정론적 로컬 분석 결과 유지
      } finally {
        setLoading(false);
      }
      return localResult;
    },
    [batchRouteMessage, billSearchQuery, customPreviewUrl, manualBoxes, photoAngleOverrides]
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
      setManualBoxes([]);
      setIsManualDrawMode(false);
      setRedrawingBoxId(null);
      setSelectedBoxId(null);
      setActiveMatcherBoxId(null);
      setCurrentStep(2);
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
    setManualBoxes([]);
    setIsManualDrawMode(false);
    setRedrawingBoxId(null);
    setSelectedCustomerFilter('ALL');
    setSampleMenuOpen(false);

    const localResult = await runAnalysis(sampleIds, files, {}, routeMsg, billSearchQuery, {}, []);
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

  const handleSelectColombia15BatchPreset = () => {
    const colombiaIds = Array.from({ length: 15 }, (_, i) => `sample-colombia-${i + 1}`);
    const simulatedFiles = colombiaIds.map((sampleId, idx) => {
      const sample = SAMPLE_PHOTOS.find((s) => s.sampleId === sampleId) || {};
      return {
        name: sample.fileName || `colombia-sample-${String(idx + 1).padStart(2, '0')}.jpg`,
        size: sample.uploadedSize || 300000,
        previewUrl: sample.imageUrl || `/samples/box-vision/colombia-sample-${String(idx + 1).padStart(2, '0')}.jpg`,
      };
    });
    const nextMsg = '콜롬비아 출고입니다 (카톡 출고 15장 묶음 전수 판독 · 48-01차/47-01차/47-02차)';
    applySamplePresetAndAdvance({
      sampleIds: colombiaIds,
      files: simulatedFiles,
      routeMsg: nextMsg,
      focusPhotoIndex: 0,
      targetStep: 2,
      noticeText:
        '콜롬비아 카톡 출고 15장 묶음(카네이션·장미·수국) 전수 학습 시연을 불러왔습니다. 15장 전수 판독 내역을 확인해 주세요.',
    });
  };

  const handleFilesAdded = useCallback(
    async (fileList, appendToBatch = false) => {
      const files = Array.from(fileList || []).filter(
        (f) => f && (/^image\//i.test(f.type || '') || /\.(?:jpe?g|png|webp)$/i.test(f?.name || ''))
      );
      if (!files.length) return;

      // 1) 화면 미리보기는 0ms 즉시 URL.createObjectURL(file)로 생성
      const rawPairs = files.map((f, idx) => {
        let previewUrl = '';
        try {
          previewUrl = URL.createObjectURL(f);
        } catch {
          previewUrl = '';
        }
        return {
          file: f,
          name: f.name || `kakao-paste-${Date.now()}-${idx + 1}.jpg`,
          size: Number(f.size || 0),
          previewUrl,
        };
      });

      if (rawPairs[0]?.previewUrl) {
        setCustomPreviewUrl(rawPairs[0].previewUrl);
      }

      // 2) 오프스크린 <canvas>로 최대 1280px 경량 압축 + 픽셀/색상 밴드 시그니처 병렬 추출
      const newMetaList = await Promise.all(
        rawPairs.map((item) => extractLightweightVisionMeta(item.file, item.previewUrl))
      );

      // [사장님 필수 수정 2 & 3]
      // 사용자가 새 이미지를 업로드(드롭 / Ctrl+V / 파일 선택)하면 이전에 남아있던 샘플 데이터(신라, 주광농원, 늘봄원예, 중복 218박스 등)를
      // 100% 즉시 폐기(초기화)하고 오직 사용자가 방금 올린 사진만 판독 목록에 넣습니다!
      // 명시적인 [+ 현재 묶음에 사진 추가] 버튼을 눌렀을 때만 기존 사용자 업로드 배열에 이어 붙이며, 그 경우에도 샘플 더미(selectedSampleIds)는 0건으로 비웁니다.
      const hadOnlySamplesBefore = selectedSampleIds.length > 0 && uploadedFiles.length === 0;
      const shouldAppendUploads = Boolean(appendToBatch) && !hadOnlySamplesBefore && uploadedFiles.length > 0;

      const combinedUploads = shouldAppendUploads ? [...uploadedFiles, ...newMetaList] : newMetaList;
      const nextIds = []; // 사용자 실제 업로드 시 기존 샘플 ID(sample-1~5) 잔류 전면 차단!
      const nextOverrides = shouldAppendUploads ? boxOverrides : {};
      const nextAngleOverrides = shouldAppendUploads ? photoAngleOverrides : {};
      const nextManualBoxes = shouldAppendUploads ? manualBoxes : [];

      setSelectedSampleIds(nextIds);
      setUploadedFiles(combinedUploads);
      setBoxOverrides(nextOverrides);
      setPhotoAngleOverrides(nextAngleOverrides);
      setManualBoxes(nextManualBoxes);
      setIsManualDrawMode(false);
      setRedrawingBoxId(null);
      setSelectedCustomerFilter('ALL');
      setActivePhotoIndex(shouldAppendUploads ? Math.max(0, combinedUploads.length - newMetaList.length) : 0);
      setActiveMatcherBoxId(null);

      // 단일 1회 배치 호출로 로컬 + 서버 분석 실행
      const localResult = await runAnalysis(
        nextIds,
        combinedUploads,
        nextOverrides,
        batchRouteMessage,
        billSearchQuery,
        nextAngleOverrides,
        nextManualBoxes
      );

      const firstPending = localResult?.unreadablePendingQueue?.[0];
      setSelectedBoxId(firstPending?.boxId || localResult?.allBoxes?.[0]?.boxId || null);
      setNotice(
        shouldAppendUploads
          ? `현재 묶음에 사진 ${files.length}장을 추가했습니다 (총 ${combinedUploads.length}장 · 유효 ${fmt(localResult?.totals?.countedBoxes || 0)}박스).`
          : `새 사진 ${files.length}장을 불러왔습니다 (이전 샘플/작업 초기화 완료 · 유효 ${fmt(localResult?.totals?.countedBoxes || 0)}박스 검출).`
      );
    },
    [
      batchRouteMessage,
      billSearchQuery,
      boxOverrides,
      photoAngleOverrides,
      runAnalysis,
      selectedSampleIds.length,
      uploadedFiles,
    ]
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
        handleFilesAdded(imageFiles, false);
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
      manualBoxes,
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
    runAnalysis(
      selectedSampleIds,
      uploadedFiles,
      nextOverrides,
      batchRouteMessage,
      billSearchQuery,
      photoAngleOverrides,
      manualBoxes
    );
  };

  const handleBatchAutoDeduceZigzag = (includeAllUnreadable = true) => {
    const { nextOverrides, appliedCount, appliedList } = autoDeduceZigzagBoxes({
      sampleIds: selectedSampleIds,
      uploadedFiles,
      boxOverrides,
      photoAngleOverrides,
      manualBoxes,
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
    runAnalysis(
      selectedSampleIds,
      uploadedFiles,
      nextOverrides,
      batchRouteMessage,
      billSearchQuery,
      photoAngleOverrides,
      manualBoxes
    );
  };

  const handleAddManualBox = useCallback(
    (bbox) => {
      const activePhoto = analysisData?.analyzedPhotos?.[activePhotoIndex] || null;
      const sampleId = activePhoto?.sampleId || selectedSampleIds[activePhotoIndex] || null;
      const photoId = activePhoto?.sampleId || activePhoto?.photoId || `photo-${activePhotoIndex + 1}`;
      const firstBox = activePhoto?.boxes?.[0] || null;

      const newBox = addManualBox({
        photoId,
        sampleId,
        bbox,
        custName: firstBox?.custName || '주광농원',
        custKey: firstBox?.custKey || 533,
        custCode: firstBox?.custCode || 'YCL2',
        invoiceNo: firstBox?.invoiceNo || '1222993',
        awbNo: firstBox?.awbNo || '180-9162-6441',
        orderWeek: firstBox?.orderWeek || '47-02',
        farmName: firstBox?.farmName || 'Holex',
        countryName: firstBox?.countryName || '네덜란드',
        ocrStatus: 'unreadable_both',
        unreadableReason: '사용자 직접 추가 박스 (품목·수량 매칭 대기)',
        status: 'COUNTED',
      });

      const nextManualBoxes = [...manualBoxes, newBox];
      setManualBoxes(nextManualBoxes);
      setIsManualDrawMode(false);
      setRedrawingBoxId(null);
      setSelectedBoxId(newBox.boxId);
      setActiveMatcherBoxId(newBox.boxId);

      const candidates = buildUnreadableBoxSearchCandidates(newBox, {
        allBoxes: [...(analysisData?.allBoxes || []), newBox],
        productCatalog: analysisData?.searchableProducts || SEARCHABLE_PRODUCT_CATALOG,
        searchQuery: '',
      });
      const top = candidates[0] || null;
      setMatcherSelectedCandidate(top);
      setMatcherQtyPerBox(top ? Number(top.suggestedQtyPerBox || 40) : 40);
      setMatcherCustKey(Number(newBox.custKey || top?.custKey || 533));
      setMatcherInvoiceNo(String(newBox.invoiceNo || top?.invoiceNo || '1222993'));

      setNotice(
        `새 박스 [#${newBox.countSeq || newBox.boxSeq}]를 추가했습니다. 우측에서 품목과 수량을 매칭해 주세요.`
      );

      runAnalysis(
        selectedSampleIds,
        uploadedFiles,
        boxOverrides,
        batchRouteMessage,
        billSearchQuery,
        photoAngleOverrides,
        nextManualBoxes
      );
    },
    [
      activePhotoIndex,
      analysisData?.allBoxes,
      analysisData?.analyzedPhotos,
      analysisData?.searchableProducts,
      batchRouteMessage,
      billSearchQuery,
      boxOverrides,
      manualBoxes,
      photoAngleOverrides,
      runAnalysis,
      selectedSampleIds,
      uploadedFiles,
    ]
  );

  const handleUpdateBoxBbox = useCallback(
    (boxId, bbox) => {
      const nextOverrides = {
        ...boxOverrides,
        [boxId]: {
          ...(boxOverrides[boxId] || {}),
          bbox,
        },
      };
      setBoxOverrides(nextOverrides);
      setRedrawingBoxId(null);
      setNotice(`박스 영역(위치·크기)을 재조정했습니다.`);
      runAnalysis(
        selectedSampleIds,
        uploadedFiles,
        nextOverrides,
        batchRouteMessage,
        billSearchQuery,
        photoAngleOverrides,
        manualBoxes
      );
    },
    [
      boxOverrides,
      batchRouteMessage,
      billSearchQuery,
      photoAngleOverrides,
      manualBoxes,
      runAnalysis,
      selectedSampleIds,
      uploadedFiles,
    ]
  );

  const handleDeleteBox = useCallback(
    (boxId) => {
      const nextOverrides = {
        ...boxOverrides,
        [boxId]: {
          ...(boxOverrides[boxId] || {}),
          status: 'DELETED',
          deleted: true,
        },
      };
      const nextManual = manualBoxes.filter((b) => b.boxId !== boxId);
      setBoxOverrides(nextOverrides);
      setManualBoxes(nextManual);
      if (selectedBoxId === boxId) setSelectedBoxId(null);
      if (activeMatcherBoxId === boxId) setActiveMatcherBoxId(null);
      if (redrawingBoxId === boxId) setRedrawingBoxId(null);
      setNotice(`박스를 삭제했습니다.`);
      runAnalysis(
        selectedSampleIds,
        uploadedFiles,
        nextOverrides,
        batchRouteMessage,
        billSearchQuery,
        photoAngleOverrides,
        nextManual
      );
    },
    [
      activeMatcherBoxId,
      batchRouteMessage,
      billSearchQuery,
      boxOverrides,
      manualBoxes,
      photoAngleOverrides,
      redrawingBoxId,
      runAnalysis,
      selectedBoxId,
      selectedSampleIds,
      uploadedFiles,
    ]
  );

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
            onChange={(e) => {
              const isAppend = Boolean(appendModeRef.current);
              appendModeRef.current = false;
              handleFilesAdded(e.target.files, isAppend);
              if (e.target) e.target.value = '';
            }}
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
                      style={{ background: '#ecfdf5', borderColor: '#10b981', color: '#047857', fontWeight: 700 }}
                      data-testid="box-vision-colombia-15batch-btn"
                      onClick={handleSelectColombia15BatchPreset}
                    >
                      🌺 [콜롬비아 카톡 출고 15장 묶음 학습 시연 (카네이션·장미·수국)]
                    </button>
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
            onClick={() => {
              appendModeRef.current = false;
              fileInputRef.current?.click();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                appendModeRef.current = false;
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFilesAdded(e.dataTransfer?.files, false);
            }}
          >
            <div className={styles.heroDropTitle}>
              여기에 묶음 사진을 끌어다 놓거나 화면에서 Ctrl+V로 붙여넣으세요
            </div>
            <div className={styles.heroDropSub}>
              새 사진을 올리면 기존 샘플 데이터는 즉시 비워지고 올린 사진만 깔끔하게 판독됩니다 (JPG · PNG · WEBP)
            </div>
            <button
              type="button"
              className={styles.btnPrimary}
              data-testid="box-vision-upload-btn"
              onClick={(e) => {
                e.stopPropagation();
                appendModeRef.current = false;
                fileInputRef.current?.click();
              }}
            >
              새 사진 파일 선택하기 (기존 샘플 비우고 새 사진만 로드)
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
                    onClick={() => {
                      appendModeRef.current = true;
                      fileInputRef.current?.click();
                    }}
                  >
                    + 현재 묶음에 사진 추가
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


      {/* [2단계] 미식별 · 지그재그 옆면 박스 확인 패널 */}
      {currentStep === 2 && (
        <BoxVisionStep2ReviewPanel
          analyzedPhotos={analyzedPhotos}
          activePhotoIndex={activePhotoIndex}
          setActivePhotoIndex={setActivePhotoIndex}
          currentPhoto={currentPhoto}
          handlePhotoAngleChange={handlePhotoAngleChange}
          displayImageUrl={displayImageUrl}
          selectedBox={selectedBox}
          setSelectedBoxId={setSelectedBoxId}
          handleOpenSearchMatcher={handleOpenSearchMatcher}
          toggleBoxInclusion={toggleBoxInclusion}
          showSelectedBoxDetail={showSelectedBoxDetail}
          setShowSelectedBoxDetail={setShowSelectedBoxDetail}
          handleMarkBoxAsUnreadable={handleMarkBoxAsUnreadable}
          pendingQueue={pendingQueue}
          confirmedNormalBoxesCount={confirmedNormalBoxesCount}
          totals={totals}
          showConfirmedBoxesCollapse={showConfirmedBoxesCollapse}
          setShowConfirmedBoxesCollapse={setShowConfirmedBoxesCollapse}
          analysisData={analysisData}
          handleBatchAutoDeduceZigzag={handleBatchAutoDeduceZigzag}
          handleBatchPassAllUnreadable={handleBatchPassAllUnreadable}
          activeMatcherBoxId={activeMatcherBoxId}
          setActiveMatcherBoxId={setActiveMatcherBoxId}
          matcherSearchQuery={matcherSearchQuery}
          setMatcherSearchQuery={setMatcherSearchQuery}
          matcherSelectedCandidate={matcherSelectedCandidate}
          setMatcherSelectedCandidate={setMatcherSelectedCandidate}
          matcherQtyPerBox={matcherQtyPerBox}
          setMatcherQtyPerBox={setMatcherQtyPerBox}
          matcherCustKey={matcherCustKey}
          setMatcherCustKey={setMatcherCustKey}
          handleConfirmZigzagDeductionSingle={handleConfirmZigzagDeductionSingle}
          handlePassUnreadableBox={handlePassUnreadableBox}
          handleConfirmSearchMatch={handleConfirmSearchMatch}
          resolvedQueue={resolvedQueue}
          setCurrentStep={setCurrentStep}
          isManualDrawMode={isManualDrawMode}
          setIsManualDrawMode={setIsManualDrawMode}
          redrawingBoxId={redrawingBoxId}
          setRedrawingBoxId={setRedrawingBoxId}
          handleAddManualBox={handleAddManualBox}
          handleUpdateBoxBbox={handleUpdateBoxBbox}
          handleDeleteBox={handleDeleteBox}
        />
      )}

      {/* [3단계] 최종 결과표 (업체별 품목·수량·Bill 번호 · 입고 차수 확인) */}
      {currentStep === 3 && (
        <BoxVisionStep3ResultsPanel
          setCurrentStep={setCurrentStep}
          handleStartNewWork={handleStartNewWork}
          handleOpenNewTabWork={handleOpenNewTabWork}
          totals={totals}
          totalStemsSum={totalStemsSum}
          allReconciledMatch={allReconciledMatch}
          bill={bill}
          selectedCustomerFilter={selectedCustomerFilter}
          setSelectedCustomerFilter={setSelectedCustomerFilter}
          analysisData={analysisData}
          filteredCustomerItemRows={filteredCustomerItemRows}
          activeStep3SubTab={activeStep3SubTab}
          setActiveStep3SubTab={setActiveStep3SubTab}
          billOrderWeekLedger={billOrderWeekLedger}
          billSearchQuery={billSearchQuery}
          setBillSearchQuery={setBillSearchQuery}
          liveBillLookupResults={liveBillLookupResults}
          linkedDefectKeys={linkedDefectKeys}
          handleAttachDefectPhoto={handleAttachDefectPhoto}
        />
      )}
    </div>
  );
}
