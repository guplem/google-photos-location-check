# Read a photo when its thumbnail appears, and never scan ahead

## Context

An album of 1611 photos takes about 13 seconds to read in full, which is fast enough that scanning the whole album up front looks tempting. It is not free, though. The page ships only the first 300 media ids; the rest exist only once the virtualised grid has rendered them. Reading the whole album therefore means scrolling it to the bottom first, which takes about a minute of the user watching a grid fly past before a single badge appears.

There is a second cost. A whole-album scan asks Google about photos the user may never look at, on every album they open.

## Decision

**A photo is read when its thumbnail comes into the page, and at no other time.**

`locationBadgeRenderer.js` already watches the grid, because the grid is virtualised and badges must be redrawn as elements are reused. On each redraw it reports the photo keys currently present. Those go to `locationLookupQueue.js`, which drops the ones already answered and the ones already being asked about, and a short debounce lets a scroll settle before the request goes out.

The consequence is that opening an album costs nothing, the first badges appear in well under a second, and scrolling fills in the rest at roughly the speed the user can look at the photos.

Each answer is remembered per album (`0006-extension-storage-layout.md`), so an album looked at before shows its badges immediately, with no request at all.

**A photo that has not been read yet carries no badge.** It is stamped `pending` and left plain. A badge that appears and then disappears reads as a wrong answer, and there is no honest icon for "we have not looked yet".

**Rejected alternative:** scroll the album to the bottom on open and scan everything. It gives a trustworthy whole-album count, which the panel cannot give today. It costs a minute of forced scrolling before the first badge, on every album, and it moves the page under the user's hands.

**Rejected alternative:** a "Scan whole album" button that does the above on request. It is a reasonable thing to add later, and nothing in the design blocks it: `albumLocationScan.js` already takes any list of media ids. It is left out for now because it needs grid-scrolling code that would otherwise not exist, and the scroll-driven path already answers the question the user asked.

## Consequences

**Positive:**

- Opening an album is instant, and no request is sent for photos nobody looked at.
- The only page code needed is the grid watcher that badges already require. There is no scroller, no automation, and nothing that moves the page.

**Trade-offs and follow-up:**

- The panel's counts describe the photos read so far, not the album. It cannot say "42 photos in this album have no location" until the user has scrolled the whole album.
- A photo whose location changed elsewhere keeps its remembered answer. The panel's **Read this album again** button forgets one album, and the options page forgets all of them.
