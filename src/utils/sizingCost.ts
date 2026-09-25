import { PricingPlanEnum } from '@/parts/sizingCommon/types';

/**
 * Monthly unit prices in CNY.
 *
 * Milvus CPU / memory / storage are billed against the pool selected by the
 * pricing plan (dedicated: di-olap-milvus; shared: SG public pool). S3 disk is
 * billed against ozone-sg-dedicated / ozone-sg-public. Kafka storage uses
 * kafka-sg-live for both plans.
 */
export const MONTHLY_UNIT_PRICES: Record<
  PricingPlanEnum,
  {
    milvusCpuPerCore: number;
    milvusMemoryPerGiB: number;
    milvusStoragePerGB: number;
    s3DiskPerGB: number;
    kafkaStoragePerGB: number;
  }
> = {
  [PricingPlanEnum.Dedicated]: {
    milvusCpuPerCore: 62.5,
    milvusMemoryPerGiB: 9.8,
    milvusStoragePerGB: 0.42,
    s3DiskPerGB: 0.031,
    kafkaStoragePerGB: 0.048,
  },
  [PricingPlanEnum.Shared]: {
    milvusCpuPerCore: 41,
    milvusMemoryPerGiB: 7.4,
    milvusStoragePerGB: 0.28,
    s3DiskPerGB: 0.022,
    kafkaStoragePerGB: 0.048,
  },
};

export interface MonthlyCostParams {
  plan: PricingPlanEnum;
  milvusCpuCores: number;
  milvusMemoryGiB: number;
  milvusStorageGB: number;
  s3DiskGB: number;
  kafkaStorageGB: number;
}

export interface MonthlyCostBreakdown {
  milvusCpu: number;
  milvusMemory: number;
  milvusStorage: number;
  s3Disk: number;
  kafkaStorage: number;
  total: number;
}

export const estimateMonthlyCost = (
  params: MonthlyCostParams
): MonthlyCostBreakdown => {
  const {
    plan,
    milvusCpuCores,
    milvusMemoryGiB,
    milvusStorageGB,
    s3DiskGB,
    kafkaStorageGB,
  } = params;
  const price = MONTHLY_UNIT_PRICES[plan] ?? MONTHLY_UNIT_PRICES[PricingPlanEnum.Shared];

  const milvusCpu = milvusCpuCores * price.milvusCpuPerCore;
  const milvusMemory = milvusMemoryGiB * price.milvusMemoryPerGiB;
  const milvusStorage = milvusStorageGB * price.milvusStoragePerGB;
  const s3Disk = s3DiskGB * price.s3DiskPerGB;
  const kafkaStorage = kafkaStorageGB * price.kafkaStoragePerGB;

  return {
    milvusCpu,
    milvusMemory,
    milvusStorage,
    s3Disk,
    kafkaStorage,
    total: milvusCpu + milvusMemory + milvusStorage + s3Disk + kafkaStorage,
  };
};

/** Formats a CNY amount as `¥12,345.67`; fixed en-US grouping keeps SSR and client output identical. */
export const formatCny = (amount: number) =>
  `¥${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
