/**
 * Field-level schema model used by the sizing form to describe the scalar
 * part of a collection: a mandatory primary key row followed by optional
 * scalar rows, each with its type, size parameters and scalar index.
 * The numbers are derived in `@/utils/sizingScalar`.
 */
import { ScalarIndexTypeEnum } from '@/types/sizingScalar';
import { DEFAULT_BITMAP_CARDINALITY } from '@/consts/sizingScalar';

export enum FieldTypeEnum {
  Bool = 'BOOL',
  Int8 = 'INT8',
  Int16 = 'INT16',
  Int32 = 'INT32',
  Int64 = 'INT64',
  Float = 'FLOAT',
  Double = 'DOUBLE',
  VarChar = 'VARCHAR',
  Json = 'JSON',
  Array = 'ARRAY',
}

export interface ArraySubSchema {
  elementType: FieldTypeEnum;
  /** Average number of elements per row; '' while the input is empty. */
  capacity: number | '';
  /** Average length of each VARCHAR element; '' while the input is empty. */
  averageLength: number | '';
}

export interface SchemaField {
  id: string;
  fieldType: FieldTypeEnum;
  primary: boolean;
  /** VARCHAR / JSON only; '' while the input is empty or the type is fixed-size. */
  averageLength: number | '';
  /** ARRAY only. */
  subSchema?: ArraySubSchema;
  /** Scalar index built on the field; the primary key only carries segment stats. */
  index: ScalarIndexTypeEnum;
  /** Distinct values, BITMAP only; '' while the input is empty. */
  cardinality: number | '';
}

/** Bytes per row for fixed-size types. Variable-size types use the entered average length. */
export const FIXED_FIELD_BYTES: Partial<Record<FieldTypeEnum, number>> = {
  [FieldTypeEnum.Bool]: 1,
  [FieldTypeEnum.Int8]: 1,
  [FieldTypeEnum.Int16]: 2,
  [FieldTypeEnum.Int32]: 4,
  [FieldTypeEnum.Int64]: 8,
  [FieldTypeEnum.Float]: 4,
  [FieldTypeEnum.Double]: 8,
};

export const VARIABLE_LENGTH_TYPES = [FieldTypeEnum.VarChar, FieldTypeEnum.Json];

export const INTEGER_TYPES = [
  FieldTypeEnum.Int8,
  FieldTypeEnum.Int16,
  FieldTypeEnum.Int32,
  FieldTypeEnum.Int64,
];

export const NUMERIC_TYPES = [
  ...INTEGER_TYPES,
  FieldTypeEnum.Float,
  FieldTypeEnum.Double,
];

/** Milvus primary keys must be INT64 or VARCHAR. */
export const PRIMARY_KEY_TYPE_OPTIONS = [
  { label: 'VARCHAR', value: FieldTypeEnum.VarChar },
  { label: 'INT64', value: FieldTypeEnum.Int64 },
];

export const SCALAR_FIELD_TYPE_OPTIONS = [
  { label: 'VARCHAR', value: FieldTypeEnum.VarChar },
  { label: 'INT8', value: FieldTypeEnum.Int8 },
  { label: 'INT16', value: FieldTypeEnum.Int16 },
  { label: 'INT32', value: FieldTypeEnum.Int32 },
  { label: 'INT64', value: FieldTypeEnum.Int64 },
  { label: 'FLOAT', value: FieldTypeEnum.Float },
  { label: 'DOUBLE', value: FieldTypeEnum.Double },
  { label: 'BOOL', value: FieldTypeEnum.Bool },
  { label: 'JSON', value: FieldTypeEnum.Json },
  { label: 'ARRAY', value: FieldTypeEnum.Array },
];

/** Element types Milvus allows inside an ARRAY field. */
export const ARRAY_ELEMENT_TYPE_OPTIONS = SCALAR_FIELD_TYPE_OPTIONS.filter(
  option =>
    option.value !== FieldTypeEnum.Json && option.value !== FieldTypeEnum.Array
);

