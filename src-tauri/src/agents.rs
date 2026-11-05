//! The assistant's link to AI already on this PC, used instead of an API key: agent programs
//! (Claude Code, Codex, Gemini CLI, Antigravity), run once per step with the conversation as text
//! (`src/assistant/agentText.ts`) and their file and command tools blocked, and local AI servers
//! that take ChatGPT's request shape (Ollama, LM Studio, or any address on this PC). The UI only
//! names a program; which file runs, and with which options, is decided here.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::assistant::ModelInfo;

/// The longest one step may take before the program is stopped (local models can be slow too).
const STEP_LIMIT: Duration = Duration::from_secs(300);

/// Replaces Claude Code's own coding instructions; the real ones are in the prompt.
const CLAUDE_SYSTEM: &str = "You are the editing assistant inside Craftora, a video editor. Follow the instructions in the message and reply in the JSON format it asks for.";

/// Local AI apps that are looked for at their usual address.
const SERVERS: [(&str, &str); 2] = [("Ollama", "http://127.0.0.1:11434/v1"), ("LM Studio", "http://127.0.0.1:1234/v1")];

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Program {
    Claude,
    Codex,
    GeminiCli,
    Antigravity,
}

impl Program {
    const ALL: [Program; 4] = [Program::Claude, Program::Codex, Program::GeminiCli, Program::Antigravity];

    /// As the UI names it (the serde name).
    fn id(self) -> &'static str {
        match self {
            Program::Claude => "claude",
            Program::Codex => "codex",
            Program::GeminiCli => "gemini-cli",
            Program::Antigravity => "antigravity",
        }
    }

    fn name(self) -> &'static str {
        match self {
            Program::Claude => "Claude Code",
            Program::Codex => "Codex",
            Program::GeminiCli => "Gemini CLI",
            Program::Antigravity => "Antigravity",
        }
    }

    /// Its file names: the installer's own, then npm's launcher.
    fn files(self) -> &'static [&'static str] {
        match self {
            Program::Claude => &["claude.exe", "claude.cmd"],
            Program::Codex => &["codex.exe", "codex.cmd"],
            Program::GeminiCli => &["gemini.exe", "gemini.cmd"],
            Program::Antigravity => &["agy.exe"],
        }
    }

    /// Where its installer puts it, for when that folder isn't on Craftora's PATH (it was
    /// installed after signing in to Windows).
    fn usual_dirs(self) -> Vec<PathBuf> {
        let under = |var: &str, rest: &str| std::env::var_os(var).map(|dir| PathBuf::from(dir).join(rest));
        match self {
            Program::Claude => under("USERPROFILE", ".local\\bin"),
            Program::Codex | Program::GeminiCli => under("APPDATA", "npm"),
            Program::Antigravity => under("LOCALAPPDATA", "agy\\bin"),
        }
        .into_iter()
        .collect()
    }

    fn find(self) -> Option<PathBuf> {
        let path = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default();
        path.into_iter()
            .chain(self.usual_dirs())
            .flat_map(|dir| self.files().iter().map(move |file| dir.join(file)))
            .find(|file| file.is_file())
    }

    /// One answer, nothing saved, own tools blocked: Claude Code's are switched off, Codex and
    /// Gemini CLI run read-only, Antigravity's print mode refuses commands and edits.
    fn args(self) -> Vec<&'static str> {
        match self {
            Program::Claude => vec![
                "-p",
                "--output-format",
                "json",
                "--tools",
                "",
                "--strict-mcp-config",
                "--disable-slash-commands",
                "--no-session-persistence",
                "--setting-sources",
                "",
                "--system-prompt",
                CLAUDE_SYSTEM,
            ],
            Program::Codex => vec!["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "-"],
            Program::GeminiCli => vec!["--output-format", "json", "--approval-mode", "plan", "--extensions", "none", "-p", ""],
            Program::Antigravity => vec![
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--mode",
                "plan",
                "--disable-slash-commands",
                "-p",
                "",
            ],
        }
    }

    /// The prompt goes in through stdin: too long for a command line.
    fn input(self, prompt: &str) -> String {
        match self {
            Program::Antigravity => format!("{}\n", json!({ "event": "user", "message": { "content": prompt } })),
            _ => prompt.to_string(),
        }
    }

    /// The answer in the program's output, or what went wrong in its words; None if the output
    /// isn't what this program prints.
    fn reply(self, out: &str) -> Option<Result<String, String>> {
        let text = |v: &Value| v.as_str().map(str::to_string);
        match self {
            Program::Claude => {
                let answer = json_in(out)?;
                let result = text(&answer["result"])?;
                Some(if answer["is_error"].as_bool() == Some(true) { Err(result) } else { Ok(result) })
            }
            Program::GeminiCli => {
                let answer = json_in(out)?;
                match text(&answer["response"]) {
                    Some(response) => Some(Ok(response)),
                    None => text(&answer["error"]["message"]).map(Err),
                }
            }
            Program::Antigravity => {
                let result = out.lines().filter_map(|line| serde_json::from_str::<Value>(line).ok()).find(|v| v["event"] == "result")?;
                let result = &result["result"];
                if result["status"] == "SUCCESS" {
                    text(&result["response"]).map(Ok)
                } else {
                    Some(Err(text(&result["error"]).unwrap_or_else(|| "it stopped without answering".into())))
                }
            }
            Program::Codex => Some(out.trim()).filter(|t| !t.is_empty()).map(|t| Ok(t.to_string())),
        }
    }
}

