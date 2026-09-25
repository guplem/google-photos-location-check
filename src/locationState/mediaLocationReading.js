/**
 * Turns one answer of the `fDcn4b` call into "this photo has a location" or
 * "this photo has none".
 *
 * ## Where the answer keeps the location
 *
 * The answer is a nested array with no field names. The photo sits at
 * `payload[0]`, and inside it:
 *
 * | Index | Holds                                                    |
 * | ----- | -------------------------------------------------------- |
 * | 0     | the media id, the same one we asked for                  |
 * | 2     | the file name, such as `PXL_20260816_115242847.jpg`      |
 * | 3     | the time the photo was taken, in milliseconds UTC        |
 * | 4     | the offset of the photo's time zone, in milliseconds     |
 * | 13    | the location, or `null` when the photo carries none      |
 *
 * The location itself is `[[latitudeE7, longitudeE7], flag, [placeEntry, ...]]`.
 * `E7` means the number is the real degree value times ten million, so
 * `53443938` is `5.3443938`. A place entry carries the name Google shows in the
 * info panel, such as `Khemical`.
 *
 * The time and the offset add up to the photo's own local time: `1620854449439`
 * at `7200000` is 21:20:49 UTC, which is 23:20:49 at +02:00. They only describe
 * the photo. They never change the verdict, so a time that cannot be read is
 * `null` and the verdict still stands.
 *
 * ## Why `null` is a real answer
 *
 * The indexes above are Google's, not ours, and Google can reorder them with no
 * notice. If that happens, index 13 holds something else, and reading it as
 * "no location" would badge **every photo in the album** as missing. So this
 * function answers `null` for "cannot tell" whenever the payload does not look
 * like the photo we asked for, or index 13 holds something that is neither
 * absent nor a well formed location. The caller must show "unknown", never
 * "missing". A badge nobody can trust is worse than no badge.
 *
 * No DOM and no network here, so the whole decision is unit tested with arrays.
 */

/** Index of the location inside the photo array. */
const LOCATION_INDEX = 13;

/** Index of the media id inside the photo array. */
const MEDIA_ID_INDEX = 0;

/** Index of the file name inside the photo array. */
const FILE_NAME_INDEX = 2;

/** Index of the time the photo was taken inside the photo array. */
const TAKEN_AT_INDEX = 3;

/** Index of the time zone offset inside the photo array. */
const TIME_ZONE_OFFSET_INDEX = 4;

/** Degree values arrive multiplied by ten million. */
const DEGREES_PER_UNIT = 1e-7;

// A moved index can put any number at index 3 or 4. A number that cannot be a
// photo's time must read as "time unknown", never as a false time in the list.
const EARLIEST_TAKEN_AT_MS = Date.UTC(1900, 0, 1);
const LATEST_TAKEN_AT_MS = Date.UTC(10000, 0, 1) - 1;
// A flag, a count, or a file size reads as a time close to 1 January 1970.
// No real photo in an album is that close to the epoch.
const EPOCH_MARGIN_MS = Date.UTC(1971, 0, 1);
const MS_PER_MINUTE = 60000;
/** Real time zones reach from -12:00 to +14:00. */
const LARGEST_OFFSET_MS = 14 * 60 * MS_PER_MINUTE;

/**
 * @typedef {'has-location' | 'no-location'} LocationState
 *
 * @typedef {object} Coordinates
 * @property {number} latitude
 * @property {number} longitude
 *
 * @typedef {object} MediaLocationReading
 * @property {string} mediaId
 * @property {LocationState} state
 * @property {string | null} fileName    Shown in the diagnostics report, so a user can find the photo.
 * @property {number | null} takenAt           Milliseconds since the epoch, UTC.
 * @property {number | null} timeZoneOffsetMs  Add it to `takenAt` to get the photo's local time.
 * @property {string | null} placeName   The name the info panel shows, when there is a location.
 * @property {Coordinates | null} coordinates
 */

