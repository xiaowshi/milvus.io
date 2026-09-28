import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import classes from './index.module.css';
import { SizingRange } from '@/components/sizing';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import { ExternalLinkIcon } from '@/components/icons';
import { IndexTypeComponent } from './indexTypeComponent';
import { SizingVersionConfig } from './types';
import {
  MAX_VECTOR_FIELD_COUNT,
  VectorFieldConfig,
  createVectorField,
} from './vectorFieldSchema';

interface VectorFieldsProps {
  fields: VectorFieldConfig[];
  onChange: (fields: VectorFieldConfig[]) => void;
  config: SizingVersionConfig;
}

/** Small cross, drawn with strokes so it inherits the button color. */
const DeleteIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
  </svg>
);

export const VectorFields = (props: VectorFieldsProps) => {
  const { fields, onChange, config } = props;
  const { t } = useTranslation('sizingTool');
  const { DIMENSION_RANGE_CONFIG, INDEX_TYPE_OPTIONS } = config.consts;

  const updateField = (index: number, patch: Partial<VectorFieldConfig>) => {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const updateIndexParam = (index: number, key: string, value: any) => {
    const field = fields[index];
    updateField(index, {
      indexTypeParams: { ...field.indexTypeParams, [key]: value },
    });
  };

  const removeField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  const addField = () => {
    onChange([...fields, createVectorField(config)]);
  };

  const canAdd = fields.length < MAX_VECTOR_FIELD_COUNT;

  return (
    <div className={classes.vectorFieldList}>
      <h4 className="flex items-center justify-between mb-[8px]">
        <span className="font-[600] text-[14px] leading-[22px] text-black1">
          {t('form.vectorFields')}
        </span>
        <a
          className="flex items-center gap-[4px] font-[400] text-[12px] leading-[16px] text-black1 hover:underline"
          href="https://milvus.io/docs/zh/index-explained.md"
          target="_blank"
        >
          {t('form.indexTypeTip')}
          <ExternalLinkIcon />
        </a>
      </h4>
      <ul className={classes.schemaList}>
        {fields.map((field, index) => (
          <li key={field.id} className={classes.vectorFieldCard}>
            <div className={classes.vectorFieldHeader}>
              <span className={classes.vectorFieldTitle}>
                {t('form.vectorField', { index: index + 1 })}
              </span>
              <button
                type="button"
                className={classes.schemaDeleteBtn}
                onClick={() => removeField(index)}
                disabled={fields.length <= 1}
                aria-label={t('form.removeVectorField')}
              >
                <DeleteIcon />
              </button>
            </div>
            <div className="mb-[16px]">
              <SizingRange
                rangeConfig={DIMENSION_RANGE_CONFIG}
                label={t('form.dim')}
                classes={{ label: classes.vectorFieldLabel }}
                onRangeChange={val => updateField(index, { dimension: val })}
                value={field.dimension}
                placeholder={`[${DIMENSION_RANGE_CONFIG.min}, ${DIMENSION_RANGE_CONFIG.max}]`}
              />
            </div>
            <div>
              <p className={clsx(classes.vectorFieldLabel, 'mb-[8px]')}>
                {t('form.indexType')}
              </p>
              <Select
                value={field.indexTypeParams.indexType}
                onValueChange={val => updateIndexParam(index, 'indexType', val)}
              >
                <SelectTrigger className={classes.selectTrigger}>
                  {field.indexTypeParams.indexType}
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
                data={field.indexTypeParams}
                onChange={(key, value) => updateIndexParam(index, key, value)}
                config={config}
                refine={field.refineType ?? undefined}
                onRefineChange={value =>
                  updateField(index, { refineType: value })
                }
              />
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={clsx(classes.addFieldBtn)}
        onClick={addField}
        disabled={!canAdd}
      >
        + {t('form.addVectorField')}
      </button>
      {!canAdd && (
        <p className={classes.vectorFieldLimitTip}>
          {t('form.maxVectorFieldTip', { max: MAX_VECTOR_FIELD_COUNT })}
        </p>
      )}
    </div>
  );
};
