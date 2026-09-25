/**
 * The small panel in the corner of an album page.
 *
 * It answers one question at a glance: how many photos of this album have no
 * location. Badges mark them one by one; this is the total. It also carries the
 * button that reads the whole album at once, the pair that walks the grid from
 * one photo without a location to the next, the button that copies the list of
 * photos without a location, and the two buttons a user needs when something
 * looks wrong: copy the diagnostics, and forget what is
 * remembered about this album so it is read again.
 *
 * ## Why every button catches everything
 *
 * A button that awaits must catch the await as well as the body, or a failure
 * is silent and the user presses again and again with nothing happening. The
 * clipboard is the worst of these: Chrome leaves `navigator.clipboard.writeText`
 * unresolved when it decides the document is not focused. So the copy has a
 * deadline and a fallback, and the report reaches the console before either
 * runs, which means it is never lost. The list of photos without a location
 * takes the same path.
 *
 * This is a thin DOM adapter and holds no decision, so it has no unit test.
 */

const PANEL_ID = 'gplc-panel';
const COPY_TIMEOUT_MS = 2000;

/**
 * @typedef {object} ControlPanelCounts
 * @property {number} known
 * @property {number} withoutLocation
 * @property {number} pending
 * @property {number} unreadable
 * @property {number | null} albumTotal  How many photos the album holds, once a sweep reached its end.
 *
 * @typedef {object} ControlPanelDeps
 * @property {Document} document
 * @property {() => Promise<void>} onReadWholeAlbum
 * @property {() => void} onStopReading
 * @property {(direction: 'next' | 'previous') => Promise<void>} onJumpToPhotoWithoutLocation
 * @property {() => Promise<string>} buildReport
 * @property {() => Promise<import('../photosWithoutLocationList.js').PhotosWithoutLocationList>} buildPhotosWithoutLocationList
 * @property {() => Promise<void>} onRecheckAlbum
 * @property {() => void} onOpenOptions
 */

/**
 * Copies text, and never leaves the user with nothing.
 *
 * The console line comes first on purpose: it is the one path that cannot fail.
 * @param {Document} ownerDocument
 * @param {string} text
 * @param {string} consoleLabel  Names the text in the console, such as "diagnostics report".
 * @returns {Promise<boolean>}
 */
async function copyText(ownerDocument, text, consoleLabel) {
  console.info('[Location Check] ' + consoleLabel + '\n' + text);

  const view = ownerDocument.defaultView;
  if (view?.navigator.clipboard !== undefined) {
    const deadline = new Promise((resolve) => setTimeout(() => resolve('timed out'), COPY_TIMEOUT_MS));
    try {
      const winner = await Promise.race([view.navigator.clipboard.writeText(text).then(() => 'copied'), deadline]);
      if (winner === 'copied') return true;
    } catch {
      // Falls through to the textarea below.
    }
  }

  // Older path, and the one that still works when the document is not focused.
  try {
    const holder = ownerDocument.createElement('textarea');
    holder.value = text;
    holder.style.position = 'fixed';
    holder.style.opacity = '0';
    ownerDocument.body.append(holder);
    holder.select();
    const copied = ownerDocument.execCommand('copy');
    holder.remove();
    return copied;
  } catch {
    return false;
  }
}

/**
 * @param {ControlPanelDeps} deps
 */
