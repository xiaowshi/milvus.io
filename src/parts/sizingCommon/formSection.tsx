import { useEffect, useMemo, useRef, useState } from 'react';
import classes from './index.module.css';
import {
  SizingRange,
  SizingSwitch,
} from '@/components/sizing';
import {
  Collapsible,
  Checkbox,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import clsx from 'clsx';
import { Trans, useTranslation } from 'react-i18next';
import { TooltipArrow } from '@radix-ui/react-tooltip';
import { SizingVersionConfig } from './types';
import { SchemaFields } from './schemaFields';
import { SchemaField, defaultSchemaFields, schemaBytesPerRow } from './schema';
import { VectorFields } from './vectorFields';
import {
  VectorFieldConfig,
  defaultVectorFields,
  totalDimension,
} from './vectorFieldSchema';

interface FormSectionProps {
  className: string;
  config: SizingVersionConfig;
  onCalculatedResult: (params: any) => void;
  disableCalculationThreshold?: boolean;
}

export default function FormSection(props: FormSectionProps) {
  const { t } = useTranslation('sizingTool');
  const { className, config, onCalculatedResult, disableCalculationThreshold = false } = props;

  const { VECTOR_RANGE_CONFIG, SEGMENT_SIZE_OPTIONS } = config.consts;

  const { ModeEnum, DependencyComponentEnum } = config.types;

  const {
    memoryAndDiskCalculator,
    rawDataSizeCalculator,
    $1B768D,
    dependencyCalculator,
    clusterNodesConfigCalculator,
    standaloneNodeConfigCalculator,
  } = config.utils;

  const collapseEle = useRef<HTMLDivElement | null>(null);

  const [rawDataSize, setRawDataSize] = useState(0);

  const [form, setForm] = useState({
    vector: VECTOR_RANGE_CONFIG.defaultValue,
    vectorFields: defaultVectorFields(config) as VectorFieldConfig[],
    widthScalar: false,
    scalarData: {
      fields: defaultSchemaFields() as SchemaField[],
      offLoading: false,
    },
    segmentSize: SEGMENT_SIZE_OPTIONS[1].value,
    // Only the distributed / Kafka deployment is estimated.
    dependency: DependencyComponentEnum.Kafka,
    mode: ModeEnum.Cluster,
  });

  const handleFormChange = (key: string, value: any) => {
    setForm({
      ...form,
      [key]: value,
    });
  };

  const handleVectorFieldsChange = (vectorFields: VectorFieldConfig[]) => {
    setForm({
      ...form,
      vectorFields,
    });
  };

  // Raw data is linear in dimension, so the summed dimension of all vector
  // fields drives the collection-level calculators.
  const dimension = useMemo(
    () => totalDimension(form.vectorFields),
    [form.vectorFields]
  );

  const handleSchemaChange = (fields: SchemaField[]) => {
    setForm({
      ...form,
      scalarData: {
        ...form.scalarData,
        fields,
      },
    });
  };

  // Average scalar bytes per row, derived from the field table.
  const scalarAvg = useMemo(
    () =>
      form.widthScalar ? schemaBytesPerRow(form.scalarData.fields) : 0,
    [form.widthScalar, form.scalarData.fields]
  );

  const handleOffLoadingChange = (value: boolean) => {
    setForm({
      ...form,
      scalarData: {
        ...form.scalarData,
        offLoading: value,
      },
    });
  };

  const selectedSegmentSize = useMemo(() => {
    return SEGMENT_SIZE_OPTIONS.find((v: any) => v.value === form.segmentSize);
  }, [form.segmentSize]);

  useEffect(() => {
    if (form.widthScalar === false) {
      setForm({
        ...form,
        scalarData: {
          fields: defaultSchemaFields(),
          offLoading: false,
        },
      });
    }
  }, [form.widthScalar]);

  useEffect(() => {
    const rawDataSize = rawDataSizeCalculator({
      num: form.vector,
      d: dimension,
      withScalar: form.widthScalar,
      scalarAvg,
    });
    setRawDataSize(rawDataSize);
  }, [form.vector, dimension, form.widthScalar, scalarAvg]);

  useEffect(() => {
    const currentMode = form.mode;

    const calculatorParams: any = {
      rawDataSize,
      vectorFields: form.vectorFields.map(field => ({
        d: field.dimension,
        indexTypeParams: field.indexTypeParams,
        // refineType only matters for RABITQ on versions that support it
        refineType: config.supportsRabitq ? field.refineType : undefined,
      })),
      num: form.vector,
      withScalar: form.widthScalar,
      offLoading: form.scalarData.offLoading,
      scalarAvg,
      segSize: Number(form.segmentSize),
      mode: currentMode,
    };

    const { memory, disk: localDisk } = memoryAndDiskCalculator(calculatorParams);

    const standaloneNodeConfig = standaloneNodeConfigCalculator({
      memory: memory,
    });

    const clusterNodeConfig = clusterNodesConfigCalculator({
      memory: memory,
    });

    const dependencyParams: any = {
      num: form.vector,
      d: dimension,
      withScalar: form.widthScalar,
      scalarAvg,
      mode: currentMode,
      loadingMemory: memory,
    };

    // Add dependency for v3
    if (config.supportsWoodpecker) {
      dependencyParams.dependency = form.dependency;
    }

    const dependencyConfig = dependencyCalculator(dependencyParams);

    onCalculatedResult({
      rawDataSize,
      memorySize: memory,
      localDiskSize: localDisk,
      clusterNodeConfig,
      standaloneNodeConfig,
      dependencyConfig: dependencyConfig,
      mode: currentMode,
      dependency: form.dependency,
      isOutOfCalculate: disableCalculationThreshold ? false : rawDataSize > $1B768D,
    });
  }, [form, rawDataSize]);

  return (
    <section className={clsx(className, classes.formSection)}>
      <div className={classes.singlePart}>
        <div className="mb-[24px]">
          <SizingRange
            rangeConfig={VECTOR_RANGE_CONFIG}
            label={t('form.num')}
            onRangeChange={val => {
              handleFormChange('vector', val);
            }}
            value={form.vector}
            unit="Million"
          />
        </div>
        <VectorFields
          fields={form.vectorFields}
          onChange={handleVectorFieldsChange}
          config={config}
        />
        <div className="">
          <div className="flex items-center gap-[8px]">
            <p className="text-[14px] leading-[22px] font-[600]">
              {t('form.withScalar')}
            </p>
            <SizingSwitch
              checked={form.widthScalar}
              onCheckedChange={value => {
                handleFormChange('widthScalar', value);
              }}
            />
          </div>
          <Collapsible
            open={form.widthScalar}
            className={clsx(classes.collapsible, {
              [classes.visibleCollapse]: form.widthScalar,
              [classes.invisibleCollapse]: !form.widthScalar,
            })}
          >
            <div className="" ref={collapseEle}>
              <SchemaFields
                fields={form.scalarData.fields}
                onChange={handleSchemaChange}
              />
              <div>
                <div className="flex items-center gap-[8px] mb-[8px]">
                  <Checkbox
                    checked={form.scalarData.offLoading}
                    onCheckedChange={handleOffLoadingChange}
                  />
                  <p className="text-[12px] leading-[18px] font-[500]">
                    {t('form.offloading')}
                  </p>
                </div>
                <p className={classes.offLoadingDesc}>
                  <Trans
                    t={t}
                    i18nKey="form.mmp"
                    components={[<a href="/docs/mmap.md" key="mmp"></a>]}
                  />
                </p>
              </div>
            </div>
          </Collapsible>
        </div>
      </div>
      <div className={clsx(classes.singlePart, 'pb-[24px]')}>
        <div className="mb-[24px]">
          <h4 className="">
            <TooltipProvider>
              <Tooltip delayDuration={0}>
                <TooltipTrigger
                  className={clsx(
                    'text-[14px] font-[600] leading-[22px] mb-[8px]',
                    classes.tooltipTrigger
                  )}
                >
                  {t('form.segmentSize')}
                </TooltipTrigger>
                <TooltipContent className="w-[280px]">
                  <Trans
                    t={t}
                    i18nKey="form.segmentTooltip"
                    components={[
                      <a
                        href="/docs/configure_datacoord.md#dataCoordsegmentmaxSize"
                        key="backup-restore"
                        className={classes.tooltipLink}
                      ></a>,
                    ]}
                  />
                  <TooltipArrow />
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </h4>
          <Select
            value={form.segmentSize}
            onValueChange={val => {
              handleFormChange('segmentSize', val);
            }}
          >
            <SelectTrigger className={classes.selectTrigger}>
              {selectedSegmentSize?.label}
            </SelectTrigger>
            <SelectContent>
              {SEGMENT_SIZE_OPTIONS.map((v: any) => (
                <SelectItem key={v.value} value={v.value}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="mt-[36px] text-[12px]  leading-[18px] text-black2">
          <Trans
            t={t}
            i18nKey="tooltip"
            components={[<span key="note" className="font-[600]"></span>]}
          />
        </p>
      </div>
    </section>
  );
}
