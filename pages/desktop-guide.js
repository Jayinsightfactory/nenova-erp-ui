import WorkflowGuide from '../components/WorkflowGuide';

export default function DesktopGuide(){
  return <main style={{maxWidth:960,margin:'0 auto',padding:'24px 16px'}}>
    <h1 style={{fontSize:24}}>오늘의 내 업무 사용 가이드</h1>
    <p>상단 웹 개발요청, 큰 월간 달력과 하단 주간 시간표를 확인하고, 시간표 입력과 PC 메모장 바로가기를 사용하는 방법입니다.</p>
    <WorkflowGuide workflowId="desktop-task-schedule" />
    <ol style={{lineHeight:2}}><li>홈에서 오늘 업무와 상단 웹 개발요청 버튼을 확인합니다.</li><li>시간표의 빈 시간을 눌러 업무 입력 시간을 채웁니다.</li><li>업무명과 반복 설정을 입력하고 저장합니다.</li><li>좁은 PC 메모장에서 업무를 확인합니다.</li><li>메뉴를 검색해 바로가기를 연결합니다.</li><li>바로가기와 완료 체크를 따로 사용합니다.</li><li>월간 달력에서 날짜를 선택하고 하단 주간 시간표에서 시간을 선택합니다.</li><li>메모장 ↗ 버튼으로 홈을 다시 엽니다. 본창을 닫아도 메모장은 유지됩니다.</li><li>월 제목 옆 회사 공통 일정으로 전 직원이 함께 볼 일정을 등록합니다. 등록자와 관리자만 수정·삭제할 수 있습니다.</li><li>월간과 주간을 각각 접고 엽니다. 홈을 다시 열면 모두 펼쳐집니다.</li></ol>
    <p>시간은 한국 시간 기준이며, 시간이 되어도 메뉴가 자동으로 실행되지는 않습니다. 데스크톱 메뉴는 현재 계정에 허용된 메뉴만 열 수 있습니다.</p>
  </main>;
}