export function createControlPanel(deps) {
  const ownerDocument = deps.document;

  /** @type {HTMLElement | null} */
  let panel = null;
  /** @type {HTMLElement | null} */
  let countLine = null;
  /** @type {HTMLElement | null} */
  let statusLine = null;
  /** @type {HTMLButtonElement | null} */
  let sweepButton = null;
  /** @type {HTMLButtonElement[]} */
  let jumpButtons = [];

  let busy = false;

  /**
   * @param {string} label
   * @param {() => void} onClick
   * @returns {HTMLButtonElement}
   */
  function createButton(label, onClick) {
    const button = ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'gplc-panel-button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  /** @param {string} message */
  function setStatus(message) {
    if (statusLine !== null) statusLine.textContent = message;
  }

  function build() {
    const root = ownerDocument.createElement('section');
    root.id = PANEL_ID;
    root.setAttribute('aria-label', 'Google Photos Location Check');

    countLine = ownerDocument.createElement('p');
    countLine.className = 'gplc-panel-count';

    statusLine = ownerDocument.createElement('p');
    statusLine.className = 'gplc-panel-status';

    sweepButton = createButton('Read whole album', () => {
      if (busy) {
        deps.onStopReading();
        setStatus('Stopping...');
        return;
      }
      void (async () => {
        try {
          await deps.onReadWholeAlbum();
        } catch (error) {
          console.error('[Location Check] could not read the whole album', error);
          setStatus('Could not read the album. See the console.');
        }
      })();
    });

    // One handler for both directions: they differ only in which way they walk.
    /** @param {'next' | 'previous'} direction */
    const createJumpButton = (direction) =>
      createButton(direction === 'next' ? 'Next without location' : 'Previous without location', () => {
        void (async () => {
          try {
            await deps.onJumpToPhotoWithoutLocation(direction);
          } catch (error) {
            console.error('[Location Check] could not jump to a photo without a location', error);
            setStatus('Could not look for that photo. See the console.');
          }
        })();
      });
    jumpButtons = [createJumpButton('previous'), createJumpButton('next')];

    const buttons = ownerDocument.createElement('div');
    buttons.className = 'gplc-panel-buttons';
    buttons.append(
      sweepButton,
      ...jumpButtons,
      createButton('Copy photos without location', () => {
        void (async () => {
          setStatus('Building the list...');
          try {
            const list = await deps.buildPhotosWithoutLocationList();
            const copied = await copyText(ownerDocument, list.text, 'photos without a location');
            setStatus(
              copied
                ? 'Copied ' + String(list.photoCount) + (list.photoCount === 1 ? ' photo' : ' photos') + ' without a location.'
                : 'Could not copy. The list is in the console.',
            );
          } catch (error) {
            console.error('[Location Check] could not build the list of photos without a location', error);
            setStatus('Could not build the list. See the console.');
          }
        })();
      }),
      createButton('Copy diagnostics', () => {
        void (async () => {
          setStatus('Building the report...');
          try {
            const report = await deps.buildReport();
            setStatus(
              (await copyText(ownerDocument, report, 'diagnostics report'))
                ? 'Copied.'
                : 'Could not copy. The report is in the console.',
            );
          } catch (error) {
            console.error('[Location Check] could not build the report', error);
            setStatus('Could not build the report. See the console.');
          }
        })();
      }),
      createButton('Read this album again', () => {
        void (async () => {
          setStatus('Forgetting what was read...');
          try {
            await deps.onRecheckAlbum();
            setStatus('Reading again as you scroll.');
          } catch (error) {
            console.error('[Location Check] could not clear the album', error);
            setStatus('Could not clear this album. See the console.');
          }
        })();
      }),
      createButton('Options', () => {
        try {
          deps.onOpenOptions();
        } catch (error) {
          console.error('[Location Check] could not open the options page', error);
        }
      }),
    );

    root.append(countLine, statusLine, buttons);
    return root;
  }

  return {
    mount() {
      if (panel !== null || ownerDocument.body === null) return;
      panel = build();
      ownerDocument.body.append(panel);
    },

    unmount() {
      panel?.remove();
      panel = null;
      countLine = null;
      statusLine = null;
      sweepButton = null;
      jumpButtons = [];
      busy = false;
    },

    /**
     * Turns the sweep button into a Stop button while a sweep runs.
     * @param {boolean} running
     */
    setBusy(running) {
      busy = running;
      if (sweepButton !== null) sweepButton.textContent = running ? 'Stop reading' : 'Read whole album';
      for (const button of jumpButtons) button.disabled = running;
    },

    /**
     * A jump walks the grid, so a second one pressed on top of it would fight
     * the first over where the page sits. Both buttons wait instead.
     * @param {boolean} running
     */
    setJumping(running) {
      for (const button of jumpButtons) button.disabled = running;
      if (sweepButton !== null) sweepButton.disabled = running;
    },

    /** @param {ControlPanelCounts} counts */
    setCounts(counts) {
      if (countLine === null) return;
      const parts = [String(counts.withoutLocation) + ' without location'];
      // "12 read" and "12 of 1611 read" say different things. The second is
      // only honest once a sweep reached the end of the album.
      parts.push(
        counts.albumTotal === null
          ? String(counts.known) + ' read'
          : String(counts.known) + ' of ' + String(counts.albumTotal) + ' read',
      );
      if (counts.pending > 0) parts.push(String(counts.pending) + ' to go');
      if (counts.unreadable > 0) parts.push(String(counts.unreadable) + ' unreadable');
      countLine.textContent = parts.join(' \u00b7 ');
    },

    setStatus,
  };
}

/** @typedef {ReturnType<typeof createControlPanel>} ControlPanel */
