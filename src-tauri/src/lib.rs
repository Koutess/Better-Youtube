use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};
use reqwest::Client;

// =====================================================
// DATA MODELS
// =====================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub thumbnail: String,
    pub published_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub videos: Vec<Video>,
}

fn default_playlists() -> Vec<Playlist> {
    vec![
        Playlist {
            id: "watch-later".into(),
            name: "Watch later".into(),
            videos: Vec::new(),
        }
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct LibraryState {
    pub api_key: String,
    pub region_code: String,
    pub queue: Vec<Video>,
    pub history: Vec<Video>,
    pub playlists: Vec<Playlist>,
    pub accent: String,
    pub always_on_top: bool,
}

impl Default for LibraryState {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            region_code: "NL".into(),
            queue: Vec::new(),
            history: Vec::new(),
            playlists: default_playlists(),
            accent: "red".into(),
            always_on_top: false,
        }
    }
}

// =====================================================
// YOUTUBE RESPONSE MODELS
// =====================================================

#[derive(Deserialize)]
struct Thumbnail {
    url: String,
}

#[derive(Default, Deserialize)]
struct Thumbnails {
    default: Option<Thumbnail>,
    medium: Option<Thumbnail>,
    high: Option<Thumbnail>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snippet {
    title: String,
    channel_title: String,
    published_at: String,
    #[serde(default)]
    thumbnails: Thumbnails,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchId {
    video_id: Option<String>,
}

#[derive(Deserialize)]
struct SearchItem {
    id: SearchId,
    snippet: Snippet,
}

#[derive(Default, Deserialize)]
struct SearchResponse {
    items: Vec<SearchItem>,
}

#[derive(Deserialize)]
struct TrendingItem {
    id: String,
    snippet: Snippet,
}

#[derive(Default, Deserialize)]
struct TrendingResponse {
    items: Vec<TrendingItem>,
}

// =====================================================
// HELPERS
// =====================================================

fn video_from_snippet(id: String, snippet: Snippet) -> Video {
    let thumbnail = snippet
        .thumbnails
        .high
        .or(snippet.thumbnails.medium)
        .or(snippet.thumbnails.default)
        .map(|image| image.url)
        .unwrap_or_default();

    Video {
        id,
        title: snippet.title,
        channel: snippet.channel_title,
        thumbnail,
        published_at: snippet.published_at,
    }
}

fn library_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    fs::create_dir_all(&directory)
        .map_err(|e| e.to_string())?;

    Ok(directory.join("library.json"))
}

fn validate_api_key(key: &str) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err(
            "Add your YouTube Data API key in LTX Settings.".into()
        );
    }

    Ok(())
}

// =====================================================
// LOCAL STORAGE
// =====================================================

#[tauri::command]
pub fn load_library(
    app: AppHandle
) -> Result<LibraryState, String> {
    let path = library_path(&app)?;

    if !path.exists() {
        return Ok(LibraryState::default());
    }

    let contents = fs::read_to_string(path)
        .map_err(|e| e.to_string())?;

    let state: LibraryState =
        serde_json::from_str(&contents)
            .map_err(|e| e.to_string())?;

    Ok(state)
}

#[tauri::command]
pub fn save_library(
    app: AppHandle,
    mut state: LibraryState,
) -> Result<(), String> {
    let path = library_path(&app)?;

    state.history.truncate(100);
    state.queue.truncate(100);

    if state.playlists.is_empty() {
        state.playlists = default_playlists();
    }

    let contents = serde_json::to_string_pretty(&state)
        .map_err(|e| e.to_string())?;

    fs::write(path, contents)
        .map_err(|e| e.to_string())?;

    Ok(())
}

// =====================================================
// YOUTUBE SEARCH
// =====================================================

#[tauri::command(rename_all = "camelCase")]
pub async fn search_videos(
    api_key: String,
    query: String,
    category: Option<String>,
) -> Result<Vec<Video>, String> {
    validate_api_key(&api_key)?;

    if query.trim().is_empty() {
        return Err("Enter a search term.".into());
    }

    let client = Client::new();

    let mut params = vec![
        ("part", "snippet"),
        ("q", query.trim()),
        ("type", "video"),
        ("maxResults", "24"),
        ("safeSearch", "strict"),
        ("key", api_key.trim()),
    ];

    if let Some(ref category_id) = category {
        if !category_id.is_empty() {
            params.push(("videoCategoryId", category_id.as_str()));
        }
    }

    let response = client
        .get("https://www.googleapis.com/youtube/v3/search")
        .query(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();

        return Err(format!(
            "YouTube search failed ({}): {}",
            status,
            body
        ));
    }

    let result = response
        .json::<SearchResponse>()
        .await
        .map_err(|e| e.to_string())?;

    let videos = result
        .items
        .into_iter()
        .filter_map(|item| {
            item.id.video_id.map(|id| {
                video_from_snippet(id, item.snippet)
            })
        })
        .collect();

    Ok(videos)
}

// =====================================================
// TRENDING VIDEOS
// =====================================================

#[tauri::command(rename_all = "camelCase")]
pub async fn trending_videos(
    api_key: String,
    region_code: String,
) -> Result<Vec<Video>, String> {
    validate_api_key(&api_key)?;

    let region = if region_code.trim().is_empty() {
        "NL"
    } else {
        region_code.trim()
    };

    let client = Client::new();

    let response = client
        .get("https://www.googleapis.com/youtube/v3/videos")
        .query(&[
            ("part", "snippet"),
            ("chart", "mostPopular"),
            ("maxResults", "24"),
            ("regionCode", region),
            ("key", api_key.trim()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();

        return Err(format!(
            "Trending request failed ({}): {}",
            status,
            body
        ));
    }

    let result = response
        .json::<TrendingResponse>()
        .await
        .map_err(|e| e.to_string())?;

    Ok(
        result.items
            .into_iter()
            .map(|item| video_from_snippet(item.id, item.snippet))
            .collect()
    )
}

// =====================================================
// WINDOW CONTROL
// =====================================================

#[tauri::command]
pub fn set_always_on_top(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    window
        .set_always_on_top(enabled)
        .map_err(|e| e.to_string())?;

    Ok(())
}

// =====================================================
// APPLICATION ENTRY
// =====================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(
            tauri::generate_handler![
                load_library,
                save_library,
                search_videos,
                trending_videos,
                set_always_on_top
            ]
        )
        .run(tauri::generate_context!())
        .expect("Failed to launch LTX");
}
