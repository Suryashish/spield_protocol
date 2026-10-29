import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

// Runs the testnet USTRY v2 NAV relay (contract/spield/scripts/ustry_nav_relay.mjs) for as long as
// `vite` dev is up. Testnet only: mainnet series read RedStone and need no relay. The relay is a
// convenience, not a dependency. If it is down, Series 2 pauses new deposits once NAV is 13h old;
// exits never need it. Set USTRY_RELAY=0 to skip it.
//
// Only one relay runs per machine: a second dev server's relay sees the lock and exits quietly.
// Stopping: the server's close (Ctrl+C, `q`, config restart) and process exit kill the child, and
// the relay exits by itself if this process disappears without running either.
const DEPLOYMENT = 'src/lib/ustry-v2-testnet-series-2.json';
const SCRIPTS = '../contract/spield/scripts';

export function ustryRelay(): Plugin {
  return {
    name: 'spield-ustry-relay',
    apply: 'serve',
    configureServer(server) {
      const log = server.config.logger;
      const tag = '\x1b[36m[ustry-relay]\x1b[0m';
      if (process.env.USTRY_RELAY === '0') return;
      const scripts = path.resolve(__dirname, SCRIPTS);
      if (!fs.existsSync(path.join(scripts, 'node_modules'))) {
        log.warn(`${tag} not started: run \`npm install\` in contract/spield/scripts first.`);
        return;
      }
      const { oracle, series } = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, DEPLOYMENT), 'utf8'),
      ) as { oracle: string; series: string };
      let stopping = false;
      const child: ChildProcess = spawn(
        process.execPath,
        ['ustry_nav_relay.mjs', '--oracle', oracle, '--sync', series, '--loop', '--quiet'],
        { cwd: scripts, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const relay = (stream: NodeJS.ReadableStream | null, warn: boolean) =>
        stream?.on('data', (chunk: Buffer) => {
          for (const line of chunk.toString().split('\n').filter(Boolean))
            (warn ? log.warn : log.info)(`${tag} ${line}`, { timestamp: true });
        });
      relay(child.stdout, false);
      relay(child.stderr, true);
      child.on('exit', (code, signal) => {
        if (!stopping && code !== 0)
          log.warn(`${tag} stopped (${signal ?? `exit ${code}`}). Restart the dev server to retry.`);
      });
      const stop = () => {
        stopping = true;
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      };
      server.httpServer?.once('close', stop);
      process.once('exit', stop);
    },
  };
}
