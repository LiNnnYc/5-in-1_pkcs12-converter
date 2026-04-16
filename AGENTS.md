# Repository Guidelines

## Project Structure & Module Organization
This repository is currently spec-first. The active source files today are [`spec.md`](./spec.md), [`PFX轉檔程式企畫書.txt`](./PFX轉檔程式企畫書.txt), and [`pkcs12轉檔工具_規格書修改_20260409.txt`](./pkcs12轉檔工具_規格書修改_20260409.txt). Build the implementation to match the structure described in `spec.md`: `main/` for Electron main-process code, `main/engines/` for OpenSSL and Keytool runners, `main/services/` for merge/extract/view/convert logic, `utils/` for sanitizing and temp-file helpers, and `locales/` for `zh-TW.json` and `en.json`.

## Build, Test, and Development Commands
When the app scaffold is added, keep the standard workflow simple and predictable:

- `npm install`: install Electron, Vue 3, Vite, vue-i18n, and packaging dependencies.
- `npm run dev`: start the desktop app in local development mode.
- `npm run build`: build the renderer and Electron bundle for verification.
- `npm run package`: create the portable Windows output with `electron-builder`.
- `npm test`: run automated tests before every PR.

If you introduce different scripts, update this file and keep command names conventional.

## Windows Shell Notes
When opening or reading files from PowerShell, default to UTF-8 to avoid mojibake in Chinese-language filenames and specs. For PowerShell command examples in this repository, prepend `chcp 65001` before the actual command, for example: `chcp 65001; Get-Content spec.md`.

## Coding Style & Naming Conventions
Use TypeScript for app code, 2-space indentation, and one module per responsibility. Prefer kebab-case filenames such as `merge-service.ts`, `keytool-runner.ts`, and `ipc-handlers.ts`. Keep IPC channels explicit and namespaced, for example `pkcs12:view` and `jks:toP12`. Use `execFile` instead of shell-based execution, and centralize input validation in a sanitizer utility.

## Testing Guidelines
Add unit tests for service-layer behavior and parser utilities, plus integration tests for OpenSSL/Keytool invocations. Name tests after the subject under test, such as `merge-service.test.ts` or `output-parser.test.ts`. Cover success cases, bad passwords, legacy PKCS#12 handling, and Windows-path edge cases. Treat packaging smoke tests on clean Windows 10/11 x64 as release-blocking.

## Commit & Pull Request Guidelines
No Git history is present in this workspace yet, so there is no existing commit convention to inherit. Start with Conventional Commits: `feat: add PKCS#12 merge service`, `fix: sanitize temp file paths`. PRs should include a short summary, linked issue or spec section, test evidence, and screenshots for UI changes. Call out any OpenSSL, JRE, or packaging footprint changes explicitly.

## Security & Configuration Tips
Never commit certificates, private keys, passwords, or generated `.pfx/.p12/.jks` artifacts. Keep bundled runtime binaries version-pinned, validate all filesystem inputs, and delete temporary decrypted materials immediately after use.
