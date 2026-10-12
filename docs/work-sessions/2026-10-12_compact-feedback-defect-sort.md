# 홈 피드백 상태색·불량 입력 정렬

## 요청과 결과
- 홈 수입부 피드백을 작은 기존 공간에서 상태색으로 구분한다. 읽음 여부와 업무 진행 상태를 분리하며 농장·품목·문제 요약을 유지한다.
- 영업수입불량차감의 입력 편집·저장 후 완료 목록과 수입부 확인 목록을 업체→담당자 기본순으로 표시하고 담당자→업체로 전환한다. 기존 국가·품종별 수입부 보기도 유지한다.

## 기준과 부작용
- 빨강은 WAITING(미답변)의 유효한 답변 기한이 한국시간 오늘보다 지난 경우만 적용한다. NEW 요청 필요·WAITING 답변 필요·RECURRED 재발 확인은 주황, OBSERVING 개선 관찰은 파랑, ANSWERED 답변 도착·CLOSED 개선 확인은 초록이다. 답변 도착을 개선 완료로 바꾸지 않는다. 알 수 없는 상태는 중립 안내다.
- 원본 상태·기한은 변경하지 않는다. 큰 상세가 생략되어도 top-level dueDate는 보존한다. 개인 읽음 여부가 상태색을 바꾸지 않는다.
- 정렬은 원본 배열을 수정하지 않는 표시 투영이며 원본 sourceIndex·deductionKey를 유지한다. 편집·선택·삭제·저장의 대상 및 기존 payload는 보존한다.
- OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentFarm/ShipmentDate/Estimate/WebProfitReport 및 피드백 원본은 전부 보존한다. SQL·API 쓰기·권한·매칭 정책 변경 없음.

## 메뉴 기본값
적용: 1920×1080 CSS px/100%, 작은 화면, 기존 색상과 공간, 긴 내용 줄바꿈, 키보드, 표시와 실제 상태 일치, 선택 맥락 보존.
해당 없음: 신규 메뉴·전산 반영·원장 보정·새 저장 단계. 기존 입력/확인 흐름은 유지한다.
예외: 넓은 업무표의 기존 가로 스크롤은 유지한다.
프로젝트 하위 작업 지침 파일 docs/CODEX_SUBTASK_ORCHESTRATION.md는 존재하지 않아 사용자 제공 AGENTS의 역할 분담 규칙을 적용했다.

## 검증·배포
진행 중. 실제 통과 결과와 배포 근거는 완료 후 추가한다. 설치된 사용자 앱의 실제 확인과 fixture 검증은 구분한다.

- 검증 통과: 홈 owner/year/budget/오래된 지연 우선 포함 fixture, 불량 정렬 unit, 홈1920×1080·800×1080 브라우저 fixture, 불량1920×1080·800×900 브라우저 fixture(정렬 후 선택·비고 보존), Electron25 unit/native smoke/restore/updater 무설치 검증, ERP 계약·dnSpy·manifest·쓰기 가드·UI layout. 실제 설치 사용자 앱을 임의 재시작하지 않았다.
- 최종 리뷰의 집계 범위 P2 해결: 표시N건 명시, 최대20건 적용 전에 긴급순 정렬, 전체 현황 원문 안내. 이후 추가 P0–P2 없음.
- PC1.3.8 설치기 패키지의 shell 소스 일치 확인. SHA256 28bb2286d9a7dde3bccf5e4ff8e403a66def9de3d77da63534412b3da66d4885.

## 운영 배포 완료
- 최종 production build exit0. PR1011 https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1011 병합, master 0a2aecf4db4408f601d4325474753d00c6b3a430. PR Windows installer/ERP verify 모두 성공. master Windows run38194313051 성공.
- Cafe24 run38194313118 성공(SSH배포 및 실브라우저 hydration 포함). 운영 로그인1920×1080/800×1080 CSS px 100%에서1.3.8 다운로드·hydration=true·가로넘침false 확인. 비인증 홈API401 확인.
- desktop-v1.3.8 공개 및 latest.yml 로컬과일치. 공개설치기111710891bytes, GitHub asset SHA256과 로컬검증값 일치. 새 설치기 source asar shell 동일.
- 인증된 실제 운영 홈/불량 행의 내용과 사용자의 설치된 PC 앱 업데이트 완료는 직접 확인하지 않았다. 해당 화면동작은 fixture실브라우저 및 isolated Electron으로 검증했다. 운영 원장쓰기/강제 앱재시작 없음.

## 추가 요청: 홈 버튼 집 모양 (PC1.3.9)
- 상단 왼쪽 #menuButton의 메뉴형 문자 아이콘을 currentColor 윤곽 집 SVG로 교체. 접근성 이름/툴팁도 홈으로 변경. 버튼30px·활성화상태·기존toggle·Ctrl+K 유지. 입력/즐겨찾기/ERP 데이터 변경 없음.
- 적용: 기존공간·색상·키보드·1920×1080 및800×1080. 해당없음: 신규메뉴·SQL·원장쓰기. 작은아이콘변경으로 기존 의미있는 Electron/browser smoke를 재사용했다.
- Desktopunit/native smoke와홈브라우저 fixture 통과,1920화면육안확인. 설치기 asar 소스일치, SHA256 a10e076df632df0004dfbb1485f3e6ffee6cbd402772fe68fe34a236f0e97902. 최종리뷰 P0–P2없음. 배포확인은 후속기록.
