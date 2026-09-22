// __tests__/workDrive.test.js — 업무 드라이브: 차수 정규화·단계 분류·민감 태그·부서 접근·중복/버전·파일 전용 저장.
// 실행: node __tests__/workDrive.test.js  (MSSQL 불필요, 임시 폴더에서 파일만 다룸)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-test-'));
const cwd = process.cwd();
process.chdir(tmp);

const src = fs.readFileSync(path.join(cwd, 'lib', 'workDrive.js'), 'utf8')
  .replace(/^import fs from 'fs';/m, "const fs = require('fs');")
  .replace(/^import path from 'path';/m, "const path = require('path');")
  .replace(/^import crypto from 'crypto';/m, "const crypto = require('crypto');")
  .replace(/^import \{ DEPARTMENTS \} from '\.\/workManuals';/m,
    "const DEPARTMENTS = [{ id: 'sales-support', name: '영업지원', members: ['설연주', '강현우', '임재용'] }, { id: 'import', name: '수입부', members: ['가브리엘', '김원빈'] }, { id: 'sales', name: '영업부', members: ['박성수', '정재훈', '조현욱'] }, { id: 'management', name: '경영지원', members: ['강명훈'] }];")
  .replace(/^import \{ isOrbitReportViewer \} from '\.\/orbitReportAccess';/m,
    "const isOrbitReportViewer = (u) => String(u?.userId || '').toLowerCase() === 'nenovass3';")
  .replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { STAGES, extractCycle, classifyStage, isSensitive, classify, ingestFile, reclassify, reclassifyAll, canView, canDownload, listVisible, getFile, downloadLog };';
const modPath = path.join(tmp, 'workDrive.cjs');
fs.writeFileSync(modPath, src);
const wd = require(modPath);

// 차수 정규화 — 실측 표기 5종
assert.strictEqual(wd.extractCycle('38-2 NL 원가자료.xlsx'), '38-2');
assert.strictEqual(wd.extractCycle('3802_콜롬비아수국.xlsx'), '38-2');
assert.strictEqual(wd.extractCycle('(Holex) 2026년도 38-02주차 입고 상세 목록_2026-09-18.xlsx'), '38-2');
assert.strictEqual(wd.extractCycle('38-2차 친구플라워 출고 내역서.xlsx'), '38-2');
assert.strictEqual(wd.extractCycle('40-1_Ecuador.xlsx'), '40-1');
assert.strictEqual(wd.extractCycle('39-2 cloud 발주.xlsx'), '39-2');
assert.strictEqual(wd.extractCycle('40차 친구플라워 출고 내역서.xlsx'), '40', '회차만 있으면 회차');
assert.strictEqual(wd.extractCycle('2026년 라움 발주서.xlsx'), '', '연도는 차수 아님');
assert.strictEqual(wd.extractCycle('9월 거래명세서.xlsx'), '');

