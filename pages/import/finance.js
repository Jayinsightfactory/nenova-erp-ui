// pages/import/finance.js — 경영지원(강명훈) 프리셋: 수입부 통합 같은 화면을 송금·지급·채권 기본 탭으로 연다. 메뉴 계약상 실제 페이지 경로가 필요해 얇은 래퍼로 둔다.
import { ImportOnePage } from './index';

export default function ImportFinancePage() { return <ImportOnePage initialRole="finance" />; }
