mod mcp;
mod xacro;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .manage(mcp::McpState::default())
        .invoke_handler(tauri::generate_handler![
            mcp::mcp_start,
            mcp::mcp_stop,
            mcp::mcp_status,
            mcp::mcp_respond,
            mcp::mcp_notify_tools_changed,
            xacro::xacro_expand,
        ])
        .run(tauri::generate_context!())
        .expect("error while running URDF Forge");
}
