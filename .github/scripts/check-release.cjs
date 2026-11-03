'use strict';
/*
 * Checks the latest BO2 Requiem NX release for t6zm.nro / t6mp.nro builds that patcher.js doesn't
 * list in KNOWN yet, and opens one GitHub issue per new build. Run by
 * .github/workflows/check-requiem.yml every hour.
 *
 * - Known builds are recognised from the zip's table of contents (size + CRC-32), read with two
 *   small range requests, so nothing big is downloaded when there's nothing new.
 * - For a new build only the two .nro files are fetched from the zip and run through patcher.js,
 *   so the issue says whether the page already patches them (auto-detected) or refuses them.
 * - A build that already has an issue (open or closed) is never reported again.
 * - Successful runs that didn't open an issue are deleted afterwards, so the Actions tab only
 *   keeps the runs that did something (and failures).
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID (set by Actions).
 * Local testing: DRY_RUN=1 prints the issue instead of creating it and deletes nothing;
 * IGNORE_KNOWN=1 treats every build as new.
 */
const zlib = require('node:zlib');
const fs = require('node:fs');
const P = require('../../patcher.js');

const UPSTREAM = 'HDErick/BO2-Requiem-NX';
const ASSET = 'bo2requiem.zip';
const WORKFLOW = 'check-requiem.yml';
const LABEL = 'requiem-build';
const API = 'https://api.github.com';
const { GITHUB_TOKEN, GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: RUN_ID } = process.env;
const DRY = process.env.DRY_RUN === '1';
const IGNORE_KNOWN = process.env.IGNORE_KNOWN === '1';

function log(...a) { console.log(...a); }

function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(GITHUB_TOKEN ? { Authorization: 'Bearer ' + GITHUB_TOKEN } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// ---- zip reading over HTTP range requests ----

async function range(url, start, end) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`range request ${start}-${end}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function zipEntries(url, size) {
  const tailLen = Math.min(size, 65557); // EOCD (22 bytes) + the longest possible comment
  const tail = await range(url, size - tailLen, size - 1);
  const e = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (e === -1) throw new Error('zip end record not found');
  const cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
  if (cdSize === 0xffffffff || cdOff === 0xffffffff) throw new Error('zip64 archives are not supported');
  const cd = await range(url, cdOff, cdOff + cdSize - 1);
  const entries = [];
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    entries.push({
      name: cd.toString('utf8', p + 46, p + 46 + nameLen),
      method: cd.readUInt16LE(p + 10),
      crc: cd.readUInt32LE(p + 16),
      compSize: cd.readUInt32LE(p + 20),
      size: cd.readUInt32LE(p + 24),
      localOff: cd.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function extract(url, entry) {
  const head = await range(url, entry.localOff, entry.localOff + 29);
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`${entry.name}: bad local header`);
  const dataOff = entry.localOff + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const data = await range(url, dataOff, dataOff + entry.compSize - 1);
  let out;
  if (entry.method === 0) out = data;
  else if (entry.method === 8) out = zlib.inflateRawSync(data);
  else throw new Error(`${entry.name}: unsupported compression method ${entry.method}`);
  if (out.length !== entry.size || crc32(out) !== entry.crc) throw new Error(`${entry.name}: size or CRC mismatch after extracting`);
  return out;
}

// ---- report ----

const crcHex = n => '0x' + n.toString(16).padStart(8, '0');
const byteList = b => '[' + b.map(x => P.hex(x, 2)).join(', ') + ']';
const bytesStr = b => b.map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

function knownEntry(f, tag) {
  const sites = f.result.sites.map(s => `{ off: ${P.hex(s.off)}, old: ${byteList(s.bytes)} }`).join(', ');
  return `    { kind: '${f.kind.id}', build: '${tag}', size: ${f.entry.size}, crc: ${crcHex(f.entry.crc)}, tested: false,\n` +
    `      sites: [${sites}] },`;
}

function fileSection(f) {
  const head = `### \`${f.kind.file}\` (${f.kind.name})\n\n` +
    `- Size: ${f.entry.size.toLocaleString('en-US')} bytes, CRC-32 \`${crcHex(f.entry.crc)}\`\n`;
  if (f.error) {
    return head + `- Version in the file: ${f.error.info?.version || 'not found'}\n` +
      `- **Not found:** \`${f.error.code}\`: ${f.error.message}\n`;
  }
  const r = f.result;
  const rows = r.sites.map(s => `| \`${s.setting}\` max | \`${P.hex(s.off)}\` | \`${bytesStr(s.bytes)}\` | ${P.describeInsn(s.bytes)} |`).join('\n');
  return head + `- Version in the file: ${r.version || 'not found'}\n- Engine (ELF) at \`${P.hex(r.engine)}\`\n\n` +
    '| Setting | File offset | Original bytes | Instruction |\n|---|---|---|---|\n' + rows + '\n';
}

