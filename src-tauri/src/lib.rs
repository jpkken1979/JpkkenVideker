use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_shell::{
    process::{Command, CommandChild, CommandEvent},
    ShellExt,
};
use url::Url;

const YT_DLP_RELEASE_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const UPDATE_USER_AGENT: &str = "JpkkenVideker/0.1.0";

#[derive(Default)]
struct DownloadManager {
    children: Mutex<HashMap<String, CommandChild>>,
    updating_engine: Mutex<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    yt_dlp_ready: bool,
    yt_dlp_version: Option<String>,
    ffmpeg_ready: bool,
    ffmpeg_version: Option<String>,
    deno_ready: bool,
    deno_version: Option<String>,
    engine_source: String,
    default_download_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineUpdateInfo {
    current_version: Option<String>,
    latest_version: String,
    update_available: bool,
    source: String,
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaInfo {
    id: String,
    title: String,
    uploader: String,
    duration: Option<f64>,
    thumbnail: Option<String>,
    extractor: String,
    webpage_url: String,
    is_playlist: bool,
    playlist_count: Option<u64>,
    resolutions: Vec<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    id: String,
    url: String,
    title: String,
    uploader: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    view_count: Option<u64>,
    source: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadRequest {
    job_id: String,
    url: String,
    title: String,
    output_dir: String,
    kind: String,
    format: String,
    quality: String,
    subtitles: bool,
    embed_metadata: bool,
    embed_thumbnail: bool,
    include_playlist: bool,
    browser_cookies: Option<String>,
    concurrent_fragments: u8,
    compatibility_mode: bool,
    use_deno: bool,
    avoid_duplicates: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RingtoneRequest {
    input_path: String,
    output_dir: String,
    start_seconds: f64,
    duration_seconds: f64,
    preset: String,
    fade: bool,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
enum DownloadEvent {
    Started {
        #[serde(rename = "jobId")]
        job_id: String,
    },
    Progress {
        #[serde(rename = "jobId")]
        job_id: String,
        percent: f64,
        speed: String,
        eta: String,
        #[serde(rename = "downloadedBytes")]
        downloaded_bytes: u64,
        #[serde(rename = "totalBytes")]
        total_bytes: Option<u64>,
    },
    Stage {
        #[serde(rename = "jobId")]
        job_id: String,
        label: String,
    },
    Retrying {
        #[serde(rename = "jobId")]
        job_id: String,
        attempt: u8,
        #[serde(rename = "maxAttempts")]
        max_attempts: u8,
        label: String,
    },
    Completed {
        #[serde(rename = "jobId")]
        job_id: String,
        #[serde(rename = "filePath")]
        file_path: Option<String>,
    },
    Failed {
        #[serde(rename = "jobId")]
        job_id: String,
        message: String,
        category: String,
        suggestions: Vec<String>,
        #[serde(rename = "technicalDetails")]
        technical_details: String,
    },
    Cancelled {
        #[serde(rename = "jobId")]
        job_id: String,
    },
}

struct ErrorDiagnosis {
    category: &'static str,
    message: &'static str,
    suggestions: Vec<&'static str>,
}

#[derive(Clone, Copy)]
enum CompatibilityStrategy {
    Normal,
    Polite,
    Impersonate,
    Ipv4,
}

enum AttemptOutcome {
    Success(Option<String>),
    Failed(String),
    Cancelled,
}

fn validate_url(raw: &str) -> Result<(), String> {
    let parsed = Url::parse(raw).map_err(|_| "El enlace no es válido.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("El enlace debe empezar por http o https.".to_string());
    }
    Ok(())
}

fn validate_browser(browser: Option<&str>) -> Result<(), String> {
    if let Some(browser) = browser {
        if !matches!(browser, "chrome" | "edge" | "firefox" | "brave") {
            return Err("El navegador seleccionado no es compatible.".to_string());
        }
    }
    Ok(())
}

fn target_triple() -> &'static str {
    option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or("x86_64-pc-windows-msvc")
}

fn binary_directory() -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries")
    } else {
        std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

fn bundled_binary_path(name: &str) -> PathBuf {
    let current_exe_candidate = std::env::current_exe().ok().and_then(|path| {
        path.parent()
            .map(|parent| parent.join(format!("{name}.exe")))
    });
    if let Some(path) = current_exe_candidate {
        if path.exists() {
            return path;
        }
    }

    let directory = binary_directory();
    let target_candidate = directory.join(format!("{name}-{}.exe", target_triple()));
    if target_candidate.exists() {
        target_candidate
    } else {
        directory.join(format!("{name}.exe"))
    }
}

fn engine_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("engine"))
        .map_err(|error| format!("No se pudo abrir la carpeta de datos: {error}"))
}

fn updated_engine_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(engine_directory(app)?.join("yt-dlp.exe"))
}

fn engine_source(app: &AppHandle) -> String {
    match updated_engine_path(app) {
        Ok(path) if path.exists() => "updated".to_string(),
        _ => "bundled".to_string(),
    }
}

fn bundled_yt_dlp_command(app: &AppHandle) -> Result<Command, String> {
    app.shell()
        .sidecar("yt-dlp")
        .map_err(|error| format!("No se encontró el motor yt-dlp: {error}"))
}

fn yt_dlp_command(app: &AppHandle) -> Result<Command, String> {
    let updated = updated_engine_path(app)?;
    if updated.exists() {
        Ok(app.shell().command(updated))
    } else {
        bundled_yt_dlp_command(app)
    }
}

fn first_line(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

async fn command_version(command: Command, args: &[&str]) -> Option<String> {
    command
        .args(args)
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| first_line(&output.stdout))
}

async fn current_engine_version(app: &AppHandle) -> Option<String> {
    let command = yt_dlp_command(app).ok()?;
    command_version(command, &["--version"]).await
}

fn add_js_runtime_args(args: &mut Vec<String>, use_deno: bool) {
    if !use_deno {
        return;
    }
    let deno = bundled_binary_path("deno");
    if deno.exists() {
        args.extend([
            "--js-runtimes".to_string(),
            format!("deno:{}", deno.to_string_lossy()),
            "--remote-components".to_string(),
            "ejs:npm".to_string(),
        ]);
    }
}

fn clean_error(raw: &str) -> String {
    let useful = raw
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with("[debug]"))
        .collect::<Vec<_>>();
    useful
        .last()
        .copied()
        .unwrap_or("El motor no devolvió detalles.")
        .trim_start_matches("ERROR:")
        .trim()
        .to_string()
}

