Memoo Strimo
Desktop client for the open Stremio addon protocol built with Tauri 2, React, and Rust. Ships with no content or addons.

Note: The project is in its early development stages and still requires a significant amount of work to reach a fully stable release.

Getting Started
Development
Bash
pnpm install && pnpm tauri icon <logo.png> && pnpm tauri dev
Production Build
Bash
pnpm tauri build
Roadmap
Phase 1 (Current)
Cinemeta Integration: Browse and search capabilities.

Details Page: Comprehensive movie and show media info.

Addon Management: Install addons directly via URL.

Stream Engine: Parallel stream fetching, parsing, trust scoring, and ranking.

Playback: Built-in HTML5 media player.

User Data: Watchlist and "Continue Watching" tracking.

Customization & Safety: 5 visual themes and an integrated safety filter.

Phase 2 (Planned)
Advanced Playback: libmpv native player integration.

Torrent Support: Built-in torrent server sidecar.

External Integrations: Trakt and TMDB support.

Live Content: Live TV and EPG support.

Social & Sharing: Watch parties and casting.

Specialized Features: Anime room and a custom Theme Studio.
