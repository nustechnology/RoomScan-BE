import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, '../scripts/prisma-migrate-reset.mjs');

function runWithEnv(nodeEnv: string) {
  return spawnSync(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
    },
    encoding: 'utf8',
  });
}

describe('prisma-migrate-reset guard', () => {
  it('refuses to run when NODE_ENV is production', () => {
    const result = runWithEnv('production');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'prisma:migrate:reset is only allowed when NODE_ENV=development',
    );
  });

  it('refuses to run when NODE_ENV is staging', () => {
    const result = runWithEnv('staging');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'prisma:migrate:reset is only allowed when NODE_ENV=development',
    );
  });

  it('refuses to run when NODE_ENV is test', () => {
    const result = runWithEnv('test');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'prisma:migrate:reset is only allowed when NODE_ENV=development',
    );
  });
});
