import { useEffect, useMemo, useRef, useState } from 'react';
import classes from './index.module.css';
import {
  SizingInput,
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
import { IndexTypeComponent } from './indexTypeComponent';
import { Trans, useTranslation } from 'react-i18next';
import { TooltipArrow } from '@radix-ui/react-tooltip';
import { ExternalLinkIcon } from '@/components/icons';
import { SizingVersionConfig } from './types';

interface FormSectionProps {
  className: string;
  config: SizingVersionConfig;
  onCalculatedResult: (params: any) => void;
  disableCalculationThreshold?: boolean;
}

export default function FormSection(props: FormSectionProps) {
  const { t } = useTranslation('sizingTool');
  const { className, config, onCalculatedResult, disableCalculationThreshold = false } = props;

  const {
    VECTOR_RANGE_CONFIG,
    DIMENSION_RANGE_CONFIG,
    SEGMENT_SIZE_OPTIONS,
    INDEX_TYPE_OPTIONS,
    N_LIST_RANGE_CONFIG,
    MAX_NODE_DEGREE_RANGE_CONFIG,
    M_RANGE_CONFIG,
    MAXIMUM_AVERAGE_LENGTH,
    REFINE_OPTIONS,
  } = config.consts;

  const {
    ModeEnum,
    IndexTypeEnum,
    DependencyComponentEnum,
    RefineValueEnum,
  } = config.types;

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

  const [refine, setRefine] = useState(
    config.supportsRabitq && REFINE_OPTIONS ? REFINE_OPTIONS[0].value : null
  );

  const [form, setForm] = useState({
    vector: VECTOR_RANGE_CONFIG.defaultValue,
    dimension: DIMENSION_RANGE_CONFIG.defaultValue,
    widthScalar: false,
    scalarData: {
      averageNum: 0,
      averageString: '',
      offLoading: false,
    },
    segmentSize: SEGMENT_SIZE_OPTIONS[1].value,
    // Only the distributed / Kafka deployment is estimated.
    dependency: DependencyComponentEnum.Kafka,
    mode: ModeEnum.Cluster,
  });

  const initialIndexTypeParams = useMemo(() => {
    const base: any = {
      indexType: INDEX_TYPE_OPTIONS[0].value,
      widthRawData: false,
      maxDegree: MAX_NODE_DEGREE_RANGE_CONFIG.defaultValue,
      inlinePq: MAX_NODE_DEGREE_RANGE_CONFIG.defaultValue,
      flatNList: N_LIST_RANGE_CONFIG.defaultValue,
      sq8NList: N_LIST_RANGE_CONFIG.defaultValue,
      m: M_RANGE_CONFIG.defaultValue,
    };
    if (config.supportsRabitq) {
      base.rabitqNList = N_LIST_RANGE_CONFIG.defaultValue;
    }
    return base;
  }, [config.supportsRabitq]);

  const [indexTypeParams, setIndexTypeParams] = useState(initialIndexTypeParams);

  const handleRefineChange = (value: any) => {
    setRefine(value);
  };

  const handleFormChange = (key: string, value: any) => {
    setForm({
      ...form,
      [key]: value,
    });
  };

  const handleIndexTypeParamsChange = (key: string, value: any) => {
    setIndexTypeParams({
      ...indexTypeParams,
      [key]: value,
    });
  };

  const handleAverageLengthChange = (e: any) => {
    let lengthString = e.target.value;
    let lengthNum = Number(lengthString);
    if (Number.isNaN(lengthNum) && lengthString !== '') {
      return;
    }
    if (lengthString === '') {
      lengthNum = 0;
    }

    if (Number(lengthString) > MAXIMUM_AVERAGE_LENGTH) {
      lengthString = `${MAXIMUM_AVERAGE_LENGTH}`;
    }
    setForm({
      ...form,
      scalarData: {
        ...form.scalarData,
        averageNum: lengthNum,
        averageString: lengthString,
      },
    });
  };

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
          averageString: '',
          averageNum: 0,
          offLoading: false,
        },
      });
    }
  }, [form.widthScalar]);

  useEffect(() => {
    const rawDataSize = rawDataSizeCalculator({
      num: form.vector,
      d: form.dimension,
      withScalar: form.widthScalar,
      scalarAvg: form.scalarData.averageNum,
    });
    setRawDataSize(rawDataSize);
  }, [
    form.vector,
    form.dimension,
    form.widthScalar,
    form.scalarData.averageNum,
  ]);

  useEffect(() => {
    const currentMode = form.mode;

    const calculatorParams: any = {
      rawDataSize,
      indexTypeParams,
      d: form.dimension,
      num: form.vector,
      withScalar: form.widthScalar,
      offLoading: form.scalarData.offLoading,
      scalarAvg: form.scalarData.averageNum,
      segSize: Number(form.segmentSize),
      mode: currentMode,
    };

    // Add refineType for v3
    if (config.supportsRabitq && refine) {
      calculatorParams.refineType = refine;
    }

    const { memory, disk: localDisk } = memoryAndDiskCalculator(calculatorParams);

    const standaloneNodeConfig = standaloneNodeConfigCalculator({
      memory: memory,
    });

    const clusterNodeConfig = clusterNodesConfigCalculator({
      memory: memory,
    });

    const dependencyParams: any = {
      num: form.vector,
      d: form.dimension,
      withScalar: form.widthScalar,
      scalarAvg: form.scalarData.averageNum,
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
  }, [form, indexTypeParams, refine]);

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
        <div className="mb-[24px]">
          <SizingRange
            rangeConfig={DIMENSION_RANGE_CONFIG}
            label={t('form.dim')}
            onRangeChange={val => {
              handleFormChange('dimension', val);
            }}
            value={form.dimension}
            placeholder={`[${DIMENSION_RANGE_CONFIG.min}, ${DIMENSION_RANGE_CONFIG.max}]`}
          />
        </div>
        <div className="mb-[24px]">
          <h4 className="flex items-center justify-between mb-[8px]">
            <span className="font-[600] text-[14px] leading-[22px] text-black1">
              {t('form.indexType')}
            </span>
            <a
              className="flex items-center gap-[4px] font-[400] text-[12px] leading-[16px] text-black1 hover:underline"
              href="/docs/index.md?tab=floating"
              target="_blank"
            >
              {t('form.indexTypeTip')}
              <ExternalLinkIcon />
            </a>
          </h4>

          <Select
            value={indexTypeParams.indexType}
            onValueChange={val => {
              handleIndexTypeParamsChange('indexType', val);
            }}
          >
            <SelectTrigger className={classes.selectTrigger}>
              {indexTypeParams.indexType}
            </SelectTrigger>
            <SelectContent>
              {INDEX_TYPE_OPTIONS.map((v: any) => (
                <SelectItem
                  key={v.value}
                  value={v.value}
                  className={classes.selectItem}
                >
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <IndexTypeComponent
            data={indexTypeParams}
            onChange={handleIndexTypeParamsChange}
            config={config}
            refine={refine}
            onRefineChange={handleRefineChange}
          />
        </div>
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
              <SizingInput
                label={t('form.averageLength')}
                unit={t('setup.basic.byte')}
                value={form.scalarData.averageString}
                onChange={handleAverageLengthChange}
                fullWidth
                classes={{
                  root: classes.marginBtm20,
                  label: classes.averageLabel,
                }}
                placeholder="[ 0, 60,000,000 ]"
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
