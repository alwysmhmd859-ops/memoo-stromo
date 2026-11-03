export type Meta = { id: string; type: string; name: string; poster?: string; background?: string; description?: string; year?: string; releaseInfo?: string; imdbRating?: string; genres?: string[]; videos?: { id: string; season?: number; episode?: number; title?: string; name?: string }[] };
export type Stream = { name?: string; title?: string; description?: string; url?: string; infoHash?: string; externalUrl?: string };
export type Addon = { base: string; name: string; resources: string[]; types: string[] };

export const CINEMETA = "https://v3-cinemeta.strem.io";
const norm = (u: string) => u.trim().replace(/^stremio:\/\//, "https://").replace(/\/manifest\.json$/, "").replace(/\/$/, "");
const get = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

export async function loadAddon(url: string): Promise<Addon> {
  const base = norm(url);
  const m = await get<any>(`${base}/manifest.json`);
  const resources = (m.resources ?? []).map((r: any) => (typeof r === "string" ? r : r.name));
  return { base, name: m.name ?? base, resources, types: m.types ?? [] };
}
export const catalog = async (type: string, search?: string): Promise<Meta[]> =>
  (await get<{ metas: Meta[] }>(`${CINEMETA}/catalog/${type}/top${search ? `/search=${encodeURIComponent(search)}` : ""}.json`)).metas;
export const meta = async (type: string, id: string): Promise<Meta> =>
  (await get<{ meta: Meta }>(`${CINEMETA}/meta/${type}/${id}.json`)).meta;

// Ask every installed addon in parallel; results stream in as each one answers.
export function streams(addons: Addon[], type: string, id: string, onPart: (s: Stream[]) => void) {
  return Promise.allSettled(
    addons.filter(a => a.resources.includes("stream")).map(async a => {
      const r = await get<{ streams: Stream[] }>(`${a.base}/stream/${type}/${encodeURIComponent(id)}.json`);
      onPart(r.streams ?? []);
    })
  );
}
