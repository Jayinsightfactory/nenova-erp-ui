# 실패 응답 보관·무료 파서 재검증

사용자 요청: 실패 응답 저장, 추가 유료 분석 없이 파서 재검증,4번째 원인 확인·해결,완료3개 유지,운영DB 보존,검증·배포.

## 사실과 한계
- 이전31ba5ad5 실파일은15구간 중3완료 후4번째 strict JSON.parse에서 실패. 당시 raw 응답은 보관되지 않았다. 비용 추적기도 토큰/모델/비용/목적만 저장하고 응답 본문은 저장하지 않는다.
- 따라서 기존4번째의 정확한 JSON 내용을 복구하거나 실제 원인을 확정했다고 주장하지 않는다. 새로운 유료 호출은 금지한다.

## 구현
- 구간 응답 text/stop_reason을 **파싱 전** 사용자별 private sidecar에 저장.2MiB/응답,30일,240개+활성참조 보호,0600/700, SHA 및 원본 cacheKey·페이지 대조. raw 일반조회/로그 노출0.
- 같은 사용자·같은 원본의 FAILED job을 무료 재검증. API key/quota/provider/SQL 경로 전에 별도 분기. 기존 SUCCEEDED 구간은 그대로 유지. 누락 응답은 MISSING_SAVED_RESPONSE, JSON 미완결/문법/다중객체/전체대조를 구분한다.
- 완결 JSON에 붙은 설명·Markdown 포장은 분리해 읽되, 괄호 닫기/수치 변경/부분 송장 복구는 하지 않는다. 해당 원인 유형은 합성 fixture로 수정 검증했으며 실제4번째 원인으로 단정하지 않는다.
- 오류 복구용 「저장 응답 재검증 · 무료」 버튼. 일반 업로드·매칭·입고 순서와 writer는 불변. 새 메뉴/탭/일반 업무 순서 변경 없으므로 새 가이드 촬영 해당 없음.

## 검증
- 표적45 PASS. 유료 fetch/quota/비용기록0, API키 없는 재검증, 다른 사용자/다른 원본 및 잘못된 boolean 차단, legacy3유지+4응답없음, 완결 응답 재활용 성공, 잘린 응답 차단·보존, 저장실패 후 후속호출0, raw 비공개.
- manifest201/writeguard/dnSpy/workflow-guide 검사 PASS. 정식 전체ERP 및webpack1worker build exit0. CI/실브라우저/배포는 진행 중.
- 운영 ERP 원장 수정0, 추가 유료 분석0. 실제4번째 원문이 없다는 한계는 배포 후 무료 재검증 화면에서도 확인한다.

검색어: savePackingPdfChunkResponse revalidateOnly MISSING_SAVED_RESPONSE JSON_UNTERMINATED 무료재검증 3of15
