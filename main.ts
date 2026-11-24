// Token launch radar — entrypoint.
// Reads a DefiLlama snapshot, ranks the pre-token protocols by an implied
// value derived from the snapshot's own figures, and writes the board, the
// dashboard data, the dashboard files, the screenshots, and the dossier.
// Node 22, standard library only, no network, deterministic output.
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_MAX_BYTES = 65536;

function usage(): string {
  return 'Usage: node main.ts [--input <snapshot.json>] [--output <dir>]';
}

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '/input/snapshot.json';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input' && index + 1 < argv.length) {
      input = argv[index + 1];
      index += 1;
    } else if (arg === '--output' && index + 1 < argv.length) {
      output = argv[index + 1];
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}\n${usage()}`);
    }
  }
  return { input, output };
}

function copyDirectory(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(source)) {
    cpSync(join(source, name), join(target, name), { recursive: true });
  }
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snapshotPath = resolve(input);
  const outDir = resolve(output);
  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const { rows, radar } = buildBoard(snapshot);
  const issue = boardIssue(snapshot, rows);
  if (issue) {
    throw new Error(`Board failed its own check: ${issue}`);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'data.js'), dataScript(radar), 'utf8');
  copyDirectory(join(here, 'dashboard'), join(outDir, 'dashboard'));
  copyDirectory(join(here, 'screenshots'), join(outDir, 'screenshots'));
  const dossier = buildDossier(outDir, {
    text_max_bytes: DASHBOARD_MAX_BYTES,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  // buildDossier returns the dossier bytes themselves, not an object:
  // write them raw, exactly as the starter does.
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  const watchlistRows = rows.filter((row) => snapshot.watchlist.includes(row.slug)).length;
  console.log(
    `Token radar ${radar.model_version}: ${rows.length} rows (${watchlistRows} watchlist, ${rows.length - watchlistRows} early), ` +
      `implied $${rows[0].implied_value_usd.toLocaleString('en-US')} to $${rows[rows.length - 1].implied_value_usd.toLocaleString('en-US')}, ` +
      `snapshot as of ${snapshot.as_of}, dossier written.`,
  );
}

main();
