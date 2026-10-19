import { spawn } from '@react-native-harness/tools';
import { logger } from '@react-native-harness/tools';
import { createWriteStream } from 'node:fs';
import { access, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import https from 'node:https';

const CMDLINE_TOOLS_PATH_SEGMENTS = ['cmdline-tools', 'latest'];
const ANDROID_REPOSITORY_INDEX_URL =
  'https://dl.google.com/android/repository/repository2-1.xml';
const androidEnvironmentLogger = logger.child('android-environment');

export type AndroidSystemImageArch = 'x86_64' | 'arm64-v8a' | 'armeabi-v7a';

type AndroidSdkRootOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
};

const getConfiguredAndroidSdkRoot = (
  env: NodeJS.ProcessEnv = process.env,
): string | null => {
  return env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT ?? null;
};

export const getDefaultUnixAndroidSdkRoot = ({
  platform = process.platform,
  homeDirectory = os.homedir(),
}: Omit<AndroidSdkRootOptions, 'env'> = {}): string | null => {
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Android', 'sdk');
  }

  if (platform === 'linux') {
    return path.join(homeDirectory, 'Android', 'Sdk');
  }

  return null;
};

const canBootstrapAndroidSdk = (
  platform: NodeJS.Platform = process.platform,
) => {
  return platform === 'darwin' || platform === 'linux';
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const downloadText = async (url: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const { statusCode = 0, headers } = response;

      if (
        statusCode >= 300 &&
        statusCode < 400 &&
        typeof headers.location === 'string'
      ) {
        response.resume();
        resolve(downloadText(headers.location));
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        reject(
          new Error(
            `Failed to download Android repository index from ${url} (status ${statusCode}).`,
          ),
        );
        return;
      }

      response.setEncoding('utf8');

      let body = '';
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.once('end', () => {
        resolve(body);
      });
    });

    request.once('error', reject);
  });
};

const downloadFile = async (
  url: string,
  destinationPath: string,
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const request = https.get(url, (response) => {
      const { statusCode = 0, headers } = response;

      if (
        statusCode >= 300 &&
        statusCode < 400 &&
        typeof headers.location === 'string'
      ) {
        response.resume();
        resolve(downloadFile(headers.location, destinationPath));
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        reject(
          new Error(
            `Failed to download Android command-line tools from ${url} (status ${statusCode}).`,
          ),
        );
        return;
      }

      const output = createWriteStream(destinationPath);
      pipeline(response, output).then(resolve).catch(reject);
    });

    request.once('error', reject);
  });
};

const getCommandLineToolsArchiveUrl = async (
  platform: NodeJS.Platform = process.platform,
): Promise<string> => {
  const archivePlatform =
    platform === 'darwin' ? 'mac' : platform === 'linux' ? 'linux' : null;

  if (!archivePlatform) {
    throw new Error(
      'Automatic Android SDK bootstrap is only supported on macOS and Linux.',
    );
  }

  const repositoryIndex = await downloadText(ANDROID_REPOSITORY_INDEX_URL);
  const archivePattern = new RegExp(
    `commandlinetools-${archivePlatform}-(\\d+)_latest\\.zip`,
    'g',
  );
  const matches = [...repositoryIndex.matchAll(archivePattern)];

  if (matches.length === 0) {
    throw new Error(
      `Failed to resolve Android command-line tools archive for ${archivePlatform}.`,
    );
  }

  const newestArchive = matches
    .map((match) => ({
      fileName: match[0],
      revision: Number(match[1]),
    }))
    .sort((left, right) => right.revision - left.revision)[0];

  return `https://dl.google.com/android/repository/${newestArchive.fileName}`;
};

