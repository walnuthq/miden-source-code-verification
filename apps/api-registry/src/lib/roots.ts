// Account code roots and note script roots are 32-byte hashes, rendered as `0x`
// followed by 64 hex characters. Account ids are shorter, so checking the shape
// turns the easy mistake of addressing a code-keyed endpoint with an id into a
// clear 400 rather than a puzzling 404.
const ROOT_PATTERN = /^0x[0-9a-f]{64}$/i;

/**
 * Validates a 32-byte hex root and normalizes it to the lowercase form the
 * registry stores, so lookups are case-insensitive. Returns `undefined` when
 * the value isn't a root.
 */
export const parseRoot = (value: string) =>
  ROOT_PATTERN.test(value) ? value.toLowerCase() : undefined;
