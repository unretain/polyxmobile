"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { X, Check, AlertCircle, Info } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now();
    setToasts((prev) => {
      const newToasts = [...prev, { id, message, type }];

      // Dynamic dismiss time based on toast count
      // 1 toast = 3s, 2 = 2s, 3 = 1.5s, 4+ = 1s
      const count = newToasts.length;
      const dismissTime = count <= 1 ? 3000 : count === 2 ? 2000 : count === 3 ? 1500 : 1000;

      setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
      }, dismissTime);

      return newToasts;
    });
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Toast container - top center */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-3 px-4 py-3 shadow-xl border-2 border-[#FF6B4A] bg-[#1a1a1a] text-white animate-in slide-in-from-top-5 fade-in duration-200"
          >
            {toast.type === "success" && <Check className="h-5 w-5 flex-shrink-0 text-[#FF6B4A]" />}
            {toast.type === "error" && <AlertCircle className="h-5 w-5 flex-shrink-0 text-[#FF6B4A]" />}
            {toast.type === "info" && <Info className="h-5 w-5 flex-shrink-0 text-[#FF6B4A]" />}
            <span className="text-sm font-medium">{toast.message}</span>
            <button
              onClick={() => dismissToast(toast.id)}
              className="ml-2 p-1 rounded hover:bg-white/20 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
