//! Expands `.xacro` robot descriptions with the system `xacro` from ROS 2, so they open as
//! written (macros, arguments, `$(find pkg)` and includes) instead of half-parsed.

use std::io::ErrorKind;
use std::process::Command;

const NOT_FOUND: &str = "xacro was not found. Install ROS 2 and start URDF Forge from a terminal \
where ROS and your workspace are sourced, or run xacro yourself and open the .urdf.";

/// `xacro <path> [name:=value ...]`, returning the expanded URDF.
#[tauri::command]
pub async fn xacro_expand(path: String, args: Vec<String>) -> Result<String, String> {
    if let Some(bad) = args.iter().find(|a| !a.contains(":=")) {
        return Err(format!(
            "Not a xacro argument (expected name:=value): {bad}"
        ));
    }
    tauri::async_runtime::spawn_blocking(move || run(&path, &args))
        .await
        .map_err(|e| e.to_string())?
}

fn run(path: &str, args: &[String]) -> Result<String, String> {
    let out = match Command::new("xacro").arg(path).args(args).output() {
        Ok(o) => o,
        Err(e) if e.kind() == ErrorKind::NotFound => return Err(NOT_FOUND.into()),
        Err(e) => return Err(format!("Could not run xacro: {e}")),
    };
    if !out.status.success() {
        return Err(failure_message(&String::from_utf8_lossy(&out.stderr)));
    }
    String::from_utf8(out.stdout).map_err(|_| "xacro produced output that is not UTF-8.".into())
}

/// The end of xacro's error output, which is where the reason is.
fn failure_message(stderr: &str) -> String {
    let lines: Vec<&str> = stderr.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail = lines[lines.len().saturating_sub(6)..].join("\n");
    if tail.is_empty() {
        "xacro failed without an error message.".into()
    } else {
        format!("xacro failed:\n{tail}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_last_lines_of_stderr() {
        let err = (1..=10)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let msg = failure_message(&err);
        assert!(msg.starts_with("xacro failed:\nline 5"));
        assert!(msg.ends_with("line 10"));
        assert_eq!(
            failure_message("\n \n"),
            "xacro failed without an error message."
        );
    }

    #[test]
    fn rejects_arguments_without_assignment() {
        let r = tauri::async_runtime::block_on(xacro_expand("x.xacro".into(), vec!["oops".into()]));
        assert!(r.unwrap_err().contains("name:=value"));
    }
}
