import { GLOBAL_EXPECT } from '@vitest/expect';
import { afterAll, describe, expect, it, vi } from 'vitest';
import '../globals.js';

const matchImageSnapshot = vi.fn();

vi.mock('../client/store.js', () => ({
  getHandle: () => ({
    transferScreenshot: vi.fn(async () => ({ path: '/project/received.png' })),
    matchImageSnapshot,
  }),
}));

vi.mock('../runner/index.js', () => ({
  getHarnessContext: () => ({
    testFilePath: '/project/screen.harness.tsx',
    runner: 'android',
  }),
}));

// The runtime's expect module installs itself as the global expect; Vitest's
// own expect is put back once the tests are done.
const vitestGlobalExpect = Object.getOwnPropertyDescriptor(
  globalThis,
  GLOBAL_EXPECT
);
const { expect: harnessExpect } = await import('../expect/expect.js');

afterAll(() => {
  if (vitestGlobalExpect) {
    Object.defineProperty(globalThis, GLOBAL_EXPECT, vitestGlobalExpect);
  }
});

const screenshot = { data: new Uint8Array(4), width: 1, height: 1 };

describe('toMatchImageSnapshot', () => {
  it('fails a negated assertion when the snapshot could not be compared', async () => {
    matchImageSnapshot.mockRejectedValueOnce(
      new Error('New snapshot was not written')
    );

    await expect(
      harnessExpect(screenshot).not.toMatchImageSnapshot({ name: 'square' })
    ).rejects.toThrow('New snapshot was not written');
  });

  it('negates a comparison with an existing snapshot', async () => {
    matchImageSnapshot.mockResolvedValueOnce({
      pass: false,
      message: 'Images differ by 4 pixels.',
    });

    await expect(
      harnessExpect(screenshot).not.toMatchImageSnapshot({ name: 'square' })
    ).resolves.toBeUndefined();
  });
});
