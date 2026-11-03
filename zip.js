/*
 * Minimal ZIP writer (no compression) for the "download everything" button: puts the patched
 * files in the folder layout of the SD card, so the zip can be unpacked onto its root.
 * Works on Blobs, so large files are never copied into memory whole (only read once for the CRC).
 */
(function (root) {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  async function crc32(blob) {
    const STEP = 8 * 1024 * 1024;
    let c = 0xffffffff;
    for (let pos = 0; pos < blob.size; pos += STEP) {
      const b = new Uint8Array(await blob.slice(pos, pos + STEP).arrayBuffer());
      for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    const time = d.getHours() << 11 | d.getMinutes() << 5 | Math.floor(d.getSeconds() / 2);
    const date = (Math.max(1980, d.getFullYear()) - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate();
    return { time, date };
  }

  /** entries: [{ path: 'switch/t6game/t6zm.nro', blob }]. Resolves to a zip Blob (stored, no zip64). */
  async function makeZip(entries, now = new Date()) {
    const { time, date } = dosDateTime(now);
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.path), size = e.blob.size, crc = await crc32(e.blob);
      if (size >= 0xffffffff || offset >= 0xffffffff) throw new RangeError('zip too large');
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
      local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true);
      local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true); cd.setUint16(12, time, true); cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true);
      cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
      parts.push(local, name, e.blob);
      central.push(cd, name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  const api = { makeZip, crc32 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FovZip = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
