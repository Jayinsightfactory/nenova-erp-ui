// lib/moyiDriveViewModel.js mapPermissionRowView() 출력 전용.
// backend ACL 조회 API가 아직 없어 pages/integrations/moyi-drive.js 에서는 아직 호출하지 않지만,
// docs/contract-drafts/moyi-drive-permission.draft.json 계약이 배포되면 그대로 연결한다.
export default function PermissionRow({ row }) {
  return (
    <tr>
      <td className="name">{row.subject}{row.subjectType ? ` · ${row.subjectType}` : ''}</td>
      <td>{row.scope}</td>
      {row.actions.map((action) => (
        <td key={action.key} className={`moyi-permission-${action.state}`}>{action.label}</td>
      ))}
      <style jsx>{`
        .moyi-permission-denied { color: var(--red); font-weight: bold; }
        .moyi-permission-allowed { color: var(--green); }
        .moyi-permission-inherited { color: var(--text2); }
        .moyi-permission-unknown { color: var(--text3); font-style: italic; }
      `}</style>
    </tr>
  );
}
