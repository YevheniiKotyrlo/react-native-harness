import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { formatPath, toPosixPath } from '../path.js';

describe('formatPath', () => {
  it('formats absolute paths relative to the current working directory', () => {
    expect(
      formatPath(
        path.join('/project', '.harness', 'crash-reports', 'log.txt'),
        {
          cwd: '/project',
        }
      )
    ).toBe(path.join('.harness', 'crash-reports', 'log.txt'));
  });

  it('leaves relative paths unchanged', () => {
    expect(formatPath(path.join('.harness', 'crash-reports', 'log.txt'))).toBe(
      path.join('.harness', 'crash-reports', 'log.txt')
    );
  });

  it('formats the working directory as a dot', () => {
    expect(formatPath('/project', { cwd: '/project' })).toBe('.');
  });
});

describe('toPosixPath', () => {
  afterEach(() => {
    vi.doUnmock('node:path');
    vi.resetModules();
  });

  it('joins the segments of a host path with forward slashes', () => {
    expect(toPosixPath(path.join('src', '__tests__', 'smoke.harness.ts'))).toBe(
      'src/__tests__/smoke.harness.ts'
    );
  });

  it('converts the separators of a Windows host', async () => {
    vi.resetModules();
    vi.doMock('node:path', async (importOriginal) => {
      const { win32 } = await importOriginal<typeof import('node:path')>();
      return { ...win32, default: win32 };
    });
    const { toPosixPath: toPosixPathOnWindows } = await import('../path.js');

    expect(toPosixPathOnWindows('src\\__tests__\\smoke.harness.ts')).toBe(
      'src/__tests__/smoke.harness.ts'
    );
    expect(toPosixPathOnWindows('C:\\project\\src')).toBe('C:/project/src');
  });
});
