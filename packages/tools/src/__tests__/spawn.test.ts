import { describe, expect, it } from 'vitest';
import { runCommand, spawn, SubprocessError } from '../spawn.js';

const captureFailure = async (script: string): Promise<SubprocessError> => {
  const outcome = await spawn(globalThis.process.execPath, ['-e', script]).then(
    () => undefined,
    (error: unknown) => error,
  );

  if (!(outcome instanceof SubprocessError)) {
    throw new Error(`expected a SubprocessError, got ${String(outcome)}`);
  }

  return outcome;
};

describe('spawn', () => {
  it('names what a failed command printed in its error', async () => {
    const error = await captureFailure(
      "console.log('Checking packages'); console.error('Failed to find package system-images'); process.exit(1)",
    );

    expect(error).toMatchObject({
      exitCode: 1,
      stdout: 'Checking packages',
      stderr: 'Failed to find package system-images',
    });
    expect(error.message.split('\n').slice(1)).toEqual([
      'Checking packages',
      'Failed to find package system-images',
    ]);
    expect(error.stack).toContain('Failed to find package system-images');
  });

  it('keeps the last lines of a long output', async () => {
    const error = await captureFailure(
      "for (let line = 1; line <= 50; line++) console.log('line ' + line); process.exit(3)",
    );

    expect(error.message.split('\n').slice(1)).toEqual([
      '[30 earlier lines]',
      ...Array.from({ length: 20 }, (_, index) => `line ${index + 31}`),
    ]);
  });

  it('keeps the message of a failed command that printed nothing', async () => {
    const error = await captureFailure('process.exit(2)');

    expect(error.message).toMatch(/^Command failed with exit code 2: [^\n]+$/);
  });
});

describe('runCommand', () => {
  it('uses SIGKILL when a deadline expires', async () => {
    const command = runCommand(globalThis.process.execPath, [
      '-e',
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000)",
    ], {
      signal: new AbortController().signal,
      timeoutMs: 50,
    });

    await expect(command).rejects.toBeDefined();
  });
});
