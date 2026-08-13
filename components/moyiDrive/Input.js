// 기존 ERP .filter-input 스타일 재사용. 모바일에서는 폭을 강제로 고정하지 않는다(부모 CSS가 100%로 늘림).
export default function Input({ value, onChange, placeholder, ariaLabel, className = '', ...rest }) {
  return (
    <input
      className={`filter-input ${className}`.trim()}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
      {...rest}
    />
  );
}