const ensureAndroidCommandLineTools = async (
  sdkRoot: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> => {
  if (
    (await pathExists(getSdkManagerBinaryPath(sdkRoot, platform))) &&
    (await pathExists(getAvdManagerBinaryPath(sdkRoot, platform)))
  ) {
    return;
  }

  if (!canBootstrapAndroidSdk(platform)) {
    throw new Error(
      'Android command-line tools are missing. Set ANDROID_HOME or ANDROID_SDK_ROOT to an initialized SDK.',
    );
  }

  androidEnvironmentLogger.info(
    'Bootstrapping Android command-line tools in %s',
    sdkRoot,
  );

  await mkdir(sdkRoot, { recursive: true });

  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'android-cmdline-tools-'),
  );
  const archivePath = path.join(temporaryDirectory, 'cmdline-tools.zip');
  const extractedPath = path.join(temporaryDirectory, 'extracted');
  const sourceDirectory = path.join(extractedPath, 'cmdline-tools');
  const targetDirectory = path.join(sdkRoot, ...CMDLINE_TOOLS_PATH_SEGMENTS);

  try {
    await downloadFile(
      await getCommandLineToolsArchiveUrl(platform),
      archivePath,
    );
    await spawn('unzip', ['-q', archivePath, '-d', extractedPath]);
    await rm(targetDirectory, { force: true, recursive: true });
    await mkdir(path.dirname(targetDirectory), { recursive: true });
    await cp(sourceDirectory, targetDirectory, { recursive: true });
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
};

function* answerYes(): Generator<string> {
  for (;;) {
    yield 'y\n';
  }
}

// sdkmanager asks before every license it has no record of accepting; like
// `yes`, the answers run until it exits.
const runSdkManager = async (
  sdkRoot: string,
  args: readonly string[],
): Promise<void> => {
  const sdkManager = spawn(
    getSdkManagerBinaryPath(sdkRoot),
    [`--sdk_root=${sdkRoot}`, ...args],
    {
      stdin: 'pipe',
      env: getAndroidProcessEnv({
        ...process.env,
        ANDROID_HOME: sdkRoot,
        ANDROID_SDK_ROOT: sdkRoot,
      }),
    },
  );
  const { stdin } = await sdkManager.nodeChildProcess;

  if (stdin) {
    void pipeline(Readable.from(answerYes()), stdin).catch(() => undefined);
  }

  await sdkManager;
};

const getPackageVerificationPath = (
  sdkRoot: string,
  packageName: string,
  platform: NodeJS.Platform,
): string | null => {
  if (packageName === 'platform-tools') {
    return getAdbBinaryPath(sdkRoot, platform);
  }

  if (packageName === 'emulator') {
    return getEmulatorBinaryPath(sdkRoot, platform);
  }

  if (packageName.startsWith('platforms;android-')) {
    return path.join(sdkRoot, packageName.replace(';', '/'));
  }

  if (packageName.startsWith('system-images;android-')) {
    return path.join(sdkRoot, packageName.replaceAll(';', path.sep));
  }

  return null;
};

const getMissingAndroidSdkPackages = async (
  sdkRoot: string,
  packages: readonly string[],
  platform: NodeJS.Platform,
): Promise<string[]> => {
  const missingPackages: string[] = [];

  for (const packageName of packages) {
    const verificationPath = getPackageVerificationPath(
      sdkRoot,
      packageName,
      platform,
    );

    if (!verificationPath) {
      continue;
    }

    if (!(await pathExists(verificationPath))) {
      missingPackages.push(packageName);
    }
  }

  return missingPackages;
};

const installAndroidSdkPackages = async (
  sdkRoot: string,
  packages: readonly string[],
): Promise<void> => {
  if (packages.length === 0) {
    return;
  }

  androidEnvironmentLogger.info(
    'Installing missing Android SDK packages: %s',
    packages.join(', '),
  );

  await runSdkManager(sdkRoot, ['--licenses']);
  await runSdkManager(sdkRoot, packages);
};

export const getAndroidSdkRoot = (
  env: NodeJS.ProcessEnv = process.env,
  options: Omit<AndroidSdkRootOptions, 'env'> = {},
): string | null => {
  return (
    getConfiguredAndroidSdkRoot(env) ?? getDefaultUnixAndroidSdkRoot(options)
  );
};

