const TONE_CLASS = {
  green: 'badge-green',
  amber: 'badge-amber',
  red: 'badge-red',
  gray: 'badge-gray',
  blue: 'badge-blue',
};

// 색상만으로 상태를 전달하지 않도록 항상 글자(children)와 함께 쓴다.
export default function StatusBadge({ tone, children }) {
  return <span className={`badge ${TONE_CLASS[tone] || 'badge-gray'}`}>{children}</span>;
}
