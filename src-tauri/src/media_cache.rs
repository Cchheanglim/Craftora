//! A disk cache in front of a link's preview streams, so scrubbing through any part already
//! fetched is instant. The preview plays `http://cmedia.localhost/<id>` (a private Tauri
//! protocol, no network port): each byte range the player asks for is served from the
//! cache file when it's there, or fetched from the internet, saved and served. "Download
//! first" also fills the cache from start to end in the background (`prefetch_media`).

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, State};

/// Bytes fetched per request while playing: small, so a jump starts playing quickly.
const PLAY_CHUNK: u64 = 1024 * 1024;
/// Bytes fetched per request while filling the cache in the background.
const FILL_CHUNK: u64 = 4 * 1024 * 1024;
/// The most served from the cache in one answer (the player asks again for more).
const MAX_ANSWER: u64 = 8 * 1024 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

#[derive(Default)]
pub struct MediaCache(Mutex<HashMap<String, Arc<Entry>>>);

struct Entry {
    url: String,
    path: PathBuf,
    state: Mutex<Cached>,
}

#[derive(Default)]
struct Cached {
    /// The whole stream's size, once a response has told us.
    total: Option<u64>,
    content_type: Option<String>,
    /// Byte ranges already on disk, `[start, end)`, sorted and merged.
    ranges: Vec<(u64, u64)>,
    filling: bool,
}

impl Cached {
    /// Where the cached run starting at `at` ends, if `at` is cached.
    fn covered_until(&self, at: u64) -> Option<u64> {
        self.ranges.iter().find(|(s, e)| *s <= at && at < *e).map(|(_, e)| *e)
    }

    fn add(&mut self, start: u64, end: u64) {
        self.ranges.push((start, end));
        self.ranges.sort_unstable();
        let mut merged: Vec<(u64, u64)> = Vec::with_capacity(self.ranges.len());
        for (s, e) in self.ranges.drain(..) {
            match merged.last_mut() {
                Some(last) if s <= last.1 => last.1 = last.1.max(e),
                _ => merged.push((s, e)),
            }
        }
        self.ranges = merged;
    }

    fn cached_bytes(&self) -> u64 {
        self.ranges.iter().map(|(s, e)| e - s).sum()
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .build()
        .unwrap_or_default()
}

/// Positioned file I/O, so playing and filling never move each other's file cursor.
fn write_at(path: &PathBuf, offset: u64, data: &[u8]) -> std::io::Result<()> {
    let file = OpenOptions::new().create(true).truncate(false).write(true).open(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut written = 0;
        while written < data.len() {
            written += file.seek_write(&data[written..], offset + written as u64)?;
        }
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::FileExt;
        file.write_all_at(data, offset)?;
    }
    Ok(())
}

fn read_at(path: &PathBuf, offset: u64, len: u64) -> std::io::Result<Vec<u8>> {
    let file = File::open(path)?;
    let mut data = vec![0u8; len as usize];
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut read = 0;
        while read < data.len() {
            let n = file.seek_read(&mut data[read..], offset + read as u64)?;
            if n == 0 {
                break;
            }
            read += n;
        }
        data.truncate(read);
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::FileExt;
        file.read_exact_at(&mut data, offset)?;
    }
    Ok(data)
}

/// Fetches `[start, start + len)` from the internet into the cache; returns the bytes.
async fn fetch(entry: &Entry, start: u64, len: u64) -> Result<Vec<u8>, String> {
    let end = start + len - 1;
    let response = client()
        .get(&entry.url)
        .header(header::RANGE, format!("bytes={start}-{end}"))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the video: {e}"))?;
    if response.status() != StatusCode::PARTIAL_CONTENT {
        return Err(format!("The video's server answered {} instead of part of the file.", response.status()));
    }
    // "bytes 0-1048575/123456789": the total is after the slash.
    let total = response
        .headers()
        .get(header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit('/').next())
        .and_then(|t| t.parse::<u64>().ok());
    let content_type = response.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_string);
    let bytes = response.bytes().await.map_err(|e| format!("The video stopped downloading: {e}"))?.to_vec();
    write_at(&entry.path, start, &bytes).map_err(|e| format!("Couldn't save to the cache: {e}"))?;
    let mut state = entry.state.lock().unwrap();
    if total.is_some() {
        state.total = total;
    }
    if state.content_type.is_none() {
        state.content_type = content_type;
    }
    if !bytes.is_empty() {
        state.add(start, start + bytes.len() as u64);
    }
    Ok(bytes)
}

fn entry(app: &AppHandle, id: &str) -> Option<Arc<Entry>> {
    app.state::<MediaCache>().0.lock().unwrap().get(id).cloned()
}

/// Puts a link's preview stream behind the cache; returns the id the preview plays.
#[tauri::command]
pub fn cache_media(app: AppHandle, cache: State<'_, MediaCache>, url: String) -> Result<String, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only web links can be cached.".into());
    }
    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    let id = format!("{:016x}", hasher.finish());
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("streams");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create the cache folder: {e}"))?;
    let mut entries = cache.0.lock().unwrap();
    entries.entry(id.clone()).or_insert_with(|| {
        let path = dir.join(format!("{id}.bin"));
        // A cache file from an earlier run has no record of what's in it: start clean.
        let _ = std::fs::remove_file(&path);
        Arc::new(Entry { url, path, state: Mutex::new(Cached::default()) })
    });
    Ok(id)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FillProgress {
    id: String,
    /// 0–100.
    percent: f64,
}