fn download_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(UPDATE_USER_AGENT)
        .build()
        .map_err(|error| format!("No se pudo preparar la conexión segura: {error}"))
}

async fn latest_release(client: &Client) -> Result<GithubRelease, String> {
    client
        .get(YT_DLP_RELEASE_API)
        .send()
        .await
        .map_err(|error| format!("No se pudo consultar la actualización: {error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub rechazó la consulta de actualización: {error}"))?
        .json::<GithubRelease>()
        .await
        .map_err(|error| format!("La respuesta de actualización no es válida: {error}"))
}

#[tauri::command]
async fn check_engine_update(app: AppHandle) -> Result<EngineUpdateInfo, String> {
    let client = download_client()?;
    let release = latest_release(&client).await?;
    let latest = release.tag_name.trim_start_matches('v').to_string();
    let current = current_engine_version(&app).await;
    Ok(EngineUpdateInfo {
        update_available: current.as_deref() != Some(latest.as_str()),
        current_version: current,
        latest_version: latest,
        source: engine_source(&app),
    })
}

fn expected_checksum(contents: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let filename = parts.next()?.trim_start_matches('*');
        if filename == "yt-dlp.exe"
            && hash.len() == 64
            && hash.chars().all(|character| character.is_ascii_hexdigit())
        {
            Some(hash.to_ascii_lowercase())
        } else {
            None
        }
    })
}

