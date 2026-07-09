export function Placeholder({ title, wireframe }: { title: string; wireframe: string }) {
  return (
    <div className="card">
      <h1 style={{ fontFamily: 'var(--display)', fontSize: 22, margin: '0 0 8px' }}>{title}</h1>
      <p style={{ color: 'var(--text-faint)', fontSize: 13.5, margin: 0 }}>
        Routing scaffold only — full UI still needs to be ported from{' '}
        <code style={{ fontFamily: 'var(--mono)' }}>wireframes/{wireframe}</code>.
      </p>
    </div>
  );
}
