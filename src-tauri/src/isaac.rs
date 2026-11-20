//! Converts an Isaac export's URDF to USD by running the `convert_to_usd` script written next to
//! it (Isaac Lab's `scripts/tools/convert_urdf.py` through `uv`), streaming its output to the
//! webview line by line. The script is the same one users run by hand, so both paths agree.

use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::ipc::Channel;
use tauri::State;

/// Isaac Lab's URDF to USD tool, relative to the checkout.
const CONVERT_TOOL: &[&str] = &["scripts", "tools", "convert_urdf.py"];

#[cfg(windows)]
const SCRIPT: &str = "convert_to_usd.ps1";
#[cfg(not(windows))]
const SCRIPT: &str = "convert_to_usd.sh";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Process id of the running conversion, so it can be cancelled.
#[derive(Default)]
pub struct IsaacState {
    pid: Arc<Mutex<Option<u32>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IsaacLabCheck {
    /// The checkout has the conversion tool and `uv` runs.
    ok: bool,
    /// Why it cannot convert, for the user.
    reason: Option<String>,
    /// `uv --version` output when uv was found.
    uv: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputLine {
    /// "stdout" or "stderr".
    stream: &'static str,
    text: String,
}

fn tool_path(isaac_lab: &Path) -> PathBuf {
    CONVERT_TOOL
        .iter()
        .fold(isaac_lab.to_path_buf(), |p, s| p.join(s))
}

fn command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

fn uv_version() -> Option<String> {
    let out = command("uv").arg("--version").output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Why `isaac_lab` cannot be used for conversion, or None when it can (uv aside).
fn checkout_problem(isaac_lab: &str) -> Option<String> {
    if isaac_lab.trim().is_empty() {
        return Some("No Isaac Lab folder is set. Choose it in Settings > General.".into());
    }
    let root = Path::new(isaac_lab);
    if !root.is_dir() {
        return Some(format!(
            "Isaac Lab was not found at {isaac_lab}. Install Isaac Lab 3 there or change the \
             folder in Settings > General."
        ));
    }
    if !tool_path(root).is_file() {
        return Some(format!(
            "{isaac_lab} has no scripts/tools/convert_urdf.py, so it is not an Isaac Lab checkout."
        ));
    }
    None
}

/// Whether Isaac Lab at `path` can convert URDF to USD.
#[tauri::command]
pub async fn isaac_check(path: String) -> IsaacLabCheck {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(reason) = checkout_problem(&path) {
            return IsaacLabCheck {
                ok: false,
                reason: Some(reason),
                uv: None,
            };
        }
        match uv_version() {
            Some(v) => IsaacLabCheck {
                ok: true,
                reason: None,
                uv: Some(v),
            },
            None => IsaacLabCheck {
                ok: false,
                reason: Some(
                    "uv was not found on PATH. Isaac Lab 3 runs through uv \
                     (https://docs.astral.sh/uv/); install it and restart URDF Forge."
                        .into(),
                ),
                uv: None,
            },
        }
    })
    .await
    .unwrap_or(IsaacLabCheck {
        ok: false,
        reason: Some("Could not check Isaac Lab.".into()),
        uv: None,
    })
}

/// Lines of `r`, sent to `out` as they arrive. Carriage returns (progress bars) end lines too.
fn pump(r: impl Read, stream: &'static str, out: Channel<OutputLine>) {
    let mut r = BufReader::new(r);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match r.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let s = String::from_utf8_lossy(&buf);
                for part in s.split(['\r', '\n']).filter(|p| !p.trim().is_empty()) {
                    let _ = out.send(OutputLine {
                        stream,
                        text: part.to_string(),
                    });
                }
            }
        }
    }
}

/// Run `<dir>/convert_to_usd.(ps1|sh)` against the Isaac Lab checkout, streaming its output.
/// Returns the script's exit code.
#[tauri::command]
pub async fn isaac_convert(
    dir: String,
    isaac_lab: String,
    on_output: Channel<OutputLine>,
    state: State<'_, IsaacState>,
) -> Result<i32, String> {
    if let Some(reason) = checkout_problem(&isaac_lab) {
        return Err(reason);
    }
    let script = Path::new(&dir).join(SCRIPT);
    if !script.is_file() {
        return Err(format!(
            "{} was not found. Export the robot again.",
            script.display()
        ));
    }
    let pid = state.pid.clone();
    if pid.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("A conversion is already running.".into());
    }

    #[cfg(windows)]
    let mut cmd = {
        let mut c = command("powershell.exe");
        c.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script)
        .arg("-IsaacLab")
        .arg(&isaac_lab);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        use std::os::unix::process::CommandExt;
        let mut c = command("bash");
        c.arg(&script).arg(&isaac_lab).process_group(0);
        c
    };
    cmd.current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start {SCRIPT}: {e}"))?;
    *pid.lock().map_err(|e| e.to_string())? = Some(child.id());
    let readers = [
        child.stdout.take().map(|r| {
            let out = on_output.clone();
            thread::spawn(move || pump(r, "stdout", out))
        }),
        child.stderr.take().map(|r| {
            let out = on_output.clone();
            thread::spawn(move || pump(r, "stderr", out))
        }),
    ];
    let status = tauri::async_runtime::spawn_blocking(move || {
        let status = child.wait();
        for t in readers.into_iter().flatten() {
            let _ = t.join();
        }
        status
    })
    .await
    .map_err(|e| e.to_string())?;
    *pid.lock().map_err(|e| e.to_string())? = None;
    let status = status.map_err(|e| e.to_string())?;
    Ok(status.code().unwrap_or(-1))
}

/// Stop the running conversion and everything it started (uv, Python, Kit).
#[tauri::command]
pub fn isaac_cancel(state: State<'_, IsaacState>) -> bool {
    let Some(pid) = state.pid.lock().ok().and_then(|p| *p) else {
        return false;
    };
    #[cfg(windows)]
    let ok = command("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status();
    #[cfg(not(windows))]
    let ok = command("kill").args(["-TERM", &format!("-{pid}")]).status();
    ok.map(|s| s.success()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explains_a_missing_checkout() {
        assert!(checkout_problem("").unwrap().contains("Settings"));
        let missing = checkout_problem("/definitely/not/isaac/lab").unwrap();
        assert!(missing.contains("was not found"));
        let not_lab = std::env::temp_dir();
        assert!(checkout_problem(not_lab.to_str().unwrap())
            .unwrap()
            .contains("convert_urdf.py"));
    }

    #[test]
    fn accepts_a_folder_with_the_tool() {
        let root = std::env::temp_dir().join(format!("isaac_lab_check_{}", std::process::id()));
        let tool = tool_path(&root);
        std::fs::create_dir_all(tool.parent().unwrap()).unwrap();
        std::fs::write(&tool, "").unwrap();
        assert_eq!(checkout_problem(root.to_str().unwrap()), None);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
