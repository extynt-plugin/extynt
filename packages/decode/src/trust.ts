// The single place the library tells the compiler what its own validation has already proven.

/** Narrows a value the caller's decoders have just validated to the type those decoders promise. */
export function assertDecoded<T>(value: unknown): asserts value is T {}
