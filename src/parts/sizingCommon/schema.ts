/**
 * Field-level schema model used by the sizing form to derive the average
 * scalar bytes per row. Mirrors the field table of the Zilliz Cloud pricing
 * calculator: a mandatory primary key row followed by optional scalar rows.
 */
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
  /** VARCHAR / JSON only; '' while the input is empty. */
  averageLength: number | '';
  /** ARRAY only. */
  subSchema?: ArraySubSchema;
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
});

export const createScalarField = (): SchemaField => ({
  id: nextFieldId(),
  fieldType: FieldTypeEnum.Int8,
  primary: false,
  averageLength: DEFAULT_AVERAGE_LENGTH,
});

export const createArraySubSchema = (): ArraySubSchema => ({
  elementType: FieldTypeEnum.VarChar,
  capacity: '',
  averageLength: '',
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

const numberOrZero = (value: number | '' | undefined) =>
  typeof value === 'number' ? value : 0;

const elementBytes = (sub: ArraySubSchema) =>
  sub.elementType === FieldTypeEnum.VarChar
    ? numberOrZero(sub.averageLength)
    : FIXED_FIELD_BYTES[sub.elementType] ?? 0;

/** Average bytes one row spends on a single field. */
export const fieldBytesPerRow = (field: SchemaField): number => {
  if (VARIABLE_LENGTH_TYPES.includes(field.fieldType)) {
    return numberOrZero(field.averageLength);
  }
  if (field.fieldType === FieldTypeEnum.Array) {
    const sub = field.subSchema ?? createArraySubSchema();
    return numberOrZero(sub.capacity) * elementBytes(sub);
  }
  return FIXED_FIELD_BYTES[field.fieldType] ?? 0;
};

/** Average scalar bytes per row across the whole schema. */
export const schemaBytesPerRow = (fields: SchemaField[]): number =>
  fields.reduce((sum, field) => sum + fieldBytesPerRow(field), 0);
