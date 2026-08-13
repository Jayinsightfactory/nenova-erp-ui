import Input from './Input';
import Button from './Button';
import StatusBadge from './StatusBadge';

// PC: 기존 .filter-bar 조밀한 ERP 스타일 그대로. 모바일(<=768px): 줄바꿈 + 각 컨트롤 폭 100%·44px 터치 대상.
export default function Toolbar({ company, rootFolder, query, onQueryChange, disabledReasons, connected }) {
  return (
    <div className="filter-bar moyi-toolbar" aria-label="Drive 도구">
      <span className="filter-label">회사</span>
      <span className="moyi-company-value">{company?.name}</span>
      <span className="moyi-folder-value">폴더: {rootFolder?.name || '연결대기'}</span>
      <Input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="파일 이름 검색"
        ariaLabel="파일 이름 검색"
        className="moyi-search-input"
      />
      <Button disabled reason={disabledReasons?.upload}>파일 올리기</Button>
      <Button disabled reason={disabledReasons?.classify}>분류 확인</Button>
      <StatusBadge tone={connected ? 'green' : 'amber'}>{connected ? '실제 원장 조회' : '연결 대기'}</StatusBadge>
      <style jsx>{`
        .moyi-search-input { min-width: 220px; }
        .moyi-company-value { font-size: 12px; font-weight: bold; padding: 0 4px; white-space: nowrap; }
        .moyi-folder-value { font-size: 12px; color: var(--text3); padding: 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
        @media (max-width: 768px) {
          .moyi-toolbar { align-items: stretch; }
          .moyi-toolbar :global(input),
          .moyi-toolbar :global(button) { min-height: 44px; width: 100%; }
          .moyi-search-input { min-width: 0 !important; }
          .moyi-company-value,
          .moyi-folder-value { max-width: none; white-space: normal; }
        }
      `}</style>
    </div>
  );
}