/**
 * Scalar index types Milvus accepts per field type. JSON only supports path
 * indexes, which the tool does not model yet, so it gets none.
 */
export const scalarIndexOptionsForType = (
  fieldType: FieldTypeEnum
): ScalarIndexTypeEnum[] => {
  const { None, AutoIndex, Inverted, Bitmap, StlSort, Trie } =
    ScalarIndexTypeEnum;
  if (INTEGER_TYPES.includes(fieldType)) {
    return [None, AutoIndex, Inverted, StlSort, Bitmap];
  }
  if (fieldType === FieldTypeEnum.Float || fieldType === FieldTypeEnum.Double) {
    return [None, AutoIndex, Inverted, StlSort];
  }
  switch (fieldType) {
    case FieldTypeEnum.VarChar:
      return [None, AutoIndex, Inverted, Trie, Bitmap];
    case FieldTypeEnum.Bool:
      return [None, AutoIndex, Bitmap, Inverted];
    case FieldTypeEnum.Array:
      return [None, AutoIndex, Inverted, Bitmap];
    default:
      return [None];
  }
};

export const MIN_AVERAGE_LENGTH = 1;
export const MAX_AVERAGE_LENGTH = 65535;
export const MIN_ARRAY_CAPACITY = 0;
export const MAX_ARRAY_CAPACITY = 4096;
export const MAX_FIELD_COUNT = 63;
export const DEFAULT_AVERAGE_LENGTH = 32;

let fieldSeq = 0;
const nextFieldId = () => `field-${++fieldSeq}`;

export const createPrimaryKeyField = (): SchemaField => ({
  id: 'primary-key',
  fieldType: FieldTypeEnum.VarChar,
  primary: true,
  averageLength: DEFAULT_AVERAGE_LENGTH,
  index: ScalarIndexTypeEnum.None,
  cardinality: '',
});

export const createScalarField = (): SchemaField => ({
  id: nextFieldId(),
  fieldType: FieldTypeEnum.Int8,
  primary: false,
  averageLength: '',
  index: ScalarIndexTypeEnum.None,
  cardinality: '',
});

export const createArraySubSchema = (): ArraySubSchema => ({
  elementType: FieldTypeEnum.VarChar,
  capacity: '',
  averageLength: '',
});

/** Resets the type-dependent parts of a field when its type changes. */
export const retypeField = (
  field: SchemaField,
  fieldType: FieldTypeEnum
): SchemaField => {
  const allowed = scalarIndexOptionsForType(fieldType);
  return {
    ...field,
    fieldType,
    averageLength: VARIABLE_LENGTH_TYPES.includes(fieldType)
      ? typeof field.averageLength === 'number'
        ? field.averageLength
        : DEFAULT_AVERAGE_LENGTH
      : '',
    subSchema:
      fieldType === FieldTypeEnum.Array ? createArraySubSchema() : undefined,
    index: allowed.includes(field.index) ? field.index : ScalarIndexTypeEnum.None,
  };
};

/** Applies an index choice; BITMAP needs a cardinality to estimate against. */
export const reindexField = (
  field: SchemaField,
  index: ScalarIndexTypeEnum
): SchemaField => ({
  ...field,
  index,
  cardinality:
    index === ScalarIndexTypeEnum.Bitmap
      ? typeof field.cardinality === 'number'
        ? field.cardinality
        : DEFAULT_BITMAP_CARDINALITY
      : field.cardinality,
});

export const defaultSchemaFields = (): SchemaField[] => [createPrimaryKeyField()];

/** Clamps a raw input value; keeps '' so the user can clear the box. */
export const clampFieldNumber = (
  raw: string,
  min: number,
  max: number
): number | '' | undefined => {
  if (raw === '') return '';
  const num = Number(raw);
  if (Number.isNaN(num)) return undefined;
  return Math.min(max, Math.max(min, Math.floor(num)));
};