/// Fills the whole cache from start to end in the background ("Download first").
#[tauri::command]
pub fn prefetch_media(app: AppHandle, id: String) -> Result<(), String> {
    let entry = entry(&app, &id).ok_or("That video isn't cached.")?;
    {
        let mut state = entry.state.lock().unwrap();
        if state.filling {
            return Ok(());
        }
        state.filling = true;
    }
    tauri::async_runtime::spawn(async move {
        let mut at = 0u64;
        let mut failures = 0;
        loop {
            let (total, covered) = {
                let state = entry.state.lock().unwrap();
                (state.total, state.covered_until(at))
            };
            if let Some(end) = covered {
                at = end;
            }
            if total.is_some_and(|t| at >= t) {
                break;
            }
            if covered.is_some() {
                continue;
            }
            let len = total.map_or(FILL_CHUNK, |t| FILL_CHUNK.min(t - at));
            match fetch(&entry, at, len).await {
                Ok(bytes) if !bytes.is_empty() => {
                    failures = 0;
                    at += bytes.len() as u64;
                }
                _ => {
                    failures += 1;
                    if failures > 5 {
                        break;
                    }
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
            let state = entry.state.lock().unwrap();
            if let Some(total) = state.total {
                let percent = (state.cached_bytes() as f64 / total as f64 * 100.0).min(100.0);
                let _ = app.emit("media-cache", FillProgress { id: id.clone(), percent });
            }
        }
        entry.state.lock().unwrap().filling = false;
    });
    Ok(())
}

fn reply(status: StatusCode, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap_or_default()
}

/// Answers the preview's request for `http://cmedia.localhost/<id>` with part of the stream.
pub async fn serve(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let id = request.uri().path().trim_start_matches('/').to_string();
    let Some(entry) = entry(app, &id) else {
        return reply(StatusCode::NOT_FOUND, b"Not cached".to_vec());
    };
    // "bytes=START-" or "bytes=START-END"; no range means from the start.
    let (start, wanted_end) = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes="))
        .and_then(|v| {
            let (s, e) = v.split_once('-')?;
            Some((s.parse::<u64>().ok()?, e.parse::<u64>().ok()))
        })
        .unwrap_or((0, None));
    answer(&entry, start, wanted_end).await
}

/// Part of the stream from `start` (to `wanted_end` at most): from disk when cached.
async fn answer(entry: &Entry, start: u64, wanted_end: Option<u64>) -> Response<Vec<u8>> {
    let (total, covered) = {
        let state = entry.state.lock().unwrap();
        (state.total, state.covered_until(start))
    };
    if total.is_some_and(|t| start >= t) {
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{}", total.unwrap_or(0)))
            .body(Vec::new())
            .unwrap_or_default();
    }

    let body = match covered {
        // Already on disk: answer from the cache, as much as is there (up to a limit).
        Some(run_end) => {
            let mut end = run_end.min(start + MAX_ANSWER);
            if let Some(w) = wanted_end {
                end = end.min(w + 1);
            }
            read_at(&entry.path, start, end - start)
        }
        // Not yet: fetch a small piece, keep it, and answer with it.
        None => {
            let mut len = PLAY_CHUNK;
            if let Some(w) = wanted_end {
                len = len.min(w + 1 - start);
            }
            if let Some(t) = total {
                len = len.min(t - start);
            }
            match fetch(entry, start, len.max(1)).await {
                Ok(bytes) => Ok(bytes),
                Err(message) => return reply(StatusCode::BAD_GATEWAY, message.into_bytes()),
            }
        }
    };
    let body = match body {
        Ok(b) if !b.is_empty() => b,
        _ => return reply(StatusCode::INTERNAL_SERVER_ERROR, b"Couldn't read the cache".to_vec()),
    };

    let state = entry.state.lock().unwrap();
    let total = state.total.map_or("*".to_string(), |t| t.to_string());
    let end = start + body.len() as u64 - 1;
    Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, state.content_type.clone().unwrap_or_else(|| "video/mp4".into()))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
        .header(header::CONTENT_LENGTH, body.len().to_string())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::Cached;

    /// Against a real server: `cargo test --lib -- --ignored live_cache`.
    #[tokio::test]
    #[ignore]
    async fn live_cache_serves_fetched_parts_from_disk() {
        let path = std::env::temp_dir().join("craftora-cache-test.bin");
        let _ = std::fs::remove_file(&path);
        let entry = super::Entry {
            url: "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4".into(),
            path: path.clone(),
            state: std::sync::Mutex::new(Cached::default()),
        };
        let timed = |label: &'static str| {
            let t = std::time::Instant::now();
            move |r: &tauri::http::Response<Vec<u8>>| {
                println!("{label}: {} {} bytes, {:?}", r.status(), r.body().len(), t.elapsed());
            }
        };
        let r = super::answer(&entry, 30_000_000, None).await;
        timed("jump to 30 MB, from the internet")(&r);
        assert_eq!(r.status(), 206);
        let fetched = r.body().clone();
        let done = timed("same spot again, from disk");
        let r = super::answer(&entry, 30_000_000, None).await;
        done(&r);
        assert_eq!(r.body(), &fetched);
        assert!(entry.state.lock().unwrap().total.unwrap() > 60_000_000);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn ranges_merge_and_report_coverage() {
        let mut c = Cached::default();
        c.add(10, 20);
        c.add(0, 5);
        c.add(5, 10);
        c.add(30, 40);
        assert_eq!(c.ranges, vec![(0, 20), (30, 40)]);
        assert_eq!(c.covered_until(7), Some(20));
        assert_eq!(c.covered_until(25), None);
        assert_eq!(c.cached_bytes(), 30);
    }
}
