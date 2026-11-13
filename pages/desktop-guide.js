import WorkflowGuide from '../components/WorkflowGuide';

export default function DesktopGuide(){
  return <main style={{maxWidth:960,margin:'0 auto',padding:'24px 16px'}}>
    <h1 style={{fontSize:24}}>오늘의 내 업무 사용 가이드</h1>
    <p>개발요청과 개인 업무 달력을 확인하고, 시간표 입력과 PC 메모장 바로가기를 사용하는 방법입니다.</p>
    <WorkflowGuide workflowId="desktop-task-schedule" />
    <ol style={{lineHeight:2}}><li>홈에서 오늘 업무와 완료 수를 확인합니다.</li><li>시간표의 빈 시간을 눌러 반복 업무와 시간을 입력합니다.</li><li>데스크톱 메뉴 또는 웹 링크를 연결한 뒤 저장합니다.</li><li>업무 메모장에서는 바로가기와 완료 체크를 따로 사용합니다.</li><li>개발요청 게시판에서 작성·전체 보기로 이동하고 달력 날짜로 업무를 조회합니다.</li><li>본창을 닫아도 메모장은 유지됩니다. 메모장 위쪽 ↗ 버튼으로 홈을 다시 열고, 전체 종료 버튼으로 모든 창을 닫습니다.</li></ol>
    <p>시간은 한국 시간 기준이며, 시간이 되어도 메뉴가 자동으로 실행되지는 않습니다. 데스크톱 메뉴는 현재 계정에 허용된 메뉴만 열 수 있습니다.</p>
  </main>;
}
