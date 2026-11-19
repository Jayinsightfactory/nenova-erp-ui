export const DESKTOP_DOWNLOAD_URL = 'https://github.com/Jayinsightfactory/nenova-erp-ui/releases/latest';

export default function DesktopDownloadButton({ fullWidth = false }) {
  return (
    <a
      href={DESKTOP_DOWNLOAD_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-sm"
      data-desktop-download
      aria-label="PC 버전 다운로드 — Windows 64비트 최신 릴리스"
      title="최신 Windows 64비트 설치 파일을 선택하세요"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: 5, minHeight: fullWidth ? 36 : 28, padding: '4px 10px',
        width: fullWidth ? '100%' : undefined, boxSizing: 'border-box',
        flexShrink: 0, whiteSpace: 'nowrap', textDecoration: 'none',
        background: '#EBF8FF', color: '#164e82', border: '1px solid #2b6cb0',
        borderRadius: 4, fontSize: 12, fontWeight: 600,
      }}
    >
      <span aria-hidden="true">↓</span> PC 버전 다운로드
    </a>
  );
}
