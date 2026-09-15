# Settings in sync storage, album answers in local storage, one key per album

## Context

Chrome gives an extension two storage areas, with very different limits.

- `chrome.storage.sync` follows the user's Chrome profile to their other computers. It holds about 100KB in total and about 8KB per item.
- `chrome.storage.local` stays on one computer and holds about 10MB.

The extension stores two kinds of data. **Settings** are small, and a user who changes them on one computer wants them everywhere. **Album answers** are one entry per photo, so a 1611-photo album is far past the 8KB per-item limit of `sync`.

A write also matters. Answers arrive in batches while the user scrolls, so the extension writes often. If all albums shared one storage key, each write would serialize every album the user had ever opened.

## Decision

- **Settings** live in `chrome.storage.sync` under the single key `settings:v1`.
- **Album answers** live in `chrome.storage.local` under one key per album: `locationState:v1:<albumKey>`. `locationStateStore.js` is the only file that reads or writes them.
- **Never put album answers in `sync`.** A large album exceeds the per-item quota and the write fails.

**Only a verdict is ever stored.** `has-location` and `no-location` are written; `unknown` is not. Writing `unknown` would tell the next visit that the photo is already answered, and the extension would never try it again. A photo it could not read must stay unread.

Both areas are validated on read. `normalizeSettings` and `normalizeAlbumRecord` drop unknown keys and repair wrong values, because storage can hold data written by an older version of the extension. Whenever you add a field, extend the matching function and add a test.

The `:v1` suffix in each key is the migration escape hatch. If a record shape ever changes in a way `normalize` cannot repair, write `:v2` keys and leave the old ones to be cleared from the options page.

**Rejected alternative:** one `local` key holding every album. It is simpler to read, but every batched write while scrolling would rewrite the whole cache, and the cost grows with the number of albums the user has ever opened.

**Rejected alternative:** put the answers in `sync` so they follow the user. The quota forbids it, and the value is low: an answer is cheap to fetch again, and a whole album costs about 13 seconds.

## Consequences

**Positive:**

- A batch of answers writes one small key, whatever else is remembered.
- The options page forgets every album with one prefix scan (`clearAllAlbums`), and it cannot touch the settings by accident because they live in a different area.
- Settings follow the user's profile, which is what a user expects from a preference.

**Trade-offs and follow-up:**

- Answers do not follow the user to another computer. Each computer pays for its own first read.
- Nothing evicts old albums. `local` holds about 10MB, which is thousands of albums, so this is not urgent, but a very heavy user has no automatic cleanup beyond the options-page button.
- A record carries no album name, only the key from the URL, so the options page can report a count of albums but not which ones.
