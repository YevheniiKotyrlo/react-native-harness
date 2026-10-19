import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureAndroidSdkPackages,
  getAdbBinaryPath,
  getAvdManagerBinaryPath,
  getEmulatorBinaryPath,
  getSdkManagerBinaryPath,
} from '../environment.js';

const createEmptyFile = async (filePath: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, '');
};

describe('Android SDK binaries', () => {
  let sdkRoot: string;

  beforeEach(async () => {
    sdkRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-android-sdk-'));
  });

  afterEach(async () => {
    await rm(sdkRoot, { force: true, recursive: true });
  });

  it('names the executables and scripts a Windows SDK ships', () => {
    expect(getAdbBinaryPath(sdkRoot, 'win32')).toBe(
      path.join(sdkRoot, 'platform-tools', 'adb.exe')
    );
    expect(getEmulatorBinaryPath(sdkRoot, 'win32')).toBe(
      path.join(sdkRoot, 'emulator', 'emulator.exe')
    );
    expect(getSdkManagerBinaryPath(sdkRoot, 'win32')).toBe(
      path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat')
    );
    expect(getAvdManagerBinaryPath(sdkRoot, 'win32')).toBe(
      path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager.bat')
    );
  });

  it.each(['darwin', 'linux'] as const)(
    'keeps the extensionless names on %s',
    (platform) => {
      expect(getAdbBinaryPath(sdkRoot, platform)).toBe(
        path.join(sdkRoot, 'platform-tools', 'adb')
      );
      expect(getEmulatorBinaryPath(sdkRoot, platform)).toBe(
        path.join(sdkRoot, 'emulator', 'emulator')
      );
      expect(getSdkManagerBinaryPath(sdkRoot, platform)).toBe(
        path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager')
      );
      expect(getAvdManagerBinaryPath(sdkRoot, platform)).toBe(
        path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager')
      );
    }
  );

  it('accepts the platform tools and the emulator a Windows SDK already has', async () => {
    await createEmptyFile(path.join(sdkRoot, 'platform-tools', 'adb.exe'));
    await createEmptyFile(path.join(sdkRoot, 'emulator', 'emulator.exe'));

    await expect(
      ensureAndroidSdkPackages(['platform-tools', 'emulator'], {
        env: { ANDROID_HOME: sdkRoot },
        platform: 'win32',
      })
    ).resolves.toBe(sdkRoot);
  });
});
