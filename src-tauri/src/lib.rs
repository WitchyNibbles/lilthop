pub mod analyze;
mod audio;
mod commands;
mod dsp;
mod error;
mod paths;
mod storage;

use tauri::{Manager, RunEvent};

use audio::AudioState;
use storage::Storage;

fn open_storage(app: &tauri::App) -> Result<Storage, Box<dyn std::error::Error>> {
    let resolver = app.path();
    let base = resolver.app_data_dir()?;
    // Same parent Tauri uses for every app's data folder, so the previous
    // identifier's folder is found wherever the platform keeps it.
    let previous = paths::previous_data_dir(&resolver.data_dir()?);
    let legacy = paths::legacy_data_dir(std::env::var_os("APPDATA"));
    Ok(Storage::init(base, Some(&previous), legacy.as_deref())?)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let built = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(open_storage(app)?);
            app.manage(commands::audio_state(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_input_devices,
            commands::start_pitch,
            commands::stop_pitch,
            commands::start_recording,
            commands::stop_recording,
            commands::play_recording,
            commands::stop_playback,
            commands::list_recordings,
            commands::delete_recording,
            commands::set_recording_meta,
            commands::get_profile,
            commands::set_profile,
            commands::save_result,
            commands::get_results,
            commands::export_data,
            commands::backup_create,
            commands::backup_restore,
            commands::delete_all_data,
            commands::start_fresh,
            commands::can_move_earlier_data,
            commands::move_earlier_data,
        ])
        .build(tauri::generate_context!());
    let app = match built {
        Ok(app) => app,
        Err(e) => {
            eprintln!("lilthop could not start: {e}");
            std::process::exit(1);
        }
    };
    app.run(|handle, event| {
        // Close the recording file properly on a normal exit.
        if let (RunEvent::Exit, Some(audio)) = (&event, handle.try_state::<AudioState>()) {
            audio.release_all();
        }
    });
}
