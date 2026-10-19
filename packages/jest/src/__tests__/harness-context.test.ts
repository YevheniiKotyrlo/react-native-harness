import type { HarnessContext } from '@react-native-harness/bridge';
import type { Config as JestConfig } from 'jest-runner';
import { describe, expect, it } from 'vitest';
import { createHarnessContext } from '../harness-context.js';

const platform: HarnessContext['platform'] = {
  name: 'ios',
  platformId: 'ios',
  runner: '/dev/null',
  config: {},
};

describe('createHarnessContext', () => {
  it.each(['all', 'new', 'none'] as const)(
    "hands the bridge the run's %s snapshot update state",
    (updateSnapshot) => {
      const context = createHarnessContext(platform, {
        updateSnapshot,
      } as JestConfig.GlobalConfig);

      expect(context).toEqual({ platform, updateSnapshot });
    }
  );
});