// 단계 분류 — 실측 파일명
assert.strictEqual(wd.classifyStage('2026년 라움 발주서.xlsx'), '발주');
assert.strictEqual(wd.classifyStage('38-02_NL_H_PROFORMA.xlsx'), '입고');
assert.strictEqual(wd.classifyStage('38-2 NL 원가자료.xlsx'), '원가·운임');
assert.strictEqual(wd.classifyStage('38차 운임비.xlsx'), '원가·운임');
assert.strictEqual(wd.classifyStage('40차 친구플라워 출고 내역서.xlsx'), '출고');
assert.strictEqual(wd.classifyStage('강남,건대 라움 견적서 양식.xlsx'), '견적·거래처');
assert.strictEqual(wd.classifyStage('★2026 지출결의서.xlsx'), '송금·경영');
assert.strictEqual(wd.classifyStage('38-1 Colombian Hydrangea Quality Issue.pdf'), '품질');
assert.strictEqual(wd.classifyStage('aaaaaaaaaaaa'), '미분류');
// backfill 실측 미분류 보강
assert.strictEqual(wd.classifyStage('6월 매출이익 보고서(22차~26차).xlsx'), '송금·경영');
assert.strictEqual(wd.classifyStage('23차 라움 판매현황.xlsx'), '견적·거래처');
assert.strictEqual(wd.classifyStage('23-1 콜카장 tiba.pdf'), '입고');
assert.strictEqual(wd.classifyStage('10-2 Rosas.xlsx'), '발주');
assert.strictEqual(wd.classifyStage('10-2 Clavel.xlsx'), '발주');
assert.strictEqual(wd.classifyStage('china defectuosos 11-1.xlsx'), '품질');
assert.strictEqual(wd.classifyStage('10차 국가 및 풍목별 컨펌률.xlsx'), '발주');
assert.strictEqual(wd.classifyStage('위임장_2509.pdf'), '송금·경영');
assert.strictEqual(wd.classifyStage('(주)네노바_하나은행_중국 cloud 선결제 해외송금증빙_26.06.17.pdf'), '송금·경영');
// 농장 사전·결제·무작위 ID
assert.strictEqual(wd.classifyStage('AYURA 17-1 HERMES ORANGE.pdf'), '입고');
assert.strictEqual(wd.classifyStage('CIRCASIA 13-1 CORAL.pdf'), '입고');
assert.strictEqual(wd.classifyStage('22-1 FLORENTINA credito.xlsx'), '송금·경영');
assert.strictEqual(wd.classifyStage('외상매출금 입금내역_25년 1분기.pdf'), '송금·경영');
assert.strictEqual(wd.classifyStage('중국MELODY_CNY 210,173.5_14-1차 수입_(주)네노바.pdf'), '송금·경영');
assert.strictEqual(wd.extractCycle('FL68KFM75D8G547.xlsx'), '', '무작위 ID는 차수 아님');
assert.strictEqual(wd.extractCycle('AYURA 17-1 HERMES.pdf'), '17-1');
assert.strictEqual(wd.isSensitive('AYURA 17-1 HERMES.pdf', '입고'), true, '농장 인보이스 PDF는 민감');
// 영업부(박성수·NENOVA2025) 실측 미분류 보강
assert.strictEqual(wd.classifyStage('44차 양재동 차감내역.xlsx'), '출고');
assert.strictEqual(wd.classifyStage('16차 대구희경-175박스.xlsx'), '출고');
assert.strictEqual(wd.classifyStage('26년 1차 울산신화 어버이날 물량-70.xlsx'), '출고');
assert.strictEqual(wd.classifyStage('46-1차 예상 가격표.xlsx'), '견적·거래처');
assert.strictEqual(wd.classifyStage('중국 38-2차 패킹리스트.xlsx'), '입고');
assert.strictEqual(wd.classifyStage('2026년 지역별 매출액 정리.xlsx'), '송금·경영');
assert.strictEqual(wd.classifyStage('강동동86-6 사업자등록.pdf'), '송금·경영');

// 민감
assert.strictEqual(wd.isSensitive('★외화송금결제 지출결의서.xlsx', '송금·경영'), true);
assert.strictEqual(wd.isSensitive('contrato definitivo kim.pdf', '미분류'), true);
assert.strictEqual(wd.isSensitive('40차 친구플라워 출고 내역서.xlsx', '출고'), false);

// 저장·분류·중복·버전
const buf1 = Buffer.from('v1 content'), buf2 = Buffer.from('v2 content');
const r1 = wd.ingestFile({ buffer: buf1, filename: '38-2 NL 원가자료.xlsx', orbitUserId: 'MNIAFICB3DC88DCB34', userName: '설연주', hostname: 'neonva', dir: 'Desktop' });
assert.strictEqual(r1.ok, true); assert.strictEqual(r1.classification.cycle, '38-2'); assert.strictEqual(r1.classification.stage, '원가·운임'); assert.strictEqual(r1.classification.dept, '영업지원'); assert.strictEqual(r1.version, 1);
const rDup = wd.ingestFile({ buffer: buf1, filename: '38-2 NL 원가자료.xlsx', userName: '설연주' });
assert.strictEqual(rDup.duplicate, true, '같은 내용은 중복');
const r2 = wd.ingestFile({ buffer: buf2, filename: '38-2 NL 원가자료.xlsx', userName: '설연주' });
assert.strictEqual(r2.version, 2, '같은 이름·다른 내용 = 새 버전');
const rM = wd.ingestFile({ buffer: Buffer.from('money'), filename: '★2026 지출결의서.xlsx', userName: '강명훈' });
assert.strictEqual(rM.classification.sensitive, true); assert.strictEqual(rM.classification.dept, '경영지원');
const rS = wd.ingestFile({ buffer: Buffer.from('ship'), filename: '40-1 영남꽃소재 출고 내역서.xlsx', orbitUserId: 'MN0B1204A46C4B8EAC', userName: '' });
assert.strictEqual(rS.classification.uploaderName, '정재훈', 'userId 별칭'); assert.strictEqual(rS.classification.dept, '영업부');
const rAlias = wd.ingestFile({ buffer: Buffer.from('q'), filename: '38-1 불량 이미지 정리.xlsx', userName: 'ㅋㅋ' });
assert.strictEqual(rAlias.classification.uploaderName, '조현욱');
const rHost = wd.ingestFile({ buffer: Buffer.from('h'), filename: '44차 양재동 차감내역.xlsx', userName: '설연주', hostname: 'NENOVA2025' });
assert.strictEqual(rHost.classification.uploaderName, '정재훈', 'PC 별칭이 토큰 이름보다 우선'); assert.strictEqual(rHost.classification.dept, '영업부');
assert.strictEqual(wd.ingestFile({ buffer: Buffer.alloc(0), filename: 'x.xlsx' }).status, 400);
assert.strictEqual(fs.existsSync(path.join(tmp, 'data', 'drive', '38-2')), true, '차수 폴더에 저장');
assert.deepStrictEqual(fs.readdirSync(path.join(tmp, 'data')), ['drive'], '저장 위치는 data/drive 뿐');