/**
 * @param {unknown} value
 * @returns {value is unknown[]}
 */
function isArray(value) {
  return Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function readFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number | null} null unless the value is a time in the years 1900 to 9999, UTC, and not within a year of the epoch.
 */
function readTakenAt(value) {
  const takenAt = readFiniteNumber(value);
  if (takenAt === null || takenAt < EARLIEST_TAKEN_AT_MS || takenAt > LATEST_TAKEN_AT_MS) return null;
  return Math.abs(takenAt) < EPOCH_MARGIN_MS ? null : takenAt;
}

/**
 * @param {unknown} value
 * @returns {number | null} null unless the value is a whole number of minutes within 14 hours.
 */
function readTimeZoneOffset(value) {
  const offsetMs = readFiniteNumber(value);
  return offsetMs !== null && offsetMs % MS_PER_MINUTE === 0 && Math.abs(offsetMs) <= LARGEST_OFFSET_MS ? offsetMs : null;
}

/**
 * Reads `[latitudeE7, longitudeE7]`.
 * @param {unknown} value
 * @returns {Coordinates | null}
 */
function readCoordinates(value) {
  if (!isArray(value)) return null;
  const [latitude, longitude] = value;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  return { latitude: latitude * DEGREES_PER_UNIT, longitude: longitude * DEGREES_PER_UNIT };
}

/**
 * Reads the first place name out of the list of place entries.
 *
 * A photo carries one or two entries and both have named the same place in
 * every sample seen so far, so the first one is enough. A missing name is not a
 * failure: the coordinates alone already answer the only question this
 * extension asks.
 * @param {unknown} value
 * @returns {string | null}
 */
function readFirstPlaceName(value) {
  if (!isArray(value)) return null;
  for (const entry of value) {
    if (!isArray(entry)) continue;
    const names = entry[1];
    if (!isArray(names)) continue;
    const firstName = names[0];
    if (!isArray(firstName)) continue;
    const name = firstName[0];
    if (typeof name === 'string' && name !== '') return name;
  }
  return null;
}

/**
 * @param {unknown} payload        One answer, already parsed out of its envelope.
 * @param {string} expectedMediaId The photo this slot was asked about.
 * @returns {MediaLocationReading | null} null means "cannot tell", never "no location".
 */
export function readMediaLocation(payload, expectedMediaId) {
  if (!isArray(payload)) return null;

  const photo = payload[0];
  if (!isArray(photo)) return null;

  // The id check does two jobs. It proves the payload is still shaped the way
  // we think, and it proves this answer belongs to the photo we asked about.
  // Answers come back with their slots shuffled, so a mix-up is a real risk.
  if (photo[MEDIA_ID_INDEX] !== expectedMediaId) return null;

  // A photo array this short is not the array we know. Reading index 13 out of
  // it would invent an answer.
  if (photo.length <= LOCATION_INDEX) return null;

  const fileNameValue = photo[FILE_NAME_INDEX];
  const fileName = typeof fileNameValue === 'string' && fileNameValue !== '' ? fileNameValue : null;
  const takenAt = readTakenAt(photo[TAKEN_AT_INDEX]);
  const timeZoneOffsetMs = readTimeZoneOffset(photo[TIME_ZONE_OFFSET_INDEX]);

  const location = photo[LOCATION_INDEX];
  if (location === null || location === undefined) {
    return {
      mediaId: expectedMediaId,
      state: 'no-location',
      fileName,
      takenAt,
      timeZoneOffsetMs,
      placeName: null,
      coordinates: null,
    };
  }

  const coordinates = isArray(location) ? readCoordinates(location[0]) : null;
  // Something sits at index 13 but it is not a location. That is the drift case
  // the whole `null` answer exists for.
  if (coordinates === null) return null;

  return {
    mediaId: expectedMediaId,
    state: 'has-location',
    fileName,
    takenAt,
    timeZoneOffsetMs,
    placeName: isArray(location) ? readFirstPlaceName(location[2]) : null,
    coordinates,
  };
}
