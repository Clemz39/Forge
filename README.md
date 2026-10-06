# Forge

**Shape your knowledge.** Forge is a note-taking and knowledge workspace with built-in AI — notes, notebooks, tasks, calendar, files, voice notes and scanned documents in one place, designed to work offline.

This repository hosts the test builds. The source code is private.

## Download

Get the latest version from **[Releases](https://github.com/Clemz39/forge/releases/latest)**.

| Platform | File | Notes |
|---|---|---|
| Windows 10/11 (64-bit) | `Forge-Setup-<version>.exe` | Installer. Recommended. |
| Android 7.0+ (64-bit) | `Forge-<version>-test.apk` | Install over any earlier test build; your notes are kept. |

### Installing on Windows

The installer isn't code-signed yet, so Windows shows a warning the first time:

1. Run `Forge-Setup-<version>.exe`.
2. If you see **Windows protected your PC**, click **More info → Run anyway**.
3. When Windows Firewall asks about Forge, allow it on **private networks** so your phone can sync with it.

### Installing on Android

1. Download the `.apk` on your phone and open it.
2. If asked, allow your browser or file manager to install unknown apps.

## Syncing your phone and computer

Forge syncs directly between your devices over Wi-Fi — no account and no server. Changes are encrypted (AES-256) before they leave a device.

1. On the computer: **Settings → Synchronization → Pair a phone**.
2. On the phone: **Settings → Synchronization → Pair → Scan QR code**.

Both devices need Forge open and to be on the same Wi-Fi network. Guest networks often block devices from seeing each other; if pairing can't find your computer, choose **Enter code** and type the address shown on the computer.

## AI

AI runs on your own devices. Download a model in **Settings → AI**:

- **Computer:** uses your graphics card (NVIDIA, AMD or Intel) when available, or the processor otherwise.
- **Phone:** runs small models on the phone itself, or uses your paired computer's AI over Wi-Fi when it's reachable.
- **Ollama:** you can also connect an existing Ollama server.

Nothing is sent to an outside AI service.

## Open-source components

On-device AI runs on [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT). Models: Qwen2.5 (Apache 2.0), Llama 3.1 and 3.2 (Llama Community Licence — Built with Llama). QR codes: qrcode-generator (MIT) and jsQR (Apache 2.0). The desktop app is built with Electron (MIT). Licence texts are included with the app.

© 2026 Kadeem Clement
