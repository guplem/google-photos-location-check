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
 * | 13    | the location, or `null` when the photo carries none      |
 *
 * The location itself is `[[latitudeE7, longitudeE7], flag, [placeEntry, ...]]`.
 * `E7` means the number is the real degree value times ten million, so
 * `53443938` is `5.3443938`. A place entry carries the name Google shows in the
 * info panel, such as `Khemical`.
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

/** Degree values arrive multiplied by ten million. */
const DEGREES_PER_UNIT = 1e-7;

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

  const location = photo[LOCATION_INDEX];
  if (location === null || location === undefined) {
    return { mediaId: expectedMediaId, state: 'no-location', fileName, placeName: null, coordinates: null };
  }

  const coordinates = isArray(location) ? readCoordinates(location[0]) : null;
  // Something sits at index 13 but it is not a location. That is the drift case
  // the whole `null` answer exists for.
  if (coordinates === null) return null;

  return {
    mediaId: expectedMediaId,
    state: 'has-location',
    fileName,
    placeName: isArray(location) ? readFirstPlaceName(location[2]) : null,
    coordinates,
  };
}
