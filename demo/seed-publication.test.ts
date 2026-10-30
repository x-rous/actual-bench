import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { recoverPreviousSeed } = require('./seed-publication.cjs') as { recoverPreviousSeed: (final: string, previous: string) => Promise<void> };

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
