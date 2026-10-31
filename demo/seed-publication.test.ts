import * as fs from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PathLike } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { publishSeed, recoverPreviousSeed } = require('./seed-publication.cjs') as {
  recoverPreviousSeed: (final: string, previous: string) => Promise<void>;
  publishSeed: (paths: Record<string, string>, io?: typeof fs) => Promise<void>;
};

it('restores the previous seed if publication stopped before installing the replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'demo-seed-recovery-'));
  const final = join(root, 'seed-data'), previous = join(root, 'seed-data.previous');
  try {
    await mkdir(previous);
    await writeFile(join(previous, 'budget'), 'old seed');
    await recoverPreviousSeed(final, previous);
    expect(await readFile(join(final, 'budget'), 'utf8')).toBe('old seed');
    await expect(readFile(join(previous, 'budget'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('preserves both seeds when an interrupted publication needs manual inspection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'demo-seed-recovery-'));
  const final = join(root, 'seed-data'), previous = join(root, 'seed-data.previous');
  try {
    await mkdir(final);
    await mkdir(previous);
    await writeFile(join(final, 'budget'), 'new seed');
    await writeFile(join(previous, 'budget'), 'old seed');
    await expect(recoverPreviousSeed(final, previous)).rejects.toThrow(/inspect/);
    expect(await readFile(join(final, 'budget'), 'utf8')).toBe('new seed');
    expect(await readFile(join(previous, 'budget'), 'utf8')).toBe('old seed');
  } finally { await rm(root, { recursive: true, force: true }); }
});


it.each([true, false])('rolls back every artifact when the manifest rename fails (existing database: %s)', async (hasDatabase) => {
  const root = await mkdtemp(join(tmpdir(), 'demo-seed-publish-'));
  const paths = {
    final: join(root, 'seed-data'), previous: join(root, 'seed-data.previous'),
    next: join(root, 'seed-data.next'), database: join(root, 'seed-bench.sqlite'),
    nextDatabase: join(root, 'seed-bench.next.sqlite'), manifest: join(root, 'seed-manifest.json'),
    nextManifest: join(root, 'seed-manifest.next.json'),
  };
  try {
    await mkdir(paths.final);
    await mkdir(paths.next);
    await writeFile(join(paths.final, 'budget'), 'old budget');
    await writeFile(join(paths.next, 'budget'), 'new budget');
    if (hasDatabase) await writeFile(paths.database, 'old database');
    await writeFile(paths.nextDatabase, 'new database');
    await writeFile(paths.manifest, 'old manifest');
    await writeFile(paths.nextManifest, 'new manifest');
    const io = { ...fs, rename: async (from: PathLike, to: PathLike) => {
      if (from === paths.nextManifest) throw new Error('manifest rename failed');
      return fs.rename(from, to);
    } };
    await expect(publishSeed(paths, io)).rejects.toThrow('manifest rename failed');
    expect(await readFile(join(paths.final, 'budget'), 'utf8')).toBe('old budget');
    expect(await readFile(paths.manifest, 'utf8')).toBe('old manifest');
    if (hasDatabase) expect(await readFile(paths.database, 'utf8')).toBe('old database');
    else await expect(readFile(paths.database)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(paths.previous, 'budget'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
