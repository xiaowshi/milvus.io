/**
 * Scalar-field sizing shared by the v3 and v2.5 sizing pages.
 *
 * For every field in the schema table the calculator derives five byte
 * counts (raw, resident raw memory, resident index memory, mmap'd local disk,
 * object storage). The vector side of the tool is untouched; the callers just
 * add these numbers to their own results.
 */
import {
  ArraySubSchema,
  FIXED_FIELD_BYTES,
  FieldTypeEnum,
  NUMERIC_TYPES,
  SchemaField,
  VARIABLE_LENGTH_TYPES,
  createArraySubSchema,
} from '@/parts/sizingCommon/schema';
import {
  ScalarFieldSizing,
  ScalarIndexTypeEnum,
  ScalarSizingResult,
} from '@/types/sizingScalar';
import {
  BINLOG_OFFSET_BYTES,
  BINLOG_STORAGE_RATIO,
  BITMAP_ROARING_RATIO,
  DEFAULT_BITMAP_CARDINALITY,
  INVERTED_POSTING_BYTES_PER_ROW,
  INVERTED_STRING_DICT_RATIO,
  MEMORY_OFFSET_BYTES,
  MMAP_RESIDENT_RATIO,
  PK_STATS_BYTES_PER_ROW,
  STL_SORT_ROW_ID_BYTES,
  TRIE_RATIO,
} from '@/consts/sizingScalar';

/** Version-specific behaviour of scalar indexes. */
export interface ScalarVersionConfig {
  /** What AUTOINDEX resolves to for each field type. */
  autoIndexMap: Partial<Record<FieldTypeEnum, ScalarIndexTypeEnum>>;
  /** Whether `mmap.scalarIndex` exists (INVERTED only). */
  supportsScalarIndexMmap: boolean;
}

/** Milvus 2.5+ builds INVERTED for every AUTOINDEX scalar field. */
export const INVERTED_AUTO_INDEX_MAP: ScalarVersionConfig['autoIndexMap'] = {
  [FieldTypeEnum.Bool]: ScalarIndexTypeEnum.Inverted,
  [FieldTypeEnum.Int8]: ScalarIndexTypeEnum.Inverted,
  [FieldTypeEnum.Int16]: ScalarIndexTypeEnum.Inverted,
  [FieldTypeEnum.Int32]: ScalarIndexTypeEnum.Inverted,
  [FieldTypeEnum.Int64]: ScalarIndexTypeEnum.Inverted,
  [FieldTypeEnum.Float]: ScalarIndexTypeEnum.Inverted,
  [FieldTypeEnum.Double]: ScalarIndexTypeEnum.Inverted,
  [FieldTypeEnum.VarChar]: ScalarIndexTypeEnum.Inverted,
  [FieldTypeEnum.Array]: ScalarIndexTypeEnum.Inverted,
};

export const defaultScalarVersionConfig: ScalarVersionConfig = {
  autoIndexMap: INVERTED_AUTO_INDEX_MAP,
  supportsScalarIndexMmap: true,
};

const numberOrZero = (value: number | '' | undefined) =>
  typeof value === 'number' ? value : 0;

const emptySizing = (): ScalarFieldSizing => ({
  rawBytes: 0,
  loadedMemory: 0,
  indexMemory: 0,
  localDisk: 0,
  objectStorage: 0,
});

/** Raw bytes of one ARRAY element, on disk (`offset = 4`) or in memory (`offset = 8`). */
const arrayElementBytes = (sub: ArraySubSchema, offset: number) =>
  sub.elementType === FieldTypeEnum.VarChar
    ? numberOrZero(sub.averageLength) + offset
    : FIXED_FIELD_BYTES[sub.elementType] ?? 0;

/**
 * Bytes one row spends on the field's raw value.
 * Fixed-size types are stored as-is; variable-length values carry a per-row
 * offset, and ARRAY carries one offset per row plus one per VARCHAR element.
 */
export const rawBytesPerRow = (
  field: SchemaField,
  offset: number = BINLOG_OFFSET_BYTES
): number => {
  if (VARIABLE_LENGTH_TYPES.includes(field.fieldType)) {
    return numberOrZero(field.averageLength) + offset;
  }
  if (field.fieldType === FieldTypeEnum.Array) {
    const sub = field.subSchema ?? createArraySubSchema();
    return numberOrZero(sub.capacity) * arrayElementBytes(sub, offset) + offset;
  }
  return FIXED_FIELD_BYTES[field.fieldType] ?? 0;
};

/** Raw value bytes without offsets, used as the base of index estimates. */
const valueBytesPerRow = (field: SchemaField) => rawBytesPerRow(field, 0);

