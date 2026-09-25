# Google Photos Location Check

A Chrome extension that shows you, straight on the Google Photos album grid, which of your photos carry no location.

Every thumbnail whose photo has no place attached gets a small orange badge with a crossed-out map pin in its top left corner. The extension never clicks anything and never edits your library. The one thing it can open on its own is another photo of the same album, and only when you press **Next without location** or **Previous without location** while a photo is already open; see below.

## Why you might want it

Google Photos only tells you whether a photo has a location when you open that photo and look at its info panel. Finding the ones that are missing a location means opening them one at a time. In a 1611-photo holiday album, that is not something anyone does.

This extension answers the same question for a whole screen of thumbnails at once, in well under a second.

## Install

There is no build step, so the repository folder **is** the extension folder.

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Press **Load unpacked** and pick the folder you cloned.
5. Open any album at [photos.google.com](https://photos.google.com).

Chrome will keep the extension until you remove it. After you pull a new version, press the reload arrow on the extension's card, then reload the Google Photos tab.

## How to use it

Open an album and scroll. That is all.

- A photo is read when its thumbnail comes into view, so badges fill in as you scroll. Nothing runs ahead of you.
- A small panel in the bottom left corner counts what has been read so far in this album.
- Answers are remembered on this computer, so an album you have already looked at shows its badges immediately.

### Reading a whole album at once

Scrolling only tells you about the photos you have actually looked at. To get the total for a whole album, press **Read whole album** in the panel.

It scrolls the album from top to bottom for you, badging everything on the way, and then puts the grid back exactly where you had it. While it runs the button becomes **Stop reading**, and leaving the album stops it too.

How long it takes depends on the album, not on your connection: most of the wait is the Google Photos grid drawing each screen of thumbnails. A 1611-photo album takes a few minutes. You can keep using the panel while it runs.

Once it finishes, the panel shows a real total, for example `158 without location · 1611 of 1611 read`. If it was stopped, or could not reach the end, the total is left out on purpose: the extension will not present "we stopped looking" as "there is nothing left".

### Jumping to the next photo without a location

Press **Next without location** or **Previous without location** in the panel to go straight to the closest photo that needs one, without scrolling past everything in between yourself. Press either one again and it moves on to the next.

**On the album grid**, the button scrolls for you, brings that thumbnail into view, and rings it for two seconds so you can see where it stopped. It looks up whatever it scrolls past on the way, so it works even if you have not pressed **Read whole album** first. If there is nothing left to find in that direction, the grid goes back exactly where it was.

**In the photo viewer**, the same buttons open the next, or previous, photo of the album that has no location, so you can add a place, press Next, add a place, and so on. Opening a photo is a full page load, about a second: the extension will not press the Google Photos controls to get there. This needs the album order, and only **Read whole album** writes that down. So the first time, go back to the grid and press **Read whole album** once. After that the buttons work straight from the viewer. **Read whole album** itself still needs the grid, and the panel says so if you press it with a photo open.

### Copying the photos without a location

Press **Copy photos without location** in the panel. It copies a list of every photo in this album that has no location, sorted from oldest to newest by the time it was taken.

Each line has three columns, separated by tabs, so the list pastes into a spreadsheet as three columns:

```text
2021-05-12T23:20:49+02:00	IMG_20210512_232045262_HDR.jpg	https://photos.google.com/album/.../photo/...
```

1. The time the photo was taken, in the photo's own local time, as an ISO 8601 timestamp (a standard date format, `YYYY-MM-DDThh:mm:ss` plus the time zone). A time that ends in `Z` is in UTC (Coordinated Universal Time), because the time zone of the photo is not known.
2. The file name.
3. A link that opens the photo.

The lines that start with `#` say how many photos the list holds. They say "The whole album was read." only when a **Read whole album** reached the end, every photo has an answer, and no photo waits to be read. Otherwise they say how many photos have no answer yet or still wait to be read. The list holds only the photos the extension has read. Press **Read whole album** first to get every one. A photo with no known time appears at the end as `time unknown`. A photo that could not be read (the grey badge) is left out, and the header counts it.

To find where each photo was taken, export your Google Maps Timeline, then look up the time of each line in it. Then add the place to the photo in Google Photos. Google Maps keeps the Timeline on your phone, so export it from the Timeline settings of the Google Maps app.

If some lines say `time unknown` or `file name unknown` for photos that do have them, an older version of the extension read them. Press **Read this album again**, then **Read whole album**, to fill them in.

**What the badges mean:**

| Badge              | Means                                                                             |
| ------------------ | --------------------------------------------------------------------------------- |
| Orange crossed pin | Google Photos holds no location for this photo.                                   |
| Grey crossed pin   | The location could not be read. This is not an answer about the photo, see below. |
| No badge           | Either the photo has a location, or it has not been read yet.                     |

A grey badge means Google answered, but the answer did not hold a location where the extension expects one. That almost always means Google changed something and the extension needs an update. It never means the photo is missing a location.

## Options

Press the extension's toolbar button, or **Options** in the panel on the album page.

| Setting                                     | Default | What it does                                                                     |
| ------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| Show a badge on photos with no location     | On      | The main feature. Turn it off to hide every badge without uninstalling.          |
| Fade the photos that do have a location     | Off     | Dims the photos that are fine, so the ones missing a location stand out more.    |
| Also mark the photos that could not be read | On      | Draws the grey badge described above. Turn it off if you find it noisy.          |
| Photos asked about in one request           | 100     | Speed. Lower it if Google starts refusing requests.                              |
| Requests at the same time                   | 3       | Speed. Lower it for the same reason.                                             |
| Wait after scrolling before asking          | 250 ms  | How long a scroll must settle before the extension asks about what it uncovered. |

The same page has a button that forgets every remembered album, so everything is read again from scratch.

## Troubleshooting

**No badges appear at all.**
Check that you are on an album page (`photos.google.com/album/...` or `/share/...`). The extension does nothing on the main photo stream or on search results. If you are on an album, reload the tab: the extension starts with the page.

**Every photo shows a grey badge.**
Google changed the shape of its answer and the extension cannot read it any more. Press **Copy diagnostics** in the panel and open an issue with what it copied. Nothing is wrong with your photos.

**The panel says "could not be read" for a handful of photos.**
Usually Google refused a burst of requests. Scroll past them and back, and they are asked about again. If it keeps happening, lower **Photos asked about in one request** and **Requests at the same time** in the options.

**Read whole album stops before the end.**
Press it again and it carries on from the top, keeping everything it already read. If it stops in the same place every time, the grid is not scrolling the way the extension expects; press **Copy diagnostics** and open an issue.

**The Next / Previous buttons say the album has not been read, or do nothing useful, while a photo is open.**
Go back to the album grid and press **Read whole album** once. The buttons need the album order that only a sweep writes down; until one has run for this album, the viewer has nothing to walk.

**A badge disagrees with what Google Photos shows.**
Open the photo and press `i`. If the info panel shows a place and the badge says there is none, press **Read this album again** in the panel and scroll past that photo. If it still disagrees, that is a bug worth reporting.

**Nothing works after I reloaded the extension.**
A tab that was already open keeps running the old copy of the extension, which can no longer reach Chrome's storage. Reload the Google Photos tab.

## How it works

Google Photos fills its own info panel by calling an internal endpoint on its own servers. This extension sends that same call for the photos you are looking at, and reads the location out of the answer. It runs inside the Google Photos page, so the request carries your existing sign-in the same way the page's own requests do.

That is what makes it fast: no photo is opened and no image is downloaded. A batch of 100 photos is answered in about a second.

Because the endpoint is Google's internal one and its answer has no field names, the extension is careful about being wrong. When an answer does not look the way it should, the photo is reported as **unreadable** (the grey badge), never as **no location**. A change on Google's side can make this extension go quiet; it cannot make it tell you something false.

## Privacy

- Nothing leaves your browser. There is no server, no analytics, and no account.
- The only network request the extension makes goes to `photos.google.com`, from inside the Google Photos page itself.
- What it remembers is stored by Chrome on this computer: for each album, one entry per photo saying whether it has a location, with its file name and the time it was taken, plus the album's photo order once **Read whole album** has swept it. Your settings are stored in your Chrome profile so they follow you between computers.
- The diagnostics report and the list of photos without a location are built in the page and copied to your clipboard. They are never sent anywhere. Read them before you paste them somewhere public: the list holds your file names, times, and photo links.

## Related extensions

- [google-photos-auto-save-check](https://github.com/guplem/google-photos-auto-save-check) marks the photos of a shared album that are not in your own library yet.
- [google-photos-auto-date](https://github.com/guplem/google-photos-auto-date) corrects photo timestamps in bulk.

## Development

Requires [Node.js](https://nodejs.org). There is no build step.

```bash
npm install
npm run check
```

`npm run check` runs the format check, the type check, and the tests, which is exactly what CI runs. Contributor and architecture notes live in `AGENTS.md`.

## Licence

MIT. See `LICENSE`.
