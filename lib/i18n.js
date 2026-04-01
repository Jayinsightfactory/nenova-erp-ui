// lib/i18n.js
// 한국어 / 스페인어 전환
// 수정이력: 2026-03-30 — useLang 훅 추가 (언어 변경 시 전체 페이지 리렌더)

import { useState, useEffect } from 'react';

export const TRANSLATIONS = {
  ko: {
    '조회':'조회','신규':'신규','저장':'저장','삭제':'삭제',
    '닫기':'닫기','확정':'확정','확정취소':'확정취소','수정':'수정',
    '출력':'출력','엑셀':'엑셀','업로드':'업로드','등록':'등록',
    '취소':'취소','새로고침':'새로고침','일괄지정':'일괄지정',
    '초기화':'초기화','검색':'검색','선택':'선택','조회/검색':'조회',
    '차수':'차수','거래처':'거래처','품목명':'품목명','수량':'수량',
    '단가':'단가','합계':'합계','주문일자':'주문일자','담당자':'담당자',
    '국가':'국가','꽃':'꽃','박스':'박스','단':'단','송이':'송이',
    '전재고':'전재고','주문':'주문','입고':'입고','미발주':'미발주',
    '현재고':'현재고','비고':'비고','지역':'지역','농장명':'농장명',
    '주문등록':'주문등록','주문관리':'주문관리','발주관리':'발주관리',
    '입고관리':'입고관리','출고분배':'출고분배','출고조회':'출고조회',
    '출고내역조회':'출고내역조회','견적서 관리':'견적서 관리',
    '재고 관리':'재고 관리','거래처관리':'거래처관리','품목관리':'품목관리',
    '업체별 품목 단가관리':'업체별 품목 단가관리','코드관리':'코드관리',
    '사용자관리':'사용자관리','작업내역':'작업내역',
    'Pivot 통계':'Pivot 통계','월별 판매 현황':'월별 판매 현황',
    '지역별 판매 비교':'지역별 판매 비교','매출/물량 분석':'매출/물량 분석',
    '영업 사원 실적':'영업 사원 실적',
    '주문관리':'주문관리','입/출고관리':'입/출고관리',
    '통계화면':'통계화면','코드관리':'코드관리',
    '로그아웃':'로그아웃',
    '지난 주문 불러오기':'지난 주문 불러오기',
    '주문 변경 내역 조회':'주문 변경 내역 조회',
    '수량 초기화':'수량 초기화',
    '그룹을 선택하세요':'그룹을 선택하세요',
    '품목명 검색...':'품목명 검색...',
    '거래처 검색...':'거래처 검색...',
  },
  es: {
    '조회':'Buscar','신규':'Nuevo','저장':'Guardar','삭제':'Eliminar',
    '닫기':'Cerrar','확정':'Confirmar','확정취소':'Cancelar Conf.','수정':'Editar',
    '출력':'Imprimir','엑셀':'Excel','업로드':'Subir','등록':'Registrar',
    '취소':'Cancelar','새로고침':'Actualizar','일괄지정':'Lote',
    '초기화':'Reiniciar','검색':'Buscar','선택':'Seleccionar','조회/검색':'Buscar',
    '차수':'Semana','거래처':'Cliente','품목명':'Producto','수량':'Cantidad',
    '단가':'Precio','합계':'Total','주문일자':'Fecha Pedido','담당자':'Encargado',
    '국가':'País','꽃':'Flor','박스':'Caja','단':'Tallo','송이':'Botón',
    '전재고':'Stock Ant.','주문':'Pedido','입고':'Recepción','미발주':'Pendiente',
    '현재고':'Stock Act.','비고':'Nota','지역':'Región','농장명':'Finca',
    '주문등록':'Reg. Pedido','주문관리':'Gest. Pedidos','발주관리':'Gest. Órdenes',
    '입고관리':'Recepción','출고분배':'Distribución','출고조회':'Ver Salida',
    '출고내역조회':'Historial Salida','견적서 관리':'Cotización',
    '재고 관리':'Inventario','거래처관리':'Clientes','품목관리':'Productos',
    '업체별 품목 단가관리':'Precios por Cliente','코드관리':'Códigos',
    '사용자관리':'Usuarios','작업내역':'Historial',
    'Pivot 통계':'Pivot Estadísticas','월별 판매 현황':'Ventas Mensuales',
    '지역별 판매 비교':'Comparación Regional','매출/물량 분석':'Análisis Ventas',
    '영업 사원 실적':'Rendimiento Vendedores',
    '주문관리':'Gestión Pedidos','입/출고관리':'Entradas/Salidas',
    '통계화면':'Estadísticas','코드관리':'Códigos',
    '로그아웃':'Salir',
    '지난 주문 불러오기':'Cargar Pedido Anterior',
    '주문 변경 내역 조회':'Ver Historial Cambios',
    '수량 초기화':'Reiniciar Cantidad',
    '그룹을 선택하세요':'Seleccione grupo',
    '품목명 검색...':'Buscar producto...',
    '거래처 검색...':'Buscar cliente...',
  }
};

// 현재 언어
export function getLang() {
  if (typeof window === 'undefined') return 'ko';
  return localStorage.getItem('nenovaLang') || 'ko';
}

export function setLang(lang) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('nenovaLang', lang);
  // 전체 컴포넌트에 언어 변경 알림
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

  // 번역 함수
  const t = (key) => TRANSLATIONS[lang]?.[key] || key;

  const toggleLang = () => {
    const next = lang === 'ko' ? 'es' : 'ko';
    setLang(next);
  };

  return { lang, t, toggleLang };
}

// 훅 없이 쓸 때 (서버사이드 등)
export function t(key) {
  return TRANSLATIONS[getLang()]?.[key] || key;
}
