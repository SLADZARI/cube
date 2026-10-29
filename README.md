# Studio Local — Ollama / FLUX.2 Klein
### Transitional public source preview · 29 October 2026

**Not LLaMA.** The software is **Ollama 0.32.5** and the on-device image model is **FLUX.2 Klein 4B** (`x/flux2-klein:4b`). All image inference stays on an Apple Silicon Mac. No paid OpenAI API, Google Gemini/Nano Banana, or cloud deployment.

This **public mirror is a sanitized, standalone source preview**, kept in an isolated branch of `SLADZARI/cube` only to let another ChatGPT/GitHub account read the work. The repository's main branch is unchanged. The canonical repository `SLADZARI/studio` remains **private**.

## Contents
- Original Canvas-derived Prompt → **AI Image** → Run; original output bytes are attached to the same Job and Inbox.
- Editable Object types **Герой / Среда** with description, image reference uploads (PNG/JPEG/WebP, up to four verified originals per Run), and compact JSON export/import UI.
- **Clean two-node seed** with no user's original graph, Jobs, images or secrets.

## On the same Mac (not on the internet)
1. Download ZIP: https://github.com/SLADZARI/cube/archive/refs/heads/studio-local-ollama-public-preview-2026-10-29.zip
2. Extract to a new folder (do **not** overwrite the user's existing Studio source).
3. Prerequisites: Node.js 22+, a *separate* compatible Ollama 0.32.5 already running on `127.0.0.1:11435`, and local model `x/flux2-klein:4b`. The script does not download any model or install paid tools.
4. Open Terminal in the extracted directory: `bash start.command`.
5. Open **http://127.0.0.1:18793/canvas** on that Mac.

This preview uses **port 18793**, data in `~/Projects/studio-local-ollama-public-preview-data`; the existing private local Studio on 18789 and its data folder are not touched. To inspect source-only checks: `node --test tests/public-smoke.test.mjs`. Do not run the server against public Internet or forward the port.

## If launch fails

The updated `start.command` now safely starts the **already installed** isolated Ollama 0.32.5 on port 11435, if it was stopped after a Mac reboot. It also prints explicit error codes and last startup log lines. It does not download a model or touch Studio on 18789.

From the extracted ZIP folder run:

```bash
bash start.command
```

If the problem persists, run **read-only** diagnostics in the same folder:

```bash
bash diagnose.command
```

Copy the diagnostic output to ChatGPT after removing anything private. This checks only Node, local ports, model/preview logs and installed code SHA. It neither restarts nor deletes anything.

**Important:** the archive you downloaded earlier does not update itself. Download the ZIP again after the launcher fix on 29 October 2026.

## Release truth
The earlier private **Mac-local** MVP and Object/image-reference generator have real image E2E evidence. The newest JSON editor was initially **63/64 PASS** on Mac, with a stale test-string assertion. The assertion was corrected on private GitHub commit `2ba27f895ba0f2b5ba55b146375a8ad98f86efc8`; full 64/64 Mac rerun and installation **are not yet confirmed**. This public sanitized build has **not** been browser acceptance-tested on Mac. It is source, not a production publish.

**Another ChatGPT account:** [HANDOFF_OTHER_ACCOUNT.md](HANDOFF_OTHER_ACCOUNT.md).

No original user data, auth allowlist/email, user reference photos, credentials or model weights are present. No open-source license is granted by this temporary publication.
