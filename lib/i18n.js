// lib/i18n.js
// 한국어 / 스페인어 전환
// 수정이력: 2026-03-30 — useLang 훅 추가 (언어 변경 시 전체 페이지 리렌더)

import { useState, useEffect } from 'react';

export const TRANSLATIONS = {
  ko: {
    // 공통 버튼/액션
    '조회':'조회','신규':'신규','저장':'저장','삭제':'삭제',
    '닫기':'닫기','확정':'확정','확정취소':'확정취소','수정':'수정',
    '출력':'출력','엑셀':'엑셀','업로드':'업로드','등록':'등록',
    '취소':'취소','새로고침':'새로고침','일괄지정':'일괄지정',
    '초기화':'초기화','검색':'검색','선택':'선택','조회/검색':'조회',
    '확인':'확인','저장 중...':'저장 중...','로딩 중…':'로딩 중…',
    '전체 해제':'전체 해제','건너뛰기':'건너뛰기',

    // 공통 필드
    '차수':'차수','거래처':'거래처','품목명':'품목명','수량':'수량',
    '단가':'단가','합계':'합계','주문일자':'주문일자','담당자':'담당자',
    '국가':'국가','꽃':'꽃','박스':'박스','단':'단','송이':'송이',
    '전재고':'전재고','주문':'주문','입고':'입고','미발주':'미발주',
    '현재고':'현재고','비고':'비고','지역':'지역','농장명':'농장명',
    '거래처명':'거래처명','품목':'품목','날짜':'날짜','코드':'코드',
    '건수':'건수','단위':'단위','공급가액':'공급가액','부가세':'부가세',
    '합계금액':'합계금액','수량합계':'수량합계','잔량':'잔량',
    '입고수량':'입고수량','출고수량':'출고수량','주문수량':'주문수량',
    '차이':'차이','변경일시':'변경일시','사용자':'사용자','이전값':'이전값','변경값':'변경값',

    // 메뉴
    '주문등록':'주문등록','붙여넣기 주문등록':'붙여넣기 주문등록','주문관리':'주문관리','발주관리':'발주관리',
    '입고관리':'입고관리','입고단가/송금':'입고단가/송금',
    '운송기준원가':'운송기준원가',
    '출고분배':'출고분배','차수 확정 현황':'차수 확정 현황','출고,재고상황':'출고,재고상황',
    '출고조회':'출고조회','출고내역조회':'출고내역조회','견적서 관리':'견적서 관리',
    '재고 관리':'재고 관리','거래처관리':'거래처관리','품목관리':'품목관리',
    '업체별 품목 단가관리':'업체별 품목 단가관리','코드관리':'코드관리',
    '사용자관리':'사용자관리','작업내역':'작업내역','작업/기획 현황':'작업/기획 현황',
    'Pivot 통계':'Pivot 통계','월별 판매 현황':'월별 판매 현황',
    '지역별 판매 비교':'지역별 판매 비교','매출/물량 분석':'매출/물량 분석',
    '영업 사원 실적':'영업 사원 실적',
    '주문관리':'주문관리','입/출고관리':'입/출고관리',
    '통계화면':'통계화면',
    '로그아웃':'로그아웃',
    '채권관리':'채권관리','거래처별 채권':'거래처별 채권',
    '판매현황':'판매현황','세금계산서 진행단계':'세금계산서 진행단계',
    '이카운트 연동':'이카운트 연동',
    '구매관리':'구매관리','구매현황(외화/수입)':'구매현황(외화/수입)',
    '재무관리':'재무관리','입/출금 계좌 조회':'입/출금 계좌 조회',
    '외화/환율 관리':'외화/환율 관리',

    // 주문/출고
    '지난 주문 불러오기':'지난 주문 불러오기',
    '주문 변경 내역 조회':'주문 변경 내역 조회',
    '수량 초기화':'수량 초기화',
    '그룹을 선택하세요':'그룹을 선택하세요',
    '품목명 검색...':'품목명 검색...',
    '거래처 검색...':'거래처 검색...',
    '조회 기준':'조회 기준','품목 기준':'품목 기준','업체 기준':'업체 기준',
    '분배방식':'분배방식','비율 분배':'비율 분배','우선 분배':'우선 분배',
    '일괄 출고분배':'일괄 출고분배','개별 출고분배':'개별 출고분배',
    '개별 초기화':'개별 초기화',

    // 입고단가/송금
    '국내 운송료 포함':'국내 운송료 포함',
    '크레딧 차감 (불량/반품)':'크레딧 차감 (불량/반품)',
    '최종 송금액':'최종 송금액','소계':'소계','크레딧':'크레딧','송금액':'송금액',
    '저장할 차수':'저장할 차수','메모 (사유)':'메모 (사유)',
    '운송료':'운송료','국내 운송비':'국내 운송비',

    // 판매/채권
    '판매 내역':'판매 내역','거래처별 판매 현황':'거래처별 판매 현황',
    '품목별 판매 현황':'품목별 판매 현황',
  },
  es: {
    // 공통 버튼/액션
    '조회':'Buscar','신규':'Nuevo','저장':'Guardar','삭제':'Eliminar',
    '닫기':'Cerrar','확정':'Confirmar','확정취소':'Cancelar Conf.','수정':'Editar',
    '출력':'Imprimir','엑셀':'Excel','업로드':'Subir','등록':'Registrar',
    '취소':'Cancelar','새로고침':'Actualizar','일괄지정':'Lote',
    '초기화':'Reiniciar','검색':'Buscar','선택':'Seleccionar','조회/검색':'Buscar',
    '확인':'Confirmar','저장 중...':'Guardando...','로딩 중…':'Cargando…',
    '전체 해제':'Deselec. todo','건너뛰기':'Omitir',

    // 공통 필드
    '차수':'Semana','거래처':'Cliente','품목명':'Producto','수량':'Cantidad',
    '단가':'Precio','합계':'Total','주문일자':'Fecha Pedido','담당자':'Encargado',
    '국가':'País','꽃':'Flor','박스':'Caja','단':'Tallo','송이':'Botón',
    '전재고':'Stock Ant.','주문':'Pedido','입고':'Recepción','미발주':'Pendiente',
    '현재고':'Stock Act.','비고':'Nota','지역':'Región','농장명':'Finca',
    '거래처명':'Nombre Cliente','품목':'Producto','날짜':'Fecha','코드':'Código',
    '건수':'Transac.','단위':'Unidad','공급가액':'Valor Neto','부가세':'IVA',
    '합계금액':'Total','수량합계':'Total Cant.','잔량':'Saldo',
    '입고수량':'Cant. Recep.','출고수량':'Cant. Salida','주문수량':'Cant. Pedido',
    '차이':'Diferencia','변경일시':'Fecha Cambio','사용자':'Usuario','이전값':'Valor Ant.','변경값':'Valor Nuevo',

    // 메뉴
    '주문등록':'Reg. Pedido','붙여넣기 주문등록':'Reg. por Texto','주문관리':'Gest. Pedidos','발주관리':'Gest. Órdenes',
    '입고관리':'Recepción','입고단가/송금':'Precio Ingreso/Pago',
    '운송기준원가':'Costo Transporte',
    '출고분배':'Distribución','차수 확정 현황':'Estado confirmación','출고,재고상황':'Salidas/Inventario',
    '출고조회':'Ver Salida','출고내역조회':'Historial Salida','견적서 관리':'Cotización',
    '재고 관리':'Inventario','거래처관리':'Clientes','품목관리':'Productos',
    '업체별 품목 단가관리':'Precios por Cliente','코드관리':'Códigos',
    '사용자관리':'Usuarios','작업내역':'Historial','작업/기획 현황':'Historial/Plan',
    'Pivot 통계':'Pivot Estadísticas','월별 판매 현황':'Ventas Mensuales',
    '지역별 판매 비교':'Comparación Regional','매출/물량 분석':'Análisis Ventas',
    '영업 사원 실적':'Rendimiento Vendedores',
    '주문관리':'Gestión Pedidos','입/출고관리':'Entradas/Salidas',
    '통계화면':'Estadísticas',
    '로그아웃':'Salir',
    '채권관리':'Cuentas por Cobrar','거래처별 채권':'Deudas por Cliente',
    '판매현황':'Situación Ventas','세금계산서 진행단계':'Estado Facturas',
    '이카운트 연동':'Integr. Ecount',
    '구매관리':'Gest. Compras','구매현황(외화/수입)':'Compras (Divisa/Import.)',
    '재무관리':'Finanzas','입/출금 계좌 조회':'Cuentas Bancarias',
    '외화/환율 관리':'Divisa/Tipo Cambio',

    // 주문/출고
    '지난 주문 불러오기':'Cargar Pedido Anterior',
    '주문 변경 내역 조회':'Ver Historial Cambios',
    '수량 초기화':'Reiniciar Cantidad',
    '그룹을 선택하세요':'Seleccione grupo',
    '품목명 검색...':'Buscar producto...',
    '거래처 검색...':'Buscar cliente...',
    '조회 기준':'Criterio Búsq.','품목 기준':'Por Producto','업체 기준':'Por Cliente',
    '분배방식':'Modo Distrib.','비율 분배':'Por Ratio','우선 분배':'Por Prioridad',
    '일괄 출고분배':'Distrib. masiva','개별 출고분배':'Distrib. indiv.',
    '개별 초기화':'Reiniciar Indiv.',

    // 입고단가/송금
    '국내 운송료 포함':'Incl. Flete Nacional',
    '크레딧 차감 (불량/반품)':'Crédito (Defectos/Dev.)',
    '최종 송금액':'💸 Monto Final','소계':'Subtotal','크레딧':'Crédito','송금액':'Pago',
    '저장할 차수':'Semana a guardar','메모 (사유)':'Memo (motivo)',
    '운송료':'Flete','국내 운송비':'Flete Nacional',

    // 판매/채권
    '판매 내역':'Historial Ventas','거래처별 판매 현황':'Ventas por Cliente',
    '품목별 판매 현황':'Ventas por Producto',
  }
};

