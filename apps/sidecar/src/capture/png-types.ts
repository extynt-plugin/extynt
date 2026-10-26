/** The pixel buffer the capture codecs share: 8-bit RGBA, straight (not premultiplied) alpha, row-major. */
export interface RawImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** The eight bytes every PNG file starts with. */
export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The last chunk of every complete PNG: length 0, "IEND", and its CRC. */
export const PNG_IEND_TAIL: readonly number[] = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
