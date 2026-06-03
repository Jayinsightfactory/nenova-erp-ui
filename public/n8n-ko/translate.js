/* n8n 한글 오버레이 — n8n 페이지(n8n.nenovaweb.com)에 nginx sub_filter로 주입.
 * 우하단 🇰🇷 토글 버튼으로 켜고 끈다. 주요 UI 용어만 "정확히 일치하는 전체 텍스트"에 한해 치환.
 * 성능 안전: (1) 변경된 노드만 처리(전체 재탐색 X)  (2) 데이터/JSON/코드/표현식 패널은 제외
 *           (3) 적용 중 옵저버 분리(자기 호출 방지)  (4) 한 번 처리량 상한.
 * 사용자 입력/코드/표현식/실행 데이터는 절대 건드리지 않는다. 완벽 번역이 아니라 편의용 오버레이.
 * 용어 추가/수정은 KO 사전만 늘리면 된다.
 */
(function () {
  if (window.__n8nKoLoaded) return;
  window.__n8nKoLoaded = true;

  var KO = {
    'Overview': '개요', 'Personal': '개인', 'Workflows': '워크플로우', 'Credentials': '자격증명',
    'Executions': '실행기록', 'Variables': '변수', 'Templates': '템플릿', 'Insights': '인사이트',
    'Help': '도움말', 'Settings': '설정', 'Admin Panel': '관리자',
    'Create Workflow': '워크플로우 만들기', 'Create workflow': '워크플로우 만들기',
    'Add workflow': '워크플로우 추가', 'Start from scratch': '빈 워크플로우로 시작',
    'Build a workflow': '워크플로우 만들기', 'Open': '열기', 'New': '새로 만들기',
    'All the workflows, credentials and data tables you have access to': '접근 가능한 모든 워크플로우·자격증명·데이터 테이블',
    'Prod. executions': '운영 실행 수', 'Failed prod. executions': '실패한 운영 실행', 'Failure rate': '실패율',
    'Time saved': '절약 시간', 'Run time (avg.)': '평균 실행시간', 'Data tables': '데이터 테이블',
    'Search': '검색', 'Sort by last updated': '최근 수정순', 'Created': '생성', 'Last updated': '최근 수정',
    'Owned by me': '내 소유', 'Shared with me': '나와 공유됨',
    'Save': '저장', 'Saved': '저장됨', 'Publish': '게시', 'Download': '다운로드', 'Duplicate': '복제',
    'Rename': '이름 변경', 'Delete': '삭제', 'Archive': '보관', 'Favorite': '즐겨찾기',
    'Import from URL...': 'URL에서 가져오기...', 'Import from File...': '파일에서 가져오기...',
    'Edit description': '설명 편집', 'Add tag': '태그 추가', 'Active': '활성', 'Inactive': '비활성',
    'Editor': '편집기', 'Evaluations': '평가',
    'Add first step…': '첫 단계 추가…', 'Add first step...': '첫 단계 추가...',
    'Execute workflow': '워크플로우 실행', 'Execute step': '단계 실행', 'Execute previous nodes': '이전 노드 실행',
    'Test workflow': '워크플로우 테스트', 'Test step': '단계 테스트', 'Test URL': '테스트 URL', 'Stop': '중지',
    'Parameters': '매개변수', 'Docs': '문서', 'Input': '입력', 'Output': '출력',
    'No input data': '입력 데이터 없음', 'No output data': '출력 데이터 없음', 'set mock data': '모의 데이터 설정',
    'Variables and context': '변수 및 컨텍스트',
    'Connection': '연결', 'Sharing': '공유', 'Details': '세부정보', 'Account': '계정',
    'Set up credential': '자격증명 설정', 'Create new credential': '새 자격증명 만들기',
    'Name': '이름', 'Value': '값', 'Description': '설명', 'Type': '유형', 'Method': '메서드', 'URL': 'URL',
    'Authentication': '인증', 'Header Auth': '헤더 인증', 'Generic Credential Type': '일반 자격증명 유형',
    'Send Query Parameters': '쿼리 파라미터 전송', 'Query Parameters': '쿼리 파라미터',
    'Add Query Parameter': '쿼리 파라미터 추가', 'Specify Query Parameters': '쿼리 파라미터 지정',
    'Using Fields Below': '아래 필드 사용', 'Import cURL': 'cURL 가져오기', 'Allowed HTTP Request Domains': '허용 HTTP 요청 도메인', 'All': '전체',
    'Cancel': '취소', 'Confirm': '확인', 'Close': '닫기', 'Back': '뒤로', 'Next': '다음',
    'Continue': '계속', 'Retry': '재시도', 'Yes': '예', 'No': '아니오', 'OK': '확인', 'Import': '가져오기',
    'Sign in': '로그인', 'Sign out': '로그아웃', 'Log out': '로그아웃',
    'Email': '이메일', 'Password': '비밀번호', 'First Name': '이름', 'Last Name': '성',
    'Set up owner account': '관리자 계정 설정', 'Owner': '소유자', 'Member': '멤버', 'Admin': '관리자',
    'Add node': '노드 추가', 'On a schedule': '스케줄로', 'Manual Trigger': '수동 트리거',
    'Node executed successfully': '노드가 성공적으로 실행되었습니다', 'Workflow executed successfully': '워크플로우가 성공적으로 실행되었습니다',
    'Error': '오류', 'Warning': '경고', 'Success': '성공', 'Loading': '로딩 중', 'Logs': '로그',
    'Clear execution': '실행 지우기', 'Read our docs': '문서 보기',
    'Copy': '복사', 'Paste': '붙여넣기', 'Edit': '편집', 'Add': '추가', 'Remove': '제거',

    // 트리거 선택 패널
    'What triggers this workflow?': '이 워크플로우를 무엇이 시작하나요?',
    'Trigger manually': '수동으로 시작', 'On app event': '앱 이벤트로', 'On webhook call': '웹훅 호출로',
    'On form submission': '폼 제출로', 'On chat message': '채팅 메시지로',
    'When chat message received': '채팅 메시지 수신 시',
    'Other ways…': '다른 방법…', 'Other ways...': '다른 방법...',
    'Add another trigger': '트리거 추가', 'Add Trigger': '트리거 추가',
    // 노드 검색/카테고리
    'What happens next?': '다음에 무엇을 하나요?', 'Search nodes...': '노드 검색...', 'Search nodes…': '노드 검색…',
    'Recommended': '추천', 'Action in an app': '앱에서 동작', 'Data transformation': '데이터 변환',
    'Flow': '흐름', 'Core': '코어', 'Files': '파일', 'Advanced AI': '고급 AI', 'Human in the loop': '사람 개입',
    'Triggers': '트리거', 'Actions': '동작', 'Add Action': '동작 추가', 'No results': '결과 없음',
    // 자주 쓰는 노드
    'Schedule Trigger': '스케줄 트리거', 'Webhook': '웹훅', 'HTTP Request': 'HTTP 요청',
    'Respond to Webhook': '웹훅 응답', 'Edit Fields (Set)': '필드 편집(Set)', 'Edit Fields': '필드 편집',
    'Code': '코드', 'If': '조건(IF)', 'Switch': '스위치', 'Merge': '병합', 'Filter': '필터',
    'Loop Over Items (Split in Batches)': '항목 반복(배치 분할)', 'Loop Over Items': '항목 반복',
    'Wait': '대기', 'No Operation, do nothing': '아무 작업 안 함', 'No Operation': '작업 없음',
    'Aggregate': '집계', 'Summarize': '요약', 'Sort': '정렬', 'Limit': '제한', 'Remove Duplicates': '중복 제거',
    'Date & Time': '날짜 및 시간', 'Compare Datasets': '데이터셋 비교', 'Split Out': '분리',
    'Markdown': '마크다운', 'Crypto': '암호화', 'Compression': '압축',
    'Convert to File': '파일로 변환', 'Extract from File': '파일에서 추출',
    'Read/Write Files from Disk': '디스크 파일 읽기/쓰기', 'Send Email': '이메일 보내기',
    'Email Trigger (IMAP)': '이메일 트리거(IMAP)', 'Execute Command': '명령 실행',
    'Execute Workflow': '워크플로우 실행', 'Execute Sub-workflow': '하위 워크플로우 실행',
    'AI Agent': 'AI 에이전트', 'Basic LLM Chain': '기본 LLM 체인', 'Google Sheets': '구글 시트',
    // 노드 매개변수
    'Resource': '리소스', 'Operation': '작업', 'Options': '옵션', 'Add Option': '옵션 추가',
    'Add Field': '필드 추가', 'Add Value': '값 추가', 'Add Condition': '조건 추가', 'Add Header': '헤더 추가',
    'Fields to Set': '설정할 필드', 'Keep Only Set': '설정한 값만 유지', 'Include Other Input Fields': '다른 입력 필드 포함',
    'Send Headers': '헤더 전송', 'Send Body': '본문 전송', 'Header Parameters': '헤더 파라미터',
    'Body': '본문', 'Body Content Type': '본문 콘텐츠 유형', 'Specify Body': '본문 지정', 'Headers': '헤더',
    'Response': '응답', 'Conditions': '조건', 'Combine': '결합', 'Mode': '모드',
    'Expression': '표현식', 'Fixed': '고정값',
    'Continue On Fail': '실패해도 계속', 'Always Output Data': '항상 데이터 출력', 'Execute Once': '한 번만 실행',
    'Retry On Fail': '실패 시 재시도', 'On Error': '오류 시', 'Notes': '메모',
    // 스케줄 트리거
    'Trigger Rules': '트리거 규칙', 'Trigger Interval': '트리거 주기', 'Seconds': '초', 'Minutes': '분',
    'Hours': '시간', 'Days': '일', 'Weeks': '주', 'Months': '개월',
    'Trigger at Hour': '실행 시(시각)', 'Trigger at Minute': '실행 분', 'Trigger on Weekdays': '실행 요일',
    'Cron Expression': 'Cron 표현식', 'Custom (Cron)': '사용자 지정(Cron)', 'Add Rule': '규칙 추가',
    'Seconds Between Triggers': '트리거 간격(초)',
    // 실행/패널
    'Execution': '실행', 'Running': '실행 중', 'Succeeded': '성공', 'Failed': '실패', 'Waiting': '대기 중',
    'Canceled': '취소됨', 'Pin data': '데이터 고정', 'Unpin': '고정 해제', 'Edit Output': '출력 편집',
    'Run': '실행', 'Copy to editor': '편집기로 복사', 'Auto refresh': '자동 새로고침'
  };

  // 번역 제외: 데이터/JSON/코드/표현식/입출력 패널 (사용자 데이터 보호 + 성능)
  var SKIP_TAG = /^(SCRIPT|STYLE|TEXTAREA|INPUT|CODE|PRE|SELECT|OPTION|SVG|PATH)$/;
  var SKIP_CONTAINER = /(run-data|ndv|json|data-display|output|input-panel|el-table|code-editor|cm-editor|monaco|expression|parameter-input|resource-mapper|CodeMirror)/i;
  var MAX_NODES = 1500; // 한 번 처리 상한

  var enabled = localStorage.getItem('n8nKo') !== 'off';
  var observer = null, queue = [], scheduled = false;

  function inSkippedContainer(el) {
    for (var p = el; p && p !== document.body; p = p.parentElement) {
      var c = p.className;
      if (typeof c === 'string' && SKIP_CONTAINER.test(c)) return true;
    }
    return false;
  }

  function translateEl(root) {
    if (!root || root.nodeType !== 1) {
      // 텍스트 노드면 부모 기준 처리
      if (root && root.nodeType === 3) return translateTextNode(root);
      return;
    }
    if (SKIP_TAG.test(root.tagName) || inSkippedContainer(root)) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n, count = 0;
    while ((n = walker.nextNode()) && count < MAX_NODES) { count++; translateTextNode(n); }
    try {
      var els = root.querySelectorAll('[placeholder],[title],[aria-label]');
      for (var i = 0; i < els.length && i < MAX_NODES; i++) {
        if (inSkippedContainer(els[i])) continue;
        ['placeholder', 'title', 'aria-label'].forEach(function (a) {
          var v = els[i].getAttribute(a);
          if (v && KO[v.trim()]) els[i].setAttribute(a, KO[v.trim()]);
        });
      }
    } catch (e) {}
  }

  function translateTextNode(node) {
    var p = node.parentElement;
    if (!p || SKIP_TAG.test(p.tagName) || p.isContentEditable || inSkippedContainer(p)) return;
    var key = node.nodeValue.trim();
    if (key && KO[key] && node.nodeValue.indexOf(KO[key]) === -1) {
      node.nodeValue = node.nodeValue.replace(key, KO[key]);
    }
  }

  function flush() {
    scheduled = false;
    if (!enabled || !observer) return;
    observer.disconnect();              // 적용 중 자기 호출 방지
    try {
      var items = queue; queue = [];
      for (var i = 0; i < items.length; i++) translateEl(items[i]);
    } catch (e) {}
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (window.requestIdleCallback || window.setTimeout)(flush, 300);
  }

  function start() {
    translateEl(document.body);
    observer = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) queue.push(added[j]);
      }
      if (queue.length) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function makeButton() {
    var b = document.createElement('button');
    b.id = 'n8n-ko-toggle';
    b.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;padding:7px 12px;' +
      'border-radius:18px;border:1px solid #d0d0d0;background:#fff;cursor:pointer;font-size:13px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.18);';
    b.textContent = enabled ? '🇰🇷 한글 ON' : '🇰🇷 한글 OFF';
    b.title = '클릭하면 n8n 화면 한글 표시를 켜고 끕니다';
    b.onclick = function () {
      enabled = !enabled;
      localStorage.setItem('n8nKo', enabled ? 'on' : 'off');
      location.reload();
    };
    document.body.appendChild(b);
  }

  function init() {
    if (!document.body) { setTimeout(init, 100); return; }
    makeButton();
    if (enabled) start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