const getRequiredAndroidSdkRoot = (
  env: NodeJS.ProcessEnv = process.env,
  options: Omit<AndroidSdkRootOptions, 'env'> = {},
): string => {
  const sdkRoot = getAndroidSdkRoot(env, options);

  if (!sdkRoot) {
    throw new Error(
      'Android SDK root is not configured. Set ANDROID_HOME or ANDROID_SDK_ROOT.',
    );
  }

  return sdkRoot;
};

export const getHostAndroidSystemImageArch = (
  architecture: string = process.arch,
): AndroidSystemImageArch => {
  switch (architecture) {
    case 'arm64':
      return 'arm64-v8a';
    case 'arm':
      return 'armeabi-v7a';
    case 'x64':
    default:
      return 'x86_64';
  }
};

export const getAndroidPlatformPackage = (apiLevel: number): string => {
  return `platforms;android-${apiLevel}`;
};

export const getAndroidSystemImagePackage = (
  apiLevel: number,
  architecture: AndroidSystemImageArch = getHostAndroidSystemImageArch(),
): string => {
  return `system-images;android-${apiLevel};default;${architecture}`;
};

export const getRequiredAndroidSdkPackages = ({
  apiLevel,
  includeEmulator = false,
  architecture = getHostAndroidSystemImageArch(),
}: {
  apiLevel?: number;
  includeEmulator?: boolean;
  architecture?: AndroidSystemImageArch;
} = {}): string[] => {
  const packages = ['platform-tools'];

  if (!includeEmulator) {
    return packages;
  }

  packages.push('emulator');

  if (typeof apiLevel === 'number') {
    packages.push(getAndroidPlatformPackage(apiLevel));
    packages.push(getAndroidSystemImagePackage(apiLevel, architecture));
  }

  return packages;
};

const getMissingAndroidSdkPackagesForEnvironment = async (
  packages: readonly string[],
  {
    env = process.env,
    platform = process.platform,
    homeDirectory = os.homedir(),
  }: AndroidSdkRootOptions = {},
): Promise<{ sdkRoot: string; missingPackages: string[] }> => {
  const sdkRoot = getRequiredAndroidSdkRoot(env, { platform, homeDirectory });

  await mkdir(sdkRoot, { recursive: true });

  return {
    sdkRoot,
    missingPackages: await getMissingAndroidSdkPackages(
      sdkRoot,
      packages,
      platform,
    ),
  };
};

export const ensureAndroidSdkPackages = async (
  packages: readonly string[],
  {
    env = process.env,
    platform = process.platform,
    homeDirectory = os.homedir(),
  }: AndroidSdkRootOptions = {},
): Promise<string> => {
  const { sdkRoot, missingPackages } =
    await getMissingAndroidSdkPackagesForEnvironment(packages, {
      env,
      platform,
      homeDirectory,
    });

  if (missingPackages.length === 0) {
    return sdkRoot;
  }

  await ensureAndroidCommandLineTools(sdkRoot, platform);

  await installAndroidSdkPackages(sdkRoot, missingPackages);

  const unresolvedPackages = await getMissingAndroidSdkPackages(
    sdkRoot,
    packages,
    platform,
  );

  if (unresolvedPackages.length > 0) {
    throw new Error(
      `Android SDK packages are still missing after installation: ${unresolvedPackages.join(
        ', ',
      )}`,
    );
  }

  return sdkRoot;
};

export const ensureAndroidAdbAvailable = async (
  options: AndroidSdkRootOptions = {},
): Promise<string> => {
  return ensureAndroidSdkPackages(['platform-tools'], options);
};

export const ensureAndroidEmulatorAvailable = async (
  options: AndroidSdkRootOptions = {},
): Promise<string> => {
  return ensureAndroidSdkPackages(['emulator'], options);
};

