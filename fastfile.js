/*
 * BO2 FOV patcher: the FOV slider in the options menu.
 *
 * The NRO patch raises the engine limit to 160, but the menu slider has its own range: the
 * options menu (Lua, compiled into patch_zm.ff / patch_mp.ff from your BO2 game data) creates it
 * with addHardwareProfileLeftRightSlider(..., "cg_fov_default", 65, 90, ...). This module changes
 * that 90 into a higher max (the page uses the FOV the player picks, at most 160).
 *
 * A BO2 PC fastfile ("zone") is a header followed by chunks of at most 0x8000 bytes. The chunks
 * take turns over 4 streams, each chunk is deflate-compressed and then Salsa20-encrypted. The
 * Salsa20 IV of a chunk depends on the zone name and on the SHA-1 of every earlier chunk of the
 * same stream (the same scheme OpenAssetTools uses). The stock files are signed (TAff0100); a
 * changed file can't carry that signature, so it is written as an unsigned zone (TAffu100), the
 * same format mod fastfiles use and that the game loads without a signature.
 *
 * Works in the browser and in Node 20+ (needs DecompressionStream/CompressionStream "deflate-raw").
 */
(function (root) {
  'use strict';

  const P = typeof module === 'object' && module.exports ? require('./patcher.js') : root.FovPatcher;
  const { PatchError } = P;

  const KEY = [0x64, 0x1D, 0x8A, 0x2F, 0xE3, 0x1D, 0x3A, 0xA6, 0x36, 0x22, 0xBB, 0xC9, 0xCE, 0x85, 0x87, 0x22,
    0x9D, 0x42, 0xB0, 0xF8, 0xED, 0x9B, 0x92, 0x41, 0x30, 0xBF, 0x88, 0xB6, 0x5E, 0xDC, 0x50, 0xBE]; // Treyarch PC
  const MAGIC_SIGNED = 'TAff0100', MAGIC_UNSIGNED = 'TAffu100', AUTH_MAGIC = 'PHEEBs71';
  const HEADER = 12, AUTH = 8 + 4 + 32 + 256;
  const STREAMS = 4, HASH_BLOCKS = 200, VBUF = 0x80000, XCHUNK = 0x8000;
  const SLIDER_MIN = 65, OLD_MAX = 90, NEW_MAX = 160; // NEW_MAX: the engine limit set by the .nro patch

  const KINDS = {
    zm: { id: 'zm', name: 'Zombies', file: 'patch_zm.ff', zone: 'patch_zm' },
    mp: { id: 'mp', name: 'Multiplayer', file: 'patch_mp.ff', zone: 'patch_mp' },
  };

  // Compiled Lua constants: "cg_fov_default", then number 65 (type 3, float), then number <max>,
  // then a string (type 4). The 4 bytes after NEEDLE are the slider max.
  const NEEDLE = [...'cg_fov_default'].map(c => c.charCodeAt(0)).concat([0x00, 0x03, 0x00, 0x00, 0x82, 0x42, 0x03]);
  const AFTER_MAX = 0x04;

  const ascii = (b, from, len) => String.fromCharCode(...b.subarray(from, from + len));
  const f32 = b => new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);
  const f32Bytes = v => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); return b; };

  // ---- Salsa20 (20 rounds, 256-bit key, 64-bit nonce, block counter from 0) ----

  const K32 = new Uint32Array(8);
  for (let i = 0; i < 8; i++) K32[i] = KEY[i * 4] | KEY[i * 4 + 1] << 8 | KEY[i * 4 + 2] << 16 | KEY[i * 4 + 3] << 24;
  const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]; // "expand 32-byte k"

  function salsa20(iv, data) {
    const n0 = iv[0] | iv[1] << 8 | iv[2] << 16 | iv[3] << 24, n1 = iv[4] | iv[5] << 8 | iv[6] << 16 | iv[7] << 24;
    const s = new Uint32Array([SIGMA[0], K32[0], K32[1], K32[2], K32[3], SIGMA[1], n0, n1, 0, 0,
      SIGMA[2], K32[4], K32[5], K32[6], K32[7], SIGMA[3]]);
    const x = new Uint32Array(16), out = new Uint8Array(data.length);
    const R = (v, c) => v << c | v >>> (32 - c);
    for (let pos = 0, ctr = 0; pos < data.length; pos += 64, ctr++) {
      s[8] = ctr; s[9] = Math.floor(ctr / 2 ** 32);
      x.set(s);
      for (let r = 0; r < 10; r++) {
        x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9); x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
        x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9); x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
        x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9); x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
        x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9); x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
        x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9); x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
        x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9); x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
        x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9); x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
        x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9); x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
      }
      const end = Math.min(64, data.length - pos);
      for (let i = 0; i < end; i++) {
        const w = (x[i >> 2] + s[i >> 2]) >>> 0;
        out[pos + i] = data[pos + i] ^ (w >>> ((i & 3) * 8)) & 0xff;
      }
    }
    return out;
  }

  // ---- SHA-1 (synchronous, so the IV chain doesn't need WebCrypto or a secure context) ----

  function sha1(data) {
    const len = data.length, total = ((len + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total);
    m.set(data); m[len] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(len / 2 ** 29)); dv.setUint32(total - 4, (len << 3) >>> 0);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Uint32Array(80);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 80; i++) { const t = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = t << 1 | t >>> 31; }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        const t = ((a << 5 | a >>> 27) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = b << 30 | b >>> 2; b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    const out = new Uint8Array(20), ov = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h));
    return out;
  }

  // ---- IV chain: per stream, the next IV is the previous hash block XOR the SHA-1 of the chunk ----

  function ivChain(zone) {
    const hashes = new Uint8Array(HASH_BLOCKS * STREAMS * 20), idx = new Array(STREAMS).fill(0);
    const name = zone.slice(0, 31);
    for (let i = 0, z = 0; i < hashes.length; i += 4, z = (z + 1) % name.length) hashes.fill(name.charCodeAt(z), i, i + 4);
    const at = s => (idx[s] * STREAMS + s) * 20;
    return {
      iv: s => hashes.slice(at(s), at(s) + 8),
      advance(s, plain) {
        const h = sha1(plain);
        idx[s] = (idx[s] + 1) % HASH_BLOCKS;
        const o = at(s);
        for (let k = 0; k < 20; k++) hashes[o + k] ^= h[k];
      },
    };
  }

  // ---- reading and writing the chunk stream ----

  // The game reads the stream through a 0x80000-byte buffer: a chunk size that would cross the
  // end of that buffer starts at the next buffer instead (the bytes in between are padding).
  function readChunks(bytes, start, zone) {
    const chain = ivChain(zone), chunks = [];
    let pos = start, voff = start % VBUF;
    for (let s = 0; pos + 4 <= bytes.length; s = (s + 1) % STREAMS) {
      if (voff + 4 > VBUF) { pos += VBUF - voff; voff = 0; if (pos + 4 > bytes.length) break; }
      const size = bytes[pos] | bytes[pos + 1] << 8 | bytes[pos + 2] << 16 | bytes[pos + 3] << 24;
      pos += 4; voff = (voff + 4) % VBUF;
      if (size === 0) break;
      if (size < 0 || size > XCHUNK || pos + size > bytes.length) throw new PatchError('ffcorrupt', `bad chunk size ${size} at ${pos - 4}`);
      const plain = salsa20(chain.iv(s), bytes.subarray(pos, pos + size));
      chain.advance(s, plain);
      chunks.push(plain);
      pos += size; voff = (voff + size) % VBUF;
    }
    return chunks;
  }

  function writeUnsigned(version, chunks, zone) {
    const chain = ivChain(zone), parts = [];
    let len = HEADER, voff = HEADER;
    const push = b => { parts.push(b); len += b.length; voff = (voff + b.length) % VBUF; };
    const pad = () => { if (voff + 4 > VBUF) push(new Uint8Array(VBUF - voff)); };
    parts.push(new Uint8Array([...MAGIC_UNSIGNED].map(c => c.charCodeAt(0)).concat(version)));
    chunks.forEach((plain, i) => {
      const s = i % STREAMS;
      pad();
      const size = new Uint8Array(4);
      new DataView(size.buffer).setUint32(0, plain.length, true);
      push(size);
      push(salsa20(chain.iv(s), plain));
      chain.advance(s, plain);
    });
    pad();
    // End marker (a zero chunk size) plus zero padding: at least 0x40 bytes, aligned to 0x40, like the stock files.
    push(new Uint8Array((((len + 0x40) + 0x3f) & ~0x3f) - len));
    return new Blob(parts, { type: 'application/octet-stream' });
  }

  const pipe = (bytes, stream) => new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(b => new Uint8Array(b));
  const inflate = bytes => pipe(bytes, new DecompressionStream('deflate-raw'));
  const deflate = bytes => pipe(bytes, new CompressionStream('deflate-raw'));

  function indexOf(hay, needle, from) {
    for (let i = hay.indexOf(needle[0], from); i !== -1 && i <= hay.length - needle.length; i = hay.indexOf(needle[0], i + 1)) {
      let k = 1;
      while (k < needle.length && hay[i + k] === needle[k]) k++;
      if (k === needle.length) return i;
    }
    return -1;
  }

  // ---- public API ----

  /** True when the blob starts like a BO2 PC fastfile. */
  async function isFastfile(blob) {
    if (blob.size < HEADER + 4) return false;
    const m = ascii(new Uint8Array(await blob.slice(0, 8).arrayBuffer()), 0, 8);
    return m === MAGIC_SIGNED || m === MAGIC_UNSIGNED;
  }

  /**
   * Analyses patch_zm.ff / patch_mp.ff. Resolves to
   *   { type: 'ff', kind, signed, size, max, chunk, offset, ... }   (max: the slider max now in the file)
   * or throws a PatchError: 'ffzone' (not patch_zm/patch_mp) | 'ffcorrupt' | 'noslider'.
   */
  async function analyze(blob, { onProgress, fileName } = {}) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const magic = ascii(bytes, 0, 8);
    const version = Array.from(bytes.subarray(8, 12));
    let start, candidates;
    if (magic === MAGIC_SIGNED) {
      if (ascii(bytes, HEADER, 8) !== AUTH_MAGIC) throw new PatchError('ffcorrupt', 'missing auth header');
      const name = ascii(bytes, HEADER + 12, 32).replace(/\0.*$/s, '');
      start = HEADER + AUTH;
      candidates = Object.values(KINDS).filter(k => k.zone === name);
      if (!candidates.length) throw new PatchError('ffzone', `zone ${name}`, { zone: name });
    } else if (magic === MAGIC_UNSIGNED) {
      // An unsigned zone doesn't store its name: try the one from the file name first, then both.
      start = HEADER;
      const base = (fileName || '').toLowerCase().replace(/\.ff$/, '');
      candidates = Object.values(KINDS).sort((a, b) => (b.zone === base) - (a.zone === base));
    } else {
      throw new PatchError('ffcorrupt', 'not a fastfile');
    }

    let kind = null, chunks = null, raw = null;
    for (const k of candidates) {
      try {
        chunks = readChunks(bytes, start, k.zone);
        if (!chunks.length) continue;
        raw = [await inflate(chunks[0])];
        kind = k;
        break;
      } catch (err) {
        if (err instanceof PatchError && magic === MAGIC_SIGNED) throw err;
      }
    }
    if (!kind) throw new PatchError(magic === MAGIC_SIGNED ? 'ffcorrupt' : 'ffzone', 'could not decode the zone');

    try {
      for (let i = 1; i < chunks.length; i++) {
        raw.push(await inflate(chunks[i]));
        if (onProgress && i % 16 === 0) onProgress(i / chunks.length);
      }
    } catch (err) {
      throw new PatchError('ffcorrupt', 'chunk does not decompress');
    }

    const hits = [];
    raw.forEach((r, i) => { for (let o = indexOf(r, NEEDLE, 0); o !== -1; o = indexOf(r, NEEDLE, o + 1)) hits.push([i, o]); });
    if (hits.length !== 1) throw new PatchError('noslider', `${hits.length} FOV sliders found`, { zone: kind.zone });
    const [chunk, o] = hits[0];
    const offset = o + NEEDLE.length;
    if (offset + 5 > raw[chunk].length || raw[chunk][offset + 4] !== AFTER_MAX) {
      throw new PatchError('noslider', 'unexpected layout after the slider range', { zone: kind.zone });
    }
    if (onProgress) onProgress(1);
    return { type: 'ff', kind, signed: magic === MAGIC_SIGNED, size: blob.size, version, chunks, chunk, offset,
      plain: raw[chunk], max: f32(raw[chunk].subarray(offset, offset + 4)), chunkCount: chunks.length };
  }

  /** New unsigned fastfile with the slider max set to `max` (a whole number, above 65 and at most 160). */
  async function withMax(r, max) {
    if (!Number.isInteger(max) || max <= SLIDER_MIN || max > NEW_MAX) throw new RangeError(`slider max ${max} out of range`);
    const plain = r.plain.slice();
    plain.set(f32Bytes(max), r.offset);
    const packed = await deflate(plain);
    if (packed.length > XCHUNK) throw new PatchError('ffcorrupt', 'chunk too large after compression');
    const chunks = r.chunks.slice();
    chunks[r.chunk] = packed;
    return writeUnsigned(r.version, chunks, r.kind.zone);
  }

  /** Reads `out` back and checks it is the same zone with the slider max set to `max`. */
  async function verify(out, r, max) {
    try {
      const o = await analyze(out, { fileName: r.kind.file });
      return o.kind === r.kind && o.max === max && !o.signed && o.chunkCount === r.chunkCount;
    } catch (err) {
      return false;
    }
  }

  const api = { KINDS, OLD_MAX, NEW_MAX, isFastfile, analyze, withMax, verify };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FovFastfile = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
