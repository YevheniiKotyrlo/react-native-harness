import type { HarnessContext } from '@react-native-harness/bridge';
import type { HarnessPlatform } from '@react-native-harness/platforms';
import type { Config as JestConfig } from 'jest-runner';

export const createHarnessContext = (
  platform: HarnessPlatform,
  globalConfig: JestConfig.GlobalConfig
): HarnessContext => ({
  platform,
  updateSnapshot: globalConfig.updateSnapshot,
});
