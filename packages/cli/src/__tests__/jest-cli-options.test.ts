import { buildArgv } from 'jest-cli';
import { describe, expect, it } from 'vitest';
import { patchYargsOptions } from '../jest-cli-options.js';

describe('patchYargsOptions', () => {
  it('lets Jest accept the options Harness reads from the command line', async () => {
    patchYargsOptions();

    const argv = await buildArgv([
      '--harnessRunner',
      'android',
      '--metroPort',
      '8097',
    ]);

    expect(argv).toMatchObject({ harnessRunner: 'android', metroPort: 8097 });
  });
});
