/**
 * Progress lines for the long stages.
 *
 * Everything here goes to stdout, because that is the one channel both callers
 * already read: a shell running `yarn demo:record`, and the app server, which
 * pipes the child's stdout into the Studio's log panel and (since it survives a
 * server restart and the in-memory panel does not) into a file under
 * `output/logs/`.
 *
 * The wall-clock stamp is the point. Recording and rendering are minutes of
 * silence otherwise, and the question afterwards is always the same one — how
 * far did it get before it stopped, and which step was it in when it did.
 */
const stamp = () => new Date().toISOString().slice(11, 19);

export const step = (message) => console.log(`[${stamp()}] ${message}`);

/** A failure worth seeing on stderr while the stage keeps its own error handling. */
export const warn = (message) => console.error(`[${stamp()}] ${message}`);

export const seconds = (milliseconds) => `${(milliseconds / 1000).toFixed(1)}s`;

/**
 * Wrap a phase so its start, duration and failure are all reported the same way.
 * The error is re-thrown untouched: this narrates, it does not handle.
 */
export const timed = async (message, run) => {
  step(`${message}…`);
  const startedAt = Date.now();
  try {
    const result = await run();
    step(`${message} — done in ${seconds(Date.now() - startedAt)}`);
    return result;
  } catch (error) {
    warn(`${message} — failed after ${seconds(Date.now() - startedAt)}: ${error.message}`);
    throw error;
  }
};
