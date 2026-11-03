import { useEffect, useState } from "react";
import type { Addon, Meta } from "./stremio";

export type State = { addons: Addon[]; watchlist: Meta[]; history: Meta[]; theme: string; safety: "strict" | "balanced" | "off" };
const KEY = "memoo-strimo/v1";
const init: State = { addons: [], watchlist: [], history: [], theme: "memoo", safety: "strict" };

export function useStore() {
  const [s, set] = useState<State>(() => { try { return { ...init, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return init; } });
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} document.documentElement.dataset.theme = s.theme; }, [s]);
  return [s, (p: Partial<State>) => set(x => ({ ...x, ...p }))] as const;
}
