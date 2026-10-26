/**
 * Tiny real-video fixtures. The still PNGs cannot exercise footage.interpretation (loop / conform need a non-still source)
 * or footage.scene-edits (needs a video layer), so the kit ships a 1 s clip as uncompressed frames in two containers and the
 * runner imports whichever one the host accepts (AVI is Windows-native, QuickTime "raw " is macOS-native; AE reads both on recent builds).
 */
const VIDEO_WIDTH = 32;
const VIDEO_HEIGHT = 32;
export const VIDEO_FRAMES = 12;
const VIDEO_RATE = 12;

function frameRgb(index: number): [number, number, number] {
  const t = index / (VIDEO_FRAMES - 1);
  return [Math.round(255 * (1 - t)), 40, Math.round(255 * t)];
}
const u32be = (value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0);
  return out;
};
const u16be = (value: number): Buffer => {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(value);
  return out;
};
const u32le = (value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
};
const u16le = (value: number): Buffer => {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
};
const zeros = (count: number): Buffer => Buffer.alloc(count);

const atom = (type: string, ...parts: Buffer[]): Buffer => { const body = Buffer.concat(parts); return Buffer.concat([u32be(body.length + 8), Buffer.from(type, "ascii"), body]); };
const MATRIX = Buffer.concat([u32be(0x10000), zeros(12), u32be(0x10000), zeros(12), u32be(0x40000000)]);
const rawFrame = (index: number): Buffer => Buffer.from(Array.from({ length: VIDEO_WIDTH * VIDEO_HEIGHT }, () => frameRgb(index)).flat());

function movSampleTable(chunkOffset: number, frameBytes: number): Buffer {
  const description = Buffer.concat([
    zeros(6),
    u16be(1),
    u16be(0),
    u16be(0),
    zeros(12),
    u16be(VIDEO_WIDTH),
    u16be(VIDEO_HEIGHT),
    u32be(0x480000),
    u32be(0x480000),
    zeros(4),
    u16be(1),
    zeros(32),
    u16be(24),
    u16be(0xffff),
  ]);
  const stsd = atom("stsd", zeros(4), u32be(1), u32be(description.length + 8), Buffer.from("raw ", "ascii"), description);
  const stts = atom("stts", zeros(4), u32be(1), u32be(VIDEO_FRAMES), u32be(1));
  const stsc = atom("stsc", zeros(4), u32be(1), u32be(1), u32be(VIDEO_FRAMES), u32be(1));
  const stsz = atom("stsz", zeros(4), u32be(frameBytes), u32be(VIDEO_FRAMES));
  return atom("stbl", stsd, stts, stsc, stsz, atom("stco", zeros(4), u32be(1), u32be(chunkOffset)));
}
function movTrack(chunkOffset: number, frameBytes: number): Buffer {
  const tkhd = atom("tkhd", u32be(0x0000000f), zeros(8), u32be(1), zeros(4), u32be(VIDEO_FRAMES), zeros(8), zeros(4), zeros(4), MATRIX, u32be(VIDEO_WIDTH << 16), u32be(VIDEO_HEIGHT << 16));
  const mdhd = atom("mdhd", zeros(4), zeros(8), u32be(VIDEO_RATE), u32be(VIDEO_FRAMES), zeros(4));
  const hdlr = atom("hdlr", zeros(4), Buffer.from("mhlr", "ascii"), Buffer.from("vide", "ascii"), zeros(12), Buffer.from([0]));
  const dref = atom("dref", zeros(4), u32be(1), atom("alis", u32be(1)));
  const minf = atom("minf", atom("vmhd", u32be(1), zeros(8)), atom("dinf", dref), movSampleTable(chunkOffset, frameBytes));
  return atom("trak", tkhd, atom("mdia", mdhd, hdlr, minf));
}
/** A QuickTime movie of VIDEO_FRAMES uncompressed RGB frames: ftyp, mdat, then moov pointing back into mdat. */
export function rawMov(): Buffer {
  const frames = Array.from({ length: VIDEO_FRAMES }, (_, index) => rawFrame(index)), frameBytes = frames[0]?.length ?? 0;
  const ftyp = atom("ftyp", Buffer.from("qt  ", "ascii"), zeros(4), Buffer.from("qt  ", "ascii"));
  const mdat = atom("mdat", ...frames), chunkOffset = ftyp.length + 8;
  const mvhd = atom("mvhd", zeros(4), zeros(8), u32be(VIDEO_RATE), u32be(VIDEO_FRAMES), u32be(0x10000), u16be(0x100), zeros(10), MATRIX, zeros(24), u32be(2));
  return Buffer.concat([ftyp, mdat, atom("moov", mvhd, movTrack(chunkOffset, frameBytes))]);
}

const riff = (type: string, list: string | null, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat([...(list === null ? [] : [Buffer.from(list, "ascii")]), ...parts]);
  return Buffer.concat([Buffer.from(type, "ascii"), u32le(body.length), body]);
};
const chunkOf = (id: string, data: Buffer): Buffer =>
  Buffer.concat([Buffer.from(id, "ascii"), u32le(data.length), data, data.length % 2 === 1 ? zeros(1) : zeros(0)]);
const aviFrame = (index: number): Buffer => {
  const [r, g, b] = frameRgb(index),
    row = Buffer.alloc(VIDEO_WIDTH * 3);
  for (let x = 0; x < VIDEO_WIDTH; x += 1) row.set([b, g, r], x * 3);
  return Buffer.concat(Array.from({ length: VIDEO_HEIGHT }, () => row));
};

/** An AVI of VIDEO_FRAMES uncompressed DIB frames, with the idx1 index some importers insist on. */
export function rawAvi(): Buffer {
  const frames = Array.from({ length: VIDEO_FRAMES }, (_, index) => aviFrame(index)), frameBytes = frames[0]?.length ?? 0;
  const avih = chunkOf("avih", Buffer.concat([u32le(Math.round(1_000_000 / VIDEO_RATE)), zeros(4), zeros(4), u32le(0x10), u32le(VIDEO_FRAMES), zeros(4), u32le(1), u32le(frameBytes), u32le(VIDEO_WIDTH), u32le(VIDEO_HEIGHT), zeros(16)]));
  const strh = chunkOf("strh", Buffer.concat([Buffer.from("vids", "ascii"), Buffer.from("DIB ", "ascii"), zeros(4), zeros(4), zeros(4), u32le(1), u32le(VIDEO_RATE), zeros(4), u32le(VIDEO_FRAMES), u32le(frameBytes), u32le(0xffffffff), zeros(4), zeros(8)]));
  const strf = chunkOf("strf", Buffer.concat([u32le(40), u32le(VIDEO_WIDTH), u32le(VIDEO_HEIGHT), u16le(1), u16le(24), zeros(4), u32le(frameBytes), zeros(16)]));
  const hdrl = riff("LIST", "hdrl", avih, riff("LIST", "strl", strh, strf));
  const movi = riff("LIST", "movi", ...frames.map((frame) => chunkOf("00db", frame)));
  const idx1 = chunkOf("idx1", Buffer.concat(frames.map((_, index) => Buffer.concat([Buffer.from("00db", "ascii"), u32le(0x10), u32le(4 + index * (8 + frameBytes)), u32le(frameBytes)]))));
  return riff("RIFF", "AVI ", hdrl, movi, idx1);
}
