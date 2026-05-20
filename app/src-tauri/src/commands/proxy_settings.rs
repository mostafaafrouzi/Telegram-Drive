use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use std::path::PathBuf;

/// Proxy mode options matching the frontend dropdown
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProxyMode {
    Disabled,
    System,
    Socks5,
    Http,
}

impl Default for ProxyMode {
    fn default() -> Self {
        Self::Disabled
    }
}

/// Persisted proxy settings (written to proxy_settings.json in the app data dir)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProxySettingsFile {
    pub mode: ProxyMode,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

impl Default for ProxySettingsFile {
    fn default() -> Self {
        Self {
            mode: ProxyMode::Disabled,
            host: String::new(),
            port: 1080,
            username: String::new(),
            password: String::new(),
        }
    }
}

/// What the frontend sees
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProxySettingsResponse {
    pub mode: ProxyMode,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub has_password: bool,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("proxy_settings.json"))
}

pub fn load_proxy_settings(app: &AppHandle) -> ProxySettingsFile {
    let path = match settings_path(app) {
        Ok(p) => p,
        Err(_) => return ProxySettingsFile::default(),
    };
    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => ProxySettingsFile::default(),
    }
}

fn save_proxy_settings(app: &AppHandle, settings: &ProxySettingsFile) -> Result<(), String> {
    let path = settings_path(app)?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// Build a proxy URL string from the current settings for use with grammers ConnectionParams.
/// Returns None if proxy is disabled or system proxy is selected but none detected.
pub fn build_proxy_url(settings: &ProxySettingsFile) -> Option<String> {
    match settings.mode {
        ProxyMode::Disabled => None,
        ProxyMode::System => detect_system_proxy(),
        ProxyMode::Socks5 => {
            if settings.host.is_empty() {
                return None;
            }
            let auth = if settings.username.is_empty() {
                String::new()
            } else if settings.password.is_empty() {
                format!("{}@", settings.username)
            } else {
                format!("{}:{}@", settings.username, settings.password)
            };
            Some(format!("socks5://{}{}:{}", auth, settings.host, settings.port))
        }
        ProxyMode::Http => {
            if settings.host.is_empty() {
                return None;
            }
            let auth = if settings.username.is_empty() {
                String::new()
            } else if settings.password.is_empty() {
                format!("{}@", settings.username)
            } else {
                format!("{}:{}@", settings.username, settings.password)
            };
            Some(format!("http://{}{}:{}", auth, settings.host, settings.port))
        }
    }
}

/// Detect system proxy from environment variables.
/// Checks ALL_PROXY, HTTPS_PROXY, HTTP_PROXY (in priority order).
fn detect_system_proxy() -> Option<String> {
    // Check common environment variables for proxy settings
    for var in &["ALL_PROXY", "all_proxy", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        if let Ok(val) = std::env::var(var) {
            if !val.is_empty() {
                log::info!("Detected system proxy from {}: {}", var, val);
                return Some(val);
            }
        }
    }

    // On Linux, check GNOME/KDE proxy settings via gsettings
    #[cfg(target_os = "linux")]
    {
        if let Some(url) = detect_gnome_proxy() {
            return Some(url);
        }
    }

    log::info!("No system proxy detected");
    None
}

#[cfg(target_os = "linux")]
fn detect_gnome_proxy() -> Option<String> {
    use std::process::Command;

    let mode = Command::new("gsettings")
        .args(["get", "org.gnome.system.proxy", "mode"])
        .output()
        .ok()?;
    let mode_str = String::from_utf8_lossy(&mode.stdout).trim().replace('\'', "");

    if mode_str != "manual" {
        return None;
    }

    // Try SOCKS proxy first
    let socks_host = Command::new("gsettings")
        .args(["get", "org.gnome.system.proxy.socks", "host"])
        .output()
        .ok()?;
    let socks_host_str = String::from_utf8_lossy(&socks_host.stdout).trim().replace('\'', "");

    if !socks_host_str.is_empty() {
        let socks_port = Command::new("gsettings")
            .args(["get", "org.gnome.system.proxy.socks", "port"])
            .output()
            .ok()?;
        let socks_port_str = String::from_utf8_lossy(&socks_port.stdout).trim().to_string();
        let port: u16 = socks_port_str.parse().unwrap_or(1080);
        return Some(format!("socks5://{}:{}", socks_host_str, port));
    }

    // Fall back to HTTP proxy
    let http_host = Command::new("gsettings")
        .args(["get", "org.gnome.system.proxy.http", "host"])
        .output()
        .ok()?;
    let http_host_str = String::from_utf8_lossy(&http_host.stdout).trim().replace('\'', "");

    if !http_host_str.is_empty() {
        let http_port = Command::new("gsettings")
            .args(["get", "org.gnome.system.proxy.http", "port"])
            .output()
            .ok()?;
        let http_port_str = String::from_utf8_lossy(&http_port.stdout).trim().to_string();
        let port: u16 = http_port_str.parse().unwrap_or(8080);
        return Some(format!("http://{}:{}", http_host_str, port));
    }

    None
}

#[tauri::command]
pub async fn cmd_get_proxy_settings(
    app: AppHandle,
) -> Result<ProxySettingsResponse, String> {
    let settings = load_proxy_settings(&app);
    Ok(ProxySettingsResponse {
        mode: settings.mode,
        host: settings.host,
        port: settings.port,
        username: settings.username,
        has_password: !settings.password.is_empty(),
    })
}

#[tauri::command]
pub async fn cmd_update_proxy_settings(
    mode: ProxyMode,
    host: String,
    port: u16,
    username: String,
    password: String,
    app: AppHandle,
    state: tauri::State<'_, crate::TelegramState>,
) -> Result<ProxySettingsResponse, String> {
    let settings = ProxySettingsFile {
        mode: mode.clone(),
        host: host.clone(),
        port,
        username: username.clone(),
        password: password.clone(),
    };

    save_proxy_settings(&app, &settings)?;

    // Force reconnection with new proxy settings by clearing the current client.
    // The next command that needs the client will trigger ensure_client_initialized
    // which will pick up the new proxy settings.
    let had_client = {
        let mut guard = state.client.lock().await;
        let had = guard.is_some();
        *guard = None;
        had
    };

    if had_client {
        // Shutdown the existing runner
        let did_shutdown = {
            let mut guard = state.runner_shutdown.lock().unwrap();
            if let Some(shutdown_tx) = guard.take() {
                log::info!("Shutting down runner for proxy settings change...");
                let _ = shutdown_tx.send(());
                true
            } else {
                false
            }
        };
        if did_shutdown {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        // Reconnect if we have an API ID
        let api_id_opt = *state.api_id.lock().await;
        if let Some(api_id) = api_id_opt {
            log::info!("Reconnecting with new proxy settings...");
            match crate::commands::auth::ensure_client_initialized(&app, &state, api_id).await {
                Ok(_) => log::info!("Reconnection with new proxy successful"),
                Err(e) => log::warn!("Reconnection with new proxy failed: {}", e),
            }
        }
    }

    Ok(ProxySettingsResponse {
        mode,
        host,
        port,
        username,
        has_password: !password.is_empty(),
    })
}
