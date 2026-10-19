import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

// test/setup.ts replaces parts of '../adb.js'; this suite drives the real
// emulator creation against a temporary AVD home.
vi.mock('../adb.js', async () => {
  return await vi.importActual<typeof import('../adb.js')>('../adb.js');
});

vi.mock('../environment.js', async () => {
  const actual = await vi.importActual<typeof import('../environment.js')>(
    '../environment.js'
  );

  return {
    ...actual,
    ensureAndroidSdkPackages: vi.fn(actual.ensureAndroidSdkPackages),
  };
});

vi.mock('@react-native-harness/tools', async () => {
  const actual = await vi.importActual<
    typeof import('@react-native-harness/tools')
  >('@react-native-harness/tools');

  return { ...actual, spawn: mocks.spawn };
});

const { createAvd, deleteAvd } = await import('../adb.js');
const { getAvdConfigPath, getAvdDirectory } = await import('../avd-config.js');
const environment = await import('../environment.js');
const { getEmulatorCpuCores } = await import('../emulator-startup.js');

type SpawnCall = {
  file: string;
  args: readonly string[];
  stdinAnswers: string;
};

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (prefix: string): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const writeExecutable = async (filePath: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '');
};

// Stands in for a command-line tool: it reads the first answer written to its
// stdin, if it was given one, then does `act` and exits.
const recordSpawnCalls = (
  act: (file: string, args: readonly string[]) => Promise<string>,
): SpawnCall[] => {
  const calls: SpawnCall[] = [];

  mocks.spawn.mockImplementation(
    (file: string, args: readonly string[], options?: { stdin?: unknown }) => {
      const call: SpawnCall = { file, args, stdinAnswers: '' };
      const stdin = new PassThrough();
      calls.push(call);

      const completion = (async () => {
        if (options?.stdin === 'pipe') {
          await once(stdin, 'readable');
          call.stdinAnswers = String(stdin.read());
          stdin.destroy();
        } else if (
          typeof options?.stdin === 'object' &&
          options.stdin !== null &&
          'string' in options.stdin
        ) {
          call.stdinAnswers = String(options.stdin.string);
        }

        return { stdout: await act(file, args), stderr: '', output: '' };
      })();

      return Object.assign(completion, {
        nodeChildProcess: Promise.resolve({ stdin }),
      });
    },
  );

  return calls;
};

beforeEach(() => {
  mocks.spawn.mockReset();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();

  for (const directory of temporaryDirectories.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe('emulator creation', () => {
  const name = 'Pixel_8_API_35';

  const createEmulator = async () => {
    const sdkRoot = await createTemporaryDirectory('harness-android-sdk-');
    const avdHome = await createTemporaryDirectory('harness-avd-home-');
    vi.stubEnv('ANDROID_HOME', sdkRoot);
    vi.stubEnv('ANDROID_SDK_ROOT', sdkRoot);
    vi.stubEnv('ANDROID_AVD_HOME', avdHome);
    vi.mocked(environment.ensureAndroidSdkPackages).mockResolvedValueOnce(
      sdkRoot,
    );
    const avdManager = environment.getAvdManagerBinaryPath(sdkRoot);
    const calls = recordSpawnCalls(async (file, args) => {
      if (file === avdManager && args[0] === 'list') {
        return 'id: 0 or "pixel_8"\n    Name: Pixel 8\n';
      }

      if (file === avdManager && args[0] === 'create') {
        await fs.mkdir(getAvdDirectory(name), { recursive: true });
        await fs.writeFile(getAvdConfigPath(name), 'hw.device.name=pixel_8\n');
      }

      return '';
    });

    await createAvd({
      name,
      apiLevel: 35,
      profile: 'pixel_8',
      diskSize: '2G',
      heapSize: '576M',
    });

    return { avdHome, avdManager, calls };
  };

  it('runs avdmanager itself and declines a custom hardware profile on its stdin', async () => {
    const { avdManager, calls } = await createEmulator();

    expect(calls.map(({ file }) => file)).not.toContain('bash');
    expect(calls).toContainEqual({
      file: avdManager,
      args: [
        'create',
        'avd',
        '--force',
        '--name',
        name,
        '--package',
        environment.getAndroidSystemImagePackage(35),
        '--device',
        'pixel_8',
        '-p',
        getAvdDirectory(name),
      ],
      stdinAnswers: 'no\n',
    });
  });

  it("writes the emulator's ini file and its hardware settings", async () => {
    const { avdHome } = await createEmulator();

    await expect(
      fs.readFile(path.join(avdHome, `${name}.ini`), 'utf8'),
    ).resolves.toBe(
      [
        'avd.ini.encoding=UTF-8',
        `path=${getAvdDirectory(name)}`,
        `path.rel=avd/${name}.avd`,
        'target=android-35',
        '',
      ].join('\n'),
    );
    await expect(fs.readFile(getAvdConfigPath(name), 'utf8')).resolves.toBe(
      [
        'hw.device.name=pixel_8',
        'disk.dataPartition.size=2G',
        'vm.heapSize=576M',
        `hw.cpu.ncore=${getEmulatorCpuCores()}`,
        '',
      ].join('\n'),
    );

    await deleteAvd(name);

    await expect(fs.readdir(avdHome)).resolves.toEqual([]);
  });
});

describe('emulator home', () => {
  it("keeps emulators in the user's home directory when ANDROID_AVD_HOME and HOME are unset", async () => {
    const homeDirectory = await createTemporaryDirectory('harness-home-');
    vi.stubEnv('ANDROID_AVD_HOME', undefined);
    vi.stubEnv('HOME', undefined);
    vi.spyOn(os, 'homedir').mockReturnValue(homeDirectory);

    expect(getAvdDirectory('Pixel_8_API_35')).toBe(
      path.join(homeDirectory, '.android', 'avd', 'Pixel_8_API_35.avd'),
    );
  });

  it('passes a configured ANDROID_AVD_HOME on to the tools it starts', () => {
    const avdHome = path.join(os.tmpdir(), 'configured-avd-home');

    expect(
      environment.getAndroidProcessEnv({
        ANDROID_HOME: path.join(os.tmpdir(), 'sdk'),
        ANDROID_AVD_HOME: avdHome,
      }).ANDROID_AVD_HOME,
    ).toBe(avdHome);
  });
});

describe('SDK package installation', () => {
  it('runs sdkmanager itself and answers its license prompts on stdin', async () => {
    const sdkRoot = await createTemporaryDirectory('harness-android-sdk-');
    const sdkManager = environment.getSdkManagerBinaryPath(sdkRoot);
    await writeExecutable(sdkManager);
    await writeExecutable(environment.getAvdManagerBinaryPath(sdkRoot));
    const platformPackage = environment.getAndroidPlatformPackage(35);
    const calls = recordSpawnCalls(async (file, args) => {
      if (file === sdkManager && args.includes(platformPackage)) {
        await fs.mkdir(path.join(sdkRoot, 'platforms', 'android-35'), {
          recursive: true,
        });
      }

      return '';
    });

    await environment.ensureAndroidSdkPackages([platformPackage], {
      env: { ANDROID_HOME: sdkRoot },
    });

    expect(calls).toEqual([
      {
        file: sdkManager,
        args: [`--sdk_root=${sdkRoot}`, '--licenses'],
        stdinAnswers: expect.stringMatching(/^(y\n)+$/),
      },
      {
        file: sdkManager,
        args: [`--sdk_root=${sdkRoot}`, platformPackage],
        stdinAnswers: expect.stringMatching(/^(y\n)+$/),
      },
    ]);
  });
});
