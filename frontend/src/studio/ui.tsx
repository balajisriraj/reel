import { type ReactNode, createContext, useCallback, useContext, useState } from "react";

// ---------------------------------------------------------------- icons (1.8px strokes, 20px box)

const P: Record<string, ReactNode> = {
  brief: <><path d="M5 4h10l4 4v12H5z" /><path d="M9 12h6M9 16h4M14 4v4h4" /></>,
  style: <><circle cx="12" cy="12" r="8" /><circle cx="9" cy="10" r="1.3" /><circle cx="14" cy="9" r="1.3" /><circle cx="15.5" cy="13.5" r="1.3" /><path d="M12 20a2 2 0 0 1 0-4h1" /></>,
  story: <><path d="M4 6h16M4 12h10M4 18h7" /><path d="m16 15 2 2 4-4" /></>,
  media: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="10" r="1.6" /><path d="m21 15-5-5-8 9" /></>,
  brand: <><path d="M12 3 4 7v5c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V7z" /><path d="m9 12 2 2 4-4" /></>,
  export: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></>,
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  spark: <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  upload: <><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" /><path d="M5 20h14" /></>,
  back: <path d="M15 5 8 12l7 7" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
  music: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  camera: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><circle cx="12" cy="12.5" r="3.5" /><path d="M8 6l1.5-2h5L16 6" /></>,
  voice: <><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></>,
};

export function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name]}
    </svg>
  );
}

export const Mark = ({ size = 26 }: { size?: number }) => (
  <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
    <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff8a3d" /><stop offset="1" stopColor="#ff3d6e" /></linearGradient></defs>
    <rect width="64" height="64" rx="16" fill="#1b1a20" />
    <circle cx="32" cy="32" r="17" fill="none" stroke="url(#rg)" strokeWidth="6" />
    <circle cx="32" cy="32" r="5" fill="url(#rg)" />
  </svg>
);

// ---------------------------------------------------------------- controls

export function Seg<T extends string | number>({ value, options, onChange, full }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; full?: boolean }) {
  return (
    <div className={`seg${full ? " full" : ""}`}>
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Toggle = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) => (
  <button className={`toggle${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
);

export const Section = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => (
  <div className="section">
    <h3>
      {title}
      <span className="grow" />
      {action}
    </h3>
    {children}
  </div>
);

export const Field = ({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) => (
  <label className="field" style={{ display: "block" }}>
    <span className="label">{label}</span>
    {children}
    {hint && <div className="hint">{hint}</div>}
  </label>
);

// ---------------------------------------------------------------- toasts

const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; bad: boolean; key: number } | null>(null);
  const show = useCallback((text: string, bad = false) => {
    const key = Date.now();
    setToast({ text, bad, key });
    setTimeout(() => setToast((t) => (t?.key === key ? null : t)), bad ? 5200 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={`toast${toast.bad ? " bad" : ""}`}>{toast.text}</div>}
    </ToastCtx.Provider>
  );
}

/** Beat colours for the timeline, stable per beat name. */
const BEAT_COLOURS = ["#ff8a3d", "#ff3d6e", "#a77bff", "#3db7ff", "#3ddc97", "#ffcf5a", "#ff7ad9", "#7ce0ff", "#c3f75c"];
export const beatColour = (beats: string[], beat: string) => BEAT_COLOURS[Math.max(0, beats.indexOf(beat)) % BEAT_COLOURS.length];
