export function Spinner() {
  return (
    <svg className="spinner" width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