/// The JSON object a program printed, after any warning lines before it.
fn json_in(out: &str) -> Option<Value> {
    let start = if out.starts_with('{') { 0 } else { out.find("\n{")? + 1 };
    serde_json::from_str(out[start..].trim()).ok()
}

/// Stops a program and whatever it started (npm's launchers start Node).
fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    let _ = child.kill();
}

fn read_all(mut pipe: impl Read + Send + 'static) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).into_owned()
    })
}

fn run(program: Program, prompt: &str) -> Result<String, String> {
    let name = program.name();
    let exe = program.find().ok_or_else(|| format!("{name} isn't installed on this PC any more."))?;
    // An empty folder of its own: nothing there to read or change, and no project rules to load.
    let dir = std::env::temp_dir().join("craftora-agent");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't start {name}: {e}"))?;
    let mut command = Command::new(&exe);
    command
        .args(program.args())
        .current_dir(&dir)
        // Set when Craftora was started from inside Claude Code; Claude Code then refuses to start.
        .env_remove("CLAUDECODE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|e| format!("Couldn't start {name}: {e}"))?;
    let input = program.input(prompt);
    let mut stdin = child.stdin.take().expect("piped");
    // Written on its own thread so a full output pipe can't stall it; dropping it closes stdin.
    std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    let out = read_all(child.stdout.take().expect("piped"));
    let err = read_all(child.stderr.take().expect("piped"));
    let deadline = Instant::now() + STEP_LIMIT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                kill_tree(&mut child);
                return Err(format!("{name} took more than 5 minutes to answer, so it was stopped."));
            }
        }
    };
    let (out, err) = (out.join().unwrap_or_default(), err.join().unwrap_or_default());
    match program.reply(&out) {
        Some(Ok(answer)) if status.success() || !answer.is_empty() => Ok(answer),
        Some(Err(why)) => Err(format!("{name}: {why}")),
        _ => {
            let last = err.lines().chain(out.lines()).map(str::trim).rfind(|l| !l.is_empty()).unwrap_or("it stopped without answering");
            Err(format!("{name} couldn't answer: {}", last.chars().take(300).collect::<String>()))
        }
    }
}

/// One step: `prompt` to `program`, its answer as text.
#[tauri::command]
pub async fn agent_run(program: Program, prompt: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run(program, &prompt)).await.map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct Found {
    /// A program's id or a server's address.
    id: String,
    name: String,
    kind: &'static str,
    ready: bool,
    detail: String,
}

/// The agent programs installed on this PC and the local AI servers answering right now.
#[tauri::command]
pub async fn agents_scan() -> Vec<Found> {
    let mut found: Vec<Found> = Program::ALL
        .iter()
        .map(|p| {
            let path = p.find();
            Found {
                id: p.id().into(),
                name: p.name().into(),
                kind: "program",
                ready: path.is_some(),
                detail: path.map_or("Not installed".into(), |f| f.display().to_string()),
            }
        })
        .collect();
    if let Ok(client) = local_client(Duration::from_millis(800)) {
        for (name, address) in SERVERS {
            // Nothing listening is refused at once, so asking one after another is quick.
            let ready = client.get(format!("{address}/models")).send().await.is_ok_and(|r| r.status().is_success());
            let detail = if ready { address.into() } else { "Not running".into() };
            found.push(Found { id: address.into(), name: name.into(), kind: "server", ready, detail });
        }
    }
    found
}