async fn update_engine_inner(app: &AppHandle) -> Result<EngineUpdateInfo, String> {
    let client = download_client()?;
    let release = latest_release(&client).await?;
    let tag = release.tag_name;
    let latest = tag.trim_start_matches('v').to_string();
    let current = current_engine_version(app).await;
    if current.as_deref() == Some(latest.as_str()) {
        return Ok(EngineUpdateInfo {
            current_version: current,
            latest_version: latest,
            update_available: false,
            source: engine_source(app),
        });
    }

    let base_url = format!("https://github.com/yt-dlp/yt-dlp/releases/download/{tag}");
    let checksums = client
        .get(format!("{base_url}/SHA2-256SUMS"))
        .send()
        .await
        .map_err(|error| format!("No se pudo descargar la firma SHA-256: {error}"))?
        .error_for_status()
        .map_err(|error| format!("No se encontró la firma oficial: {error}"))?
        .text()
        .await
        .map_err(|error| format!("No se pudo leer la firma oficial: {error}"))?;
    let expected = expected_checksum(&checksums)
        .ok_or_else(|| "La lista oficial no contiene la firma de yt-dlp.exe.".to_string())?;

    let executable = client
        .get(format!("{base_url}/yt-dlp.exe"))
        .send()
        .await
        .map_err(|error| format!("No se pudo descargar yt-dlp: {error}"))?
        .error_for_status()
        .map_err(|error| format!("La descarga oficial de yt-dlp falló: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("No se pudo leer la actualización: {error}"))?;
    let actual = format!("{:x}", Sha256::digest(&executable));
    if actual != expected {
        return Err(
            "La actualización no superó la verificación SHA-256 y fue descartada.".to_string(),
        );
    }

    let directory = engine_directory(app)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("No se pudo crear la carpeta del motor: {error}"))?;
    let final_path = directory.join("yt-dlp.exe");
    let temporary_path = directory.join("yt-dlp-update.exe");
    let backup_path = directory.join("yt-dlp.backup.exe");
    fs::write(&temporary_path, &executable)
        .map_err(|error| format!("No se pudo guardar la actualización: {error}"))?;

    let verified_version = command_version(app.shell().command(&temporary_path), &["--version"])
        .await
        .filter(|version| version == &latest);
    if verified_version.is_none() {
        let _ = fs::remove_file(&temporary_path);
        return Err(
            "La actualización descargada no se pudo ejecutar o no coincide con la versión oficial."
                .to_string(),
        );
    }

    if final_path.exists() {
        fs::copy(&final_path, &backup_path)
            .map_err(|error| format!("No se pudo crear una copia de seguridad: {error}"))?;
        fs::remove_file(&final_path)
            .map_err(|error| format!("No se pudo reemplazar el motor anterior: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary_path, &final_path) {
        if backup_path.exists() {
            let _ = fs::copy(&backup_path, &final_path);
        }
        return Err(format!(
            "No se pudo activar la actualización; se conservó la versión anterior: {error}"
        ));
    }
    fs::write(directory.join("yt-dlp.sha256"), format!("{expected}\n"))
        .map_err(|error| format!("El motor se actualizó, pero no se guardó su firma: {error}"))?;

    let installed = current_engine_version(app).await;
    if installed.as_deref() != Some(latest.as_str()) {
        let _ = fs::remove_file(&final_path);
        if backup_path.exists() {
            let _ = fs::copy(&backup_path, &final_path);
        }
        return Err(
            "El motor actualizado no respondió correctamente; se restauró la copia anterior."
                .to_string(),
        );
    }

    Ok(EngineUpdateInfo {
        current_version: installed,
        latest_version: latest,
        update_available: false,
        source: "updated".to_string(),
    })
}

#[tauri::command]
async fn update_engine(
    app: AppHandle,
    state: State<'_, DownloadManager>,
) -> Result<EngineUpdateInfo, String> {
    {
        let mut updating = state
            .updating_engine
            .lock()
            .map_err(|_| "No se pudo bloquear el actualizador.".to_string())?;
        if *updating {
            return Err("Ya hay una actualización en curso.".to_string());
        }
        *updating = true;
    }
    if !state
        .children
        .lock()
        .map_err(|_| "No se pudo consultar la cola de descargas.".to_string())?
        .is_empty()
    {
        if let Ok(mut updating) = state.updating_engine.lock() {
            *updating = false;
        }
        return Err(
            "Espera a que terminen las descargas antes de actualizar el motor.".to_string(),
        );
    }

    let result = update_engine_inner(&app).await;
    if let Ok(mut updating) = state.updating_engine.lock() {
        *updating = false;
    }
    result
}

#[tauri::command]
async fn get_app_status(app: AppHandle) -> Result<AppStatus, String> {
    let yt_dlp_version = current_engine_version(&app).await;
    let ffmpeg_path = bundled_binary_path("ffmpeg");
    let deno_path = bundled_binary_path("deno");
    let ffmpeg_version = if ffmpeg_path.exists() {
        command_version(app.shell().command(&ffmpeg_path), &["-version"]).await
    } else {
        None
    };
    let deno_version = if deno_path.exists() {
        command_version(app.shell().command(&deno_path), &["--version"]).await
    } else {
        None
    };
    let default_download_dir = app
        .path()
        .document_dir()
        .map(|documents| documents.join("JpkkenVideker"))
        .or_else(|_| app.path().download_dir())
        .map_err(|error| format!("No se encontró una carpeta de destino: {error}"))?
        .to_string_lossy()
        .to_string();

    Ok(AppStatus {
        yt_dlp_ready: yt_dlp_version.is_some(),
        yt_dlp_version,
        ffmpeg_ready: ffmpeg_version.is_some(),
        ffmpeg_version,
        deno_ready: deno_version.is_some(),
        deno_version,
        engine_source: engine_source(&app),
        default_download_dir,
    })
}

fn analysis_args(
    url: &str,
    include_playlist: bool,
    browser_cookies: Option<&str>,
    use_deno: bool,
    strategy: CompatibilityStrategy,
) -> Vec<String> {
    let mut args = vec![
        "--ignore-config".to_string(),
        "--no-warnings".to_string(),
        "--dump-single-json".to_string(),
        "--skip-download".to_string(),
        "--socket-timeout".to_string(),
        "25".to_string(),
        "--retries".to_string(),
        "3".to_string(),
        "--extractor-retries".to_string(),
        "3".to_string(),
        if include_playlist {
            "--yes-playlist"
        } else {
            "--no-playlist"
        }
        .to_string(),
    ];
    add_js_runtime_args(&mut args, use_deno);
    if let Some(browser) = browser_cookies {
        args.extend(["--cookies-from-browser".to_string(), browser.to_string()]);
    }
    match strategy {
        CompatibilityStrategy::Normal => {}
        CompatibilityStrategy::Polite => {
            args.extend(["--sleep-requests".to_string(), "1.5".to_string()]);
        }
        CompatibilityStrategy::Impersonate => {
            args.extend([
                "--impersonate".to_string(),
                "chrome".to_string(),
                "--force-ipv4".to_string(),
                "--sleep-requests".to_string(),
                "1".to_string(),
            ]);
        }
        CompatibilityStrategy::Ipv4 => {
            args.push("--force-ipv4".to_string());
        }
    }
    args.push(url.to_string());
    args
}

fn search_args(query: &str, limit: u8, source: &str) -> Result<Vec<String>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Escribe algo para buscar.".to_string());
    }
    if query.chars().count() > 300 {
        return Err("La búsqueda es demasiado larga.".to_string());
    }
    let limit = limit.clamp(1, 30);
    let mut args = vec![
        "--ignore-config".to_string(),
        "--no-warnings".to_string(),
        "--dump-single-json".to_string(),
        "--flat-playlist".to_string(),
        "--skip-download".to_string(),
        "--socket-timeout".to_string(),
        "25".to_string(),
        "--retries".to_string(),
        "3".to_string(),
        "--extractor-retries".to_string(),
        "3".to_string(),
    ];
    match source {
        "youtube" => args.push(format!("ytsearch{limit}:{query}")),
        "soundcloud" => args.push(format!("scsearch{limit}:{query}")),
        "dailymotion" => {
            let mut search_url =
                Url::parse("https://www.dailymotion.com").expect("URL base válida");
            search_url
                .path_segments_mut()
                .expect("URL con segmentos")
                .push("search")
                .push(query)
                .push("videos");
            args.extend(["--playlist-items".to_string(), format!("1:{limit}")]);
            args.push(search_url.to_string());
        }
        _ => return Err("La fuente de búsqueda no es compatible.".to_string()),
    }
    Ok(args)
}

fn search_results_from_json(value: &Value, source: &str) -> Vec<SearchResult> {
    value
        .get("entries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let id = entry.get("id").and_then(Value::as_str)?.to_string();
            let url = entry
                .get("url")
                .or_else(|| entry.get("webpage_url"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    (entry.get("ie_key").and_then(Value::as_str) == Some("Youtube"))
                        .then(|| format!("https://www.youtube.com/watch?v={id}"))
                })?;
            let is_youtube = source == "youtube"
                || entry.get("ie_key").and_then(Value::as_str) == Some("Youtube");
            let thumbnail = entry
                .get("thumbnails")
                .and_then(Value::as_array)
                .and_then(|items| items.last())
                .and_then(|thumb| thumb.get("url"))
                .and_then(Value::as_str)
                .or_else(|| entry.get("thumbnail").and_then(Value::as_str))
                .map(str::to_string)
                .or_else(|| {
                    is_youtube.then(|| format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"))
                });
            Some(SearchResult {
                id,
                url,
                title: entry
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Contenido sin título")
                    .to_string(),
                uploader: entry
                    .get("uploader")
                    .or_else(|| entry.get("channel"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                duration: entry.get("duration").and_then(Value::as_f64),
                thumbnail,
                view_count: entry.get("view_count").and_then(Value::as_u64),
                source: source.to_string(),
            })
        })
        .collect()
}

async fn run_analysis(app: &AppHandle, args: Vec<String>) -> Result<Value, String> {
    let output = yt_dlp_command(app)?
        .args(args)
        .output()
        .await
        .map_err(|error| {
            format!("No se pudo iniciar el análisis. Comprueba la instalación: {error}")
        })?;
    if !output.status.success() {
        return Err(clean_error(&String::from_utf8_lossy(&output.stderr)));
    }
    serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|error| format!("El sitio respondió, pero sus datos no se pudieron leer: {error}"))
}

fn media_from_json(value: Value, original_url: &str) -> MediaInfo {
    let is_playlist = value.get("_type").and_then(Value::as_str) == Some("playlist");
    let entries = value.get("entries").and_then(Value::as_array);
    let representative = entries.and_then(|items| items.first()).unwrap_or(&value);
    let mut resolutions = representative
        .get("formats")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|format| format.get("height").and_then(Value::as_u64))
        .collect::<Vec<_>>();
    resolutions.sort_unstable_by(|left, right| right.cmp(left));
    resolutions.dedup();

    let playlist_count = value
        .get("playlist_count")
        .and_then(Value::as_u64)
        .or_else(|| entries.map(|items| items.len() as u64));
    MediaInfo {
        id: value
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("media")
            .to_string(),
        title: value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Contenido sin título")
            .to_string(),
        uploader: value
            .get("uploader")
            .or_else(|| value.get("channel"))
            .and_then(Value::as_str)
            .unwrap_or("Autor desconocido")
            .to_string(),
        duration: representative.get("duration").and_then(Value::as_f64),
        thumbnail: representative
            .get("thumbnail")
            .and_then(Value::as_str)
            .map(str::to_string),
        extractor: value
            .get("extractor_key")
            .or_else(|| value.get("extractor"))
            .and_then(Value::as_str)
            .unwrap_or("Sitio compatible")
            .to_string(),
        webpage_url: value
            .get("webpage_url")
            .and_then(Value::as_str)
            .unwrap_or(original_url)
            .to_string(),
        is_playlist,
        playlist_count,
        resolutions,
    }
}

#[tauri::command]
async fn analyze_url(
    app: AppHandle,
    url: String,
    include_playlist: bool,
    browser_cookies: Option<String>,
    use_deno: bool,
    compatibility_mode: bool,
) -> Result<MediaInfo, String> {
    validate_url(&url)?;
    validate_browser(browser_cookies.as_deref())?;
    let normal_args = analysis_args(
        &url,
        include_playlist,
        browser_cookies.as_deref(),
        use_deno,
        CompatibilityStrategy::Normal,
    );
    let value = match run_analysis(&app, normal_args).await {
        Ok(value) => value,
        Err(first_error) if compatibility_mode => {
            let retry_args = analysis_args(
                &url,
                include_playlist,
                browser_cookies.as_deref(),
                use_deno,
                CompatibilityStrategy::Impersonate,
            );
            run_analysis(&app, retry_args)
                .await
                .map_err(|second_error| {
                    format!(
                        "No se pudo analizar el enlace. {second_error} (Primer intento: {first_error})"
                    )
                })?
        }
        Err(error) => return Err(format!("No se pudo analizar el enlace. {error}")),
    };
    Ok(media_from_json(value, &url))
}

#[tauri::command]
async fn search_media(
    app: AppHandle,
    query: String,
    limit: Option<u8>,
    source: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let source = source.unwrap_or_else(|| "youtube".to_string());
    let args = search_args(&query, limit.unwrap_or(20), &source)?;
    let value = run_analysis(&app, args)
        .await
        .map_err(|error| format!("No se pudo completar la búsqueda. {error}"))?;
    Ok(search_results_from_json(&value, &source))
}

fn diagnose_error(raw: &str) -> ErrorDiagnosis {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("drm") || lower.contains("digital rights management") {
        ErrorDiagnosis {
            category: "drm",
            message: "Este contenido está protegido con DRM y JpkkenVideker no puede descargarlo.",
            suggestions: vec![
                "Usa la opción de descarga oficial del servicio, si está disponible.",
                "Prueba con contenido propio o autorizado que no tenga DRM.",
            ],
        }
    } else if lower.contains("sign in")
        || lower.contains("login")
        || lower.contains("authentication")
        || lower.contains("private video")
        || lower.contains("members-only")
    {
        ErrorDiagnosis {
            category: "authentication",
            message: "El sitio pide una sesión válida o permisos de acceso.",
            suggestions: vec![
                "En Ajustes, selecciona el navegador donde ya tienes acceso legítimo.",
                "Comprueba que tu sesión siga abierta en ese navegador.",
            ],
        }
    } else if lower.contains("not available in your country")
        || lower.contains("geo")
        || lower.contains("region")
    {
        ErrorDiagnosis {
            category: "geo",
            message: "El proveedor no ofrece este contenido en tu región.",
            suggestions: vec![
                "Comprueba la disponibilidad directamente en la página original.",
                "Respeta las condiciones y restricciones regionales del proveedor.",
            ],
        }
    } else if lower.contains("429")
        || lower.contains("too many requests")
        || lower.contains("rate limit")
        || lower.contains("temporarily blocked")
    {
        ErrorDiagnosis {
            category: "rateLimited",
            message: "El sitio limitó temporalmente las solicitudes.",
            suggestions: vec![
                "Espera unos minutos antes de usar Reparar descarga.",
                "Reduce los fragmentos simultáneos en Ajustes.",
            ],
        }
    } else if lower.contains("impersonat")
        || lower.contains("403")
        || lower.contains("forbidden")
        || lower.contains("bot")
        || lower.contains("challenge")
    {
        ErrorDiagnosis {
            category: "blocked",
            message: "El sitio rechazó la conexión automática.",
            suggestions: vec![
                "Activa Compatibilidad automática y vuelve a intentarlo.",
                "Si el contenido requiere sesión, selecciona tu navegador en Ajustes.",
            ],
        }
    } else if lower.contains("permission denied")
        || lower.contains("access is denied")
        || lower.contains("no space left")
        || lower.contains("disk full")
        || lower.contains("file name")
    {
        ErrorDiagnosis {
            category: "filesystem",
            message: "Windows no pudo guardar o procesar el archivo.",
            suggestions: vec![
                "Elige una carpeta donde tengas permiso de escritura.",
                "Comprueba el espacio libre y que el archivo no esté abierto.",
            ],
        }
    } else if lower.contains("video unavailable")
        || lower.contains("content unavailable")
        || lower.contains("removed")
        || lower.contains("deleted")
        || lower.contains("unsupported url")
    {
        ErrorDiagnosis {
            category: "unavailable",
            message: "El contenido ya no está disponible o el sitio no es compatible.",
            suggestions: vec![
                "Abre el enlace original y confirma que todavía funciona.",
                "Actualiza el motor desde Ajustes y vuelve a analizar el enlace.",
            ],
        }
    } else if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("connection")
        || lower.contains("network")
        || lower.contains("dns")
        || lower.contains("unable to download")
    {
        ErrorDiagnosis {
            category: "network",
            message: "La conexión se interrumpió antes de terminar.",
            suggestions: vec![
                "Comprueba Internet; la descarga parcial se reanudará automáticamente.",
                "Usa Reparar descarga para probar una conexión más conservadora.",
            ],
        }
    } else {
        ErrorDiagnosis {
            category: "unknown",
            message: "El sitio no pudo completar la descarga.",
            suggestions: vec![
                "Actualiza el motor desde Ajustes.",
                "Copia el diagnóstico técnico si necesitas revisar el problema.",
            ],
        }
    }
}

fn next_strategy(category: &str, failed_attempt: u8) -> Option<CompatibilityStrategy> {
    match (category, failed_attempt) {
        ("drm" | "authentication" | "geo" | "filesystem" | "unavailable", _) => None,
        ("rateLimited", 1) => Some(CompatibilityStrategy::Polite),
        ("rateLimited", 2) => Some(CompatibilityStrategy::Impersonate),
        ("blocked", 1) => Some(CompatibilityStrategy::Impersonate),
        ("blocked", 2) => Some(CompatibilityStrategy::Polite),
        ("network", 1) => Some(CompatibilityStrategy::Ipv4),
        ("network", 2) => Some(CompatibilityStrategy::Polite),
        (_, 1) => Some(CompatibilityStrategy::Polite),
        (_, 2) => Some(CompatibilityStrategy::Ipv4),
        _ => None,
    }
}

fn strategy_label(strategy: CompatibilityStrategy) -> &'static str {
    match strategy {
        CompatibilityStrategy::Normal => "Conexión normal",
        CompatibilityStrategy::Polite => "Esperando más entre solicitudes",
        CompatibilityStrategy::Impersonate => "Usando compatibilidad de navegador",
        CompatibilityStrategy::Ipv4 => "Probando una ruta de red alternativa",
    }
}

