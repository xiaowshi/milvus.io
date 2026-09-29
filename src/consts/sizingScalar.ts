/**
 * Coefficients for the scalar-field part of the sizing tool. Every number here
 * is a conservative estimate rather than a published formula; keep them in one
 * place so they can be tuned without touching the calculator.
 *
 * Sources: docs/userGuide/search-query-get/mmap.md, docs/reference/scalar_index.md,
 * docs/userGuide/indexes/scalar/bitmap.md, and the existing `/10` used by the
 * sizing tool before scalar fields were modelled per type.
 */

/** Per-row offset stored next to a variable-length value in binlog (uint32). */
export const BINLOG_OFFSET_BYTES = 4;

/** Per-row offset kept by the in-memory variable-length column (uint64). */
export const MEMORY_OFFSET_BYTES = 8;

/** Validity bitmap for nullable fields: one bit per row. */
export const NULLABLE_BITMAP_BYTES_PER_ROW = 1 / 8;

/**
 * Share of an mmap'd file that is assumed to stay resident in page cache.
 * Kept equal to the historical `/10` of the tool; treated as an empirical value.
 */
export const MMAP_RESIDENT_RATIO = 0.1;

/**
 * Binlog (Parquet) is compressed on object storage. 1.0 is deliberately
 * conservative; lower it once real bucket usage is available.
 */
export const BINLOG_STORAGE_RATIO = 1.0;

/** Tantivy bit-packs doc ids; ~4 bytes per row for the posting lists. */
export const INVERTED_POSTING_BYTES_PER_ROW = 4;

/** Term dictionary of a string INVERTED index relative to the raw string bytes (cardinality = rows, worst case). */
export const INVERTED_STRING_DICT_RATIO = 1.0;

/** STL_SORT keeps (value, rowId) pairs; the row id is a uint32. */
export const STL_SORT_ROW_ID_BYTES = 4;

/** Trie shares prefixes, but stays close to raw size in the worst case. */
export const TRIE_RATIO = 1.0;

/** Roaring bitmaps compress the raw `cardinality × rows / 8` bitmap to roughly this share. */
export const BITMAP_ROARING_RATIO = 0.3;

/** Milvus docs recommend BITMAP only below this cardinality. */
export const BITMAP_RECOMMENDED_MAX_CARDINALITY = 500;

export const DEFAULT_BITMAP_CARDINALITY = 100;
export const MIN_CARDINALITY = 1;
export const MAX_CARDINALITY = 100000;

/** Per-segment primary-key statistics (bloom filter + min/max) amortised per row. */
export const PK_STATS_BYTES_PER_ROW = 2;
