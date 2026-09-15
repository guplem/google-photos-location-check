# Ask the Google Photos web app's own endpoint for the location

## Context

The question the extension answers is "does this photo carry a location?". Three sources could answer it, and they were all measured on a real 1611-photo album before this was decided.

1. **The public Google Photos API.** Google restricted it in March 2025: an application now sees only the media it uploaded itself. Nothing there answers this question. This source is closed.
2. **The photo's info panel in the page.** Open a photo, press `i`, and the panel shows a row whose accessible name is `Edit location` when a location exists and `Add a location` when it does not. This is a clean, named signal that obeys `0004-semantic-dom-matching.md`. It costs one photo opening per photo: the image downloads, the panel renders, and the walk waits. On this album that is over half an hour.
3. **The internal endpoint the web app itself calls.** The info panel is filled by an RPC named `fDcn4b`, sent to `/_/PhotosUi/data/batchexecute`. It takes one media id and answers with that photo's details, and field 13 of the answer is the location, or `null` when there is none.

The third source was measured. One HTTP request carries many calls: **100 photos answered in 950 ms**, and the first 300 photos of the album were read in **2.36 seconds** using three requests at once. The whole album would take about 13 seconds. It downloads no image and renders nothing.

The sibling extension `google-photos-auto-save-check` faced the same choice and **rejected** this endpoint (`adr/0002` there). That decision must not be copied here without thought, because the cost of being wrong is not the same. There, a wrong reading tells the user a photo is already saved when it is not, and the user loses the photo. Here, a wrong reading draws a wrong badge, and the user opens the photo and sees the truth. Nothing is written, nothing is deleted, nothing is lost.

## Decision

**Use the internal endpoint.** `photosRpcClient.js` sends the `fDcn4b` call, and `mediaLocationReading.js` reads field 13 of the answer.

The extension sends the request from a script running inside `photos.google.com`, so it is same-origin and the signed-in session travels with it. The three tokens the endpoint requires (`SNlM0e`, `cfb2h`, `FdrFJe`) are read out of the page's own inline scripts by `pageTokens.js`. There is no separate sign-in, no stored credential, and no network permission in the manifest beyond the host permission the content script already needs.

**The unnamed-array risk is answered by making "cannot tell" a real answer, not by avoiding the endpoint.** The indexes are Google's and Google may reorder them. So `readMediaLocation` returns `null`, not `no-location`, whenever:

- the answer does not carry the media id we asked about, or
- the photo array is too short to hold index 13, or
- something sits at index 13 that is not a well formed location.

`null` becomes `unknown`, which the user sees as a grey badge, never as the orange "no location" badge. **A wrong index can therefore make the extension say nothing; it can never make it say something false.** This is the guard that makes the endpoint acceptable, and it may not be removed.

**Rejected alternative:** open every photo and read the info panel. It is the most robust source and it needs no unnamed arrays, but it is about 150 times slower and it downloads every image in the album. It stays documented here as the fallback to build if Google ever closes this endpoint; `0004-semantic-dom-matching.md` records the two label names it needs.

**Rejected alternative:** read the album list payload already in the page (`AF_initDataCallback` under `ds:7`). It was checked: it holds 300 items with their ids, file names, sizes and video durations, and **no location at all**. The place name shown above a run of thumbnails in the grid is an album property the user set by hand, not photo data. This source cannot answer the question.

## Consequences

**Positive:**

- A whole album is read in seconds instead of half an hour, and no image is downloaded.
- The extension never opens, clicks, or changes anything in the user's library. It only reads.

**Trade-offs and follow-up:**

- Google can change the answer shape with no notice. The failure is visible (grey badges and a count in the panel), not silent, and the diagnostics report names it.
- Google can answer `429` when pushed. The batch size and the number of requests at a time are settings, and `albumLocationScan.js` backs off before each further attempt.
- The two tokens beyond the request token are read by a pattern that matches Google's own key names. A rename breaks the read, and `readPageTokens` answers `null` so the failure is reported rather than guessed around.
