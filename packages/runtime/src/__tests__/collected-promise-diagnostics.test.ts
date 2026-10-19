import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  beforeAll as harnessBeforeAll,
  describe as harnessDescribe,
  getTestCollector,
  it as harnessIt,
} from '../collector/index.js';
import { getTestRunner } from '../runner/index.js';
import {
  getPendingPromises,
  installPromiseTracker,
  uninstallPromiseTracker,
} from '../promise-tracker.js';

// The tracker's FinalizationRegistry is replaced before the tracker loads, so a
// test reports a promise collected at the moment it chooses instead of waiting
// for a garbage collection that may or may not happen in time.
const finalization = vi.hoisted(() => {
  const NativeFinalizationRegistry = globalThis.FinalizationRegistry;
  const heldValues = new Map<object, unknown>();
  let reportCollected: (heldValue: unknown) => void = () => undefined;

  class ControlledFinalizationRegistry {
    constructor(cleanup: (heldValue: unknown) => void) {
      reportCollected = cleanup;
    }

    register(target: object, heldValue: unknown): void {
      heldValues.set(target, heldValue);
    }

    unregister(): boolean {
      return false;
    }
  }

  globalThis.FinalizationRegistry =
    ControlledFinalizationRegistry as unknown as FinalizationRegistryConstructor;

  return {
    collect: (target: object): void => {
      if (!heldValues.has(target)) {
        throw new Error('The promise was never registered for finalization.');
      }

      const heldValue = heldValues.get(target);
      heldValues.delete(target);
      reportCollected(heldValue);
    },
    restore: (): void => {
      globalThis.FinalizationRegistry = NativeFinalizationRegistry;
    },
  };
});

vi.mock('../symbolicate.js', async () => {
  return {
    getCodeFrame: vi.fn(async () => null),
  };
});

const TEST_FILE = 'runtime/collected-promise.test.ts';

describe('collected promises in timeout diagnostics', () => {
  afterEach(() => {
    uninstallPromiseTracker();
  });

  afterAll(() => {
    finalization.restore();
  });

  it('keeps the promise a hung test awaits after it is collected', async () => {
    installPromiseTracker();
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Collected Suite', () => {
          harnessIt('hangs', async () => {
            const unresolvable = new Promise(() => undefined);
            finalization.collect(unresolvable);
            await unresolvable;
          });
        });
      }, TEST_FILE);

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: TEST_FILE,
        runner: 'ios',
        testTimeout: 10,
      });

      expect(result.suites[0].tests[0]).toMatchObject({
        name: 'hangs',
        status: 'failed',
        error: {
          name: 'TestCaseTimeoutError',
          diagnostics: {
            pendingPromises: {
              items: expect.arrayContaining([
                expect.objectContaining({
                  stack: expect.stringContaining(
                    'collected-promise-diagnostics.test.ts',
                  ),
                }),
              ]),
            },
          },
        },
      });
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });

  it('keeps the promise a hung beforeAll awaits after it is collected', async () => {
    installPromiseTracker();
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Collected Hook Suite', () => {
          harnessBeforeAll(async () => {
            const unresolvable = new Promise(() => undefined);
            finalization.collect(unresolvable);
            await unresolvable;
          });

          harnessIt('does not run', () => undefined);
        });
      }, TEST_FILE);

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: TEST_FILE,
        runner: 'ios',
        testTimeout: 10,
      });

      expect(result.suites[0]).toMatchObject({
        status: 'failed',
        error: {
          name: 'SuiteHookTimeoutError',
          diagnostics: {
            pendingPromises: {
              items: expect.arrayContaining([
                expect.objectContaining({
                  stack: expect.stringContaining(
                    'collected-promise-diagnostics.test.ts',
                  ),
                }),
              ]),
            },
          },
        },
      });
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });

  it('releases a collected promise once its test has finished', async () => {
    installPromiseTracker();
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Finished Suite', () => {
          harnessIt('leaves a promise behind', () => {
            finalization.collect(new Promise(() => undefined));
          });
        });
      }, TEST_FILE);

      await runner.run({
        testSuite: collection.testSuite,
        testFilePath: TEST_FILE,
        runner: 'ios',
        testTimeout: 1_000,
      });

      expect(
        getPendingPromises().filter(
          (promise) => promise.test?.fullName === 'Finished Suite leaves a promise behind',
        ),
      ).toEqual([]);
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });

  it('drops a collected promise that no test created', () => {
    installPromiseTracker();
    const readPendingIds = () => getPendingPromises().map(({ id }) => id);
    const idsBefore = new Set(readPendingIds());
    const stray = new Promise(() => undefined);
    const strayIds = readPendingIds().filter((id) => !idsBefore.has(id));

    finalization.collect(stray);

    expect(strayIds).toHaveLength(1);
    expect(readPendingIds()).not.toContain(strayIds[0]);
  });
});
