const K = "memoo-strimo/progress";
type P = Record<string, { pos: number; dur: number }>;
const all = (): P => { try { return JSON.parse(localStorage.getItem(K) ?? "{}"); } catch { return {}; } };
export const getPos = (id: string): number => { const p = all()[id]; return p && p.dur && p.pos / p.dur < 0.95 ? p.pos : 0; };
export const savePos = (id: string, pos: number, dur: number) => { const a = all(); a[id] = { pos, dur }; try { localStorage.setItem(K, JSON.stringify(a)); } catch {} };
export const fmt = (s: number) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
