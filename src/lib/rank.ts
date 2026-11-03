import type { Stream } from "./stremio";
export type Ranked = Stream & { score: number; tags: string[] };

// parse -> trust -> score -> rank
export function rank(list: Stream[], safety: "strict" | "balanced" | "off"): Ranked[] {
  const out: Ranked[] = [];
  for (const s of list) {
    const t = `${s.name ?? ""} ${s.title ?? ""} ${s.description ?? ""}`.toLowerCase();
    const tags: string[] = []; let score = 0;
    const cam = /\b(cam|hdcam|ts|telesync|telecine|hdts)\b/.test(t);
    const junk = /\b(sample|trailer)\b/.test(t) || (!s.url && !s.infoHash && !s.externalUrl);
    if (safety !== "off" && junk) continue;
    if (safety === "strict" && cam) continue;
    const [res, pts] = /2160p|4k|uhd/.test(t) ? ["4K", 40] : /1080p/.test(t) ? ["1080p", 30] : /720p/.test(t) ? ["720p", 20] : ["SD", 5];
    tags.push(res as string); score += pts as number;
    if (/dolby.?vision|\bdv\b/.test(t)) { tags.push("DV"); score += 12; } else if (/hdr/.test(t)) { tags.push("HDR"); score += 8; }
    if (/remux/.test(t)) { tags.push("REMUX"); score += 10; } else if (/blu-?ray/.test(t)) score += 6; else if (/web-?dl|webrip/.test(t)) score += 4;
    if (/atmos|truehd|dts-hd/.test(t)) { tags.push("Lossless"); score += 5; }
    if (/\+\]|⚡|cached/.test(t)) { tags.push("Cached"); score += 25; }
    const seeds = Number(/👤\s*(\d+)/.exec(t)?.[1] ?? 0);
    score += Math.min(10, Math.log10(seeds + 1) * 4);
    if (cam) { tags.push("CAM"); score -= 50; }
    out.push({ ...s, score: Math.round(score), tags });
  }
  return out.sort((a, b) => b.score - a.score);
}
