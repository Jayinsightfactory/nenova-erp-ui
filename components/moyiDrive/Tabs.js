// PC: 기존 .tabs/.tab-item 조밀한 ERP 스타일 그대로.
// 모바일(<=768px): 가로 스크롤 + 안내 문구, 터치 대상 44px, 키보드 focus-visible.
export default function Tabs({ tabs, activeKey, onSelect }) {
  return (
    <div className="moyi-tabs-wrap">
      <div className="tabs" role="tablist" aria-label="Drive 관리 항목">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeKey === tab.key}
            aria-controls={`moyi-panel-${tab.key}`}
            id={`moyi-tab-${tab.key}`}
            className={`tab-item ${activeKey === tab.key ? 'active' : ''}`}
            onClick={() => onSelect(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <span className="moyi-tabs-hint">옆으로 밀어 더 보기</span>
      <style jsx>{`
        .moyi-tabs-wrap { position: relative; }
        .moyi-tabs-hint {
          position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);
        }
        @media (max-width: 768px) {
          .tabs :global(.tab-item) {
            min-height: 44px; min-width: 44px;
            display: inline-flex; align-items: center; white-space: nowrap;
          }
          .tabs { overflow-x: auto; -webkit-overflow-scrolling: touch; flex-wrap: nowrap; }
          .moyi-tabs-hint {
            position: static; display: block; width: auto; height: auto; overflow: visible; clip: auto;
            font-size: 10px; color: var(--text3); padding: 2px 4px 4px;
          }
        }
        .tabs :global(.tab-item:focus-visible) { outline: 2px solid var(--blue); outline-offset: -2px; }
      `}</style>
    </div>
  );
}
