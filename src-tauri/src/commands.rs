//! Tauri commands. Thin: call the storage or audio layer on a blocking
//! thread and pass the error through as `{kind, message}`.
//!
//! File dialogs open here, on the Rust side. The webview never sends a path.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::audio::capture::input_device_names;
use crate::audio::{AudioState, Report, StreamInfo};
use crate::error::{AppError, AppResult, ErrorKind};
use crate::paths::recording_path;
use crate::storage::export::{self, ExportFormat};
use crate::storage::model::{NewResult, Profile, RecordingInfo, RestoreSummary, SavedResult};
use crate::storage::{DeleteReport, Storage, backup, db, recordings};

/// Run blocking work off the async runtime's threads.
async fn blocking<T, F>(work: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| AppError::new(ErrorKind::Io, format!("background task failed: {e}")))?
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Ask where to save. `None` when the person cancels.
fn ask_save_path(app: &AppHandle, file_name: &str, ext: &str) -> Option<PathBuf> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(file_name)
        .add_filter(ext.to_uppercase(), &[ext])
        .blocking_save_file()?;
    picked.into_path().ok()
}

/// Ask which file to open. `None` when the person cancels.
fn ask_open_path(app: &AppHandle, exts: &[&str]) -> Option<PathBuf> {
    let picked = app
        .dialog()
        .file()
        .add_filter(exts.join(", ").to_uppercase(), exts)
        .blocking_pick_file()?;
    picked.into_path().ok()
}

#[tauri::command]
pub async fn get_profile(storage: State<'_, Storage>) -> AppResult<Option<Profile>> {
    let storage = storage.inner().clone();
    blocking(move || db::get_profile(&*storage.conn()?)).await
}

#[tauri::command]
pub async fn set_profile(storage: State<'_, Storage>, profile: Profile) -> AppResult<()> {
    let storage = storage.inner().clone();
    blocking(move || db::set_profile(&*storage.conn()?, &profile)).await
}

#[tauri::command]
pub async fn save_result(storage: State<'_, Storage>, result: NewResult) -> AppResult<i64> {
    let storage = storage.inner().clone();
    blocking(move || db::insert_result(&*storage.conn()?, &result, now_secs())).await
}

#[tauri::command]
pub async fn get_results(storage: State<'_, Storage>) -> AppResult<Vec<SavedResult>> {
    let storage = storage.inner().clone();
    blocking(move || db::list_results(&*storage.conn()?)).await
}

#[tauri::command]
pub async fn list_recordings(storage: State<'_, Storage>) -> AppResult<Vec<RecordingInfo>> {
    let storage = storage.inner().clone();
    blocking(move || recordings::list(storage.base(), &*storage.conn()?)).await
}

#[tauri::command]
pub async fn delete_recording(storage: State<'_, Storage>, name: String) -> AppResult<()> {
    let storage = storage.inner().clone();
    blocking(move || recordings::delete(storage.base(), &*storage.conn()?, &name)).await
}

#[tauri::command]
pub async fn set_recording_meta(
    storage: State<'_, Storage>,
    name: String,
    note: String,
    tags: String,
) -> AppResult<()> {
    let storage = storage.inner().clone();
    blocking(move || recordings::set_meta(storage.base(), &*storage.conn()?, &name, &note, &tags))
        .await
}

/// Save the results as JSON or CSV. Returns the chosen file's name, or `None`
/// if the dialog was cancelled.
#[tauri::command]
pub async fn export_data(
    app: AppHandle,
    storage: State<'_, Storage>,
    format: ExportFormat,
) -> AppResult<Option<String>> {
    let storage = storage.inner().clone();
    blocking(move || {
        let suggested = format!("lilthop-results.{}", format.extension());
        let Some(path) = ask_save_path(&app, &suggested, format.extension()) else {
            return Ok(None);
        };
        export::export_to(&*storage.conn()?, &path, format)?;
        Ok(Some(file_name_of(&path)))
    })
    .await
}

/// Save a backup zip. Returns the chosen file's name, or `None` if cancelled.
#[tauri::command]
pub async fn backup_create(
    app: AppHandle,
    storage: State<'_, Storage>,
) -> AppResult<Option<String>> {
    let storage = storage.inner().clone();
    blocking(move || {
        let date = export::utc_iso(now_secs());
        let suggested = format!("lilthop-backup-{}.zip", &date[..10]);
        let Some(path) = ask_save_path(&app, &suggested, "zip") else {
            return Ok(None);
        };
        backup::create_to(storage.base(), &*storage.conn()?, &path)?;
        Ok(Some(file_name_of(&path)))
    })
    .await
}