// 접근 규칙
const boss = { userId: 'nenovaSS3', userName: '관리자' };
const seol = { userId: 'seol', userName: '설연주' };
const gab = { userId: 'gab', userName: '가브리엘' };
const jae = { userId: 'jae', userName: '정재훈' };
const kmh = { userId: 'kmh', userName: '강명훈' };
const vis = (u) => wd.listVisible(u).map((f) => f.filename);
const rF = wd.ingestFile({ buffer: Buffer.from('freight'), filename: '38차 운임비.xlsx', userName: '정재훈' });
assert.strictEqual(rF.classification.stage, '원가·운임'); assert.strictEqual(rF.classification.sensitive, false, '운임은 금액 아님');
assert.strictEqual(vis(boss).length, 7, '사장 전체(원가자료 v1·v2 + 결의서 + 출고 + 불량 + 차감 + 운임)');
assert.ok(vis(seol).includes('38-2 NL 원가자료.xlsx'), '본인 파일');
assert.ok(!vis(gab).includes('38-2 NL 원가자료.xlsx'), '원가(금액)는 민감 → 타부서 불가');
assert.ok(vis(gab).includes('38차 운임비.xlsx'), '수입부는 원가·운임 단계의 비민감 파일 인수인계 열람');
assert.ok(!vis(gab).includes('★2026 지출결의서.xlsx'), '민감 파일은 타부서 불가');
assert.ok(vis(kmh).includes('★2026 지출결의서.xlsx'), '경영지원은 민감 열람');
assert.ok(vis(jae).includes('40-1 영남꽃소재 출고 내역서.xlsx'), '영업부 본인');
assert.ok(!vis(jae).includes('★2026 지출결의서.xlsx'));
const wonbin = { userId: 'wb', userName: '김원빈' };
assert.ok(vis(wonbin).includes('40-1 영남꽃소재 출고 내역서.xlsx') === false, '수입부는 출고 파일 미열람');
// 내려받기 = 기록 남음(사장만 조회)
const g = wd.getFile(seol, r1.id); assert.ok(g && fs.existsSync(g.abs));
assert.strictEqual(wd.getFile(gab, rM.id), null, '민감 파일 타부서 내려받기 차단');
assert.strictEqual(wd.downloadLog(boss, r1.id).length, 1); assert.strictEqual(wd.downloadLog(seol, r1.id).length, 0);
// 교정: 본인/사장만, 원본 보존(추가 행)
assert.strictEqual(wd.reclassify(gab, r1.id, { stage: '입고' }).status, 403);
assert.strictEqual(wd.reclassify(seol, r1.id, { stage: '입고' }).ok, true);
assert.strictEqual(wd.listVisible(seol).find((f) => f.id === r1.id).stage, '입고');
assert.strictEqual(wd.reclassify(boss, r1.id, { deleted: true }).ok, true);
assert.ok(!wd.listVisible(boss).some((f) => f.id === r1.id), '숨김');
// 업무 드라이브 추가 관리자(김원영 nenova1): 사장과 같이 전 부서 열람·다운로드, orbit-report 권한과는 별개
const kwy = { userId: 'nenova1', userName: '김원영' };
assert.deepStrictEqual(vis(kwy).sort(), vis(boss).sort(), '김원영은 사장과 같은 목록');
assert.ok(!wd.listVisible({ userId: 'nenovaSD1', userName: '정재훈' }).some((f) => f.uploaderName === '강명훈' && f.sensitive), '일반 직원은 타부서 민감 파일 못 봄');

// 일괄 재분류: 사장만, 손으로 고친 행(r1: 입고로 교정됨)은 제외
assert.strictEqual(wd.reclassifyAll(seol).status, 403);
const ra = wd.reclassifyAll(boss); assert.strictEqual(ra.ok, true); assert.ok(ra.scanned >= 4);
const ra2 = wd.reclassifyAll(boss); assert.strictEqual(ra2.changed, 0, '두 번째 실행은 변화 없음(자동행 재적용 가능하되 멱등)');

process.chdir(cwd);
console.log('workDrive tests passed: 차수 정규화 5종, 단계 분류, 민감, 중복/버전, 부서 접근, 내려받기 기록, 교정');
