import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { MetroResolver } from './types.js';

const require = createRequire(import.meta.url);

const HARNESS_PACKAGE_SCOPE = '@react-native-harness/';

const readPackageName = (packageJsonPath: string): string | undefined => {
  try {
    const { name } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      name?: unknown;
    };
    return typeof name === 'string' ? name : undefined;
  } catch {
    return undefined;
  }
};

// A file belongs to the package named by the nearest package.json that has a
// name; answers are cached per directory.
const createHarnessModuleMatcher = (): ((filePath: string) => boolean) => {
  const packageNames = new Map<string, string | null>();

  const findPackageName = (directory: string): string | null => {
    const cached = packageNames.get(directory);
    if (cached !== undefined) {
      return cached;
    }

    const parentDirectory = path.dirname(directory);
    const packageName =
      readPackageName(path.join(directory, 'package.json')) ??
      (parentDirectory === directory ? null : findPackageName(parentDirectory));
    packageNames.set(directory, packageName);
    return packageName;
  };

  return (filePath) =>
    findPackageName(path.dirname(filePath))?.startsWith(
      HARNESS_PACKAGE_SCOPE
    ) ?? false;
};

/**
 * The runtime's peer dependencies — `react` and `react-native` — resolve from
 * the project when Harness's own packages import them. In a monorepo those
 * packages sit outside the app, so they would otherwise reach another copy
 * than the app's files, and the bundle would carry two React Natives with
 * separate registries. Every other import resolves as it did.
 *
 * It wraps the final resolver, after a platform's `metroConfigEnhancer`, so a
 * platform that renames `react-native` to its own fork resolves the fork from
 * the project too.
 */
export const resolvePeerDependenciesFromProject = (
  resolveRequest: MetroResolver,
  projectRoot: string
): MetroResolver => {
  const { peerDependencies = {} } =
    require('@react-native-harness/runtime/package.json') as {
      peerDependencies?: Record<string, string>;
    };
  const peerNames = Object.keys(peerDependencies);
  const isPeerDependency = (moduleName: string): boolean =>
    peerNames.some(
      (peerName) =>
        moduleName === peerName || moduleName.startsWith(`${peerName}/`)
    );
  const isHarnessModule = createHarnessModuleMatcher();
  const projectOrigin = path.join(projectRoot, 'package.json');

  return (context, moduleName, platform) =>
    resolveRequest(
      isPeerDependency(moduleName) && isHarnessModule(context.originModulePath)
        ? { ...context, originModulePath: projectOrigin }
        : context,
      moduleName,
      platform
    );
};