export const ensureAndroidAvdProvisioningAvailable = async (
  apiLevel: number,
  architecture: AndroidSystemImageArch = getHostAndroidSystemImageArch(),
  options: AndroidSdkRootOptions = {},
): Promise<string> => {
  return ensureAndroidSdkPackages(
    [
      getAndroidPlatformPackage(apiLevel),
      getAndroidSystemImagePackage(apiLevel, architecture),
    ],
    options,
  );
};

export const ensureAndroidDiscoveryEnvironment = async (): Promise<string> => {
  initializeAndroidProcessEnv();

  return ensureAndroidAdbAvailable();
};

export const ensureAndroidPhysicalDeviceEnvironment =
  async (): Promise<string> => {
    initializeAndroidProcessEnv();

    return ensureAndroidAdbAvailable();
  };

export const ensureAndroidEmulatorEnvironment = async (
  apiLevel: number,
): Promise<string> => {
  initializeAndroidProcessEnv();

  await ensureAndroidAdbAvailable();
  await ensureAndroidEmulatorAvailable();

  return ensureAndroidAvdProvisioningAvailable(apiLevel);
};

export const getAndroidProcessEnv = (
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const sdkRoot = getAndroidSdkRoot(env);

  if (!sdkRoot) {
    return env;
  }

  const platformToolsPath = path.join(sdkRoot, 'platform-tools');
  const emulatorPath = path.join(sdkRoot, 'emulator');
  const cmdlineToolsPath = path.join(sdkRoot, ...CMDLINE_TOOLS_PATH_SEGMENTS);
  const cmdlineToolsBinPath = path.join(cmdlineToolsPath, 'bin');
  const currentPath = env.PATH ?? '';
  const pathEntries = [
    platformToolsPath,
    emulatorPath,
    cmdlineToolsPath,
    cmdlineToolsBinPath,
    currentPath,
  ].filter((entry) => entry !== '');

  return {
    ...env,
    ANDROID_HOME: sdkRoot,
    ANDROID_SDK_ROOT: sdkRoot,
    ANDROID_AVD_HOME: getAvdHome(env),
    PATH: pathEntries.join(path.delimiter),
  };
};

export const getAvdHome = (env: NodeJS.ProcessEnv = process.env): string =>
  env.ANDROID_AVD_HOME ?? path.join(os.homedir(), '.android', 'avd');

export const initializeAndroidProcessEnv = (): void => {
  Object.assign(process.env, getAndroidProcessEnv());
};

const getExecutableFileName = (
  name: string,
  platform: NodeJS.Platform,
): string => (platform === 'win32' ? `${name}.exe` : name);

const getScriptFileName = (name: string, platform: NodeJS.Platform): string =>
  platform === 'win32' ? `${name}.bat` : name;

export const getAdbBinaryPath = (
  sdkRoot: string = getRequiredAndroidSdkRoot(),
  platform: NodeJS.Platform = process.platform,
): string =>
  path.join(sdkRoot, 'platform-tools', getExecutableFileName('adb', platform));

export const getEmulatorBinaryPath = (
  sdkRoot: string = getRequiredAndroidSdkRoot(),
  platform: NodeJS.Platform = process.platform,
): string =>
  path.join(sdkRoot, 'emulator', getExecutableFileName('emulator', platform));

export const getSdkManagerBinaryPath = (
  sdkRoot: string = getRequiredAndroidSdkRoot(),
  platform: NodeJS.Platform = process.platform,
): string =>
  path.join(
    sdkRoot,
    ...CMDLINE_TOOLS_PATH_SEGMENTS,
    'bin',
    getScriptFileName('sdkmanager', platform),
  );

export const getAvdManagerBinaryPath = (
  sdkRoot: string = getRequiredAndroidSdkRoot(),
  platform: NodeJS.Platform = process.platform,
): string =>
  path.join(
    sdkRoot,
    ...CMDLINE_TOOLS_PATH_SEGMENTS,
    'bin',
    getScriptFileName('avdmanager', platform),
  );
