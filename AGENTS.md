# Google Photos Location Check

A Manifest V3 Chrome extension that changes the Google Photos website (`https://photos.google.com`). It does one thing: it marks every album thumbnail whose photo carries no location, so you can see at a glance which photos still need one. There is no build step, so the repository folder is the folder Chrome loads. Install, run, and troubleshooting details: `README.md`.

The extension **only reads**. It never clicks a control, never presses a key, and never changes a photo. Its whole contact with the page is reading the grid and drawing its own badges into it. Keep it that way: the worst failure this design allows is a wrong badge.

Delegate to these agents at the right moment (each agent's own description says what it does). They fall into two groups, by when they run.

**Before you implement (explore agents, launched as preparation):**

- **pattern-scout**: before implementing any non-trivial module, feature, or setting, and any time you ask "how do we do X here?". Returns real code examples with the rules distilled from them.
- **adr-checker** (consult mode): before implementing in an ADR-relevant area (the "Architecture Decision Records (ADRs)" section lists them). Returns the decisions the work must follow.

**After you implement, before you ship:**

- **docs-checker**: after a change that could affect documented content. Checks every documentation location (code comments, `README.md`, `AGENTS.md`, ADRs) against the code and fixes drift.
- **validate**: just before you create a PR or push. Runs the repo's checks the way CI does (format, types, tests) and reports pass or fail.
- **adr-checker** (maintain mode): after you introduce a new architectural pattern or change one an ADR records.

Beyond these, spawn subagents freely: hand off research, code exploration, and parallel analysis so the files they read stay out of your own context. Give each subagent one task.

## Writing style

The people who read your output may read English as a second language and may be new to the area. Two layers apply. This section is the one home for both: no other file restates them.

**Layer 1 covers every piece of prose you write**: chat replies, PR and issue text, review comments, commit messages, and every document below. It follows Zinsser's four principles, which are simplicity, brevity, clarity, and humanity.

- **Short sentences, one idea each.** Use common words. Avoid idioms, slang, and cultural references.
- **Lead with the answer**, then only the detail that changes what the reader does. Cut filler and hedging. Do not use em dashes.
- **Assume a short attention span.** The reader usually skims to make a quick decision (which PR to review, which issue to pick), with little context and little time; put the single most important thing first, and make each part land even if they stop after the first line.
- **Gloss each jargon term, acronym, or tool/library name on first use** in one short clause, or pick a simpler word.
- **Explain a concept briefly before going deeper.** Do not assume a flow, tool, or pattern is already known.
- **Assume junior-level knowledge of the area.** Name the things you reference (files, commands, terms) instead of assuming the reader can guess.

**Layer 2 adds ASD-STE100 on top, for technical documents only**: `AGENTS.md`, ADRs, `README.md`, skills, subagents, and code comments. ASD-STE100 (Simplified Technical English) is a controlled-English standard from the aerospace industry. A maintenance manual must carry one reading and one only, and these documents have the same job.

- **Active voice only.** Name the actor: "the hook formats the file", not "the file gets formatted".
- **One meaning per word, and the same word for the same thing every time.** Never swap in a synonym for variety.
- **One instruction per sentence, and start the sentence with the verb.** Write "Run the migration", not "The migration should be run".
- **No `-ing` verb form as a noun or as a sentence opener.** Write "Use the skill to create a branch", not "Creating a branch is done with the skill".
- **About 20 words per sentence at most** (25 in descriptive text).
- **Leave out no word that guards the meaning.** Write "the file that you changed" when "the file you changed" could be misread.

Both layers cover prose only. Neither covers code identifiers or text you quote word for word.

## Commands

| Task                                   | Command                                                          | Notes                                                                            |
| -------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Install dependencies and the git hooks | `npm install`                                                    | The `prepare` script runs `lefthook install`. Run this once per clone.           |
| Run every check, the way CI runs it    | `npm run check`                                                  | Format check, then type check, then tests. This is the umbrella script CI calls. |
| Format the whole repo                  | `npm run format`                                                 | Prettier.                                                                        |
| Check the format only                  | `npm run format:check`                                           | Fix a failure with `npm run format`.                                             |
| Type check                             | `npm run typecheck`                                              | `tsc --noEmit` over the JSDoc types. Success prints nothing.                     |
| Run the tests                          | `npm test`                                                       | `node --test`. It finds `test/*.test.js` on its own.                             |
| Redraw the icons                       | `powershell -ExecutionPolicy Bypass -File scripts/makeIcons.ps1` | Windows only. Run it only when the artwork changes.                              |

There is no build and no code generation. To try the extension, load the repository folder unpacked in Chrome (`README.md` has the steps).

Whenever you need to confirm the code still passes, delegate to the **validate** agent (it runs the sequence above the way CI does).

## Architecture

The extension runs in two places. Know which one you are in before you write code.

| Place          | File                                                                 | Can use `chrome.*` | Can see the page |
| -------------- | -------------------------------------------------------------------- | ------------------ | ---------------- |
| Isolated world | `src/bootstrap/isolatedWorldBootstrap.js` and all of `src/` below it | Yes                | Yes, the DOM     |
| Service worker | `src/background/serviceWorker.js`                                    | Yes                | No page at all   |

Everything runs in the **isolated** world. That world can call `chrome.*` extension APIs and can read the DOM, but it cannot see the page's own JavaScript variables. Nothing here needs them, so this extension ships no MAIN world script. The request tokens look like page variables but are read out of inline `<script>` text through the DOM, which the isolated world is allowed to do.

A content script listed in `manifest.json` cannot be an ES module. `isolatedWorldBootstrap.js` is a classic script whose only job is `import(chrome.runtime.getURL('src/contentEntry.js'))`. Every other file therefore uses plain `import` and stays unit testable under Node. Any new file under `src/` is reachable only because `web_accessible_resources` lists `src/*`. Keep that entry.

The JavaScript and the stylesheets do not call each other. `publishSettings` writes settings onto `<html>` as attributes, and the CSS reads them. Keep this table true.

| Attribute                              | Read by                   | Values                                              |
| -------------------------------------- | ------------------------- | --------------------------------------------------- |
| `data-gplc-dim-located`                | `locationBadgeStyles.css` | `on` or absent                                      |
| `data-gplc-state` (on a grid link)     | `locationBadgeStyles.css` | `has-location`, `no-location`, `unknown`, `pending` |
| `data-gplc-highlight` (on a grid link) | `locationBadgeStyles.css` | `on` or absent                                      |

### How one badge happens, end to end

1. `locationBadgeRenderer.js` watches the grid and, on each redraw, reports the photo keys currently in the page.
2. `contentEntry.js` puts them in `locationLookupQueue.js`, which drops the ones already answered or already being asked about.
3. After a short debounce the queue calls `albumLocationScan.js`, which splits the work into batches and handles the retries.
4. Each batch goes through `photosRpcClient.js` to the `fDcn4b` call, and `mediaLocationReading.js` turns each answer into `has-location`, `no-location`, or "cannot tell".
5. The verdicts go to `locationStateStore.js`, and the renderer redraws.

The **Read whole album** button changes none of that. `albumGridSweep.js` only scrolls the grid from top to bottom, which makes every thumbnail appear once, and steps 1 to 5 then happen by themselves. The sweep looks up nothing itself.

The **Next / Previous without location** buttons scroll the same grid with `albumGridJump.js`, but they cannot stay off to the side the way the sweep does: they must know a screen's verdicts before they can tell whether it holds the photo they are after. So each screen they uncover is looked up and waited for before it is judged, which is why they work without the sweep having run first.

### File map

| File                                         | Holds                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/contentEntry.js`                        | Wiring only. Settings, routing, the debounce, storage writes.                    |
| `src/albumGrid/albumGridSweep.js`            | The top-to-bottom walk of the grid. Pure logic, no DOM.                          |
| `src/albumGrid/albumGridJump.js`             | The walk to the next, or previous, photo without a location. Pure logic, no DOM. |
| `src/albumGrid/albumGridScroller.js`         | **The only file that moves the grid.** Finds the real scroll container.          |
| `src/googlePhotosPage.js`                    | URL parsing and the grid link selector. **All URL knowledge lives here.**        |
| `src/diagnosticsReport.js`                   | Builds the report the panel copies. Pure logic, no DOM and no `chrome.*`.        |
| `src/photosRpc/pageTokens.js`                | Reads the three request tokens out of the page's inline script text.             |
| `src/photosRpc/batchExecuteMessage.js`       | Builds the request and reads the answers back. **All protocol shape here.**      |
| `src/photosRpc/photosRpcClient.js`           | Sends the request. The only file that calls `fetch`.                             |
| `src/locationState/mediaLocationReading.js`  | One answer to a verdict. **The only file that knows index 13.**                  |
| `src/locationState/albumLocationScan.js`     | Batches, parallel requests, and the retry rules. Pure logic, no DOM.             |
| `src/locationState/locationLookupQueue.js`   | Dedupes, drops what is known, runs one lookup at a time. Pure logic.             |
| `src/locationState/locationStateStore.js`    | The per-album record in `chrome.storage.local`.                                  |
| `src/locationState/locationBadgeRenderer.js` | Draws the badges and reports what is on screen.                                  |
| `src/controlPanel/controlPanelController.js` | The in-page panel.                                                               |
| `src/settings/extensionSettings.js`          | Defaults and `normalizeSettings`.                                                |
| `options/optionsPage.*`                      | The settings page.                                                               |

## Rules

- **"Cannot tell" is a third answer, and it may never collapse into "no location".** `readMediaLocation` returns `null` when the answer does not carry the media id we asked about, when the photo array is too short, or when index 13 holds something that is not a location. That becomes `unknown`, a grey badge, never the orange one. Google can reorder its indexes at any time; this guard is what makes a wrong index say nothing instead of saying something false. See `adr/0002-ask-google-photos-for-the-location.md`.
- **Retry the request, never the verdict.** A network failure, a non-2xx answer, a timeout, and an answer that did not arrive are all worth another go, and `albumLocationScan.js` backs off before each one. `has-location` and `no-location` are facts about the photo, and the next attempt returns the same fact.
- **Never store `unknown`.** `locationStateStore.js` writes verdicts only. Storing `unknown` would tell the next visit the photo is already answered, and it would never be read again.
- **Never match a Google class name.** Google Photos ships obfuscated class names (`QxNbxb`, `p137Zd`) that change with every release. Match the URL, a link target (`a[href*="/photo/"]`), or an accessible name. See `adr/0004-semantic-dom-matching.md`.
- **A sweep may only move the grid, and must put it back.** `albumGridSweep.js` scrolls and nothing else. It starts at the top, because the user may press the button half way down an album, and it returns the grid to where it found it in a `finally`, so a stop or a failure restores it too. Nothing covers the grid afterwards, so a user left at the bottom of a 1611-photo album has lost their place. `albumGridJump.js` also scrolls the grid, but it must move the user: that is its whole job. It restores the position only when it finds nothing.
- **Only `reachedBottom` licenses an album total.** A sweep that ran out of steps, was stopped, or met a grid that refused to move did not see the album. Showing its count as a total turns "we stopped looking" into "there is nothing left".
- **Never act on the page.** Beyond the sweep's and the jump's scrolling: no clicks, no key presses, no opening a photo. If a feature seems to need one, update `adr/0004-semantic-dom-matching.md` first, and take the sibling extensions' rule with it: a click target must match a known word, or the work stops.
- **Keep DOM and `fetch` out of the logic.** `albumLocationScan.js` receives every action as a function, which is why its whole loop is unit tested with no browser and no network. Put each fragile call in a small adapter, keep the decision in a pure function, and test the pure function.
- **Validate everything that comes out of storage.** `normalizeSettings` and `normalizeAlbumRecord` drop unknown keys and repair wrong values, because storage can hold data written by an older version. Extend those functions when you add a field, and add a test.
- **Use the two storage areas as `adr/0006-extension-storage-layout.md` sets them.** Settings go in `chrome.storage.sync`; album answers go in `chrome.storage.local`, one key per album. Never put album answers in `sync`: a large album exceeds the per-item quota.
- **Add a setting in all four places.** Whenever you add a setting, use the `add-setting` skill. A setting that misses one place resets itself with no error.

## Gotchas

- **The photo key in a grid link is the media id the RPC takes.** `a[href=".../photo/AF1Qip..."]` gives a 44-character string, and `fDcn4b` takes exactly that string. There is no translation step anywhere, and this is the fact that lets the extension work off the grid alone. Do not add a lookup table for it.
- **The location sits at index 13 of the photo array, and nothing names it.** The answer is `[[latitudeE7, longitudeE7], flag, [placeEntry, ...]]`, or `null` for a photo with no location. `E7` means degrees times ten million: `53443938` is `5.3443938`. `mediaLocationReading.js` is the only file that knows this. Change it in one place.
- **The answers come back with their slots shuffled.** A request for 100 photos answers in any order, so an answer is tied to its photo by the slot id (`row[6]`), never by position. Pair by index and you badge the wrong photos, which looks plausible and is completely wrong.
- **A place name above a run of thumbnails is not photo data.** Google Photos shows the album's own location there, which the owner set by hand. It says nothing about the photos under it, and it misled the first reading of the page during research.
- **The album payload in the page holds no location.** `AF_initDataCallback` under `ds:7` carries the first 300 items with their ids, file names, sizes and video durations. There is no location field in it. Do not go looking again.
- **The page ships only the first 300 media ids.** The rest exist only once the virtualised grid has rendered them. That is why the extension reads photos as their thumbnails appear; see `adr/0007-lazy-lookups-driven-by-scrolling.md`. The RPC that pages the album list was not found: `snAcKc`, `EzkLze` and `nMFwOc` were each tried and none accepted the payload.
- **`window.scrollTo` does not scroll the album grid.** Google Photos scrolls an inner container. `findScrollingAncestor` walks up from a grid link to the first ancestor whose `scrollHeight` exceeds its `clientHeight` and whose `overflow-y` is `auto` or `scroll`. This helper is copied from both sibling extensions, where it is proven against the live site.
- **A scroll that moves nothing means one of two opposite things.** At the end of the grid it is the end, and on some albums it is the only signal, because the content height they report is never quite reached. Anywhere else it means the scroller was not found or the page is busy. `sweepAlbumGrid` tells them apart by asking whether the position is at the bottom, and only gives up after `MAX_STALLED_STEPS` when it is not.
- **Step less than a whole screen.** `STEP_FRACTION_OF_VIEWPORT` is `0.8`, exported from `albumGridSweep.js` so `albumGridJump.js` steps by the same amount. A full-screen step can skip a row when the grid redraws late, and a skipped row is a photo that never gets a badge.
- **Scroll with `behavior: 'instant'`.** A smooth scroll is still animating when the settle time is up, so the read happens mid-flight and misses rows.
- **The grid is virtualised.** Google Photos keeps about fifty thumbnails in the page and reuses the same `<a>` elements as you scroll. One pass of decoration is never enough: `locationBadgeRenderer` watches for changes and stamps each link with `data-gplc-state` so a redraw is cheap. Document order is also not album order.
- **A photo nobody has read yet gets no badge.** It is stamped `pending` and left plain. A badge that appears and then vanishes reads as a wrong answer.
- **Every `chrome.*` call in the content script throws once the extension is reloaded.** "Extension context invalidated". A page left open keeps the old content script running with a dead `chrome.*`. So `readExtensionVersion` catches, `writeResults` falls back to keeping verdicts in memory, and `diagnosticsReport.js` takes the version as an argument rather than reading it. Keep `chrome.*` out of the paths that only report.
- **A button that awaits must catch everything, including the await.** In the sibling extension a report button awaited its builder outside the `try` and awaited `navigator.clipboard.writeText` with no deadline; both failed silently and the user saw nothing happen. `copyText` here logs the report to the console **first**, then races the clipboard against a deadline, then falls back to a hidden textarea.
- **The content script starts before `<body>` exists.** `run_at` is `document_start`, so `start()` calls `waitForBody()` before it touches `document.body`.
- **Google Photos rewrites the address bar with no event.** `watchLocation()` polls every 300ms. A `popstate` listener alone misses most navigations.
- **`node --test test/` fails on Node 24.** It treats the folder as a module. Run bare `node --test`, which is what `npm test` does.
- **Prettier uses `endOfLine: "auto"` on purpose.** This machine has `core.autocrlf=true`, so the working tree holds CRLF line endings. A pinned `endOfLine: "lf"` would fail the format check on every file while the content is correct.
- **The public Google Photos API cannot help.** Google restricted it in March 2025: an app now sees only the media it uploaded. Do not propose it. `adr/0002-ask-google-photos-for-the-location.md` holds the reasoning.

## Test-Driven Development (mandatory)

Develop new behavior **test-first, red-green**: write a failing test that pins the behavior you want (**red**), make it pass with the smallest change (**green**), then clean up with the test as your safety net. A bug fix starts with a test that reproduces the bug.

What is testable here, and what is not:

- **Testable, and always test-first:** the answer-to-verdict decision (`mediaLocationReading.js`), the request and response shapes (`batchExecuteMessage.js`), the token read (`pageTokens.js`), the scan loop with its retries (`albumLocationScan.js`), the queue (`locationLookupQueue.js`), the grid sweep (`albumGridSweep.js`), the grid jump to the next photo without a location (`albumGridJump.js`), URL parsing (`googlePhotosPage.js`), settings validation (`extensionSettings.js`), the storage record shape (`locationStateStore.js`), and the report (`diagnosticsReport.js`).
- **Exempt, because a unit test would only re-state the code:** `photosRpcClient.js`, `albumGridScroller.js`, `locationBadgeRenderer.js`, `controlPanelController.js`, and `optionsPage.js`. Keep these thin: an adapter reads an element, sends a request, or writes an attribute, and it holds no decision.
- **The safety net for the exempt parts** is the type check (`npm run typecheck` reads every file) plus one manual run in Chrome. `adr/0005-testing-strategy.md` records this split.

The scan loop takes every action as an argument, so a test drives it with a fake reader and a `wait` that only records the number. The real backoff waits six seconds; the suite finishes in milliseconds.

Three tests pin the failures that would make the extension lie, and none may be deleted:

- `answers "cannot tell" when index 13 holds something that is not a location`
- `answers "cannot tell" when the answer belongs to another photo`
- `never turns a photo it could not read into "no location"`

When a bug appears in an exempt file, do not test the adapter. Move the decision that failed into a pure function, and test that.

The gate: CI runs the checks on every PR, and the repo ruleset "Requirements for merge" blocks merging until the `checks` check is green.

## Git Workflow

- Branch from `main`, PR back to `main`. Whenever you create a branch, use the `create-branch` skill.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`. Whenever you commit, use the `write-commit` skill.
- CI runs the repo's checks (the Commands table) on every PR; the ruleset "Requirements for merge" blocks merging until the `checks` check is green.
- **PRs merge automatically once the required `checks` check passes** (`.github/workflows/auto-merge.yml`); there is no human review gate, the tests are the review, which is what makes the TDD protocol non-negotiable.
- Three layers enforce quality, and they overlap on purpose: the Claude Code hooks in `.claude/settings.json` run while you edit, the lefthook `pre-commit` hook runs the format and type checks when anyone commits, and the CI required check is the merge gate.

## Documentation Organization

Each kind of knowledge has one home. Write a change in the home that matches it; never duplicate the same content across homes. What decides the home is **when the file loads** and **how deep it goes**, not its subject.

| Home                             | Loaded                           | Holds                                                                                                                                                                        |
| -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                      | Every session                    | The map: architecture facts, conventions, gotchas, and the ADR index. Points to the homes below; does not repeat their depth. (`CLAUDE.md` is a one-line `@AGENTS.md` shim.) |
| `.claude/skills/<name>/SKILL.md` | On demand, when the task matches | One procedure: how to do X.                                                                                                                                                  |
| `adr/NNNN-*.md`                  | On demand, via adr-checker       | One architectural decision and its why.                                                                                                                                      |
| `README.md`                      | Read by humans                   | What the project is, install, use, options, troubleshooting.                                                                                                                 |

**All of these files are living: keep them true.** When you learn something that helps future agents, update the right file in the same session. When a file holds wrong or outdated information, fix it or remove it. This covers code comments too. After implementation, the **docs-checker** agent catches drift you missed.

**Rules:**

- ADRs are agent-only: never reference or list them in `README.md`.
- Number ADRs in sequence (`NNNN-kebab-title.md`) and never renumber an existing file. Index each one as a one-line row in the ADR table below, never a summary.
- Do not duplicate content between `README.md` and `AGENTS.md`; reference it instead.
- `CLAUDE.md` is a one-line `@AGENTS.md` shim; edit `AGENTS.md` instead.

## Architecture Decision Records (ADRs)

ADRs live in `adr/`. Each records one architectural decision or cross-cutting standard and why. **One ADR per pattern, kept alive:** when a pattern changes, update its ADR in place; create a new ADR only for a genuinely new pattern. Most changes need no ADR. Conventions: `adr/AGENTS.md` (auto-loads through its `adr/CLAUDE.md` shim when you work in `adr/`).

**Before implementing** in an area that may carry a decision, delegate to the **adr-checker** agent in consult mode. These areas usually carry decisions: where the has-a-location signal comes from; how the code finds elements in the Google Photos page; when a photo is read; the extension storage layout; the testing strategy and the exempt files; the toolchain, the type system, and the absence of a build step.

**After implementing**, delegate to the **adr-checker** agent in maintain mode only if you introduced a new architectural pattern or changed one an ADR already records.

| ADR                                          | Topic                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `0001-agent-docs-structure.md`               | `AGENTS.md` map + Claude-Code-only skills, subagents, and settings                  |
| `0002-ask-google-photos-for-the-location.md` | The location comes from the web app's own `fDcn4b` call, not from the rendered page |
| `0003-plain-javascript-with-jsdoc-types.md`  | JSDoc types checked by `tsc`, so the repo folder is the extension folder            |
| `0004-semantic-dom-matching.md`              | Match URLs, link targets, accessible names; never classes; never act on the page    |
| `0005-testing-strategy.md`                   | Pure logic is test-first; thin adapters are exempt and covered by types             |
| `0006-extension-storage-layout.md`           | Settings in `sync`, album answers in `local`, one key per album                     |
| `0007-lazy-lookups-driven-by-scrolling.md`   | A photo is read when its thumbnail appears; a sweep of the whole album is opt-in    |

## GitHub issues, PRs, and other artifacts

- **Always self-assign PRs** when you create them.
- **Always link PRs to issues** with `Closes #N` in the PR body, so the issue auto-closes on merge.
- **Always add the `waiting-for-human-check` label** when you create a GitHub issue, PR, or any other reviewable artifact. It means no human has verified the content yet; a human removes it after reviewing. The label marks state (unreviewed), not origin. In this repo the label does **not** block a merge: a green PR auto-merges with the label still on it.

If the repo has no `waiting-for-human-check` label, create it first:

```bash
gh label create "waiting-for-human-check" --description "No human has verified this yet -- direct AI output" --color "D93F0B"
```

Whenever you create a GitHub issue, use the `create-issue` skill. Whenever you implement one, use the `implement-issue` skill. Whenever you review a PR, use the `review-pr` skill (optional here, because no human review gate exists).

## Coding standards

- **Match existing patterns.** Before you write code, find similar implementations and follow their style, structure, and conventions (the **pattern-scout** agent does this).
- **Explicit type annotations** are mandatory for all parameters, return types, and non-trivial variables. This repo writes them as JSDoc comments, and `npm run typecheck` enforces them under `strict`.
- **Comment the _why_, never the _what_.** A comment must carry what the code cannot: a non-obvious constraint, an intentional divergence, a trap a future reader would reintroduce. Do not document self-explanatory names or signatures, and match the comment density of the surrounding file.

## Refactoring safety

Whenever you rename or refactor a symbol, use the `rename-symbol` skill.

## Debugging

Whenever a fix attempt fails or a bug needs root-causing, use the `debug` skill.

## Writing prompts for agents and rules

Whenever you author or edit an AI-facing file (`AGENTS.md`, skills under `.claude/skills/`, subagents under `.claude/agents/`, prompts for agents you spawn), use the `write-ai-instructions` skill.

## Self-updating rules

These instruction files are living, and keeping them current is part of the work. Persist a rule right away (in the narrowest scope that fits) instead of applying it only this session when you discover something **extremely hard to find, deeply non-obvious, and time-saving for future sessions**, hit a pattern that **diverges from what an AI would write by default**, when the user says **"every time" / "always" / "never"**, or when **feedback on your own work reveals a standard you should have followed** (a PR review comment, a user correction). Persist it in these shared, committed files, never in personal memory or the global config, so the whole team gets the lesson. For where to write it, use the `write-ai-instructions` skill.
