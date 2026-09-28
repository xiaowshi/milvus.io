import { SizingVersionConfig } from './types';

/**
 * Per-vector-field sizing input. Milvus lets a collection hold several vector
 * fields (proxy.maxVectorFieldNum, default 10, since 2.4.0); each one is
 * indexed and loaded independently, so memory / disk are summed per field
 * while the row count stays collection-wide.
 */
export interface VectorIndexParams {
  indexType: string;
  widthRawData: boolean;
  maxDegree: number;
  inlinePq: number;
  flatNList: number;
  sq8NList: number;
  m: number;
  rabitqNList?: number;
}

export interface VectorFieldConfig {
  id: string;
  dimension: number;
  indexTypeParams: VectorIndexParams;
  /** RABITQ refine type; only meaningful on versions with supportsRabitq. */
  refineType: string | null;
}

/** Mirrors the default of proxy.maxVectorFieldNum in milvus.yaml. */
export const MAX_VECTOR_FIELD_COUNT = 10;

let vectorFieldSeq = 0;
const nextVectorFieldId = () => `vector-field-${++vectorFieldSeq}`;

export const createVectorIndexParams = (
  config: SizingVersionConfig
): VectorIndexParams => {
  const {
    INDEX_TYPE_OPTIONS,
    MAX_NODE_DEGREE_RANGE_CONFIG,
    N_LIST_RANGE_CONFIG,
    M_RANGE_CONFIG,
  } = config.consts;
  const params: VectorIndexParams = {
    indexType: INDEX_TYPE_OPTIONS[0].value,
    widthRawData: false,
    maxDegree: MAX_NODE_DEGREE_RANGE_CONFIG.defaultValue,
    inlinePq: MAX_NODE_DEGREE_RANGE_CONFIG.defaultValue,
    flatNList: N_LIST_RANGE_CONFIG.defaultValue,
    sq8NList: N_LIST_RANGE_CONFIG.defaultValue,
    m: M_RANGE_CONFIG.defaultValue,
  };
  if (config.supportsRabitq) {
    params.rabitqNList = N_LIST_RANGE_CONFIG.defaultValue;
  }
  return params;
};

export const createVectorField = (
  config: SizingVersionConfig
): VectorFieldConfig => ({
  id: nextVectorFieldId(),
  dimension: config.consts.DIMENSION_RANGE_CONFIG.defaultValue,
  indexTypeParams: createVectorIndexParams(config),
  refineType:
    config.supportsRabitq && config.consts.REFINE_OPTIONS
      ? config.consts.REFINE_OPTIONS[0].value
      : null,
});

export const defaultVectorFields = (
  config: SizingVersionConfig
): VectorFieldConfig[] => [createVectorField(config)];

/** Raw data is linear in dimension, so the summed dimension feeds the existing calculators unchanged. */
export const totalDimension = (fields: VectorFieldConfig[]): number =>
  fields.reduce((sum, field) => sum + field.dimension, 0);
