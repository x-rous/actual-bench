/* eslint-disable @typescript-eslint/no-require-imports -- This helper is loaded by the Node seed script. */
const fs = require('node:fs/promises');
const { join } = require('node:path');

async function exists(path, io = fs) {
  try {
    await io.access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

const backupDir = (previous) => join(previous, '.publication-backup');

/** Recover a backup interrupted before the replacement directory was installed. */
async function recoverPreviousSeed(final, previous) {
  if (!(await exists(previous))) return;
  if (await exists(final)) {
    // Either version may match the published manifest; do not guess or discard
    // the backup after an interruption later in the publication sequence.
    throw new Error('Both seed-data and seed-data.previous exist; inspect them and the manifest before retrying.');
  }
  // No replacement directory was installed, so neither metadata file changed.
  await fs.rm(backupDir(previous), { recursive: true, force: true });
  await fs.rename(previous, final);
}

/** Publish matching artifacts, restoring the old set if any replacement fails. */
async function publishSeed({ final, previous, next, database, nextDatabase, manifest, nextManifest }, io = fs) {
  await io.rename(final, previous);
  const backup = backupDir(previous);
  let installedDirectory = false;
  let installedDatabase = false;
  let installedManifest = false;
  let hadDatabase = false;
  let hadManifest = false;
  try {
    await io.mkdir(backup);
    hadDatabase = await exists(database, io);
    hadManifest = await exists(manifest, io);
    if (hadDatabase) await io.copyFile(database, join(backup, 'database'));
    if (hadManifest) await io.copyFile(manifest, join(backup, 'manifest'));
    await io.rename(next, final);
    installedDirectory = true;
    await io.rename(nextDatabase, database);
    installedDatabase = true;
    await io.rename(nextManifest, manifest);
    installedManifest = true;
  } catch (error) {
    try {
      if (installedDatabase) {
        if (hadDatabase) await io.copyFile(join(backup, 'database'), database);
        else await io.rm(database, { force: true });
      }
      if (installedManifest) {
        if (hadManifest) await io.copyFile(join(backup, 'manifest'), manifest);
        else await io.rm(manifest, { force: true });
      }
      if (installedDirectory) await io.rm(final, { recursive: true, force: true });
      await io.rm(backup, { recursive: true, force: true });
      await io.rename(previous, final);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Seed publication and rollback failed; preserve seed-data.previous for inspection.');
    }
    throw error;
  }
  await io.rm(previous, { recursive: true, force: true });
}

module.exports = { publishSeed, recoverPreviousSeed };
