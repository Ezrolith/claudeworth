#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readAllUsageEvents } from './reader.js';
import { aggregate } from './aggregate.js';
import { renderDashboard } from './render.js';
import { planFromKey, PLANS } from './plans.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

function parseArgs(argv) {
  const args = { plan: 'max5', open: true, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plan' && argv[i+1]) { args.plan = argv[++i]; }
    else if (a.startsWith('--plan=')) { args.plan = a.slice(7); }
    else if (a === '--no-open') { args.open = false; }
    else if (a === '--out' && argv[i+1]) { args.out = argv[++i]; }
    else if (a === '--help' || a === '-h') { args.help = true; }
    else if (a === '--version' || a === '-v') { args.version = true; }
  }
  return args;
}

function help() {
  console.log(`claudeworth v${PKG.version} — is your Claude subscription worth it?

Usage: claudeworth [options]

Options:
  --plan <key>     Initial subscription plan: pro | max5 | max20  (default: max5)
                   You can change it in the page via the dropdown.
  --no-open        Don't auto-open the browser; just write the file
  --out <path>     Where to write the HTML (default: a temp file)
  -v, --version    Print version and exit
  -h, --help       Show this help

Plans:
${Object.entries(PLANS).map(([k, p]) => `  ${k.padEnd(8)} ${p.label} ($${p.monthly}/mo)`).join('\n')}

Source: ${PKG.homepage || 'https://github.com/Ezrolith/claudeworth'}
`);
}

function openInBrowser(path) {
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '""', path], { detached: true, stdio: 'ignore' }).unref();
  } else if (platform === 'darwin') {
    spawn('open', [path], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [path], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { help(); return; }
  if (args.version) { console.log(PKG.version); return; }

  const plan = planFromKey(args.plan);

  process.stdout.write(`Reading session data from ~/.claude/projects ... `);
  const { events, projectsDir } = await readAllUsageEvents();
  console.log(`${events.length} usage events.`);

  if (events.length === 0) {
    console.log('No Claude Code session data found. Have you used Claude Code on this machine?');
    process.exit(0);
  }

  const agg = aggregate(events);
  const html = renderDashboard({
    agg,
    plan,
    planKey: args.plan,
    sourceDir: projectsDir,
    generatedAt: new Date(),
  });

  let outPath = args.out;
  if (!outPath) {
    const dir = join(tmpdir(), 'claudeworth');
    await mkdir(dir, { recursive: true });
    outPath = join(dir, 'dashboard.html');
  } else {
    await mkdir(dirname(outPath), { recursive: true });
  }
  await writeFile(outPath, html, 'utf8');

  console.log(`\nWeek so far:  $${agg.totals.week.cost.toFixed(2)} API value`);
  console.log(`Multiplier:   ${(agg.totals.week.cost / (plan.monthly / 4.345)).toFixed(2)}x your weekly subscription cost`);
  console.log(`Dashboard:    ${outPath}`);

  if (args.open) {
    openInBrowser(outPath);
  }
}

main().catch(err => {
  console.error('claudeworth failed:', err);
  process.exit(1);
});
