/*
 * BO2 Requiem NX FOV patcher: analysis and patching engine.
 *
 * Used by index.html in the browser and by the update check (Node 20+). Works on any Blob, so
 * the browser only reads the parts of the file it needs.
 *
 * How the FOV limit is found (see README.md, "What the patch changes"):
 *  1. A .nro is a loader. The real engine is an embedded 32-bit AArch64 ELF (ILP32).
 *  2. Find the strings "cg_fov" and "cg_fov_default" in its .rodata.
 *  3. Find the code that points at each string (adrp + add): that's where the engine
 *     registers the setting.
 *  4. Just before that, the engine packs {min, max} into x5. The max comes from w0 through
 *     `bfi x5, x0, #32, #32`. The `ldr w0, [xN, #imm]` before it loads the old max (90).
 *  5. The patch replaces that ldr with `movz w0, #0x4320, lsl #16`, which is 160.0f.
 *
 * Anything that doesn't match this pattern exactly is refused, so a changed engine is never
 * patched by guesswork.
 */
(function (root) {
  'use strict';

  const NEW = [0x00, 0x64, 0xa8, 0x52]; // movz w0, #0x4320, lsl #16  ->  max = 160.0f
  const NEW_WORD = 0x52a86400;
  const BFI_X5_X0_HI = 0xb3607c05;      // bfi x5, x0, #32, #32
  const SETTINGS = ['cg_fov', 'cg_fov_default'];

  const KINDS = {
    zm: { id: 'zm', name: 'Zombies', file: 't6zm.nro', cfg: 'config_zm.cfg' },
    mp: { id: 'mp', name: 'Multiplayer', file: 't6mp.nro', cfg: 'config_mp.cfg' },
  };

  // Builds whose offsets have been checked by hand. Auto-detection handles every other build;
  // this list adds the release tag, the "tested" status and the original bytes for restoring.
  const KNOWN = [
    { kind: 'zm', build: '0.3.0', size: 52277821, tested: true,
      sites: [{ off: 0x219d619, old: [0x80, 0xda, 0x44, 0xb9] }, { off: 0x24886e5, old: [0x00, 0x00, 0x4e, 0xb9] }] },
    { kind: 'mp', build: '0.3.0', size: 84911876, tested: true,
      sites: [{ off: 0x40b1810, old: [0x80, 0x5a, 0x47, 0xb9] }, { off: 0x4397a9c, old: [0x00, 0x80, 0x40, 0xb9] }] },
    // First upload of 0.3.0; the release zip was replaced a few hours later with a rebuilt engine.
    // Hidden from the versions table, but still recognised and restorable.
    { kind: 'zm', build: '0.3.0', note: 'first upload', hidden: true, size: 52273725, tested: false,
      sites: [{ off: 0x219ca39, old: [0x80, 0x7a, 0x43, 0xb9] }, { off: 0x2487875, old: [0x00, 0xc0, 0x4d, 0xb9] }] },
    { kind: 'mp', build: '0.3.0', note: 'first upload', hidden: true, size: 84908884, tested: false,
      sites: [{ off: 0x40b1810, old: [0x80, 0xba, 0x4a, 0xb9] }, { off: 0x439780c, old: [0x00, 0x00, 0x45, 0xb9] }] },
    { kind: 'zm', build: '0.2.5', size: 51335533, tested: true,
      sites: [{ off: 0x20e71b9, old: [0x80, 0x5a, 0x46, 0xb9] }, { off: 0x23c9405, old: [0x00, 0xa0, 0x40, 0xb9] }] },
    { kind: 'mp', build: '0.2.5', size: 83981876, tested: true,
      sites: [{ off: 0x3ffdb50, old: [0x80, 0x9a, 0x4c, 0xb9] }, { off: 0x42dfd7c, old: [0x00, 0xe0, 0x46, 0xb9] }] },
  ];

  const CHUNK = 8 * 1024 * 1024;
  const OVERLAP = 64;
  const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];
  const EM_AARCH64 = 183;
  const SHT_NOBITS = 8;
  // Release tag followed by the build date, e.g. "0.3.0\0...\0Nov 02 2026 23:55:59\0".
  const VERSION_RE = /\0(\d{1,3}\.\d{1,3}\.\d{1,3})\0{1,32}[A-Z][a-z]{2} [ \d]\d \d{4} \d\d:\d\d:\d\d\0/;

  class PatchError extends Error {
    constructor(code, detail) { super(detail || code); this.code = code; }
  }

  async function read(blob, off, len) {
    return new Uint8Array(await blob.slice(off, off + len).arrayBuffer());
  }

  const latin1 = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
  };

  const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  function indexOfBytes(hay, needle, from) {
    const first = needle[0];
    for (let i = hay.indexOf(first, from); i !== -1 && i <= hay.length - needle.length; i = hay.indexOf(first, i + 1)) {
      let k = 1;
      while (k < needle.length && hay[i + k] === needle[k]) k++;
      if (k === needle.length) return i;
    }
    return -1;
  }

  // ---- step 1: find the embedded engine and the release tag (one streaming pass) ----

  async function scanFile(blob, onProgress) {
    const elfs = [];
    let version = null;
    for (let pos = 0; pos < blob.size; pos += CHUNK) {
      const buf = await read(blob, pos, CHUNK + OVERLAP);
      const limit = Math.min(CHUNK, buf.length);
      for (let i = indexOfBytes(buf, ELF_MAGIC, 0); i !== -1 && i < limit; i = indexOfBytes(buf, ELF_MAGIC, i + 1)) {
        if (i + 20 <= buf.length && buf[i + 4] === 1 && (buf[i + 18] | (buf[i + 19] << 8)) === EM_AARCH64) elfs.push(pos + i);
      }
      if (!version) {
        const m = VERSION_RE.exec(latin1(buf));
        if (m) version = m[1];
      }
      if (onProgress) onProgress(Math.min(1, (pos + CHUNK) / blob.size) * 0.7);
    }
    if (elfs.length !== 1) throw new PatchError('noengine', `expected one embedded 32-bit AArch64 ELF, found ${elfs.length}`);
    return { base: elfs[0], version };
  }

  async function readSections(blob, base) {
    const hdr = new DataView((await read(blob, base, 52)).buffer);
    const shoff = hdr.getUint32(32, true), shentsize = hdr.getUint16(46, true);
    const shnum = hdr.getUint16(48, true), shstrndx = hdr.getUint16(50, true);
    if (shentsize !== 40 || shnum === 0 || shstrndx >= shnum) throw new PatchError('noengine', 'unexpected ELF section table');
    const tab = new DataView((await read(blob, base + shoff, shnum * shentsize)).buffer);
    const secs = [];
    for (let k = 0; k < shnum; k++) {
      const o = k * shentsize;
      secs.push({ nameOff: tab.getUint32(o, true), type: tab.getUint32(o + 4, true), addr: tab.getUint32(o + 12, true),
        off: tab.getUint32(o + 16, true), size: tab.getUint32(o + 20, true) });
    }
    const strtab = secs[shstrndx];
    const names = latin1(await read(blob, base + strtab.off, strtab.size));
    for (const s of secs) s.name = names.slice(s.nameOff, names.indexOf('\0', s.nameOff));
    const get = name => {
      const s = secs.find(x => x.name === name && x.type !== SHT_NOBITS);
      if (!s) throw new PatchError('noengine', `section ${name} missing`);
      return s;
    };
    return { text: get('.text'), rodata: get('.rodata') };
  }

  // ---- step 2: find the patch site for one setting ----

  const isAdrp = w => (w & 0x9f000000) >>> 0 === 0x90000000;
  const adrpTarget = (w, pc) => {
    let imm = (((w >>> 5) & 0x7ffff) << 2 | ((w >>> 29) & 3)) * 4096;
    if (imm >= 2 ** 32) imm -= 2 ** 33;
    return Math.floor(pc / 4096) * 4096 + imm;
  };
  // add wD, wD, #imm (32-bit, no shift)
  const isAddImm = (w, rd, imm) => (w & 0xffc00000) >>> 0 === 0x11000000 && (w & 0x1f) === rd && ((w >>> 5) & 0x1f) === rd && ((w >>> 10) & 0xfff) === imm;
  // ldr w0, [xN, #imm] (unsigned offset)
  const isLdrW0 = w => (w & 0xffc0001f) >>> 0 === 0xb9400000;

  // Walks back from a string reference to the `bfi x5, x0` and then to the load of w0.
  function siteBefore(text, i) {
    for (let k = i - 4; k >= Math.max(0, i - 0x80); k -= 4) {
      if (text.getUint32(k, true) !== BFI_X5_X0_HI) continue;
      for (let j = k - 4; j >= Math.max(0, k - 44); j -= 4) {
        const w = text.getUint32(j, true);
        if (isLdrW0(w) || w === NEW_WORD) return j;
        if ((w & 0x1f) === 0) return -1; // something else writes w0/x0 first: not our pattern
      }
      return -1;
    }
    return -1;
  }

  function findSites(text, sec, target) {
    const page = Math.floor(target / 4096) * 4096, low = target % 4096;
    const sites = new Set();
    for (let i = 0; i + 4 <= text.byteLength; i += 4) {
      const w = text.getUint32(i, true);
      if (!isAdrp(w) || adrpTarget(w, sec.addr + i) !== page) continue;
      const rd = w & 0x1f;
      let hasAdd = false;
      for (let k = i + 4; k < Math.min(text.byteLength, i + 32); k += 4) {
        if (isAddImm(text.getUint32(k, true), rd, low)) { hasAdd = true; break; }
      }
      if (!hasAdd) continue;
      const s = siteBefore(text, i);
      if (s !== -1) sites.add(s);
    }
    return [...sites];
  }

  // ---- full analysis ----

  async function autoDetect(blob, onProgress) {
    const { base, version } = await scanFile(blob, onProgress);
    const { text, rodata } = await readSections(blob, base);
    const ro = latin1(await read(blob, base + rodata.off, rodata.size));
    const strAddr = s => {
      const i = ro.indexOf('\0' + s + '\0');
      return i === -1 ? -1 : rodata.addr + i + 1;
    };

    const kinds = Object.values(KINDS).filter(k => strAddr(k.cfg) !== -1);
    if (kinds.length !== 1) throw new PatchError('nokind', `found ${kinds.length} game type markers`);

    if (onProgress) onProgress(0.8);
    const code = await read(blob, base + text.off, text.size);
    const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
    const sites = SETTINGS.map(setting => {
      const addr = strAddr(setting);
      if (addr === -1) throw new PatchError('nosite', `string ${setting} not found`);
      const found = findSites(view, text, addr);
      if (found.length !== 1) throw new PatchError('nosite', `${setting}: ${found.length} candidate sites`);
      const off = base + text.off + found[0];
      return { setting, off, bytes: Array.from(code.subarray(found[0], found[0] + 4)) };
    });
    if (onProgress) onProgress(1);
    return { kind: kinds[0], version, sites, known: null };
  }

  // Known build: only the bytes at the known offsets are read, so this is instant.
  async function matchKnown(blob) {
    for (const k of KNOWN) {
      if (blob.size !== k.size) continue;
      const bytes = await Promise.all(k.sites.map(s => read(blob, s.off, 4)));
      const ok = bytes.every((b, i) => sameBytes(Array.from(b), k.sites[i].old) || sameBytes(Array.from(b), NEW));
      if (!ok) continue;
      return { kind: KINDS[k.kind], version: k.build, known: k,
        sites: k.sites.map((s, i) => ({ setting: SETTINGS[i], off: s.off, bytes: Array.from(bytes[i]) })) };
    }
    return null;
  }

  async function isNro(blob) {
    return blob.size > 0x20 && latin1(await read(blob, 0x10, 4)) === 'NRO0';
  }

  /**
   * Analyses a .nro. Resolves to
   *   { kind, version, known, status, sites: [{ setting, off, bytes, state }], patched, canRestore }
   * or throws a PatchError with code 'notnro' | 'noengine' | 'nokind' | 'nosite'.
   * status: 'tested' (known and tested on a Switch) | 'verified' (known) | 'auto' (auto-detected).
   */
  async function analyze(blob, { onProgress, autoOnly = false } = {}) {
    if (!(await isNro(blob))) throw new PatchError('notnro', 'not an NRO file');
    const r = (!autoOnly && await matchKnown(blob)) || await autoDetect(blob, onProgress);
    r.size = blob.size;
    for (const s of r.sites) s.state = sameBytes(s.bytes, NEW) ? 'patched' : 'stock';
    if (!r.known) {
      // Auto-detected: if it turns out to be a known build after all, use its details.
      const k = KNOWN.find(x => x.size === blob.size && x.kind === r.kind.id && x.sites.every((s, i) => s.off === r.sites[i].off));
      if (k) r.known = k;
    }
    if (r.known) r.version = r.known.build;
    r.status = r.known ? (r.known.tested ? 'tested' : 'verified') : 'auto';
    r.patched = r.sites.filter(s => s.state === 'patched').length;
    r.canRestore = Boolean(r.known) && r.patched > 0;
    return r;
  }

  function withBytes(blob, edits) {
    const parts = [];
    let pos = 0;
    for (const e of [...edits].sort((a, b) => a.off - b.off)) {
      parts.push(blob.slice(pos, e.off), new Uint8Array(e.bytes));
      pos = e.off + e.bytes.length;
    }
    parts.push(blob.slice(pos));
    return new Blob(parts, { type: 'application/octet-stream' });
  }

  /** Patched copy: every site set to the 160 max. */
  const patch = (blob, r) => withBytes(blob, r.sites.map(s => ({ off: s.off, bytes: NEW })));

  /** Original copy of a known build (restores the original instructions). */
  function restore(blob, r) {
    if (!r.known) throw new PatchError('norestore', 'original bytes unknown for this build');
    return withBytes(blob, r.known.sites.map(s => ({ off: s.off, bytes: s.old })));
  }

  /** Checks that `out` has exactly `expected` (4 bytes) at every site and the same size as the input. */
  async function verify(out, r, expected) {
    if (out.size !== r.size) return false;
    const got = await Promise.all(r.sites.map(s => read(out, s.off, 4)));
    return got.every((b, i) => sameBytes(Array.from(b), expected(i)));
  }

  const api = { NEW, KINDS, KNOWN, SETTINGS, PatchError, analyze, patch, restore, verify };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FovPatcher = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
