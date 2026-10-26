// The size bounds shared by the capture contract and the frame analysis, so both refuse the same frames.

/** The longest side, in pixels, a capture may ask for and a frame may carry. */
export const MAX_FRAME_SIDE = 4096;

/** The shortest side a capture may ask for. */
export const MIN_CAPTURE_SIDE = 16;

/** The most pixels the frame analysis will look at. */
export const MAX_ANALYSIS_PIXELS = MAX_FRAME_SIDE * MAX_FRAME_SIDE;
