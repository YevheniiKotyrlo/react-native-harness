import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { Config as HarnessConfig } from '@react-native-harness/config';

vi.mock('../utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils.js')>()),
  isPortAvailable: vi.fn(async () => true),
  getMetroPackage: vi.fn(),
}));

vi.mock('../withRnHarness.js', () => ({
  withRnHarness: vi.fn((config: unknown) => async () => config),
}));

vi.mock('../middlewares/bundle-request-middleware.js', () => ({
  getBundleRequestObserverMiddleware: vi.fn(() => vi.fn()),
}));

const createHttpServer = () => ({
  keepAliveTimeout: 0,
  on: vi.fn(),
  close: vi.fn((callback: () => void) => callback()),
  closeAllConnections: vi.fn(),
});

describe('getMetroInstance', () => {
  it('rejects with the abort and leaves no unhandled rejection when aborted while Metro starts', async () => {
    const { getMetroPackage } = await import('../utils.js');
    const { getMetroInstance } = await import('../factory.js');

    let markServerStarting: () => void = () => undefined;
    const serverStarting = new Promise<void>((resolve) => {
      markServerStarting = resolve;
    });
    let finishServerStart: (server: unknown) => void = () => undefined;
    vi.mocked(getMetroPackage).mockReturnValue({
      loadConfig: vi.fn(async () => ({ reporter: {} })),
      runServer: vi.fn(() => {
        markServerStarting();
        return new Promise((resolve) => {
          finishServerStart = resolve;
        });
      }),
    } as never);

    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const abortController = new AbortController();
      const instance = getMetroInstance(
        {
          projectRoot: os.tmpdir(),
          harnessConfig: {
            metroPort: 8081,
            entryPoint: './index.js',
          } as HarnessConfig,
        },
        abortController.signal
      );

      await Promise.race([serverStarting, instance]);
      abortController.abort();
      finishServerStart(createHttpServer());

      await expect(instance).rejects.toMatchObject({ name: 'AbortError' });
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
