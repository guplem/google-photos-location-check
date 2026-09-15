# Match the Google Photos page by meaning, and never act on the page

## Context

This extension changes a page it does not own and cannot version-pin. Google Photos ships Closure-compiled markup: class names such as `QxNbxb` and `p137Zd` are generated per build and change with no notice. A selector built on one is a time bomb that fails silently after a Google release.

The sibling extensions learned this the hard way in both directions. A **read** that stops working shows wrong badges, which a user notices and reports. A **click** that lands on the wrong element takes an action inside the user's own library: in `google-photos-auto-date` an early fallback clicked whichever button sat near the right edge of the window and opened the "Edit date/time" dialog at the end of every album.

This extension needs very little from the page, because `0002-ask-google-photos-for-the-location.md` gets the location from an endpoint instead of from the rendered panel. What it still needs is to find the grid thumbnails and to know which photo each one is.

## Decision

**Match by meaning, in this order of preference.**

1. The URL: `/album/`, `/share/`, `/photo/`. `googlePhotosPage.js` is the only home for URL knowledge.
2. A link target: `a[href*="/photo/"]` finds every grid thumbnail, and the id in that link is the media id the endpoint takes.
3. An accessible name: `aria-label`, then `title`, then a short `textContent`. This is the name a screen reader announces, so Google must keep it correct.
4. Position on screen, **only to narrow a set already matched by name**, never on its own.

Never match a class name. If a change seems to need one, the design is wrong; find another signal.

**This extension never clicks anything, never presses a key, and never opens a photo.** It reads the grid and it writes its own badge elements into it. That is the whole of its contact with the page. Keep it that way: a feature that needs a click needs this ADR updated first, and it inherits the rule from the siblings that a click target must match a known word or the run stops.

The one part of the page that carries meaning beyond the grid is the info panel's location row, whose accessible name is `Edit location` when a photo has a location and `Add a location` when it does not. Nothing reads it today. It is recorded here because it is the signal the fallback in `0002` would use, and because it is how a human checks whether a badge is right.

## Consequences

**Positive:**

- A Google redesign that renames a class changes nothing.
- The extension cannot damage a library, because it takes no action in the page at all. The worst failure is a wrong or missing badge.

**Trade-offs and follow-up:**

- The extension depends on the grid link still being an `<a href=".../photo/...">`. If Google turns thumbnails into buttons with no href, the media id has to be found another way, and there is no fallback ready.
- The two location-row names are in English here. They matter only to the unbuilt fallback and to a human checking a badge, so they are not a setting yet. Make them one if that fallback is ever built.
