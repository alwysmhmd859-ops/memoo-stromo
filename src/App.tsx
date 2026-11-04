import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { catalog, loadAddon, meta, streams, type Meta, type Stream } from "./lib/stremio";
import { getPos, savePos, fmt } from "./lib/progress";
import { rank, type Ranked } from "./lib/rank";
import { useStore } from "./lib/store";

type View = "home" | "movies" | "shows" | "library" | "addons" | "settings";
const NAV: [View, string][] = [["home", "Home"], ["movies", "Movies"], ["shows", "Shows"], ["library", "Library"], ["addons", "Addons"], ["settings", "Settings"]];
const THEMES = ["memoo", "nord", "dracula", "forest", "noir"];

function Grid({ items, open }: { items: Meta[]; open: (m: Meta) => void }) {
  if (!items.length) return <p className="empty">Nothing here yet.</p>;
  return <div className="grid">{items.map(m => (
    <button key={m.id} className="card" onClick={() => open(m)}>
      {m.poster ? <img src={m.poster} alt="" loading="lazy" /> : <div className="ph" />}
      <span>{m.name}</span>
    </button>))}</div>;
}

export default function App() {
  const [st, up] = useStore();
  const [view, setView] = useState<View>("home");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Meta[]>([]);
  const [sel, setSel] = useState<Meta | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (view === "movies" || view === "shows" || view === "home") {
      setErr("");
      catalog(view === "shows" ? "series" : "movie", q || undefined).then(setItems).catch(e => setErr(String(e)));
    }
  }, [view, q]);

  return (
    <div className="app">
      <aside>
        <h1>Memoo<br />Strimo</h1>
        <nav>{NAV.map(([v, l]) => <button key={v} className={view === v ? "on" : ""} onClick={() => { setView(v); setSel(null); }}>{l}</button>)}</nav>
      </aside>
      <main>
        {sel ? <Detail m={sel} st={st} up={up} back={() => setSel(null)} /> : <>
          {["home", "movies", "shows"].includes(view) && <>
            <input className="search" placeholder="Search titles" value={q} onChange={e => setQ(e.target.value)} />
            {err && <p className="err">Could not load the catalog: {err}</p>}
            <Grid items={items} open={setSel} />
          </>}
          {view === "library" && <>
            <h2>Watchlist</h2><Grid items={st.watchlist} open={setSel} />
            <h2>Continue watching</h2><Grid items={st.history} open={setSel} />
          </>}
          {view === "addons" && <Addons st={st} up={up} />}
          {view === "settings" && <section>
            <h2>Theme</h2><div className="row">{THEMES.map(t => <button key={t} className={st.theme === t ? "on" : ""} onClick={() => up({ theme: t })}>{t}</button>)}</div>
            <h2>Stream safety filter</h2><div className="row">{(["strict", "balanced", "off"] as const).map(s => <button key={s} className={st.safety === s ? "on" : ""} onClick={() => up({ safety: s })}>{s}</button>)}</div>
          </section>}
        </>}
      </main>
    </div>
  );
}

