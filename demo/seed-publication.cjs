/* eslint-disable @typescript-eslint/no-require-imports -- This helper is loaded by the Node seed script. */
const { access, rename } = require('node:fs/promises');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/** Recover a backup interrupted before the replacement directory was installed. */
async function recoverPreviousSeed(final, previous) {
  if (!(await exists(previous))) return;
  if (await exists(final)) {
    // Either version may match the published manifest; do not guess or discard
    // the backup after an interruption later in the publication sequence.
    throw new Error('Both seed-data and seed-data.previous exist; inspect them and the manifest before retrying.');
  }
  await rename(previous, final);
}

module.exports = { recoverPreviousSeed };
