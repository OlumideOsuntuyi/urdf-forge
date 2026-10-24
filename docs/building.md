# Building URDF Forge

## Prerequisites

- Node.js 20 or newer
- Rust stable (`rustup`)
- Platform libraries from the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):
  - **Windows:** Microsoft C++ Build Tools ("Desktop development with C++") and WebView2
    (preinstalled on Windows 10/11).
  - **macOS:** Xcode Command Line Tools.
  - **Linux (Debian/Ubuntu):**
    `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

## Desktop

```bash
npm ci
npm run app:dev      # development build with hot reload
npm run app:build    # release build and installers in src-tauri/target/release/bundle
```

Installers produced per OS: `.msi` and NSIS `.exe` (Windows), `.app` and `.dmg` (macOS),
`.AppImage`, `.deb` and `.rpm` (Linux). Code signing is optional; the release workflow reads the
signing secrets listed in `.github/workflows/release.yml` when they are set.

## Android

Install, in addition to the desktop prerequisites:

- A JDK 17 (or the one bundled with Android Studio), with `JAVA_HOME` set
- The Android SDK with platform-tools, a platform (API 36) and build-tools, and the NDK,
  with `ANDROID_HOME` and `NDK_HOME` set
- The Rust Android targets:
  `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`

Then:

```bash
npm run android:init                 # once: generates src-tauri/gen/android
npm run android:dev                  # run on a connected device or emulator
npm run android:build -- --apk       # release APKs in src-tauri/gen/android/app/build/outputs/apk
```

Commit `src-tauri/gen/android` after `android:init` if you customise it (for example to add
release signing). To sign release builds, follow
[Tauri's Android signing guide](https://v2.tauri.app/distribute/sign/android/): create a
keystore, add `keystore.properties`, and reference it from `app/build.gradle.kts`. The release
workflow writes `keystore.properties` from the `ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD`
and `ANDROID_KEY_ALIAS` secrets.

On Android, file dialogs use the system document picker, export works best as a zip, and the
MCP server is not started (there is no desktop assistant to connect).

## Tests and checks

```bash
npm run typecheck
npm run lint
npm test
cargo clippy --manifest-path src-tauri/Cargo.toml   # after `npx vite build`
```

The STEP tests use the sample files shipped with `occt-import-js`, so they need no network.