/// Pick a backup (new zip or old JSON) and restore it. `None` if cancelled.
#[tauri::command]
pub async fn backup_restore(
    app: AppHandle,
    storage: State<'_, Storage>,
) -> AppResult<Option<RestoreSummary>> {
    let storage = storage.inner().clone();
    blocking(move || {
        let Some(path) = ask_open_path(&app, &["zip", "json"]) else {
            return Ok(None);
        };
        let summary = backup::restore_from(storage.base(), &*storage.conn()?, &path, now_secs())?;
        Ok(Some(summary))
    })
    .await
}

#[tauri::command]
pub async fn delete_all_data(
    audio: State<'_, AudioState>,
    storage: State<'_, Storage>,
) -> AppResult<DeleteReport> {
    let audio = audio.inner().clone();
    let storage = storage.inner().clone();
    blocking(move || {
        // An open recording or a playing clip would hold its file.
        audio.release_all();
        storage.delete_all()
    })
    .await
}

// ---------- audio ----------

/// Payload of `playback-ended`.
#[derive(Serialize, Clone)]
pub struct PlaybackEnded {
    pub name: String,
}

/// Payload of `start_recording`.
#[derive(Serialize)]
pub struct RecordingStarted {
    pub name: String,
}

/// Where workers send problems that happen while audio is running.
pub fn audio_report(app: &AppHandle) -> Report {
    let app = app.clone();
    Arc::new(move |issue| {
        let _ = app.emit("audio-error", issue);
    })
}

/// The audio state, with `playback-ended` wired to the webview.
pub fn audio_state(app: &AppHandle) -> AudioState {
    let app = app.clone();
    AudioState::new(move |name| {
        let _ = app.emit(
            "playback-ended",
            PlaybackEnded {
                name: name.to_owned(),
            },
        );
    })
}

#[tauri::command]
pub async fn list_input_devices() -> AppResult<Vec<String>> {
    blocking(|| Ok(input_device_names())).await
}

/// Returns only once the microphone is really open and playing.
#[tauri::command]
pub async fn start_pitch(
    app: AppHandle,
    audio: State<'_, AudioState>,
    device_name: Option<String>,
) -> AppResult<StreamInfo> {
    let audio = audio.inner().clone();
    blocking(move || {
        let report = audio_report(&app);
        let events = app.clone();
        let emit = move |frame| {
            let _ = events.emit("pitch", frame);
        };
        audio.start_pitch(device_name, emit, report)
    })
    .await
}

#[tauri::command]
pub async fn stop_pitch(audio: State<'_, AudioState>) -> AppResult<()> {
    let audio = audio.inner().clone();
    blocking(move || {
        audio.stop_pitch();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    audio: State<'_, AudioState>,
    storage: State<'_, Storage>,
    device_name: Option<String>,
) -> AppResult<RecordingStarted> {
    let audio = audio.inner().clone();
    let dir = storage.recordings_dir();
    blocking(move || {
        let name = audio.start_recording(dir, now_ms(), device_name, audio_report(&app))?;
        Ok(RecordingStarted { name })
    })
    .await
}

#[tauri::command]
pub async fn stop_recording(audio: State<'_, AudioState>) -> AppResult<RecordingInfo> {
    let audio = audio.inner().clone();
    blocking(move || audio.stop_recording()).await
}

/// Returns as soon as the sound has started; `playback-ended` follows.
#[tauri::command]
pub async fn play_recording(
    audio: State<'_, AudioState>,
    storage: State<'_, Storage>,
    name: String,
) -> AppResult<()> {
    let audio = audio.inner().clone();
    let storage = storage.inner().clone();
    blocking(move || audio.play(&name, &recording_path(storage.base(), &name)?)).await
}

#[tauri::command]
pub async fn stop_playback(audio: State<'_, AudioState>) -> AppResult<()> {
    let audio = audio.inner().clone();
    blocking(move || {
        audio.stop_playback();
        Ok(())
    })
    .await
}

/// The way out of a failed move of the earlier data: start with an empty
/// database and never try the move again. The old folders are not touched.
#[tauri::command]
pub async fn start_fresh(storage: State<'_, Storage>) -> AppResult<()> {
    let storage = storage.inner().clone();
    blocking(move || storage.start_fresh()).await
}

/// Whether "Start fresh" left earlier data that can still be moved over.
#[tauri::command]
pub async fn can_move_earlier_data(storage: State<'_, Storage>) -> AppResult<bool> {
    let storage = storage.inner().clone();
    blocking(move || Ok(storage.can_move_earlier_data())).await
}

/// The way back from `start_fresh`, allowed only while nothing was saved since.
#[tauri::command]
pub async fn move_earlier_data(storage: State<'_, Storage>) -> AppResult<()> {
    let storage = storage.inner().clone();
    blocking(move || storage.move_earlier_data()).await
}