function Addons({ st, up }: { st: ReturnType<typeof useStore>[0]; up: ReturnType<typeof useStore>[1] }) {
  const [url, setUrl] = useState(""); const [msg, setMsg] = useState("");
  const add = async () => {
    try { const a = await loadAddon(url); up({ addons: [...st.addons.filter(x => x.base !== a.base), a] }); setUrl(""); setMsg(`Installed ${a.name}`); }
    catch { setMsg("Could not read that manifest. Check the addon URL."); }
  };
  return <section>
    <h2>Add an addon</h2>
    <div className="row"><input className="search" placeholder="https://…/manifest.json or stremio://…" value={url} onChange={e => setUrl(e.target.value)} /><button onClick={add}>Install</button></div>
    {msg && <p>{msg}</p>}
    <h2>Installed</h2>
    {st.addons.length === 0 && <p className="empty">No addons installed. Memoo Strimo ships none; bring your own.</p>}
    {st.addons.map(a => <div key={a.base} className="row item"><b>{a.name}</b><small>{a.resources.join(", ")}</small>
      <button onClick={() => up({ addons: st.addons.filter(x => x.base !== a.base) })}>Remove</button></div>)}
  </section>;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const magnetOf = (s: Stream) => {
  const tr = (s.sources ?? []).filter(x => x.startsWith("tracker:")).map(x => "&tr=" + encodeURIComponent(x.slice(8))).join("");
  return `magnet:?xt=urn:btih:${s.infoHash}${tr}`;
};

function Detail({ m, st, up, back }: { m: Meta; st: ReturnType<typeof useStore>[0]; up: ReturnType<typeof useStore>[1]; back: () => void }) {
  const [full, setFull] = useState<Meta>(m);
  const [raw, setRaw] = useState<any[]>([]);
  const [ep, setEp] = useState<string>(m.id);
  const [web, setWeb] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const saved = st.watchlist.some(x => x.id === m.id);
  const resume = getPos(ep);
  useEffect(() => { meta(m.type, m.id).then(setFull).catch(() => {}); }, [m]);
  useEffect(() => { setRaw([]); streams(st.addons, m.type, ep, s => setRaw(r => [...r, ...s])); }, [ep, st.addons, m]);
  useEffect(() => {
    if (!isTauri) return;
    let un: (() => void) | undefined;
    listen<{ pos: number; dur: number }>("mpv-progress", e => savePos(ep, e.payload.pos, e.payload.dur)).then(f => { un = f; });
    return () => un?.();
  }, [ep]);
  const ranked: Ranked[] = useMemo(() => rank(raw, st.safety), [raw, st.safety]);
  const eps = (full.videos ?? []).filter(v => v.season);

  async function start(s: Ranked) {
    try {
      let url = s.url;
      if (!url && s.infoHash) {
        if (!isTauri) throw new Error("Torrent streams need the desktop app.");
        setBusy("Fetching torrent metadata, this can take a minute…");
        url = await invoke<string>("torrent_stream", { magnet: magnetOf(s), fileIdx: s.fileIdx ?? null });
      }
      if (!url) throw new Error("This source has no playable link.");
      up({ history: [m, ...st.history.filter(x => x.id !== m.id)].slice(0, 30) });
      if (isTauri) {
        const headers = Object.entries(s.behaviorHints?.proxyHeaders?.request ?? {}).map(([k, v]) => `${k}: ${v}`);
        await invoke("play", { url, title: full.name, start: resume, headers });
        setBusy("");
      } else { setWeb(url); setBusy(""); }
    } catch (e) { setBusy(String(e)); }
  }

  return <article className="detail" style={full.background ? { backgroundImage: `linear-gradient(var(--bg-a),var(--bg)), url(${full.background})` } : undefined}>
    <button onClick={back}>Back</button>
    <h2>{full.name} <small>{full.releaseInfo ?? full.year} {full.imdbRating && `· IMDb ${full.imdbRating}`}</small></h2>
    <p>{full.description}</p>
    <div className="row"><button onClick={() => up({ watchlist: saved ? st.watchlist.filter(x => x.id !== m.id) : [m, ...st.watchlist] })}>{saved ? "Remove from watchlist" : "Add to watchlist"}</button>
      {resume > 0 && <small>Resumes from {fmt(resume)}</small>}</div>
    {eps.length > 0 && <select value={ep} onChange={e => setEp(e.target.value)}>{eps.map(v => <option key={v.id} value={v.id}>S{v.season}E{v.episode} {v.title ?? v.name}</option>)}</select>}
    {busy && <p className="status">{busy}</p>}
    {web && <video src={web} controls autoPlay className="player" />}
    <h3>Streams</h3>
    {st.addons.length === 0 && <p className="empty">Install a stream addon in Addons to see sources.</p>}
    {ranked.map((s, i) => <div key={i} className="row item">
      <span className="tags">{s.tags.map(t => <i key={t}>{t}</i>)}{s.infoHash && !s.url && <i>P2P</i>}</span>
      <small>{(s.title ?? s.description ?? s.name ?? "").split("\n")[0]}</small>
      {s.url || s.infoHash ? <button onClick={() => start(s)}>Play</button> : <small>External</small>}
    </div>)}
  </article>;
}
