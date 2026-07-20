import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  avatar?: string;   // optional avatar URL for join/leave toasts
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number, avatar?: string) => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });

export const useToast = () => useContext(ToastContext);

const TOAST_ICONS: Record<ToastType, React.ReactNode> = {
  success: (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  info: (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  warning: (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

const TYPE_STYLES: Record<ToastType, string> = {
  success: 'bg-emerald-500/15 border-emerald-500/25 text-emerald-200',
  error: 'bg-red-500/15 border-red-500/25 text-red-200',
  info: 'bg-blue-500/15 border-blue-500/25 text-blue-200',
  warning: 'bg-amber-500/15 border-amber-500/25 text-amber-200',
};

const ACCENT_COLORS: Record<ToastType, string> = {
  success: 'bg-emerald-400',
  error: 'bg-red-400',
  info: 'bg-blue-400',
  warning: 'bg-amber-400',
};

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts(prev => prev.map(t => t.id === id ? { ...t, id: `removing-${t.id}` } : t));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== `removing-${id}`));
    }, 350);
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration: number = 4000, avatar?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const toast: Toast = { id, message, type, duration, avatar };

    setToasts(prev => {
      const next = [...prev, toast];
      if (next.length > 4) {
        const oldest = next[0];
        removeToast(oldest.id);
      }
      return next.slice(-4);
    });

    const timer = setTimeout(() => removeToast(id), duration);
    timers.current.set(id, timer);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast Container */}
      <div className="fixed top-5 right-5 z-[9999] flex flex-col gap-2.5 pointer-events-none max-w-[380px]">
        {toasts.map((toast) => {
          const isRemoving = toast.id.startsWith('removing-');
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-2xl shadow-2xl cursor-pointer transition-all relative
                ${TYPE_STYLES[toast.type]}
                ${isRemoving ? 'toast-exit' : 'toast-enter'}
              `}
              onClick={() => removeToast(isRemoving ? toast.id.replace('removing-', '') : toast.id)}
            >
              {/* Accent bar */}
              <div className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full ${ACCENT_COLORS[toast.type]}`} />
              
              {/* Avatar or Icon */}
              {toast.avatar ? (
                <img 
                  src={toast.avatar} 
                  alt="" 
                  className="w-7 h-7 rounded-full object-cover flex-shrink-0 ml-1 border border-white/10" 
                />
              ) : (
                <div className="ml-1">
                  {TOAST_ICONS[toast.type]}
                </div>
              )}
              
              <span className="text-sm font-medium leading-snug">{toast.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};
