fn main() {
    vt_key_from_dot_env();
    tauri_build::build()
}

/// "Is this link safe?" uses the user's own VirusTotal key (Settings → Links). A build on the
/// owner's PC can also carry one as a fallback, from `CRAFTORA_VT_KEY` or the gitignored `.env`
/// at the repository root (`CRAFTORA_VT_KEY = …`); release builds don't.
fn vt_key_from_dot_env() {
    println!("cargo:rerun-if-env-changed=CRAFTORA_VT_KEY");
    if std::env::var_os("CRAFTORA_VT_KEY").is_some() {
        return;
    }
    let path = std::path::Path::new("../.env");
    if !path.is_file() {
        return;
    }
    println!("cargo:rerun-if-changed=../.env");
    let Ok(text) = std::fs::read_to_string(path) else { return };
    let key = text.lines().find_map(|line| {
        let (name, value) = line.split_once('=')?;
        (name.trim() == "CRAFTORA_VT_KEY").then(|| value.trim().trim_matches('"').trim_matches('\'').to_string())
    });
    if let Some(key) = key.filter(|k| !k.is_empty()) {
        println!("cargo:rustc-env=CRAFTORA_VT_KEY={key}");
    }
}
