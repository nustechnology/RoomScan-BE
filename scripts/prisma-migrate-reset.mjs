import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const nodeEnv = process.env.NODE_ENV;

if (nodeEnv !== 'development') {
  console.error(
    `prisma:migrate:reset is only allowed when NODE_ENV=development. Current NODE_ENV="${nodeEnv}".`,
  );
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const prismaBin = resolve(__dirname, '../node_modules/.bin/prisma');

const result = spawnSync(prismaBin, ['migrate', 'reset', '--force'], {
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? (result.signal ? 1 : 0));
