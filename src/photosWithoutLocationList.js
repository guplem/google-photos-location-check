/**
 * Builds the list of photos without a location that the panel copies.
 *
 * The user pastes it next to a Google Maps Timeline export and looks up where
 * they were at the time of each photo. So the list is sorted by the time the
 * photo was taken, and each line carries that time in the photo's own local
 * time, the file name, and a link to open the photo. The columns are separated
 * by tabs, so the list pastes into a spreadsheet as three columns.
 *
 * This file is pure, like `diagnosticsReport.js`. It reads no clock and no time
 * zone of the computer: the local time comes from the photo's own offset, by
 * plain arithmetic, so the same record always gives the same text.
 *
 * Only `no-location` entries are listed. A photo that answered "cannot tell"
 * is never stored, so it cannot reach this list; the header counts those
 * photos instead, so the user knows the list leaves them out.
 */

import { buildAlbumPhotoUrl } from './googlePhotosPage.js';

/** Header lines start with this, so a spreadsheet user can sort them out. */
const HEADER_PREFIX = '# ';

const MS_PER_MINUTE = 60000;

/**
 * @typedef {import('./locationState/locationStateStore.js').PhotoLocationEntry} PhotoLocationEntry
 *
 * @typedef {object} PhotosWithoutLocationListInput
 * @property {string} albumKey
 * @property {string} pageUrl  The URL the page is on. The photo links keep its account prefix and query.
 * @property {Readonly<Record<string, PhotoLocationEntry>>} photos
 * @property {boolean} orderComplete  True only when a sweep reached the bottom of the album.
 * @property {number} photosUnreadable  Photos that answered "cannot tell" during this visit.
 *
 * @typedef {object} PhotosWithoutLocationList
 * @property {string} text
 * @property {number} photoCount
 */

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function countOf(count, singular, plural) {
  return String(count) + ' ' + (count === 1 ? singular : plural);
}

/** @param {number} value */
function twoDigits(value) {
  return String(value).padStart(2, '0');
}

/**
 * Writes `+02:00` for 7200000. A known offset of zero is `+00:00`, not `Z`, so
 * "UTC" and "the time zone is not known" stay apart.
 * @param {number | null} offsetMs
 * @returns {string}
 */
function formatOffset(offsetMs) {
  if (offsetMs === null) return 'Z';
  const totalMinutes = Math.round(Math.abs(offsetMs) / MS_PER_MINUTE);
  return (offsetMs < 0 ? '-' : '+') + twoDigits(Math.floor(totalMinutes / 60)) + ':' + twoDigits(totalMinutes % 60);
}

/**
 * The photo's own local time as ISO 8601, such as `2021-05-12T23:20:49+02:00`.
 *
 * The offset is added before the date is formatted, and the `Z` that
 * `toISOString` writes is replaced by that offset. This never uses the time
 * zone of the computer that runs the extension.
 * @param {PhotoLocationEntry} entry
 * @returns {string | null} null when the time is not known or not a real date.
 */
function formatLocalTime(entry) {
  if (entry.takenAt === null) return null;
  const local = new Date(entry.takenAt + (entry.timeZoneOffsetMs ?? 0));
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString().slice(0, 19) + formatOffset(entry.timeZoneOffsetMs);
}

/**
 * @param {string | null} left
 * @param {string | null} right
 * @returns {number}
 */
function compareText(left, right) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
}

/**
 * @typedef {object} ListedPhoto
 * @property {string} photoKey
 * @property {PhotoLocationEntry} entry
 * @property {string | null} localTime
 */

/**
 * Oldest first, then by file name, then by photo key so the order never
 * depends on the order of the record. A photo with no time goes last.
 * @param {ListedPhoto} left
 * @param {ListedPhoto} right
 * @returns {number}
 */
function compareListedPhotos(left, right) {
  const leftTime = left.localTime === null ? null : left.entry.takenAt;
  const rightTime = right.localTime === null ? null : right.entry.takenAt;
  if (leftTime !== rightTime) {
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    return leftTime - rightTime;
  }
  return compareText(left.entry.fileName, right.entry.fileName) || compareText(left.photoKey, right.photoKey);
}

/**
 * @param {PhotosWithoutLocationListInput} input
 * @returns {PhotosWithoutLocationList}
 */
export function buildPhotosWithoutLocationList(input) {
  /** @type {ListedPhoto[]} */
  const listed = Object.entries(input.photos)
    .filter(([, entry]) => entry.state === 'no-location')
    .map(([photoKey, entry]) => ({ photoKey, entry, localTime: formatLocalTime(entry) }))
    .sort(compareListedPhotos);

  const withMissingDetails = listed.filter((photo) => photo.localTime === null || photo.entry.fileName === null).length;

  /** @type {string[]} */
  const header = [
    'Photos without a location in album ' + input.albumKey,
    countOf(listed.length, 'photo', 'photos') + ' without a location',
    // A list from a half-read album looks exactly like a complete one. Only a
    // sweep that reached the bottom may call it complete.
    input.orderComplete
      ? 'The whole album was read.'
      : 'The album was not read to the end, so this list may be incomplete. Press Read whole album to read all of it.',
  ];
  if (input.photosUnreadable > 0) {
    header.push(countOf(input.photosUnreadable, 'photo', 'photos') + ' could not be read, so this list leaves them out.');
  }
  if (withMissingDetails > 0) {
    header.push(
      countOf(withMissingDetails, 'photo has', 'photos have') +
        ' no time or no file name. If an older version of the extension read them,' +
        ' press Read this album again, then Read whole album, to fill them in.',
    );
  }
  header.push("Columns, separated by tabs: the time taken (the photo's local time, ISO 8601), the file name, the link.");

  const lines = listed.map((photo) =>
    [
      photo.localTime ?? 'time unknown',
      photo.entry.fileName ?? 'file name unknown',
      buildAlbumPhotoUrl(input.pageUrl, photo.photoKey) ?? photo.photoKey,
    ].join('\t'),
  );

  return {
    text: [...header.map((line) => HEADER_PREFIX + line), '', ...lines].join('\n'),
    photoCount: listed.length,
  };
}
