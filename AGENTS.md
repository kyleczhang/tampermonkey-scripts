# AGENTS.md

## What this repo is

A flat collection of standalone Tampermonkey (userscript) `.js` files — one script per file, no build step and no tests. Each file is the deliverable; users install it directly into Tampermonkey. The only tooling is Prettier (code formatting) and a Git pre-commit hook; the lone dependency (`prettier`) is dev-only and never ships in the scripts.

There is nothing to build or run from a terminal. Code is formatted with Prettier — run `npm install` once, then `npm run format` to format everything or `npm run format:check` to verify without writing (config in `.prettierrc.json`, editor defaults in `.editorconfig`). To test a change, install/reload the script in Tampermonkey and exercise it on the target site (watch the `console.log` output, every script prefixes logs with a bracketed tag like `[Claude URL Query]`).

## Distribution mechanism (critical)

Every script's metadata block points `@downloadURL`/`@updateURL` at `https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/<filename>.js`. Two consequences:

- **The filename is part of the public contract.** Renaming a file breaks auto-update for everyone who installed it. Don't rename without intent.
- **Bumping `@version` is how updates ship.** Tampermonkey only pulls an update when the version in the metadata block is higher than the installed one. Any user-facing change must include a `@version` bump or it will never reach users.

### Formatting and version bumping are automated by a pre-commit hook

`.githooks/pre-commit` does two things to staged files: (1) runs Prettier on them and re-stages the result, then (2) auto-bumps the last component of `@version` (e.g. `1.0.0` → `1.0.1`) for every staged `.js` whose code changed — so you normally **do not format or bump manually**. Details:

- Formatting runs first so whitespace changes never mask a real code diff. It uses the local `node_modules/.bin/prettier`; if Prettier isn't installed (no `npm install`) the hook prints a warning and skips formatting instead of failing.
- If you _did_ edit the `@version` line yourself in the same commit, the hook detects it and skips that file (no double bump) — do this when you want a minor/major bump rather than patch, e.g. set `2.0.0` by hand.
- Commits that touch no `.js` (docs, the Auto-backup commits) bump nothing.
- Skip formatting for one commit with `SKIP_FORMAT=1`, version bumping with `SKIP_BUMP=1` (e.g. `SKIP_BUMP=1 git commit ...` for a formatting-only commit that shouldn't ship a version).
- The hook lives in `.githooks/` (tracked) and is wired via `git config core.hooksPath .githooks`. Git does not enable repo hooks automatically, so **a fresh clone must run that `git config` command once** or the hook won't fire.

## Plan / requirements docs

Some scripts have a written requirements doc. These live in `plans/` and are named `plan-for-<script-filename-without-.js>.md` — e.g. `plans/plan-for-youtube-custom-keyboard-shortcut.md` corresponds to `youtube-custom-keyboard-shortcut.js`. Docs are written in English. When a script has a matching plan doc, treat it as the source of truth for intended behavior; keep them in sync when behavior changes, and follow the same naming convention for any new doc. Not every script has one — scripts without a doc are fine as-is; don't backfill docs unless asked.

## Two families of scripts

**1. AI-chat "URL query" auto-submitters** — `*-url-query.js` (chatgpt, claude, deepseek, gemini, tongyi, kimi, doubao, yuanbao). These read a query string from the page URL, type it into the site's chat composer, and auto-send it. They all implement the same flow (see below).

**2. Standalone site utilities** — `chatgpt-play-sound-when-finish.js`, `fix-youtube-caption-position.js`, `youtube-watch-later-shortcut.js`, `youtube-custom-keyboard-shortcut.js`. Independent, no shared pattern. Note `youtube-custom-keyboard-shortcut.js` deliberately works by _simulating YouTube's own native shortcut keys_ (so the site's built-in feedback animations fire) rather than calling the player API directly — keep that approach when editing it.

### Query-param key is NOT uniform

Newer scripts use `?cq=` (chatgpt, claude, deepseek); older ones use `?q=` (gemini, doubao, kimi, tongyi, yuanbao). Check `QUERY_KEY` / the `searchParams.get(...)` call at the top of the specific file before assuming.

## Shared architecture of the URL-query scripts

The scripts are independent copies (no shared module — userscripts can't import), but they follow one playbook. `claude-url-query.js` and `chatgpt-url-query.js` are the cleanest reference implementations:

1. **Capture early, persist across SPA routing.** Run at `@run-at document-start`. The query param is read immediately and written to `sessionStorage` (e.g. key `claude-url-query-cq`), because these SPAs redirect/remount before the composer exists and the param would otherwise be lost. The param is later stripped from the URL via `history.replaceState`.
2. **`waitFor(resolver, {timeout, root})`** — the core helper. Resolves the first truthy `resolver()` result, driven by both a `MutationObserver` and a setInterval poll (poll catches elements that exist but are mid-animation/settling), with a timeout that resolves `null` rather than hanging.
3. **Fill the composer.** `findComposer()` matches a site-specific selector (contenteditable `div`/ProseMirror or `textarea`) and checks visibility. `setComposerText()` clears then inserts via `document.execCommand('insertText', ...)` with a `textContent`/`innerHTML` fallback, then fires `input`/`change` events so the site's React/ProseMirror state actually updates — assigning text without dispatching events does not work.
4. **Send.** Wait for the send button to become enabled (`isSendButtonReady`/`isSendReady`), then prefer simulating an Enter keypress (keydown+keypress+keyup) on the composer, with a `simulateClick` (mousedown+mouseup+click) on the send button as a backup. Guard against double-send by checking whether a "Stop"/generating button has appeared before clicking.

## The selectors are the fragile part

Each script hard-codes CSS selectors for that site's composer, send button, and stop button at the top of the file (e.g. `COMPOSER_SELECTOR`, `SEND_SELECTOR`, `STOP_SELECTOR`). These break whenever the target site ships a DOM change — fixing/maintaining these selectors is the dominant kind of edit in this repo (see commit history, e.g. the Doubao selector updates). When updating a script for a site change, update the selectors and bump `@version`.

The empty `field-*.html` files in `dom-snapshots/` (`field-after-load.html`, `field-when-generating.html`, `field-with-input.html`) are scratch placeholders for pasting captured DOM snapshots of a composer in its different states while reverse-engineering selectors.