fn sanitize_file_stem(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|character| {
            if character.is_alphanumeric()
                || matches!(character, ' ' | '-' | '_' | '(' | ')' | '.' | ',' | '\'')
            {
                character
            } else {
                '_'
            }
        })
        .collect();
    let stem: String = cleaned.trim().trim_matches('.').chars().take(80).collect();
    if stem.is_empty() {
        "tono".to_string()
    } else {
        stem
    }
}

fn ringtone_args(
    request: &RingtoneRequest,
    tones_dir: &Path,
) -> Result<(Vec<String>, PathBuf), String> {
    if !request.start_seconds.is_finite() || request.start_seconds < 0.0 {
        return Err("El inicio del tono no es válido.".to_string());
    }
    if !request.duration_seconds.is_finite() {
        return Err("La duración del tono no es válida.".to_string());
    }
    let duration = request.duration_seconds.clamp(5.0, 40.0);
    let (codec_args, extension): (&[&str], &str) = match request.preset.as_str() {
        "iphone" => (&["-c:a", "aac", "-b:a", "192k", "-f", "ipod"], "m4r"),
        "android" => (&["-c:a", "libmp3lame", "-b:a", "192k"], "mp3"),
        _ => return Err("El tipo de tono no es compatible.".to_string()),
    };
    let stem = Path::new(&request.input_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("tono");
    let file_name = format!(
        "{} (tono {}s).{extension}",
        sanitize_file_stem(stem),
        duration.round() as u32
    );
    let output_path = tones_dir.join(file_name);

    let mut args = vec![
        "-y".to_string(),
        "-ss".to_string(),
        format!("{:.2}", request.start_seconds),
        "-t".to_string(),
        format!("{duration:.2}"),
        "-i".to_string(),
        request.input_path.clone(),
        "-vn".to_string(),
        "-ar".to_string(),
        "44100".to_string(),
    ];
    if request.fade {
        let fade_out_start = (duration - 1.5).max(0.0);
        args.extend([
            "-af".to_string(),
            format!("afade=t=in:st=0:d=0.3,afade=t=out:st={fade_out_start:.2}:d=1.5"),
        ]);
    }
    args.extend(codec_args.iter().map(|value| value.to_string()));
    args.push(output_path.to_string_lossy().to_string());
    Ok((args, output_path))
}

#[tauri::command]
async fn create_ringtone(app: AppHandle, request: RingtoneRequest) -> Result<String, String> {
    if !Path::new(&request.input_path).is_file() {
        return Err("No se encontró el archivo original. Descárgalo de nuevo.".to_string());
    }
    let ffmpeg = bundled_binary_path("ffmpeg");
    if !ffmpeg.exists() {
        return Err(
            "Falta el componente ffmpeg. Reinstala JpkkenVideker o ejecuta npm run sidecars."
                .to_string(),
        );
    }
    let tones_dir = PathBuf::from(&request.output_dir).join("Tonos");
    fs::create_dir_all(&tones_dir)
        .map_err(|error| format!("No se pudo preparar la carpeta de tonos: {error}"))?;
    let (args, output_path) = ringtone_args(&request, &tones_dir)?;
    let output = app
        .shell()
        .command(&ffmpeg)
        .args(args)
        .output()
        .await
        .map_err(|error| format!("No se pudo iniciar ffmpeg: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("")
            .trim()
            .to_string();
        return Err(format!("No se pudo crear el tono. {detail}"));
    }
    if !output_path.is_file() {
        return Err("ffmpeg terminó pero el tono no apareció en la carpeta.".to_string());
    }
    Ok(output_path.to_string_lossy().to_string())
}

fn media_subfolder(kind: &str) -> &'static str {
    if kind == "video" {
        "Videos"
    } else {
        "Musica"
    }
}

fn build_download_args(
    app: &AppHandle,
    request: &DownloadRequest,
    strategy: CompatibilityStrategy,
) -> Result<Vec<String>, String> {
    validate_url(&request.url)?;
    validate_browser(request.browser_cookies.as_deref())?;
    if request.kind != "video" && request.kind != "audio" {
        return Err("El tipo de descarga no es válido.".to_string());
    }
    if request.kind == "video" && !matches!(request.format.as_str(), "mp4" | "mkv" | "webm") {
        return Err("El formato de vídeo no es válido.".to_string());
    }
    if request.kind == "audio" && !matches!(request.format.as_str(), "mp3" | "m4a" | "opus") {
        return Err("El formato de audio no es válido.".to_string());
    }
    let output_dir = PathBuf::from(&request.output_dir).join(media_subfolder(&request.kind));
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("No se pudo preparar la carpeta de destino: {error}"))?;

    let fragment_count = match strategy {
        CompatibilityStrategy::Normal => request.concurrent_fragments.clamp(1, 8),
        CompatibilityStrategy::Impersonate => request.concurrent_fragments.clamp(1, 2),
        CompatibilityStrategy::Polite | CompatibilityStrategy::Ipv4 => 1,
    };
    let mut args = vec![
        "--ignore-config".to_string(),
        "--newline".to_string(),
        "--no-colors".to_string(),
        "--windows-filenames".to_string(),
        "--continue".to_string(),
        "--part".to_string(),
        "--retries".to_string(),
        "10".to_string(),
        "--fragment-retries".to_string(),
        "10".to_string(),
        "--file-access-retries".to_string(),
        "3".to_string(),
        "--extractor-retries".to_string(),
        "5".to_string(),
        "--retry-sleep".to_string(),
        "http:exp=1:20".to_string(),
        "--retry-sleep".to_string(),
        "fragment:exp=1:12".to_string(),
        "--concurrent-fragments".to_string(),
        fragment_count.to_string(),
        "--progress-template".to_string(),
        "download:JPKPROGRESS|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes,progress.total_bytes_estimate)s".to_string(),
        "--print".to_string(),
        "after_move:JPKFILE:%(filepath)s".to_string(),
        "--paths".to_string(),
        output_dir.to_string_lossy().to_string(),
        "--output".to_string(),
        "%(title).180B [%(id)s].%(ext)s".to_string(),
        if request.include_playlist {
            "--yes-playlist"
        } else {
            "--no-playlist"
        }
        .to_string(),
    ];

    let ffmpeg = bundled_binary_path("ffmpeg");
    if ffmpeg.exists() {
        args.extend([
            "--ffmpeg-location".to_string(),
            ffmpeg.to_string_lossy().to_string(),
        ]);
    }
    add_js_runtime_args(&mut args, request.use_deno);

    if request.avoid_duplicates {
        let archive = engine_directory(app)?
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("archives")
            .join("downloads.txt");
        if let Some(parent) = archive.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("No se pudo preparar el historial: {error}"))?;
        }
        args.extend([
            "--download-archive".to_string(),
            archive.to_string_lossy().to_string(),
        ]);
    }

    match strategy {
        CompatibilityStrategy::Normal => {}
        CompatibilityStrategy::Polite => {
            args.extend([
                "--sleep-requests".to_string(),
                "1.5".to_string(),
                "--sleep-interval".to_string(),
                "2".to_string(),
                "--max-sleep-interval".to_string(),
                "4".to_string(),
            ]);
        }
        CompatibilityStrategy::Impersonate => {
            args.extend(["--impersonate".to_string(), "chrome".to_string()]);
        }
        CompatibilityStrategy::Ipv4 => {
            args.push("--force-ipv4".to_string());
        }
    }

    if request.kind == "video" {
        let height_filter = if request.quality == "best" {
            String::new()
        } else {
            let height = request
                .quality
                .parse::<u16>()
                .map_err(|_| "La calidad de vídeo no es válida.".to_string())?;
            format!("[height<={height}]")
        };
        let selector = match request.format.as_str() {
            "mp4" => format!(
                "bestvideo*{height_filter}[ext=mp4]+bestaudio[ext=m4a]/best{height_filter}[ext=mp4]/bestvideo*{height_filter}+bestaudio/best{height_filter}"
            ),
            "webm" => format!(
                "bestvideo*{height_filter}[ext=webm]+bestaudio[ext=webm]/best{height_filter}[ext=webm]/bestvideo*{height_filter}+bestaudio/best{height_filter}"
            ),
            _ => format!(
                "bestvideo*{height_filter}+bestaudio/best{height_filter}"
            ),
        };
        args.extend([
            "--format".to_string(),
            selector,
            "--merge-output-format".to_string(),
            request.format.clone(),
            "--remux-video".to_string(),
            request.format.clone(),
        ]);
    } else {
        let quality = if request.quality == "best" {
            "0".to_string()
        } else {
            let bitrate = request
                .quality
                .parse::<u16>()
                .map_err(|_| "La calidad de audio no es válida.".to_string())?;
            format!("{bitrate}K")
        };
        args.extend([
            "--format".to_string(),
            "bestaudio/best".to_string(),
            "--extract-audio".to_string(),
            "--audio-format".to_string(),
            request.format.clone(),
            "--audio-quality".to_string(),
            quality,
        ]);
    }

    if request.subtitles {
        args.extend([
            "--write-subs".to_string(),
            "--write-auto-subs".to_string(),
            "--sub-langs".to_string(),
            "es.*,en.*,-live_chat".to_string(),
        ]);
        if request.kind == "video" {
            args.push("--embed-subs".to_string());
        }
    }
    if request.embed_metadata {
        args.push("--embed-metadata".to_string());
    }
    if request.embed_thumbnail {
        args.push("--embed-thumbnail".to_string());
    }
    if let Some(browser) = &request.browser_cookies {
        args.extend(["--cookies-from-browser".to_string(), browser.clone()]);
    }
    args.push(request.url.clone());
    Ok(args)
}

