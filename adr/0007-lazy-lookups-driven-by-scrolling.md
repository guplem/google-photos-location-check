# Read a photo when its thumbnail appears, and sweep the album only on request

## Context

An album of 1611 photos takes about 13 seconds of requests to read in full, which is fast enough that reading the whole album on open looks tempting. It is not free, though. The page ships only the first 300 media ids; the rest do not exist until the virtualised grid has rendered them. Reading the whole album therefore means scrolling it to the bottom first, which is about a minute of the grid flying past before a single badge appears.

There is a second cost. A whole-album read on open asks Google about photos the user may never look at, on every album they open.

But the lazy behavior alone does not answer every question. It can say "of the photos you have looked at, these have no location". It cannot say "this album has 42 photos with no location", because it has never seen the whole album. That total is the thing a user actually wants before they go and fix anything.

## Decision

**Three behaviors, and the slow ones are never automatic.**

1. **By default, a photo is read when its thumbnail comes into the page, and at no other time.** `locationBadgeRenderer.js` already watches the grid, because the grid is virtualised and badges must be redrawn as elements are reused. On each redraw it reports the photo keys present. Those go to `locationLookupQueue.js`, which drops the ones already answered or already being asked about, and a short debounce lets a scroll settle before the request goes out. Opening an album therefore costs nothing and the first badges appear in well under a second.

2. **A `Read whole album` button in the panel sweeps the grid on request.** `albumGridSweep.js` scrolls from the top to the bottom, which makes every thumbnail appear once. The sweep looks up nothing itself: the flow in point 1 does all the work, because a thumbnail that appears is a thumbnail the renderer reports. The button is off the critical path, and the extension is complete without anyone pressing it.

3. **`Next without location` and `Previous without location` buttons step the grid to the next photo that carries no location, and wait for each screen they uncover.** `albumGridJump.js` steps the grid the same way the sweep does, the same fraction of a screen and the same settle time, so it never skips a row the sweep would have found. It cannot stay off the critical path like the sweep, because it has to decide whether the photo it is after is on the screen it just uncovered, and a screen the renderer has not reported yet holds photos nobody has asked about. So each screen goes to `waitForVerdicts` (the lookup queue, drained) before the walk reads it. Two rules set it apart from the sweep:
   - **The grid is restored only when the walk finds nothing.** The sweep always gives the grid back, because it only counts. Here, moving the user to the photo is the point of the button, so a successful jump leaves the user looking at it.
   - **`reachedEnd` never licenses an album total.** It is the jump's own flag, separate from the sweep's `reachedBottom`, and it only decides whether the panel says there is no more to see that way or that the walk stopped early.

Three rules hold the sweep to the same standard as the rest of the extension.

- **The grid belongs to the user, and it is given back.** The sweep starts at the top, because the user may press the button half way down an album and the photos above would otherwise never be read. It then returns the grid to exactly where it found it, in a `finally`, so a stop or a failure restores it too. Neither sibling extension does this, because both open the photo viewer afterwards and the grid position stops mattering. Here nothing covers the grid.
- **`reachedBottom` is the only thing that licenses a total.** A sweep that ran out of steps, was stopped, or met a grid that refused to move ends with `reachedBottom` false, and the panel then shows no album total at all. "We stopped looking" and "there is nothing left" look identical from the outside and mean opposite things.
- **The sweep can be stopped.** The button becomes `Stop reading` while it runs, and leaving the album stops it as well. A sweep of a large album takes minutes, so a user who changes their mind must not have to reload the page.

Each answer is remembered per album (`0006-extension-storage-layout.md`), so a swept album shows its badges immediately on the next visit, with no requests at all.

**A photo that has not been read yet carries no badge.** It is stamped `pending` and left plain. A badge that appears and then vanishes reads as a wrong answer, and there is no honest icon for "we have not looked yet".

**Rejected alternative:** sweep the album automatically when it opens. It gives the trustworthy total with no button, but it costs a minute of forced scrolling before the first badge on every album, and it moves the page under the user's hands without being asked. The button gives the same answer to the people who want it and costs the others nothing.

**Rejected alternative:** read the ids without scrolling, by asking Google for the album list page by page. That would remove the sweep entirely. The endpoint that pages an album list was not found: `snAcKc`, `EzkLze` and `nMFwOc` were each tried and none accepted the payload. Revisit this if that endpoint is ever identified, because it would make the button instant.

## Consequences

**Positive:**

- Opening an album is instant, and no request is sent for photos nobody looked at.
- A user who wants the whole picture presses one button and gets a real album total.
- The sweep needed no new lookup path. It moves the grid, and the existing renderer and queue do the rest.

**Trade-offs and follow-up:**

- Until a sweep finishes, the panel counts only the photos read so far, and it says so by leaving the total out.
- A sweep of a very large album takes minutes, most of it waiting for the grid to redraw rather than for Google to answer.
- A photo whose location changed elsewhere keeps its remembered answer. The panel's **Read this album again** button forgets one album, and the options page forgets all of them.
