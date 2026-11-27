<p align="center"><a href="./README.md">繁體中文</a> | <a href="./README.zh-CN.md">简体中文</a> | <b>English</b></p>

# antigravity-i18n

[![CI](https://github.com/Carinoasd/antigravity-i18n/actions/workflows/ci.yml/badge.svg)](https://github.com/Carinoasd/antigravity-i18n/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

A cross-platform (Linux / macOS / Windows / WSL) **localization and appearance tool for Google Antigravity**: Traditional Chinese (`zh-TW`), Simplified Chinese (`zh-CN`), Japanese (`ja`), Korean (`ko`) and custom backgrounds — **no commands to memorize**, just open the control panel and click.

## 🚀 Getting started

### Option 1: download the single executable and double-click it (recommended)

**No Node.js, no commands.** Download the file for your system from [Releases](https://github.com/Carinoasd/antigravity-i18n/releases/latest):

| System | File |
| --- | --- |
| Windows (x64) | `antigravity-i18n-win-x64.exe` |
| macOS (Apple silicon) | `antigravity-i18n-macos-arm64` |
| Linux (x64) | `antigravity-i18n-linux-x64` |

Double-click it and your browser opens the local control panel.

- **Windows**: if SmartScreen shows "Windows protected your PC", click **More info → Run anyway**. The executable is not signed with a paid code-signing certificate, which is why this appears.
- **macOS**: the first time, right-click the file in Finder → **Open**, then confirm. If it is still blocked, go to System Settings → Privacy & Security and click **Open Anyway**. Browsers may drop the executable bit: run `chmod +x antigravity-i18n-macos-arm64` first.
- **Linux**: `chmod +x antigravity-i18n-linux-x64 && ./antigravity-i18n-linux-x64`
- If something fails at startup, the window shows the error and waits for Enter before closing, so you can copy it into a bug report.

**Verify the download (recommended)**: each Release includes `SHA256SUMS.txt`. Put it next to the executable:

```bash
# macOS
shasum -a 256 -c SHA256SUMS.txt --ignore-missing
# Linux
sha256sum -c SHA256SUMS.txt --ignore-missing
```

```powershell
# Windows (PowerShell): compare the hash with the matching line in SHA256SUMS.txt
Get-FileHash .\antigravity-i18n-win-x64.exe -Algorithm SHA256
```

> The first Release is created automatically once the maintainer pushes a `v*` tag; until then, use option 2.

### Option 2: run with npx (developers / Node.js already installed)

Requires [Node.js 20+](https://nodejs.org/):

```bash
npx github:Carinoasd/antigravity-i18n
```

> ⚠️ The npm package named `antigravity-i18n` is **not this project** (it belongs to another author). Use the `github:` form above, or install from source as shown below.

### What the control panel does

- Apply Traditional Chinese / Simplified Chinese / Japanese / Korean + background panel in one click
- Keep the English UI and only add custom backgrounds plus the `Ctrl+Alt+B` panel
- Restore the official build losslessly in one click
- Apply one of 5 built-in gradients or choose an image from your computer, and tune opacity / blur / tint
- Install or remove the Chinese AI global rule (zero-touch mode)

> The control panel listens on `127.0.0.1` only and generates a new access token on every start, so no other computer or website can drive it. Click "Close control panel" or press `Ctrl+C` to stop it.

## Features

- 🖥️ Supports Antigravity **App** (desktop 2.0+, `app.asar`), **IDE** (editor and Agent panel) and **CLI** (`agy`)
- 🧩 **Two-layer App localization**: static translation of the main-process menus / tray / updater, plus a **runtime DOM overlay** that translates the dynamically loaded React UI
- 🔒 Every file is SHA-256 hashed and backed up with a manifest before patching — **lossless one-click restore**
- 🧪 `--dry-run` previews matches and coverage without touching any file
- 🪶 **Zero-touch mode**: installs only a global rule so the AI always replies in Chinese — no app files changed
- 🖼️ **Custom background** (App): your own image (`bg set`) or 5 built-in pure-CSS gradients (`bg preset`), with a readability `--tint`; switching never requires re-patching
- 🎛️ **In-app background panel** (App): press **`Ctrl + Alt + B`** (macOS `Cmd + Option + B`) inside Antigravity to pick an image, switch presets and drag sliders — instant, no restart
- 🎨 **Background-only mode**: `--lang none` keeps the English UI and only adds the background and panel
- ✅ Built-in CI dictionary validator (key parity, placeholders, protected terms, Traditional/Simplified usage)

> ⚠️ This is a community project and is not affiliated with Google. Patching application files carries risk: preview with `--dry-run` first and make sure `restore` works for you.

## Install from source

```bash
git clone https://github.com/Carinoasd/antigravity-i18n.git
cd antigravity-i18n
npm install        # builds automatically
npm link           # makes the antigravity-i18n command available
antigravity-i18n   # no arguments: opens the control panel
```

Without `npm link`, run `node dist/cli.js <command>` instead.

## Command-line quick start

```bash
antigravity-i18n status                          # detect installs and current state
antigravity-i18n apply --lang zh-TW --dry-run    # preview, changes nothing
antigravity-i18n apply --lang zh-TW              # apply (quit Antigravity first)
antigravity-i18n apply --lang none --target app  # background + Ctrl+Alt+B panel only, English UI
antigravity-i18n restore                         # restore the official build
antigravity-i18n rules install --lang zh-TW      # zero-touch: Chinese AI replies only
```

## Commands

| Command | Description |
| --- | --- |
| `antigravity-i18n` / `ui [--port <n>] [--no-open]` | Open the local control panel (`127.0.0.1` only). In CI or non-interactive shells, running without arguments prints `--help` instead. |
| `status` (alias `doctor`) | Detected App / IDE / CLI paths, localization state, hook version, backups, background and global rules |
| `apply --lang <zh-TW\|zh-CN\|none> [--target <app\|ide\|cli\|all>] [--path <dir>] [--dry-run] [--force] [--no-runtime]` | Back up and patch. Refuses to re-apply unless `--force` (which always re-translates from the original backup). `none` = background-only mode for `app`. |
| `restore [--target ...] [--path <dir>] [--force]` | Verify backup SHA-256 and restore byte-for-byte |
| `rules <install\|remove\|status> [--lang ...]` | Manage `~/.gemini/config/rules/language-zh-*.md` (`trigger: always_on`) |
| `bg set <image>` / `bg preset <name>` / `bg presets` / `bg on\|off\|clear\|status` | Custom background (`--opacity`, `--blur`, `--size`, `--position`, `--mode overlay\|underlay`, `--tint`) |
| `launch [--lang <lang>] [--path <dir>] [--no-reapply]` | Smart launcher: if an official auto-update replaced `app.asar` (SHA-256 changed) or the hook is outdated, re-apply first, then start Antigravity and exit immediately (nothing stays resident, 0 MB). If Antigravity is running and the file is locked, it only prints a hint and skips this re-apply. |
| `shortcut <install\|remove\|status> [--name <name>] [--lang ...] [--path <dir>] [--dir <dir>]` | Create / remove a desktop shortcut that runs `launch`: Windows `.lnk`, WSL (Windows desktop `.lnk` → `wsl.exe`), macOS `.command`, Linux `.desktop`. Also available in the control panel. |
| `validate` | Dictionary validator for CI (exit code 0 / 1) |

## Custom background and the `Ctrl+Alt+B` panel

```bash
antigravity-i18n bg presets                                    # aurora, nebula, sunset, midnight, forest
antigravity-i18n bg preset midnight --opacity 0.3 --tint "rgba(0,0,0,0.25)"
antigravity-i18n bg set ~/Pictures/wallpaper.jpg --opacity 0.2 --blur 4
```

- The background is read by the App's main-process hook on every window load, so changing it **never requires re-patching** — just reopen or reload the window.
- Inside Antigravity, **`Ctrl + Alt + B`** (macOS `Cmd + Option + B`) opens the in-app panel; on **Settings → Appearance** a small "Background" button also appears. Panel settings (including the chosen image) are stored in the app's **IndexedDB** and take priority over the CLI `background.json`; "Reset" goes back to the CLI settings.
- Images: PNG / JPEG / WebP / GIF, up to **10 MB**. `--tint` only accepts safe CSS colors (`#hex`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, `transparent`, `black`, `white`, `none`).
- The background layer is `pointer-events: none` and never blocks clicks; code, editors, terminals, inputs and AI replies are never translated.
- **WSL**: settings are mirrored to the Windows home (`C:\Users\<you>\.antigravity-i18n`) so the Windows build of Antigravity can read them.

After upgrading this tool, run `antigravity-i18n apply --target app --lang <zh-TW|zh-CN|none> --force` once to update the App hook (`status` tells you when).

## Troubleshooting: `EBUSY` / `EPERM` / `EACCES`

These mean Antigravity is still running (locking `app.asar`) or the install needs elevated permissions. Both the CLI and the control panel print concrete steps:

1. Quit Antigravity completely — close every window **and** right-click the tray / menu-bar icon → Quit
2. On Windows, end any remaining Antigravity process in Task Manager; for `C:\Program Files` installs, run the terminal as Administrator
3. On Linux / macOS system locations, use `sudo` or point `--path` at an install you can write to
4. Retry — every apply / restore backs up first, so retrying is safe

## More documentation

The [Traditional Chinese README](./README.md) is the most detailed reference (detection paths, replacement rules, runtime overlay internals, data directory layout). Contribution guidelines and terminology rules: [CONTRIBUTING.md](./CONTRIBUTING.md). Rules for AI coding assistants: [AGENTS.md](./AGENTS.md).

## License

[MIT](./LICENSE)