fn parse_number(raw: &str) -> Option<u64> {
    raw.trim().trim_end_matches(".0").parse::<u64>().ok()
}

fn parse_progress(line: &str, job_id: &str) -> Option<DownloadEvent> {
    let payload = line.strip_prefix("JPKPROGRESS|")?;
    let mut parts = payload.split('|');
    let percent = parts
        .next()?
        .trim()
        .trim_end_matches('%')
        .parse::<f64>()
        .ok()?;
    let speed = parts.next().unwrap_or("").trim();
    let eta = parts.next().unwrap_or("").trim();
    let downloaded_bytes = parse_number(parts.next().unwrap_or("0")).unwrap_or(0);
    let total_bytes = parse_number(parts.next().unwrap_or(""));
    Some(DownloadEvent::Progress {
        job_id: job_id.to_string(),
        percent,
        speed: if speed == "NA" {
            String::new()
        } else {
            speed.to_string()
        },
        eta: if eta == "NA" {
            String::new()
        } else {
            eta.to_string()
        },
        downloaded_bytes,
        total_bytes,
    })
}

fn parse_file_path(line: &str) -> Option<String> {
    line.trim()
        .strip_prefix("JPKFILE:")
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string)
}

fn stage_label(line: &str) -> Option<&'static str> {
    if line.contains("[Merger]") {
        Some("Uniendo vídeo y audio")
    } else if line.contains("[ExtractAudio]") {
        Some("Convirtiendo el audio")
    } else if line.contains("[EmbedThumbnail]") {
        Some("Añadiendo la portada")
    } else if line.contains("[Metadata]") {
        Some("Guardando metadatos")
    } else if line.contains("[VideoConvertor]") || line.contains("[VideoRemuxer]") {
        Some("Preparando el formato final")
    } else {
        None
    }
}

