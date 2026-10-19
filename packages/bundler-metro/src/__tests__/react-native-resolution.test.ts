import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomResolutionContext } from 'metro-resolver';
import type { MetroConfig } from '@react-native/metro-config';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import { getHarnessResolver } from '../resolvers/resolver.js';

const tempDirs: string[] = [];

const runtimeModule = path.join(
  os.tmpdir(),
  'workspace',
  'node_modules',
  '@react-native-harness',
  'runtime',
  'dist',
  'index.js',
);

const createProjectRoot = (): string => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rn-harness-react-native-resolution-'),
  );
  tempDirs.push(projectRoot);
  fs.writeFileSync(path.join(projectRoot, 'index.js'), 'export {};');
  vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
  return projectRoot;
};

const getResolvedOrigin = (
  metroConfig: MetroConfig,
  moduleName: string,
  originModulePath: string,
): string | undefined => {
  const resolveRequest = vi.fn((context: CustomResolutionContext) => ({
    type: 'sourceFile' as const,
    filePath: context.originModulePath,
  }));
  const resolver = getHarnessResolver(metroConfig, {
    entryPoint: './index.js',
  } as HarnessConfig);

  resolver(
    { originModulePath, resolveRequest } as unknown as CustomResolutionContext,
    moduleName,
    'android',
  );

  return resolveRequest.mock.calls[0]?.[0].originModulePath;
};

afterEach(() => {
  vi.restoreAllMocks();

  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('peer dependency resolution', () => {
  it.each([
    'react-native',
    'react-native/Libraries/Core/InitializeCore',
    'react',
    'react/jsx-runtime',
  ])('resolves %s from the project for a module outside it', (moduleName) => {
    const projectRoot = createProjectRoot();

    expect(getResolvedOrigin({}, moduleName, runtimeModule)).toBe(
      path.join(projectRoot, 'package.json'),
    );
  });

  it.each([
    'react-native-web',
    'react-native-reanimated',
    'react-dom',
    '@react-native/assets-registry/registry',
    './Libraries/Core/InitializeCore',
  ])('leaves %s where it was requested from', (moduleName) => {
    createProjectRoot();

    expect(getResolvedOrigin({}, moduleName, runtimeModule)).toBe(
      runtimeModule,
    );
  });

  it('keeps a project resolver in charge of react-native', () => {
    const projectRoot = createProjectRoot();
    const projectResolver = vi.fn(() => ({
      type: 'sourceFile' as const,
      filePath: '/web/react-native-web.js',
    }));
    const resolver = getHarnessResolver(
      { resolver: { resolveRequest: projectResolver } } as unknown as MetroConfig,
      { entryPoint: './index.js' } as HarnessConfig,
    );

    expect(
      resolver(
        {
          originModulePath: runtimeModule,
          resolveRequest: vi.fn(),
        } as unknown as CustomResolutionContext,
        'react-native',
        'web',
      ),
    ).toEqual({ type: 'sourceFile', filePath: '/web/react-native-web.js' });
    expect(projectResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        originModulePath: path.join(projectRoot, 'package.json'),
      }),
      'react-native',
      'web',
    );
  });
});
