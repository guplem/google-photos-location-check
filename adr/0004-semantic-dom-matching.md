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

**This extension never clicks a Google Photos control and never presses a key.** It reads the grid, it writes its own badge elements into it, and, in the photo viewer only, it may load a new URL of its own construction. That is the whole of its contact with the page. Keep it that way: a feature that needs a click or a key press needs this ADR updated first, and it inherits the rule from the siblings that a click target must match a known word or the run stops.

The one thing allowed to open a photo is the **Next / Previous without location** buttons, while a photo is already open in the viewer. `contentEntry.js`'s `openPhotoWithoutLocation` builds the target URL with `googlePhotosPage.js`'s `replacePhotoKey`, which swaps only the photo id in the URL the page is already on, and hands it to `location.assign`. This is a plain page load, not a click and not a key press, and it drives no Google Photos control. It was chosen over pushing our own history entry, because the Google Photos router would not act on an entry we push: the address bar would name one photo while the screen kept showing another. A page load costs a reload; that cost is accepted to keep the address bar honest.

The one part of the page that carries meaning beyond the grid is the info panel's location row, whose accessible name is `Edit location` when a photo has a location and `Add a location` when it does not. Nothing reads it today. It is recorded here because it is the signal the fallback in `0002` would use, and because it is how a human checks whether a badge is right.

## Consequences

**Positive:**

- A Google redesign that renames a class changes nothing.
- The extension cannot damage a library, because it never clicks or presses a key. The worst failure is a wrong or missing badge, or, in the viewer, a page load to the wrong photo.

**Trade-offs and follow-up:**

- The extension depends on the grid link still being an `<a href=".../photo/...">`. If Google turns thumbnails into buttons with no href, the media id has to be found another way, and there is no fallback ready.
- The two location-row names are in English here. They matter only to the unbuilt fallback and to a human checking a badge, so they are not a setting yet. Make them one if that fallback is ever built.
