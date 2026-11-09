# 무료 OCR 실행 연결

웹은 사용자별 private 파일 큐만 기록하고 owner PC의 별도 Python 워커가 로컬 모델로 처리한다. 기존 Docling 워커를 바꾸거나 유료 API로 전환하지 않는다. PC가 꺼지면 대기 안내가 표시되며 다시 접수할 수 있다. ERP 입고·재고·원가 저장 API는 이 워커에서 호출하지 않는다.

로컬 Python에 RapidOCR, pypdfium2, ONNX Runtime과 설치된 PP-OCRv6 small 모델이 필요하다. 모델을 실행 중 자동 다운로드하지 않는다. 인증은 기존 Orbit ingest 설정에서 런타임으로 읽으며 키를 채팅·로그·작업 인자에 기록하지 않는다.

`scripts/install-rapidocr-worker.ps1 -PythonPath <설치된 python.exe>`는 현재 사용자 로그온 시 제한 권한으로 실행한다. 같은 작업명이 있으면 교체하지 않고 중단한다. 큐별 claim token·원본 SHA·사용자 범위를 검증한다.

현재 구조화 검증 범위는 SHA가 일치하는 46-1 콜카장 43쪽 복구와 Premium Greens 호주 인보이스다. 다른 CO 파일은 범용 지원으로 간주하지 않는다. 미지원 서식·합계 불일치·Recipe 부모 누락은 명시 실패하며 기존 완료 구간을 변경하지 않는다.

검증: `scripts/verify-free-ocr-http.mjs`는 명시한 로컬 PDF·evidence·Python으로 격리 Next 서버와 브라우저 HTTP, 실제 로컬 워커를 연결한다. ERP API는 가로채 차단한다. 생성한 초기3구간은 테스트 fixture이지 운영에 저장된 원본3구간이 아니다.
