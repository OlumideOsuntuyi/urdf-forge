//! Model Context Protocol server (Streamable HTTP transport, JSON responses).
//!
//! The server binds to 127.0.0.1 only and rejects requests whose `Origin` is not local, which
//! guards against DNS-rebinding attacks from web pages. `initialize` and `ping` are answered
//! here; `tools/list` and `tools/call` are forwarded to the webview, which owns the tools, and
//! the reply comes back through the `mcp_respond` command.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tiny_http::{Header, Method, Request, Response, Server};

const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY: usize = 16 * 1024 * 1024;
const TOOL_TIMEOUT: Duration = Duration::from_secs(300);

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;

struct Running {
    server: Arc<Server>,
    port: u16,
}

#[derive(Default)]
pub struct McpState {
    running: Mutex<Option<Running>>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
}

#[derive(Serialize)]
pub struct Status {
    running: bool,
    port: u16,
    url: String,
    error: Option<String>,
}

fn status(port: u16, running: bool, error: Option<String>) -> Status {
    Status {
        running,
        port,
        url: if running {
            format!("http://127.0.0.1:{port}/mcp")
        } else {
            String::new()
        },
        error,
    }
}

#[tauri::command]
pub fn mcp_start(app: AppHandle, state: State<'_, McpState>, port: u16) -> Status {
    let mut running = state.running.lock().unwrap();
    if let Some(r) = running.as_ref() {
        if r.port == port {
            return status(port, true, None);
        }
        r.server.unblock();
    }
    *running = None;
    let server = match Server::http(("127.0.0.1", port)) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            return status(
                port,
                false,
                Some(format!("Could not listen on port {port}: {e}")),
            )
        }
    };
    let srv = server.clone();
    let pending = state.pending.clone();
    let next_id = state.next_id.clone();
    thread::spawn(move || {
        for request in srv.incoming_requests() {
            let app = app.clone();
            let pending = pending.clone();
            let next_id = next_id.clone();
            thread::spawn(move || handle(request, &app, &pending, &next_id));
        }
    });
    *running = Some(Running { server, port });
    status(port, true, None)
}

#[tauri::command]
pub fn mcp_stop(state: State<'_, McpState>) -> Status {
    let mut running = state.running.lock().unwrap();
    let port = running.as_ref().map(|r| r.port).unwrap_or(0);
    if let Some(r) = running.take() {
        r.server.unblock();
    }
    status(port, false, None)
}

#[tauri::command]
pub fn mcp_status(state: State<'_, McpState>) -> Status {
    match state.running.lock().unwrap().as_ref() {
        Some(r) => status(r.port, true, None),
        None => status(0, false, None),
    }
}

#[tauri::command]
pub fn mcp_respond(state: State<'_, McpState>, id: u64, result: Value) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(result);
    }
}

/// Without a standing SSE stream there is nobody to notify; clients re-list tools on demand.
#[tauri::command]
pub fn mcp_notify_tools_changed() {}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

fn origin_allowed(req: &Request) -> bool {
    match req.headers().iter().find(|h| h.field.equiv("Origin")) {
        None => true,
        Some(h) => {
            let o = h.value.as_str();
            [
                "http://127.0.0.1",
                "http://localhost",
                "https://127.0.0.1",
                "https://localhost",
            ]
            .iter()
            .any(|p| o == *p || o.starts_with(&format!("{p}:")))
        }
    }
}

fn respond(req: Request, code: u16, body: Option<Value>) {
    let mut resp = match body {
        Some(v) => Response::from_string(v.to_string())
            .with_header(header("Content-Type", "application/json")),
        None => Response::from_string(String::new()),
    }
    .with_status_code(code);
    if code == 405 {
        resp = resp.with_header(header("Allow", "POST"));
    }
    let _ = req.respond(resp);
}

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn handle(mut req: Request, app: &AppHandle, pending: &Pending, next_id: &AtomicU64) {
    if !origin_allowed(&req) {
        return respond(req, 403, Some(json!({ "error": "Origin not allowed" })));
    }
    let path = req.url().split('?').next().unwrap_or("").to_string();
    if path != "/mcp" && path != "/" {
        return respond(req, 404, None);
    }
    match req.method() {
        Method::Post => {}
        Method::Delete => return respond(req, 200, None),
        _ => return respond(req, 405, None),
    }
    let mut body = String::new();
    if req
        .as_reader()
        .take(MAX_BODY as u64)
        .read_to_string(&mut body)
        .is_err()
    {
        return respond(
            req,
            400,
            Some(rpc_error(&Value::Null, -32700, "Unreadable body")),
        );
    }
    let parsed: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            return respond(
                req,
                400,
                Some(rpc_error(
                    &Value::Null,
                    -32700,
                    &format!("Parse error: {e}"),
                )),
            )
        }
    };
    let batch = parsed.is_array();
    let messages = match parsed {
        Value::Array(a) => a,
        v => vec![v],
    };
    let replies: Vec<Value> = messages
        .iter()
        .filter_map(|m| dispatch(m, app, pending, next_id))
        .collect();
    if replies.is_empty() {
        return respond(req, 202, None);
    }
    let out = if batch {
        Value::Array(replies)
    } else {
        replies.into_iter().next().unwrap()
    };
    respond(req, 200, Some(out));
}

/// Returns a JSON-RPC response for requests, or None for notifications and responses.
fn dispatch(msg: &Value, app: &AppHandle, pending: &Pending, next_id: &AtomicU64) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg.get("method").and_then(Value::as_str)?;
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => {
            let asked = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("");
            let version = if PROTOCOL_VERSIONS.contains(&asked) {
                asked
            } else {
                PROTOCOL_VERSIONS[0]
            };
            json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "urdf-forge", "title": "URDF Forge", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Tools act on the robot open in URDF Forge. Call get_robot first. Edits are undoable in the app."
            })
        }
        "ping" => json!({}),
        "tools/list" | "tools/call" => match forward(method, params, app, pending, next_id) {
            Ok(v) => v,
            Err(e) => return Some(rpc_error(&id, -32603, &e)),
        },
        _ => {
            return Some(rpc_error(
                &id,
                -32601,
                &format!("Method not found: {method}"),
            ))
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn forward(
    method: &str,
    params: Value,
    app: &AppHandle,
    pending: &Pending,
    next_id: &AtomicU64,
) -> Result<Value, String> {
    let id = next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    pending.lock().unwrap().insert(id, tx);
    if let Err(e) = app.emit(
        "mcp://request",
        json!({ "id": id, "method": method, "params": params }),
    ) {
        pending.lock().unwrap().remove(&id);
        return Err(format!("Could not reach the editor: {e}"));
    }
    match rx.recv_timeout(TOOL_TIMEOUT) {
        Ok(v) => Ok(v),
        Err(_) => {
            pending.lock().unwrap().remove(&id);
            Err("The editor did not answer in time.".into())
        }
    }
}
