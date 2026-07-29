// Entry point for the once-a-day scheduled job.
//
// Requirement (1): write a heartbeat so we can confirm the schedule fires.
// Requirement (2): pull the latest data from the Sleeper API.
//
// The heartbeat currently just records "hello world" + a timestamp into a log
// file that gets committed, so the daily run is visible in git history even on
// a day where the league data itself did not change.

import { appendFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOG = join(ROOT, 'data', 'heartbeat.log');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))
    );
  });
}

async function heartbeat() {
  await mkdir(dirname(LOG), { recursive: true });
  const line = `${new Date().toISOString()} hello world\n`;
  await appendFile(LOG, line);
  console.log(`heartbeat: ${line.trim()}`);
}

async function main() {
  await heartbeat();
  // Then pull fresh Sleeper data into src/data/.
  await run(process.execPath, [join(__dirname, 'fetch-sleeper.mjs')]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
