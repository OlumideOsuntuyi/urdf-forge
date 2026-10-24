# Contributing to URDF Forge

Thanks for helping. This guide covers how to report problems, propose changes and get a pull
request merged.

## Ways to help

- **Report a bug** with the bug template. Attach the CAD file or a `.forge` project that shows
  the problem if you can share it; a small one is best.
- **Suggest a feature** with the feature template. Describe the robot you were building and
  where the tool got in the way.
- **Test a ROS 2 / Gazebo combination** and tell us what failed to launch. Exported packages
  are only as good as the targets people check.
- **Write a plugin** and share it. See [docs/plugins.md](docs/plugins.md).
- **Improve the docs.** If something confused you, it will confuse the next person.

## Development setup

Requirements: Node.js 20 or newer, Rust stable, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/OlumideOsuntuyi/urdf-forge.git
cd urdf-forge
npm ci
npm run app:dev
```

Useful scripts:

| Command                                             | What it does                                  |
| --------------------------------------------------- | --------------------------------------------- |
| `npm run app:dev`                                   | Desktop app with hot reload                   |
| `npm test`                                          | Unit tests (Vitest)                           |
| `npm run typecheck`                                 | TypeScript checks                             |
| `npm run lint`                                      | ESLint                                        |
| `npm run format`                                    | Prettier                                      |
| `cargo clippy --manifest-path src-tauri/Cargo.toml` | Rust lints                                    |
| `npm run android:dev`                               | Run on a connected Android device or emulator |

## Where code goes

- `src/core` holds everything that can be tested without a window: the model, geometry,
  inertia, URDF/xacro/SDF generation, import and validation. **New export logic belongs here,
  with tests.**
- `src/viewport` owns three.js objects. React components never touch them directly.
- `src/commands/builtin.ts` is where user actions live. Add a command, then reference it from
  menus or buttons, so it is automatically in the palette, the shortcut list and available to
  MCP clients.
- `src-tauri` is kept thin: native dialogs, file access and the MCP transport.

## Pull requests

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Branch from `main`. Keep each PR to one change.
3. Add or update tests for behaviour changes in `src/core`.
4. Run `npm run typecheck && npm run lint && npm test` before pushing. CI runs these and builds
   the app on Windows, macOS, Linux and Android.
5. Update `CHANGELOG.md` under **Unreleased**.
6. Describe what you changed and how you checked it. Screenshots help for UI changes; test in
   at least one dark and one light theme.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

## Exported packages

Changes to generated files must keep them valid for every target in
`src/core/ros/targets.ts`. If you change a launch file or plugin name, say which distribution
and Gazebo version you launched it on.

## UI guidelines

- Use the theme tokens in `src/styles/themes.css`; never hard-code colours in components.
- Text must meet WCAG AA contrast in every theme. Never use colour alone to carry meaning.
- Every interactive control needs an accessible name and must work by keyboard.
- Check the touch density: targets of at least 44 px.

## Licence

By contributing you agree that your contributions are licensed under the Apache License 2.0,
the same licence as the project.
