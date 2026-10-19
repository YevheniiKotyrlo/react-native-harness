import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matchImageSnapshot } from '../image-snapshot.js';

const createPng = (): Buffer => {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(255);
  return PNG.sync.write(png);
};

describe('matchImageSnapshot', () => {
  let directory: string;
  let testFilePath: string;
  let receivedPath: string;
  let snapshotPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'harness-image-snapshot-'));
    testFilePath = path.join(directory, 'screen.harness.tsx');
    receivedPath = path.join(directory, 'received.png');
    snapshotPath = path.join(directory, '__image_snapshots__', 'android', 'square.png');
    await writeFile(receivedPath, createPng());
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('writes a missing snapshot and passes when new snapshots may be written', async () => {
    const result = await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'square' },
      'android',
      'new'
    );

    expect(result.pass).toBe(true);
    expect(await readFile(snapshotPath)).toEqual(await readFile(receivedPath));
  });

  it('fails on a missing snapshot without writing it in CI mode', async () => {
    const result = await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'square' },
      'android',
      'none'
    );

    expect(result.pass).toBe(false);
    expect(result.message).toContain(snapshotPath);
    expect(existsSync(snapshotPath)).toBe(false);
    expect(
      await readFile(path.join(path.dirname(snapshotPath), 'square-actual.png'))
    ).toEqual(await readFile(receivedPath));
  });

  it('compares an existing snapshot in CI mode', async () => {
    await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'square' },
      'android',
      'new'
    );

    const result = await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'square' },
      'android',
      'none'
    );

    expect(result).toEqual({ pass: true, message: 'Images match' });
  });
});