/** Resolves AUTOINDEX to the concrete type Milvus would build. */
export const resolveScalarIndex = (
  field: SchemaField,
  config: ScalarVersionConfig
): ScalarIndexTypeEnum => {
  if (field.primary) return ScalarIndexTypeEnum.None;
  if (field.index !== ScalarIndexTypeEnum.AutoIndex) return field.index;
  return config.autoIndexMap[field.fieldType] ?? ScalarIndexTypeEnum.None;
};

/** Index bytes per row for a resolved (non-AUTOINDEX) scalar index. */
export const indexBytesPerRow = (
  field: SchemaField,
  index: ScalarIndexTypeEnum
): number => {
  const value = valueBytesPerRow(field);
  const isNumeric =
    NUMERIC_TYPES.includes(field.fieldType) ||
    field.fieldType === FieldTypeEnum.Bool;

  switch (index) {
    case ScalarIndexTypeEnum.Inverted:
      // Posting lists cost ~4 B/row; the term dictionary is the value bytes
      // (numeric) or the string bytes with cardinality = rows (worst case).
      return (
        INVERTED_POSTING_BYTES_PER_ROW +
        (isNumeric ? value : value * INVERTED_STRING_DICT_RATIO)
      );
    case ScalarIndexTypeEnum.StlSort:
      return value + STL_SORT_ROW_ID_BYTES;
    case ScalarIndexTypeEnum.Trie:
      return value * TRIE_RATIO;
    case ScalarIndexTypeEnum.Bitmap: {
      const cardinality =
        typeof field.cardinality === 'number'
          ? field.cardinality
          : DEFAULT_BITMAP_CARDINALITY;
      // One bit per (distinct value, row), compressed by Roaring.
      return (cardinality / 8) * BITMAP_ROARING_RATIO;
    }
    default:
      return 0;
  }
};

export interface ScalarSizingParams {
  fields: SchemaField[];
  /** Entities in the collection (absolute count, not millions). */
  rows: number;
  /** `queryNode.mmap.scalarField`: memory-map raw scalar columns. */
  mmapScalarField: boolean;
  /** `queryNode.mmap.scalarIndex`: memory-map INVERTED scalar indexes. */
  mmapScalarIndex: boolean;
  config?: ScalarVersionConfig;
}

export const scalarFieldSizing = (
  field: SchemaField,
  params: Omit<ScalarSizingParams, 'fields'>
): ScalarFieldSizing => {
  const {
    rows,
    mmapScalarField,
    mmapScalarIndex,
    config = defaultScalarVersionConfig,
  } = params;

  const rawBytes = rawBytesPerRow(field, BINLOG_OFFSET_BYTES) * rows;
  const rawMemory = rawBytesPerRow(field, MEMORY_OFFSET_BYTES) * rows;

  const index = resolveScalarIndex(field, config);
  const indexBytes =
    (field.primary
      ? PK_STATS_BYTES_PER_ROW
      : indexBytesPerRow(field, index)) * rows;

  const indexIsMmapped =
    mmapScalarIndex &&
    config.supportsScalarIndexMmap &&
    index === ScalarIndexTypeEnum.Inverted;

  const loadedMemory = mmapScalarField
    ? rawMemory * MMAP_RESIDENT_RATIO
    : rawMemory;
  const indexMemory = indexIsMmapped
    ? indexBytes * MMAP_RESIDENT_RATIO
    : indexBytes;
  const localDisk =
    (mmapScalarField ? rawMemory : 0) + (indexIsMmapped ? indexBytes : 0);

  return {
    rawBytes,
    loadedMemory,
    indexMemory,
    localDisk,
    objectStorage: rawBytes * BINLOG_STORAGE_RATIO + indexBytes,
  };
};

/** Sizes the whole scalar schema; all fields are summed, `perField` keeps the detail. */
export const scalarSizingCalculator = (
  params: ScalarSizingParams
): ScalarSizingResult => {
  const { fields, rows } = params;
  const perField = fields.map(field => ({
    id: field.id,
    ...scalarFieldSizing(field, params),
  }));

  const total = perField.reduce<ScalarFieldSizing>((sum, f) => {
    sum.rawBytes += f.rawBytes;
    sum.loadedMemory += f.loadedMemory;
    sum.indexMemory += f.indexMemory;
    sum.localDisk += f.localDisk;
    sum.objectStorage += f.objectStorage;
    return sum;
  }, emptySizing());

  const rawObjectStorage = total.rawBytes * BINLOG_STORAGE_RATIO;

  return {
    ...total,
    perField,
    bytesPerRow: rows > 0 ? total.rawBytes / rows : 0,
    indexObjectStorage: total.objectStorage - rawObjectStorage,
  };
};

/** The result used when the scalar switch is off. */
export const emptyScalarSizing = (): ScalarSizingResult => ({
  ...emptySizing(),
  perField: [],
  bytesPerRow: 0,
  indexObjectStorage: 0,
});
