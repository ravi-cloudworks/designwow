export function Avatar({ name, avatarUrl, size = 38 }: { name: string; avatarUrl?: string | null; size?: number }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(160deg, var(--teal), #0e463d)',
        color: '#f0f6f4',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--display)',
        fontWeight: 700,
        fontSize: Math.round(size * 0.37),
        flex: 'none',
      }}
    >
      {initials}
    </div>
  );
}