// 번역 함수 핵심 — lang 에 따라 반환
// 'ko'  → 한국어만
// 'es'  → 스페인어만
// 'bi'  → "한국어 / Español" 동시 표시 (기본값)
function translate(key, lang) {
  const ko = TRANSLATIONS.ko?.[key] || key;
  const es = TRANSLATIONS.es?.[key];
  if (lang === 'es') return es || key;
  if (lang === 'bi') return es ? `${ko} / ${es}` : ko;
  return ko;
}

// 현재 언어
export function getLang() {
  if (typeof window === 'undefined') return 'bi';
  return localStorage.getItem('nenovaLang') || 'bi';
}

export function setLang(lang) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('nenovaLang', lang);
  window.dispatchEvent(new CustomEvent('langChange', { detail: lang }));
}

// ── useLang 훅: 언어 변경 시 자동 리렌더
export function useLang() {
  const [lang, setLangState] = useState(() => getLang());

  useEffect(() => {
    const handler = (e) => setLangState(e.detail || getLang());
    window.addEventListener('langChange', handler);
    return () => window.removeEventListener('langChange', handler);
  }, []);

  const t = (key) => translate(key, lang);

  // 토글 순서: bi → ko → es → bi
  const toggleLang = () => {
    const next = lang === 'bi' ? 'ko' : lang === 'ko' ? 'es' : 'bi';
    setLang(next);
  };

  return { lang, t, toggleLang };
}

// 훅 없이 쓸 때 (서버사이드 등)
export function t(key) {
  return translate(key, getLang());
}
