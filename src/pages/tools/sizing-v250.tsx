import React, { useEffect, useMemo, useState } from 'react';
import i18next from 'i18next';
import { I18nextProvider, useTranslation } from 'react-i18next';
import classes from '@/styles/sizingTool.module.css';
import pageClasses from '@/styles/responsive.module.css';
import clsx from 'clsx';
import Head from 'next/head';
import FormSection from '@/parts/sizingV250/formSection';
import ResultSection from '@/parts/sizingV250/resultSection';
import {
  DependencyComponentEnum,
  ICalculateResult,
  ModeEnum,
} from '@/types/sizingV250';
import { LanguageEnum } from '@/types/localization';
import { fetchMilvusReleases } from '@/http/milvus';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRouter } from 'next/router';
import { SIZING_TOOL_VERSION_OPTIONS } from '@/consts/sizing';
import { baseValues } from '@/parts/sizingV250/config';
import { LanguageSelector } from '@/components/language-selector';
import { SizingTabs } from '@/components/sizing';
import { PricingPlanEnum } from '@/parts/sizingCommon/types';
import { useGlobalLocale } from '@/hooks/use-global-locale';
const { etcdBaseValue, minioBaseValue, pulsarBaseValue, kafkaBaseValue } = baseValues;

type Props = {
  locale: LanguageEnum;
  latestTag: string;
};

export default function SizingTool(props: Props) {
  const { locale = LanguageEnum.ENGLISH, latestTag } = props;
  const { t } = useTranslation('sizingTool', { lng: locale });
  // The shared sizing components call useTranslation() without a language, so
  // give them an instance pinned to this page's locale. Otherwise the server
  // renders them in English and hydration on /<lang>/tools/sizing fails.
  const sizingI18n = useMemo(
    () => i18next.cloneInstance({ lng: locale, initImmediate: false }),
    [locale]
  );
  const router = useRouter();
  const {
    locale: activeLocale,
    disabled: languageSelectorDisabled,
    disabledLanguages,
    onLocaleChange,
  } = useGlobalLocale();
  const currentVersion = SIZING_TOOL_VERSION_OPTIONS.find(
    option => option.href === router.pathname
  );

  const [calculatedResult, setCalculatedResult] = useState<ICalculateResult>({
    rawDataSize: 0,
    memorySize: 0,
    localDiskSize: 0,
    standaloneNodeConfig: {
      cpu: 0,
      memory: 0,
      count: 0,
    },
    clusterNodeConfig: {
      queryNode: {
        cpu: 0,
        memory: 0,
        count: 0,
      },
      proxy: {
        cpu: 0,
        memory: 0,
        count: 0,
      },
      mixCoord: {
        cpu: 0,
        memory: 0,
        count: 0,
      },
      dataNode: {
        cpu: 0,
        memory: 0,
        count: 0,
      },
      indexNode: {
        cpu: 0,
        memory: 0,
        count: 0,
      },
    },
    dependencyConfig: {
      etcd: {
        ...etcdBaseValue,
      },
      minio: {
        ...minioBaseValue,
      },
      pulsar: {
        ...pulsarBaseValue,
      },
      kafka: {
        ...kafkaBaseValue,
      },
    },
    mode: ModeEnum.Cluster,
    dependency: DependencyComponentEnum.Kafka,
    isOutOfCalculate: false,
  });

  const [selectedVersion, setSelectedVersion] = useState<string>(
    currentVersion?.value || SIZING_TOOL_VERSION_OPTIONS[0].value
  );

  const [pricingPlan, setPricingPlan] = useState<PricingPlanEnum>(
    PricingPlanEnum.Shared
  );

  const updateCalculatedResult = (result: ICalculateResult) => {
    setCalculatedResult({ ...result, pricingPlan });
  };

  useEffect(() => {
    setCalculatedResult(prev => ({ ...prev, pricingPlan }));
  }, [pricingPlan]);

  const handleSelectVersion = (value: string) => {
    setSelectedVersion(value);
    router.push(
      SIZING_TOOL_VERSION_OPTIONS.find(option => option.value === value)
        ?.href || '/tools/sizing'
    );
  };

  return (
    <I18nextProvider i18n={sizingI18n}>
      <main className={classes.pageContainer}>
        <Head>
          <title>Estimate Your Cost</title>
          <meta name="description" content="Sizing tool v2.5.x" />
        </Head>

        <div
          className={clsx(
            pageClasses.homeContainer,
            classes.sizingToolContainer
          )}
        >
          <div className={classes.titleContainer}>
            <h1 className={classes.title}>Estimate Your Cost</h1>
            <div className={classes.selectContainer}>
              <LanguageSelector
                value={activeLocale}
                onChange={onLocaleChange}
                disabled={languageSelectorDisabled}
                disabledLanguages={disabledLanguages}
                className={classes.languageSelector}
              />
              <div className={classes.versionSelector}>
                <Select
                  value={selectedVersion}
                  onValueChange={handleSelectVersion}
                >
                  <SelectTrigger className={classes.selectTrigger}>
                    <SelectValue placeholder="Select a Milvus version">
                      {selectedVersion}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SIZING_TOOL_VERSION_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <p className={clsx(classes.desc, classes.descWithTabs)}>
            {t('content')}
          </p>

          <SizingTabs<PricingPlanEnum>
            className={classes.tabsRow}
            idPrefix="pricing-plan"
            value={pricingPlan}
            onChange={setPricingPlan}
            hint={
              pricingPlan === PricingPlanEnum.Shared
                ? t('pricingPlan.sharedHint')
                : t('pricingPlan.dedicatedHint')
            }
            options={[
              { value: PricingPlanEnum.Shared, label: t('pricingPlan.shared') },
              {
                value: PricingPlanEnum.Dedicated,
                label: t('pricingPlan.dedicated'),
              },
            ]}
          />

          <div className={classes.contentContainer}>
            <FormSection
              className={classes.leftSection}
              updateCalculatedResult={updateCalculatedResult}
            />
            <ResultSection
              className={classes.rightSection}
              calculatedResult={calculatedResult}
              latestMilvusTag={latestTag}
            />
          </div>
        </div>
      </main>
    </I18nextProvider>
  );
}

export const getStaticProps = async () => {
  const latestTag = await fetchMilvusReleases();
  return {
    props: {
      latestTag,
    },
  };
};
