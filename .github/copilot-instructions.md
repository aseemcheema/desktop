# Atuin Desktop – AI agent working notes

Use these repo-specific guidelines to be immediately productive when proposing changes, generating code, or wiring features.

## Architecture and data flow
- App = React + Vite + TypeScript (frontend in `src/`) + Tauri v2 Rust backend (in `backend/`).
- Frontend ⇄ Backend bridge:
  - Call Rust with `@tauri-apps/api/core` `invoke("command_name", args)`.
  - Commands are annotated `#[tauri::command]` in Rust and registered in `backend/src/main.rs` `invoke_handler!(...)`.
  - Examples used today: `get_app_version`, `save_window_info`, `reset_workspaces`, `show_window`, PTY: `run::pty::{pty_open, pty_write, pty_resize, pty_kill, pty_list}`, SSH in `commands::ssh_pool::*`, block execution in `commands::blocks::*`.
- Backend plugins: `tauri-plugin-{http,fs,process,os,shell,dialog,opener,sql,log,updater,deep-link}` configured via `backend/tauri.conf.json`.
- HTTP to Atuin Hub: use `src/api/http.ts` (tauri plugin-http). It auto-adds `Atuin-Desktop-Version` and optional `Authorization: Bearer <token>` from `getHubApiToken()`.

## Dev, build, and tests (pnpm + Rust)
- Dev: prefer running the Tauri dev task (starts Vite and backend) — on Windows use:
  - `pnpm tauri dev`
  - The Bash helper `script/dev` is for Unix port juggling; not required on Windows.
- Build desktop app: `pnpm tauri build` (targets configured in `tauri.conf.json`).
- Frontend unit tests: `pnpm test` (Vitest). One-shot: `pnpm test-once`.
- Backend tests: `pnpm test-rs` (runs `cargo test` in `backend/`).
- Type bindings: when Rust types derive ts-rs, run `pnpm generate-bindings` (backed by a cargo test that exports TS to `rs-bindings/`).

## Project conventions and patterns
- State: global `zustand` store (`useStore`) holds app/session/query client; prefer selectors and actions over direct mutation.
- Data fetching: `@tanstack/react-query` is the standard (query client sourced from store). Use `src/api/http.ts` helpers (`get/post/put/del`) and handle `HttpResponseError`.
- Logging/telemetry:
  - Frontend: `src/tracking.ts` initializes Sentry/PostHog when allowed; avoid PII in events and check `usage_tracking` flags.
  - Backend: `tauri-plugin-log` writes to stdout and log dir; prefer structured errors via `eyre`/`thiserror`.
- UI: Tailwind + HeroUI + shadcn-style variants; CodeMirror for editors; components under `src/components/**` follow colocated styles and small presentational units.
- Resources: static assets shipped via custom `resources://` scheme (see `backend/src/main.rs` protocol handler and `bundle.resources` in `tauri.conf.json`).

## Runbooks, blocks, and execution
- Runbook execution flows live in backend under:
  - Runtime and PTY/process: `backend/src/run/**`, `backend/src/pty.rs`, `backend/src/commands/*`.
  - Database/blocks/migrations: `backend/migrations/**` applied at startup (`apply_runbooks_migrations`).
- Execute/cancel blocks from the frontend via Tauri commands in `commands::blocks::*`. Listen to lifecycle and app events via:
  - App window events: `@tauri-apps/api/event` (`tauri://focus|blur|close-requested`).
  - Grand Central events stream: `commands::events::subscribe_to_events` (types bridged via ts-rs into `rs-bindings/`).

## Adding features quickly (examples)
- New Rust command:
  1) Implement `#[tauri::command] async fn do_thing(args...) -> Result<T, String>` in `backend/src/commands/<area>.rs`.
  2) Register it in `backend/src/main.rs` `invoke_handler![..., do_thing, ...]`.
  3) Call from TS: `const res = await invoke<T>("do_thing", { /* args */ });`.
- New API call to Hub: add a helper in `src/api/*.ts` that wraps `http.get/post` and returns typed data; headers/version are handled for you.
- New runbook DB migration: create SQL in `backend/migrations/runbooks/` using sqlx format; it auto-runs on app startup.

## Platform and packaging notes
- Dev server runs on http://localhost:1420 by default (see `vite.config.ts` and `tauri.conf.json`). HMR is disabled for Tauri.
- Deep links: scheme `atuin://` is enabled via `tauri-plugin-deep-link`.
- Windows builds/package: MSI via WiX v3 is configured; updater is enabled (see `bundle.windows` and `plugins.updater`).

References for patterns: `src/main.tsx`, `src/api/http.ts`, `backend/src/main.rs`, `backend/src/commands/**`, `backend/src/run/**`, `backend/migrations/**`, `vite.config.ts`, `backend/tauri.conf.json`.
