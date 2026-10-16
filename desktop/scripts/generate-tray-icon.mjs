// Original small PNG icon, generated without external assets.
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
const size = 32,
  pixels = Buffer.alloc(size * (size * 4 + 1));
function pixel(x, y, rgb) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = y * (size * 4 + 1) + 1 + x * 4;
  pixels.set([...rgb, 255], offset);
}
for (let y = 1; y < 31; y++)
  for (let x = 1; x < 31; x++)
    if (Math.min(x, 31 - x) + Math.min(y, 31 - y) > 5)
      pixel(x, y, [18, 80, 76]);
function line(x0, y0, x1, y1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let s = 0; s <= steps; s++)
    pixel(
      Math.round(x0 + ((x1 - x0) * s) / steps),
      Math.round(y0 + ((y1 - y0) * s) / steps),
      [211, 248, 238],
    );
}
for (let i = 0; i < 6; i++) {
  const a = (i * Math.PI) / 3,
    c = Math.cos(a),
    s = Math.sin(a);
  line(16, 16, 16 + 11 * c, 16 + 11 * s);
  for (const d of [-1, 1])
    line(
      16 + 7 * c,
      16 + 7 * s,
      16 + 7 * c + 4 * Math.cos(a + (d * 2 * Math.PI) / 3),
      16 + 7 * s + 4 * Math.sin(a + (d * 2 * Math.PI) / 3),
    );
}
function crc(data) {
  let n = 0xffffffff;
  for (const b of data) {
    n ^= b;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type),
    length = Buffer.alloc(4),
    check = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  check.writeUInt32BE(crc(Buffer.concat([label, data])));
  return Buffer.concat([length, label, data, check]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
await mkdir("assets", { recursive: true });
await writeFile(
  "assets/tray.png",
  Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
