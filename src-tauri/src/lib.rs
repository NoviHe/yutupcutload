pub mod commands;
pub mod config;
pub mod models;
pub mod process;
pub mod queue;
pub mod splitter;
pub mod ytdlp;

use std::sync::Arc;
use tauri::{Manager, RunEvent};

use crate::queue::QueueManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_settings = config::load_settings();
    let queue_manager = Arc::new(QueueManager::new(initial_settings.max_concurrent));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(queue_manager)
        .invoke_handler(tauri::generate_handler![
            commands::check_environment,
            commands::get_settings,
            commands::save_settings,
            commands::fetch_video_info,
            commands::resolve_stream_url,
            commands::generate_auto_split,
            commands::parse_bulk_clips,
            commands::enqueue_clips,
            commands::cancel_clip,
            commands::cancel_all_clips,
            commands::retry_clip,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
            if let Some(queue) = app_handle.try_state::<Arc<QueueManager>>() {
                let q = queue.inner().clone();
                tauri::async_runtime::block_on(async move {
                    q.cancel_all().await;
                });
            }
        }
    });
}
