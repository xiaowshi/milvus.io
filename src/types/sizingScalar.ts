/** Scalar index types the sizing form lets the user pick per field. */
export enum ScalarIndexTypeEnum {
  None = 'NONE',
  AutoIndex = 'AUTOINDEX',
  Inverted = 'INVERTED',
  Bitmap = 'BITMAP',
  StlSort = 'STL_SORT',
  Trie = 'TRIE',
}

/** Bytes one scalar field (or the whole schema) contributes to each sizing bucket. */
export interface ScalarFieldSizing {
  /** Logical raw data; feeds Raw Data Size and the message queue. */
  rawBytes: number;
  /** QueryNode resident memory spent on the field's raw column. */
  loadedMemory: number;
  /** QueryNode resident memory spent on the field's scalar index. */
  indexMemory: number;
  /** Bytes that mmap moves onto the QueryNode local disk (raw + index). */
  localDisk: number;
  /** Object storage: binlog plus index files. */
  objectStorage: number;
}

export interface ScalarSizingResult extends ScalarFieldSizing {
  perField: Array<ScalarFieldSizing & { id: string }>;
  /** Raw bytes per row; keeps the legacy `scalarAvg` consumers working. */
  bytesPerRow: number;
  /** Index files on object storage only, so the S3 formula can add them explicitly. */
  indexObjectStorage: number;
}

/** How the calculators split the final memory / disk numbers, for the result panel. */
export interface SizingBreakdown {
  vectorRawData: number;
  vectorIndexMemory: number;
  segmentBufferMemory: number;
  scalarRawData: number;
  scalarRawMemory: number;
  scalarIndexMemory: number;
  scalarLocalDisk: number;
  vectorIndexDisk: number;
}
