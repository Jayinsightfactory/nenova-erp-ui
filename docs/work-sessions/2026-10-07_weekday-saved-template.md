# 주광 발주내역 기본 양식 저장

Q. 매번 엑셀을 업로드하기 힘드니 첨부한 주광 발주내역 양식을 학습해서 저장한다.

A. 주광 원본을 서버 기본 양식으로 영구 보관하고 CustKey533의 유효 조회 범위에서 자동 로드한다. 재접속·새로고침·기본 차수 변경 후에도 업로드 없이 기본 양식 다운로드 가능. 직접 업로드한 파일을 덮어쓰지 않고 ‘저장 양식 사용’으로 명시 복귀한다.

- 원본: 사용자 제공 XLSX 160353bytes, 15시트. SHA256 0D2BF7505BBDB792C43A116DF037BC125E4BE44F05D7519DDFE747EB7D8FDFB3.
- 실제 파일을 읽어 시트/서식/병합 구조를 확인했다. 과거 차수·날짜와 타업체 이력도 있으므로 자동 로드는 원문 표시만, 자동 초안/수량 연결/분배·확정 저장은 없다.
- 저장소가 공개임을 확인했다. 원본 평문은 커밋하지 않고 AES-256-GCM 암호문만 보관. 배포 비밀키로 SHA검증 후 서버 ignored runtime 원본(600)을 복원하며 비밀키는 서비스 환경에 남기지 않는다. 임시 키파일 삭제.
- 인증된 고정 GET /api/estimate/weekday-template?custKey=533, private no-store. 경로입력 없음. 다른 업체400, POST405, 원본 누락·무결성503. 로그에 원본 수량·키를 출력하지 않는다.
- 부작용: 파일 저장/조회만. Order/Shipment/Stock/Estimate/Profit/확정 원장과 기존 입력 초안 모두 보존. 같은 날 직전 주광 네이티브/읽기 전용 근거를 재사용하며 API SQL 변경·원장 보정 없음.
- UI: scope/upload request 및 수동업로드 owner로 경합 차단. 오래된 수동업로드 완료가 새 요청의 busy/잠금을 지우지 못한다. 기본양식 title이 과거라고 현재 달력으로 자동 적용하지 않는다.
- 검증: 실제 원본 private loader 해시/바이트/15시트 확인. CI는 합성 XLSX 및 임시 암호문 fixture만 사용. auth·고정scope·checksum·encrypt/deploy 계약·autoload/manual우선/경합 테스트 통과. 독립 검토 중대 결함 없음. 전체 ERP계약/dnSpy/manifest/쓰기 가드 및 master 동기화 후 최종 빌드 통과. 새API1개 read-only 검증.
- 기준 viewport1920×1080/100%. 직접 화면 검증 도구 kernel 오류는 지속. 배포 후 서버 authenticated GET 원본hash/시트/익명401 smoke 및 Actions hydration/shell 확인 예정.

## PR·배포

PR #942: 초기 CI에서 backend test가 Windows SWC를 고정한 오류를 발견해 플랫폼별 컴파일러로 수정. 재실행 verify37575098180 성공(1m40s). master 병합 b4f9841bacf18b79a782fead340771bc6406cae1, Cafe24 run37575273773 success. 서버 원본 installer 무결성 검증, authenticated template200/원본SHA/15시트/익명401 포함 smoke 15passed0failed, Actions 로그인·차수피벗 hydration/일반·팝업 shell 검사 통과. 운영 반영 완료. 직접 저장양식 화면 조작은 CUA 오류로 미검증.
