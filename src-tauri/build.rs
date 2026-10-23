fn main() {
    vt_key_from_dot_env();
    tauri_build::build()
}

/// "Is this link safe?" needs the project's VirusTotal key at build time (`CRAFTORA_VT_KEY`, see
/// src/virustotal.rs). The release build gets it from a GitHub secret; on the owner's PC it can sit
/// in the gitignored `.env` file at the repository root as `CRAFTORA_VT_KEY = …`.
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
