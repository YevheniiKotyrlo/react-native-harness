import path from 'node:path';

export type FormatPathOptions = {
  cwd?: string;
};

export const formatPath = (
  filePath: string,
  { cwd = process.cwd() }: FormatPathOptions = {}
) =>
  path.isAbsolute(filePath) ? path.relative(cwd, filePath) || '.' : filePath;

/**
 * Forward slashes on every host, for a path that leaves the host: a module path
 * the device requests from Metro, a cache key, a glob.
 */
export const toPosixPath = (filePath: string): string =>
  filePath.split(path.sep).join(path.posix.sep);
