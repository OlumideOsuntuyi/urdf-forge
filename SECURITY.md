# Security policy

## Supported versions

Security fixes go into the latest release. Please update before reporting.

## Reporting a vulnerability

Do not open a public issue. Use **Report a vulnerability** on the repository's
[Security tab](https://github.com/OlumideOsuntuyi/urdf-forge/security/advisories/new)
(GitHub private vulnerability reporting). Include what you found, how to reproduce it, and the
impact you expect. We aim to acknowledge reports within five working days and to agree a
disclosure date with you.

## Security model

URDF Forge is a local desktop application. Things worth knowing when you assess a report:

- **Files.** The app can read and write any file your user account can, because opening CAD
  from anywhere and exporting into a ROS workspace is its purpose. Importers parse untrusted
  files (STEP, IGES, STL, URDF, `.forge`); a crash or hang from a crafted file is a bug we
  want to hear about.
- **Plugins** run inside the app with the same rights as the app. None runs until the user
  enables it, and the app asks for confirmation the first time. Treat a plugin like any other
  program you install.
- **MCP server.** On by default. It listens on `127.0.0.1` only, answers JSON-RPC over HTTP
  POST, and rejects requests whose `Origin` header is not a local origin, to block DNS-rebinding
  attacks from web pages. Without a token any local process can reach it while it is on; turn
  on **Require a token** in its settings to accept only requests carrying
  `Authorization: Bearer <token>`. Its tools can only do what the editor can do, and every edit
  is undoable.
- **Content Security Policy.** The webview forbids remote scripts and `eval`; WebAssembly is
  allowed for OpenCascade and the physics engine.
