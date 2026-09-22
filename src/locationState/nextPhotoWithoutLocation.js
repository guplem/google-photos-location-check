/**
 * Finds the photo without a location that comes after, or before, the one the
 * user has open in the photo viewer.
 *
 * ## Why this needs an order at all
 *
 * On the album grid the extension can walk to the next photo without a
 * location, because the grid itself holds the photos in album order and can be
 * scrolled until the right one appears (`albumGrid/albumGridJump.js`). The
 * photo viewer has no grid, so there is nothing to walk. The only way to say
 * "the next one is that photo" is to have written the album order down first,
 * which a sweep does and nothing else does.
 *
 * ## Three answers, and the caller must tell them apart
 *
 * A photo missing from the order is not the same as no photo left to find. The
 * first means nobody has read this album yet, and the user must press **Read
 * whole album** on the grid. The second means the work is done in that
 * direction. Reporting the first as the second would tell the user an album is
 * finished when it was never started.
 *
 * No DOM and no storage here, so the whole search is unit tested.
 */

/**
 * @typedef {'found' | 'none-that-way' | 'photo-not-in-order'} NextPhotoSearchOutcome
 *
 * @typedef {object} NextPhotoSearchResult
 * @property {NextPhotoSearchOutcome} outcome
 * @property {string | null} photoKey  The photo to open, and null for every other outcome.
 *
 * @typedef {object} NextPhotoSearchInput
 * @property {readonly string[]} order  The photos of the album, in album order, as a sweep saw them.
 * @property {string} fromPhotoKey      The photo the user is looking at now.
 * @property {'next' | 'previous'} direction
 * @property {(photoKey: string) => 'has-location' | 'no-location' | null} readState
 *   The stored verdict, or null when nobody has read that photo yet.
 */

/**
 * @param {NextPhotoSearchInput} input
 * @returns {NextPhotoSearchResult}
 */
export function findNextPhotoWithoutLocation(input) {
  const start = input.order.indexOf(input.fromPhotoKey);
  if (start === -1) return { outcome: 'photo-not-in-order', photoKey: null };

  const step = input.direction === 'next' ? 1 : -1;
  for (let index = start + step; index >= 0 && index < input.order.length; index += step) {
    const photoKey = input.order[index];
    // A photo nobody has read yet is not a photo without a location. Passing it
    // over is right: the alternative is to stop on a photo that may be fine.
    if (photoKey !== undefined && input.readState(photoKey) === 'no-location') {
      return { outcome: 'found', photoKey };
    }
  }

  return { outcome: 'none-that-way', photoKey: null };
}
