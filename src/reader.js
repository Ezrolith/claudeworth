import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

// The project folder name on disk is the original path with separators replaced by `-`,
// e.g. `C--Users-Peter-OneDrive-Documents-Claude-Projects-P-Universe-2`.
// We can't perfectly reverse this (because real folder names may contain `-`), but for
// display purposes we strip the drive prefix and show the tail.
export function decodeProjectName(encoded) {
  let s = encoded.replace(/^[A-Za-z]--/, '');
  s = s.replace(/-/g, '/');
  const parts = s.split('/').filter(Boolean);
  return parts.slice(-3).join('/') || encoded;
}

async function* iterateLines(filePath) {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield line;
  }
}

export async function readAllUsageEvents({ projectsDir = CLAUDE_PROJECTS_DIR } = {}) {
  const events = [];
  let projectDirs;
  try {
    projectDirs = await readdir(projectsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return { events, projectsDir };
    throw err;
  }

  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) continue;
    const projectPath = join(projectsDir, dirent.name);
    const projectName = decodeProjectName(dirent.name);

    let files;
    try {
      files = await readdir(projectPath);
    } catch { continue; }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const sessionId = file.replace(/\.jsonl$/, '');
      const fullPath = join(projectPath, file);

      try {
        for await (const line of iterateLines(fullPath)) {
          let obj;
          try { obj = JSON.parse(line); } catch { continue; }

          // We only care about assistant messages with usage data.
          if (obj.type !== 'assistant') continue;
          const msg = obj.message;
          if (!msg || !msg.usage) continue;

          const u = msg.usage;
          const cacheCreate = u.cache_creation || {};
          events.push({
            ts: obj.timestamp,
            model: msg.model || 'unknown',
            sessionId,
            project: projectName,
            projectRaw: dirent.name,
            requestId: obj.requestId,
            messageId: msg.id,
            input: u.input_tokens || 0,
            output: u.output_tokens || 0,
            cacheRead: u.cache_read_input_tokens || 0,
            cacheCreate5m: cacheCreate.ephemeral_5m_input_tokens || 0,
            cacheCreate1h: cacheCreate.ephemeral_1h_input_tokens || 0,
            // Fallback if cache_creation breakdown missing
            cacheCreateTotal: u.cache_creation_input_tokens || 0,
          });
        }
      } catch {
        // skip unreadable file
      }
    }
  }

  // De-duplicate by messageId (some events get re-logged on retries/resume)
  const seen = new Set();
  const deduped = [];
  for (const e of events) {
    const key = e.messageId || `${e.sessionId}|${e.ts}|${e.input}|${e.output}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }

  deduped.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { events: deduped, projectsDir };
}
