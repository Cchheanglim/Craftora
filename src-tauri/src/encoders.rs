//! Picks the fastest H.264 encoder this PC has: NVIDIA (NVENC), Intel (Quick Sync) or AMD
//! (AMF) graphics, else the processor (x264). Found once with a tiny test encode, at
//! startup, so exports don't wait for it.

use std::sync::OnceLock;

use serde::Deserialize;
use tauri::AppHandle;

use crate::engine::{run_to_end, FFMPEG};

/// The Export panel's speed choice.
#[derive(Deserialize, Clone, Copy, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    /// The graphics card when there is one, else a quick processor setting.
    #[default]
    Fast,
    /// The processor at a slow, careful setting: smaller files, longer wait.
    Best,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Encoder {
    Nvenc,
    QuickSync,
    Amf,
    Software,
}

impl Encoder {
    fn codec(self) -> &'static str {
        match self {
            Encoder::Nvenc => "h264_nvenc",
            Encoder::QuickSync => "h264_qsv",
            Encoder::Amf => "h264_amf",
            Encoder::Software => "libx264",
        }
    }

    pub fn is_hardware(self) -> bool {
        self != Encoder::Software
    }

    /// What the Export panel tells the user.
    fn label(self) -> &'static str {
        match self {
            Encoder::Nvenc => "your NVIDIA graphics card",
            Encoder::QuickSync => "your Intel graphics",
            Encoder::Amf => "your AMD graphics card",
            Encoder::Software => "the processor",
        }
    }

    /// FFmpeg arguments for this encoder. Quality levels are set so the hardware and the
    /// quick processor setting look about the same.
    pub fn args(self, quality: Quality) -> Vec<String> {
        let args: &[&str] = match (self, quality) {
            (Encoder::Nvenc, _) => &["-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq", "-rc", "vbr", "-cq", "23", "-b:v", "0", "-pix_fmt", "yuv420p"],
            (Encoder::QuickSync, _) => &["-c:v", "h264_qsv", "-preset", "faster", "-global_quality", "23", "-pix_fmt", "nv12"],
            (Encoder::Amf, _) => &["-c:v", "h264_amf", "-quality", "speed", "-rc", "cqp", "-qp_i", "22", "-qp_p", "24", "-pix_fmt", "yuv420p"],
            (Encoder::Software, Quality::Fast) => &["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"],
            (Encoder::Software, Quality::Best) => &["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p"],
        };
        args.iter().map(|s| s.to_string()).collect()
    }
}

static HARDWARE: OnceLock<Option<Encoder>> = OnceLock::new();

/// Whether `encoder` really works here: drivers can be missing even when FFmpeg knows it.
async fn works(app: &AppHandle, encoder: Encoder) -> bool {
    let args = ["-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=black:s=640x360:r=30:d=0.5", "-c:v", encoder.codec(), "-f", "null", "-"];
    run_to_end(app, FFMPEG, &args).await.is_ok_and(|out| out.status.success())
}

/// The graphics-card encoder to use, if any (tested once, then remembered).
pub async fn hardware(app: &AppHandle) -> Option<Encoder> {
    if let Some(found) = HARDWARE.get() {
        return *found;
    }
    let mut found = None;
    for encoder in [Encoder::Nvenc, Encoder::QuickSync, Encoder::Amf] {
        if works(app, encoder).await {
            found = Some(encoder);
            break;
        }
    }
    *HARDWARE.get_or_init(|| found)
}

/// The encoder a timeline render uses.
pub async fn for_render(app: &AppHandle, quality: Quality) -> Encoder {
    match quality {
        Quality::Best => Encoder::Software,
        Quality::Fast => hardware(app).await.unwrap_or(Encoder::Software),
    }
}

/// What does the encoding for the "Fast" setting, in words, for the Export panel.
#[tauri::command]
pub async fn export_encoder(app: AppHandle) -> String {
    hardware(&app).await.unwrap_or(Encoder::Software).label().to_string()
}