fn remember_diagnostic(lines: &mut VecDeque<String>, line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with("JPKPROGRESS|") {
        return;
    }
    if lines.len() == 24 {
        lines.pop_front();
    }
    lines.push_back(trimmed.to_string());
}

async fn run_download_attempt(
    app: &AppHandle,
    manager: &DownloadManager,
    request: &DownloadRequest,
    strategy: CompatibilityStrategy,
    on_event: &Channel<DownloadEvent>,
) -> Result<AttemptOutcome, String> {
    let args = build_download_args(app, request, strategy)?;
    let (mut receiver, child) = yt_dlp_command(app)?
        .args(args)
        .spawn()
        .map_err(|error| format!("No se pudo iniciar el motor de descarga: {error}"))?;
    manager
        .children
        .lock()
        .map_err(|_| "No se pudo registrar la descarga.".to_string())?
        .insert(request.job_id.clone(), child);

    let mut exit_code = None;
    let mut file_path = None;
    let mut diagnostics = VecDeque::new();
    while let Some(event) = receiver.recv().await {
        match event {
            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                for line in text.lines() {
                    if let Some(progress) = parse_progress(line, &request.job_id) {
                        let _ = on_event.send(progress);
                    }
                    if let Some(path) = parse_file_path(line) {
                        file_path = Some(path);
                    }
                    if let Some(label) = stage_label(line) {
                        let _ = on_event.send(DownloadEvent::Stage {
                            job_id: request.job_id.clone(),
                            label: label.to_string(),
                        });
                    }
                    remember_diagnostic(&mut diagnostics, line);
                }
            }
            CommandEvent::Error(error) => remember_diagnostic(&mut diagnostics, &error),
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
            }
            _ => {}
        }
    }

    let was_registered = manager
        .children
        .lock()
        .map_err(|_| "No se pudo cerrar el registro de la descarga.".to_string())?
        .remove(&request.job_id)
        .is_some();
    if !was_registered {
        return Ok(AttemptOutcome::Cancelled);
    }
    if exit_code == Some(0) {
        Ok(AttemptOutcome::Success(file_path))
    } else {
        let details = if diagnostics.is_empty() {
            format!("yt-dlp terminó con el código {:?}.", exit_code)
        } else {
            diagnostics.into_iter().collect::<Vec<_>>().join("\n")
        };
        Ok(AttemptOutcome::Failed(details))
    }
}

