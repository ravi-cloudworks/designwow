import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; type: ToastType };

const ToastContext = createContext<{ showToast: (message: string, type?: ToastType) => void } | null>(null);

let nextId = 0;

const TOAST_STYLES: Record<ToastType, { bg: string; color: string; border: string }> = {
  success: { bg: 'var(--moss-soft)', color: 'var(--moss)', border: 'var(--moss-line)' },
  error: { bg: 'var(--crimson-soft)', color: 'var(--crimson)', border: 'var(--crimson-line)' },
  info: { bg: 'var(--teal-soft)', color: 'var(--teal)', border: 'var(--teal-line)' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column-reverse',
          alignItems: 'center',
          gap: 8,
          zIndex: 2000,
          maxWidth: 340,
        }}
      >
        {toasts.map((t) => {
          const style = TOAST_STYLES[t.type];
          return (
            <div
              key={t.id}
              className="toast"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '11px 14px',
                borderRadius: 8,
                fontSize: 13.5,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 6px 20px rgba(20, 22, 27, 0.18)',
                background: style.bg,
                color: style.color,
                border: `1px solid ${style.border}`,
              }}
            >
              {t.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
