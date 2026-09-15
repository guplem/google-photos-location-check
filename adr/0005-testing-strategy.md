# Test the logic test-first; leave the thin DOM adapters to the type check

## Context

The repo mandates red-green TDD. A Chrome extension resists it in one specific place: the code that reads a live Google Photos page. That code cannot be honestly unit tested. A test would have to build a fake DOM that this repo itself invented, so it would only assert that the adapter calls the methods the test told it to call. It would pass while the real page had changed, which is the one failure that actually happens here.

The rest of the extension is different. Reading an answer out of an unnamed nested array, deciding when to retry, deciding what may never be retried, and deciding what counts as "cannot tell" are all decisions. They are also where a bug turns into a badge that lies.

## Decision

**Split the code so the decisions are testable, then test all of them test-first.**

- `albumLocationScan.js` holds the loop and **contains no DOM code and no `fetch` at all**. Every action arrives as a function: `readChunk`, `wait`, `shouldStop`, `onProgress`. A test passes a fake reader and a `wait` that only records the number, so the whole suite finishes in milliseconds even though the real backoff waits six seconds.
- `mediaLocationReading.js` is the verdict, and it takes plain arrays. Its fixtures are built from answers captured from a real album, so the test data is Google's shape, not this repo's guess.
- `batchExecuteMessage.js`, `pageTokens.js`, `googlePhotosPage.js`, `extensionSettings.js`, `locationStateStore.js`, `locationLookupQueue.js` and `diagnosticsReport.js` are pure and fully tested. The store takes a storage area as an argument, so a test passes an in-memory object.

**Exempt from unit tests:** `photosRpcClient.js`, `locationBadgeRenderer.js`, `controlPanelController.js`, and `optionsPage.js`. Keep them thin. An adapter reads an element, sends a request, or writes an attribute. It holds no decision. When a bug appears in one of them, move the decision that failed into a pure function and test that, rather than test the adapter.

**The safety net for the exempt files** is two things. `npm run typecheck` reads every file in the repo under `strict`, so a wrong property name or a null-handling mistake fails the build. One manual run in Chrome covers the rest: load the extension unpacked, open an album, scroll, and check the badges against what the info panel says for two or three photos.

Three tests pin the failures that would make the extension lie, and none of them may be deleted:

- `answers "cannot tell" when index 13 holds something that is not a location`.
- `answers "cannot tell" when the answer belongs to another photo`.
- `never turns a photo it could not read into "no location"`.

**Rejected alternative:** a headless browser (Puppeteer or Playwright) driving the real Google Photos. It would need a real Google account with real albums, it would break whenever Google changed the page, and it cannot run in CI without credentials. The value it adds is the value the manual Chrome run already gives.

**Rejected alternative:** record a real `batchexecute` response and replay it as a fixture in full. The captured shapes are already the basis of the `mediaLocationReading.js` fixtures, in a trimmed form that shows which indexes matter. A full capture is thousands of characters of a user's own photo data, and it hides the three indexes the code actually depends on.

## Consequences

**Positive:**

- The suite runs in well under a second, so the pre-commit hook and CI stay fast.
- The backoff, the retry rules and the "cannot tell" guard are each a cheap, deterministic test rather than something checked by hand against a live album.

**Trade-offs and follow-up:**

- The files most likely to break are the ones with no tests. That is deliberate: the type check and the diagnostics report cover them instead.
- The exemption only holds while the adapters stay thin. A decision that creeps into an adapter is a defect, and the fix is to move it out, not to widen the exemption.
- There is no merge gate for "it still works in Chrome". PRs here auto-merge on a green check, so any change to an exempt file needs a manual load before it is trusted.
