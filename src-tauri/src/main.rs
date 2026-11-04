#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct Rq(Mutex<Option<Child>>);
const RQ: &str = "127.0.0.1:3030";

fn res(app: &AppHandle, name: &str) -> PathBuf {
    let mut c: Vec<PathBuf> = vec![];
    if let Ok(d) = app.path().resource_dir() {
        c.push(d.join("resources").join(name));
        c.push(d.join(name));
    }
    c.push(PathBuf::from("src-tauri/resources").join(name));
    c.push(PathBuf::from("resources").join(name));
    c.into_iter().find(|p| p.exists()).unwrap_or_else(|| PathBuf::from(name))
}

fn is_video(n: &str) -> bool {
    let n = n.to_lowercase();
    ["mkv", "mp4", "avi", "mov", "webm", "m4v", "ts", "m2ts", "wmv", "flv"].iter().any(|e| n.ends_with(&format!(".{e}")))
}

fn get_json(path: &str) -> Result<Value, String> {
    let r = ureq::get(&format!("http://{RQ}{path}")).timeout(Duration::from_secs(15)).call().map_err(|e| e.to_string())?;
    serde_json::from_str(&r.into_string().map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

// Plays any URL in mpv (separate window) and reports progress back to the UI.
#[tauri::command]
async fn play(app: AppHandle, url: String, title: String, start: f64, headers: Vec<String>) -> Result<(), String> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let pipe = format!(r"\\.\pipe\memoo-mpv-{stamp}");
    let mut cmd = Command::new(res(&app, "mpv.exe"));
    cmd.args(["--force-window=yes", "--keep-open=no", "--hwdec=auto-safe", "--sub-auto=fuzzy", "--cache=yes", "--demuxer-max-bytes=150MiB"])
        .arg(format!("--title={title}"))
        .arg(format!("--input-ipc-server={pipe}"));
    if start > 5.0 { cmd.arg(format!("--start={start}")); }
    if !headers.is_empty() { cmd.arg(format!("--http-header-fields={}", headers.join(","))); }
    cmd.arg("--").arg(&url);
    let mut child = cmd.spawn().map_err(|e| format!("Could not start mpv: {e}"))?;
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut file = None;
        for _ in 0..50 {
            if let Ok(f) = std::fs::OpenOptions::new().read(true).write(true).open(&pipe) { file = Some(f); break; }
            std::thread::sleep(Duration::from_millis(200));
        }
        let (mut pos, mut dur, mut last) = (0.0_f64, 0.0_f64, -1_i64);
        if let Some(mut f) = file {
            let _ = writeln!(f, "{}", json!({"command":["observe_property", 1, "time-pos"]}));
            let _ = writeln!(f, "{}", json!({"command":["observe_property", 2, "duration"]}));
            for line in BufReader::new(f).lines() {
                let Ok(line) = line else { break };
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                if v["event"] == "property-change" {
                    match v["name"].as_str() {
                        Some("time-pos") => { if let Some(p) = v["data"].as_f64() { pos = p; } }
                        Some("duration") => { if let Some(d) = v["data"].as_f64() { dur = d; } }
                        _ => {}
                    }
                    if dur > 0.0 && pos as i64 != last {
                        last = pos as i64;
                        let _ = app2.emit("mpv-progress", json!({"pos": pos, "dur": dur}));
                    }
                }
            }
        }
        let _ = child.wait();
        let _ = app2.emit("mpv-ended", json!({"pos": pos, "dur": dur}));
    });
    Ok(())
}

// Starts the bundled torrent engine (rqbit) on first use and returns a local HTTP stream URL.
#[tauri::command]
async fn torrent_stream(app: AppHandle, st: State<'_, Rq>, magnet: String, file_idx: Option<usize>) -> Result<String, String> {
    {
        let mut g = st.0.lock().map_err(|e| e.to_string())?;
        if g.is_none() {
            let exe = res(&app, "rqbit.exe");
            if !exe.exists() { return Err("The torrent engine (rqbit.exe) is not bundled in this build.".into()); }
            let dir = std::env::temp_dir().join("memoo-strimo-torrents");
            let mut c = Command::new(exe);
            c.arg("server").arg("start").arg(dir);
            #[cfg(windows)]
            c.creation_flags(0x08000000);
            *g = Some(c.spawn().map_err(|e| format!("Could not start the torrent engine: {e}"))?);
        }
    }
    let mut up = false;
    for _ in 0..40 {
        match ureq::get(&format!("http://{RQ}/")).timeout(Duration::from_secs(2)).call() {
            Ok(_) | Err(ureq::Error::Status(_, _)) => { up = true; break; }
            Err(_) => std::thread::sleep(Duration::from_millis(250)),
        }
    }
    if !up { return Err("The torrent engine did not start.".into()); }

    let hash = magnet.split("btih:").nth(1).and_then(|s| s.split('&').next()).unwrap_or("").to_lowercase();
    let added = ureq::post(&format!("http://{RQ}/torrents?overwrite=true")).timeout(Duration::from_secs(120)).send_string(&magnet);
    let v: Value = match added {
        Ok(r) => serde_json::from_str(&r.into_string().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?,
        Err(_) => get_json(&format!("/torrents/{hash}"))?,
    };
    let id = v["id"].as_u64().map(|n| n.to_string()).unwrap_or(hash);
    let files = v["details"]["files"].as_array().or_else(|| v["files"].as_array());
    let idx = match file_idx {
        Some(i) => i,
        None => files
            .and_then(|f| f.iter().enumerate()
                .filter(|(_, x)| is_video(x["name"].as_str().unwrap_or("")))
                .max_by_key(|(_, x)| x["length"].as_u64().unwrap_or(0))
                .map(|(i, _)| i))
            .unwrap_or(0),
    };
    Ok(format!("http://{RQ}/torrents/{id}/stream/{idx}"))
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Rq(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![play, torrent_stream])
        .build(tauri::generate_context!())
        .expect("error while building Memoo Strimo");
    app.run(|h, e| {
        if let tauri::RunEvent::Exit = e {
            if let Some(rq) = h.try_state::<Rq>() {
                if let Ok(mut g) = rq.0.lock() { if let Some(mut c) = g.take() { let _ = c.kill(); } }
            }
        }
    });
}
