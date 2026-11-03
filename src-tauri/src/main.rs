#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Phase 2 hooks: libmpv player, cast server, stremio-server sidecar.
fn main() { tauri::Builder::default().run(tauri::generate_context!()).expect("error while running Memoo Strimo"); }