/// `address` tidied (no trailing slash; "/v1" added when it has no path, as Ollama and LM Studio
/// expect), if it's on this PC. Only this PC: the owner chose local AI only, and it means the UI
/// can't point Craftora's requests at another computer.
fn local_address(address: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(address.trim()).map_err(|_| "That isn't a web address. It looks like http://localhost:11434/v1".to_string())?;
    let host = url.host_str().unwrap_or("").trim_start_matches('[').trim_end_matches(']');
    let on_this_pc = host.eq_ignore_ascii_case("localhost") || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback());
    if !matches!(url.scheme(), "http" | "https") || !on_this_pc {
        return Err("Only an address on this PC works here, such as http://localhost:11434/v1".into());
    }
    let tidy = url.as_str().trim_end_matches('/').to_string();
    Ok(if url.path() == "/" { format!("{tidy}/v1") } else { tidy })
}

/// Local servers are reached directly, never through the proxy.
fn local_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder().no_proxy().timeout(timeout).build().map_err(|e| e.to_string())
}

async fn local_call(request: reqwest::RequestBuilder, address: &str) -> Result<Value, String> {
    let response = request.send().await.map_err(|e| {
        if e.is_timeout() {
            "The local AI took too long to answer.".to_string()
        } else if e.is_connect() {
            format!("Nothing answered at {address}. Start your local AI app, then try again.")
        } else {
            format!("Couldn't reach the local AI: {e}")
        }
    })?;
    let status = response.status();
    let answer: Value = response.json().await.map_err(|_| format!("{address} didn't answer like an AI server."))?;
    if !status.is_success() {
        let detail = answer["error"]["message"].as_str().or(answer["error"].as_str()).unwrap_or("no details");
        let hint = if detail.contains("tools") { " Pick a model that supports tools." } else { "" };
        return Err(format!("The local AI said: {detail}.{hint}"));
    }
    Ok(answer)
}

/// The models a local AI server has.
#[tauri::command]
pub async fn local_models(address: String) -> Result<Vec<ModelInfo>, String> {
    let address = local_address(&address)?;
    let answer = local_call(local_client(Duration::from_secs(5))?.get(format!("{address}/models")), &address).await?;
    let models: Vec<ModelInfo> = answer["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["id"].as_str())
        .map(|id| ModelInfo { id: id.into(), label: id.into() })
        .collect();
    if models.is_empty() {
        return Err(format!("{address} has no models yet. Download one in your local AI app first."));
    }
    Ok(models)
}

/// One request (ChatGPT's shape) to a local AI server.
#[tauri::command]
pub async fn local_generate(address: String, body: Value) -> Result<Value, String> {
    let address = local_address(&address)?;
    local_call(local_client(STEP_LIMIT)?.post(format!("{address}/chat/completions")).json(&body), &address).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_addresses_on_this_pc() {
        assert_eq!(local_address("http://localhost:11434").unwrap(), "http://localhost:11434/v1");
        assert_eq!(local_address(" http://127.0.0.1:1234/v1/ ").unwrap(), "http://127.0.0.1:1234/v1");
        assert_eq!(local_address("http://[::1]:8642/api").unwrap(), "http://[::1]:8642/api");
        assert!(local_address("http://192.168.1.5:11434/v1").is_err());
        assert!(local_address("http://localhost.evil.com/v1").is_err());
        assert!(local_address("file:///C:/x").is_err());
        assert!(local_address("localhost:11434").is_err());
    }

    #[test]
    fn reads_each_programs_answer() {
        let claude = "warning line\n{\"type\":\"result\",\"is_error\":false,\"result\":\"{\\\"say\\\":\\\"hi\\\"}\"}";
        assert_eq!(Program::Claude.reply(claude), Some(Ok("{\"say\":\"hi\"}".into())));
        let claude_failed = "{\"is_error\":true,\"result\":\"Not logged in\"}";
        assert_eq!(Program::Claude.reply(claude_failed), Some(Err("Not logged in".into())));
        let gemini = "{\n  \"response\": \"ok\",\n  \"stats\": {}\n}";
        assert_eq!(Program::GeminiCli.reply(gemini), Some(Ok("ok".into())));
        assert_eq!(Program::GeminiCli.reply("{\"error\":{\"message\":\"quota\"}}"), Some(Err("quota".into())));
        let agy = "{\"event\":\"init\"}\n{\"event\":\"result\",\"result\":{\"status\":\"SUCCESS\",\"response\":\"ok\\n\"}}";
        assert_eq!(Program::Antigravity.reply(agy), Some(Ok("ok\n".into())));
        let agy_failed = "{\"event\":\"result\",\"result\":{\"status\":\"ERROR\",\"error\":\"empty prompt\"}}";
        assert_eq!(Program::Antigravity.reply(agy_failed), Some(Err("empty prompt".into())));
        assert_eq!(Program::Codex.reply("  done \n"), Some(Ok("done".into())));
        assert_eq!(Program::Claude.reply("Error: not json"), None);
    }
}