fn valid_job_id(job_id: &str) -> bool {
    !job_id.is_empty()
        && job_id.len() <= 80
        && job_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

#[tauri::command]
async fn start_download(
    app: AppHandle,
    state: State<'_, DownloadManager>,
    request: DownloadRequest,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    if *state
        .updating_engine
        .lock()
        .map_err(|_| "No se pudo consultar el estado del motor.".to_string())?
    {
        return Err("El motor se está actualizando. Espera unos segundos.".to_string());
    }
    if !valid_job_id(&request.job_id) {
        return Err("El identificador de la descarga no es válido.".to_string());
    }
    if request.title.trim().is_empty() {
        return Err("La descarga no tiene un título válido.".to_string());
    }
    let _ = on_event.send(DownloadEvent::Started {
        job_id: request.job_id.clone(),
    });

    let max_attempts = if request.compatibility_mode { 3 } else { 1 };
    let mut strategy = CompatibilityStrategy::Normal;
    for attempt in 1..=max_attempts {
        match run_download_attempt(&app, &state, &request, strategy, &on_event).await? {
            AttemptOutcome::Success(file_path) => {
                let _ = on_event.send(DownloadEvent::Completed {
                    job_id: request.job_id.clone(),
                    file_path,
                });
                return Ok(());
            }
            AttemptOutcome::Cancelled => {
                let _ = on_event.send(DownloadEvent::Cancelled {
                    job_id: request.job_id.clone(),
                });
                return Ok(());
            }
            AttemptOutcome::Failed(details) => {
                let diagnosis = diagnose_error(&details);
                if attempt < max_attempts {
                    if let Some(next) = next_strategy(diagnosis.category, attempt) {
                        strategy = next;
                        let _ = on_event.send(DownloadEvent::Retrying {
                            job_id: request.job_id.clone(),
                            attempt: attempt + 1,
                            max_attempts,
                            label: strategy_label(next).to_string(),
                        });
                        continue;
                    }
                }
                let technical_details = details.chars().take(4_000).collect::<String>();
                let _ = on_event.send(DownloadEvent::Failed {
                    job_id: request.job_id.clone(),
                    message: diagnosis.message.to_string(),
                    category: diagnosis.category.to_string(),
                    suggestions: diagnosis
                        .suggestions
                        .into_iter()
                        .map(str::to_string)
                        .collect(),
                    technical_details,
                });
                return Ok(());
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn cancel_download(state: State<'_, DownloadManager>, job_id: String) -> Result<(), String> {
    let child = state
        .children
        .lock()
        .map_err(|_| "No se pudo acceder a la descarga.".to_string())?
        .remove(&job_id);
    if let Some(child) = child {
        child
            .kill()
            .map_err(|error| format!("No se pudo cancelar la descarga: {error}"))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(DownloadManager::default())
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            analyze_url,
            search_media,
            check_engine_update,
            update_engine,
            start_download,
            cancel_download,
            create_ringtone
        ])
        .run(tauri::generate_context!())
        .expect("error while running JpkkenVideker");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_http_urls() {
        assert!(validate_url("https://example.com/watch?v=1").is_ok());
        assert!(validate_url("http://example.com/video").is_ok());
        assert!(validate_url("file:///c:/secret.txt").is_err());
        assert!(validate_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn parses_progress_line() {
        let event = parse_progress("JPKPROGRESS| 42.5%|3.2MiB/s|00:12|425000|1000000", "job-1");
        match event {
            Some(DownloadEvent::Progress {
                percent,
                downloaded_bytes,
                total_bytes,
                ..
            }) => {
                assert_eq!(percent, 42.5);
                assert_eq!(downloaded_bytes, 425_000);
                assert_eq!(total_bytes, Some(1_000_000));
            }
            _ => panic!("progress event not parsed"),
        }
    }

    #[test]
    fn parses_final_path() {
        assert_eq!(
            parse_file_path("JPKFILE:C:\\Downloads\\demo.mp4"),
            Some("C:\\Downloads\\demo.mp4".to_string())
        );
    }

    #[test]
    fn diagnoses_rate_limit_and_drm() {
        assert_eq!(
            diagnose_error("HTTP Error 429: Too Many Requests").category,
            "rateLimited"
        );
        assert_eq!(
            diagnose_error("This video is DRM protected").category,
            "drm"
        );
    }

    #[test]
    fn sensitive_failures_do_not_retry() {
        assert!(next_strategy("drm", 1).is_none());
        assert!(next_strategy("authentication", 1).is_none());
        assert!(matches!(
            next_strategy("network", 1),
            Some(CompatibilityStrategy::Ipv4)
        ));
    }

    #[test]
    fn search_args_builds_flat_search() {
        let args = search_args("ice mc ice ice baby", 20, "youtube").unwrap();
        assert_eq!(args.last().unwrap(), "ytsearch20:ice mc ice ice baby");
        assert!(args.contains(&"--flat-playlist".to_string()));
        assert!(args.contains(&"--dump-single-json".to_string()));
        assert!(!args.contains(&"--no-playlist".to_string()));

        let soundcloud = search_args("ice mc", 5, "soundcloud").unwrap();
        assert_eq!(soundcloud.last().unwrap(), "scsearch5:ice mc");
    }

    #[test]
    fn search_args_builds_dailymotion_url() {
        let args = search_args("ice mc", 10, "dailymotion").unwrap();
        assert_eq!(
            args.last().unwrap(),
            "https://www.dailymotion.com/search/ice%20mc/videos"
        );
        let position = args
            .iter()
            .position(|arg| arg == "--playlist-items")
            .expect("playlist-items presente");
        assert_eq!(args[position + 1], "1:10");
    }

    #[test]
    fn search_args_rejects_bad_input_and_clamps_limit() {
        assert!(search_args("   ", 20, "youtube").is_err());
        assert!(search_args("ice mc", 20, "vimeo").is_err());
        let clamped = search_args("ice mc", 200, "youtube").unwrap();
        assert_eq!(clamped.last().unwrap(), "ytsearch30:ice mc");
    }

    #[test]
    fn parses_flat_search_entries() {
        let value = serde_json::json!({
            "_type": "playlist",
            "entries": [
                {
                    "id": "abc123",
                    "url": "https://www.youtube.com/watch?v=abc123",
                    "title": "Think About The Way",
                    "uploader": "Ice MC",
                    "duration": 254.0,
                    "view_count": 12_000_000u64,
                    "thumbnails": [
                        { "url": "https://i.ytimg.com/vi/abc123/default.jpg" },
                        { "url": "https://i.ytimg.com/vi/abc123/hqdefault.jpg" }
                    ]
                },
                {
                    "id": "def456",
                    "ie_key": "Youtube",
                    "title": "It's A Rainy Day",
                    "channel": "Canal música",
                    "thumbnail": "https://i.ytimg.com/vi/def456/default.jpg"
                },
                {
                    "id": "ghi789",
                    "url": "https://www.youtube.com/watch?v=ghi789",
                    "title": "Sin miniatura en la respuesta"
                },
                { "title": "Entrada sin id" }
            ]
        });
        let results = search_results_from_json(&value, "youtube");
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].id, "abc123");
        assert_eq!(
            results[0].thumbnail.as_deref(),
            Some("https://i.ytimg.com/vi/abc123/hqdefault.jpg")
        );
        assert_eq!(results[0].view_count, Some(12_000_000));
        assert_eq!(
            results[1].url,
            "https://www.youtube.com/watch?v=def456"
        );
        assert_eq!(results[1].uploader.as_deref(), Some("Canal música"));
        assert_eq!(
            results[1].thumbnail.as_deref(),
            Some("https://i.ytimg.com/vi/def456/default.jpg")
        );
        assert_eq!(results[1].source, "youtube");
        assert_eq!(
            results[2].thumbnail.as_deref(),
            Some("https://i.ytimg.com/vi/ghi789/hqdefault.jpg")
        );
    }

    #[test]
    fn routes_downloads_to_media_subfolders() {
        assert_eq!(media_subfolder("video"), "Videos");
        assert_eq!(media_subfolder("audio"), "Musica");
    }

    #[test]
    fn builds_iphone_ringtone_args() {
        let request = RingtoneRequest {
            input_path: "C:\\Musica\\Ice MC - Think About The Way.mp3".to_string(),
            output_dir: "C:\\JpkkenVideker".to_string(),
            start_seconds: 42.0,
            duration_seconds: 30.0,
            preset: "iphone".to_string(),
            fade: true,
        };
        let tones_dir = Path::new("C:\\JpkkenVideker\\Tonos");
        let (args, output_path) = ringtone_args(&request, tones_dir).unwrap();
        assert!(args.contains(&"-f".to_string()) && args.contains(&"ipod".to_string()));
        assert!(args.contains(&"aac".to_string()));
        assert!(args
            .iter()
            .any(|arg| arg.starts_with("afade=t=in") && arg.contains("afade=t=out:st=28.50")));
        assert_eq!(output_path.extension().and_then(|ext| ext.to_str()), Some("m4r"));
        let position = args.iter().position(|arg| arg == "-ss").unwrap();
        assert_eq!(args[position + 1], "42.00");
    }

    #[test]
    fn builds_android_ringtone_args_and_clamps_duration() {
        let request = RingtoneRequest {
            input_path: "C:\\Musica\\cancion.m4a".to_string(),
            output_dir: "C:\\JpkkenVideker".to_string(),
            start_seconds: 0.0,
            duration_seconds: 300.0,
            preset: "android".to_string(),
            fade: false,
        };
        let (args, output_path) = ringtone_args(&request, Path::new("C:\\Tonos")).unwrap();
        assert!(args.contains(&"libmp3lame".to_string()));
        assert!(!args.iter().any(|arg| arg.starts_with("afade")));
        let position = args.iter().position(|arg| arg == "-t").unwrap();
        assert_eq!(args[position + 1], "40.00");
        assert_eq!(output_path.extension().and_then(|ext| ext.to_str()), Some("mp3"));
    }

    #[test]
    fn rejects_invalid_ringtone_input() {
        let mut request = RingtoneRequest {
            input_path: "C:\\a.mp3".to_string(),
            output_dir: "C:\\out".to_string(),
            start_seconds: -3.0,
            duration_seconds: 30.0,
            preset: "iphone".to_string(),
            fade: false,
        };
        assert!(ringtone_args(&request, Path::new("C:\\Tonos")).is_err());
        request.start_seconds = 0.0;
        request.preset = "windows-phone".to_string();
        assert!(ringtone_args(&request, Path::new("C:\\Tonos")).is_err());
    }

    #[test]
    fn sanitizes_ringtone_file_names() {
        assert_eq!(
            sanitize_file_stem("Ice MC: Think/About\\The*Way?"),
            "Ice MC_ Think_About_The_Way_"
        );
        assert_eq!(sanitize_file_stem("***"), "___");
        assert_eq!(sanitize_file_stem("   "), "tono");
    }

    #[test]
    fn reads_official_checksum_format() {
        let contents = "abc  other\n0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  yt-dlp.exe\n";
        assert_eq!(
            expected_checksum(contents),
            Some("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string())
        );
    }
}