function issueFor(rel, asset, files, marker) {
  const fresh = files.filter(f => !f.known);
  const ok = fresh.every(f => f.result);
  const title = `Requiem ${rel.tag_name}: new build ${ok ? 'auto-detected' : 'NOT supported'}`;
  const intro = ok
    ? 'The latest Requiem release has a build the patcher doesn\'t list yet. **Auto-detection finds the FOV code, so the page already patches it** (marked "Auto-detected").'
    : '**The page refuses at least one file of the latest Requiem release:** the FOV code pattern wasn\'t found. Users get "FOV code not found" until the pattern in `patcher.js` is fixed. Check the files by hand with `tools/find_fov_offsets.py`.';
  const known = files.filter(f => f.known).map(f => `- \`${f.kind.file}\` is unchanged (already listed as ${f.known.build}).`).join('\n');
  const entries = fresh.filter(f => f.result).map(f => knownEntry(f, rel.tag_name)).join('\n');
  const body = [
    intro, '',
    `Release: [${rel.name || rel.tag_name}](${rel.html_url}) (tag \`${rel.tag_name}\`), \`${ASSET}\` ${asset.size.toLocaleString('en-US')} bytes, uploaded ${asset.updated_at}.`,
    '', known, '',
    ...fresh.map(fileSection),
    entries ? '### Entries for `KNOWN` in `patcher.js`\n\n```js\n' + entries + '\n```\n' : '',
    '### To do',
    ok ? '- [ ] Test the page locally with the files from this release' : '- [ ] Find the new pattern and fix `patcher.js`',
    '- [ ] Test in game (set `tested: true` once it works)',
    '- [ ] Add the entries to `KNOWN` and update the README tables',
    '',
    `<sub>Opened by the [release check](https://github.com/${REPO}/actions/runs/${RUN_ID}).</sub>`,
    marker,
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  return { title, body };
}

// ---- issues and runs ----

async function reportedIssues() {
  try {
    return await gh(`/repos/${REPO}/issues?labels=${LABEL}&state=all&per_page=100`);
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

async function ensureLabel() {
  try {
    await gh(`/repos/${REPO}/labels`, { method: 'POST', body: { name: LABEL, color: 'b93d0b', description: 'New Requiem build found by the release check' } });
  } catch (err) {
    if (err.status !== 422) throw err; // 422: label already exists
  }
}

// Deletes this workflow's earlier successful runs that didn't open an issue.
async function cleanRuns(issues) {
  const keep = new Set(issues.flatMap(i => [...(i.body || '').matchAll(/actions\/runs\/(\d+)/g)].map(m => m[1])));
  keep.add(String(RUN_ID));
  let runs;
  try {
    ({ workflow_runs: runs } = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?status=success&per_page=100`));
  } catch (err) {
    if (err.status !== 404) throw err;
    log('workflow not found on GitHub (local run?): nothing to clean up');
    return;
  }
  let deleted = 0;
  for (const run of runs) {
    if (keep.has(String(run.id))) continue;
    if (DRY) { log(`[dry run] would delete run ${run.id}`); continue; }
    await gh(`/repos/${REPO}/actions/runs/${run.id}`, { method: 'DELETE' });
    deleted++;
  }
  log(`cleaned up ${deleted} empty run(s)`);
}

// ---- main ----

async function check(issues) {
  const rel = await gh(`/repos/${UPSTREAM}/releases/latest`);
  const asset = rel.assets.find(a => a.name === ASSET);
  if (!asset) throw new Error(`release ${rel.tag_name} has no ${ASSET}`);
  log(`latest release ${rel.tag_name}, ${ASSET} ${asset.size} bytes, uploaded ${asset.updated_at}`);

  const entries = await zipEntries(asset.browser_download_url, asset.size);
  const files = Object.values(P.KINDS).map(kind => {
    const entry = entries.find(e => e.name.split('/').pop() === kind.file);
    if (!entry) throw new Error(`${ASSET} of ${rel.tag_name} has no ${kind.file}`);
    const known = IGNORE_KNOWN ? null : P.KNOWN.find(k => k.kind === kind.id && k.size === entry.size && k.crc === entry.crc);
    log(`${kind.file}: ${entry.size} bytes, crc ${crcHex(entry.crc)}: ${known ? 'known (' + known.build + ')' : 'NEW'}`);
    return { kind, entry, known };
  });

  if (files.every(f => f.known)) {
    summary(`Requiem ${rel.tag_name}: both files are known builds. Nothing to do.`);
    return null;
  }

  const marker = '<!-- requiem-build ' + files.map(f => `${f.kind.id}:${f.entry.size}:${crcHex(f.entry.crc)}`).join(' ') + ' -->';
  const already = issues.find(i => (i.body || '').includes(marker));
  if (already) {
    log(`already reported in #${already.number}`);
    summary(`Requiem ${rel.tag_name}: new build, already reported in #${already.number}.`);
    return null;
  }

  for (const f of files.filter(x => !x.known)) {
    const buf = await extract(asset.browser_download_url, f.entry);
    try {
      f.result = await P.analyze(new Blob([buf]), { autoOnly: true });
      log(`${f.kind.file}: auto-detected ${f.result.sites.map(s => P.hex(s.off)).join(', ')}`);
    } catch (err) {
      if (!(err instanceof P.PatchError)) throw err;
      f.error = err;
      log(`${f.kind.file}: NOT found (${err.code}: ${err.message})`);
    }
  }

  const issue = issueFor(rel, asset, files, marker);
  if (DRY) {
    log('\n[dry run] would open issue:\n# ' + issue.title + '\n\n' + issue.body);
    return issue;
  }
  await ensureLabel();
  const created = await gh(`/repos/${REPO}/issues`, { method: 'POST', body: { ...issue, labels: [LABEL] } });
  log(`opened #${created.number}: ${created.html_url}`);
  summary(`Requiem ${rel.tag_name}: new build, opened [#${created.number}](${created.html_url}).`);
  return issue;
}

(async () => {
  if (!REPO) throw new Error('GITHUB_REPOSITORY is not set');
  const issues = await reportedIssues();
  const opened = await check(issues);
  // A run that opened an issue is kept: the issue links to it.
  await cleanRuns(opened ? [...issues, { body: `actions/runs/${RUN_ID}` }] : issues);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
