import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import classes from './index.module.css';
import { SizingInput } from '@/components/sizing';
import { ExternalLinkIcon } from '@/components/icons';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import {
  ARRAY_ELEMENT_TYPE_OPTIONS,
  FieldTypeEnum,
  MAX_ARRAY_CAPACITY,
  MAX_AVERAGE_LENGTH,
  MAX_FIELD_COUNT,
  MIN_ARRAY_CAPACITY,
  MIN_AVERAGE_LENGTH,
  PRIMARY_KEY_TYPE_OPTIONS,
  SCALAR_FIELD_TYPE_OPTIONS,
  SchemaField,
  VARIABLE_LENGTH_TYPES,
  clampFieldNumber,
  createArraySubSchema,
  createScalarField,
  reindexField,
  retypeField,
  scalarIndexOptionsForType,
} from './schema';
import { ScalarIndexTypeEnum } from '@/types/sizingScalar';
import {
  BITMAP_RECOMMENDED_MAX_CARDINALITY,
  MAX_CARDINALITY,
  MIN_CARDINALITY,
} from '@/consts/sizingScalar';

interface SchemaFieldsProps {
  fields: SchemaField[];
  onChange: (fields: SchemaField[]) => void;
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

export const SchemaFields = (props: SchemaFieldsProps) => {
  const { fields, onChange } = props;
  const { t } = useTranslation('sizingTool');

  const replaceField = (index: number, next: SchemaField) => {
    onChange(fields.map((f, i) => (i === index ? next : f)));
  };

  const updateField = (index: number, patch: Partial<SchemaField>) => {
    replaceField(index, { ...fields[index], ...patch });
  };

  const removeField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  const addField = () => {
    onChange([...fields, createScalarField()]);
  };

  const handleTypeChange = (index: number, fieldType: FieldTypeEnum) => {
    replaceField(index, retypeField(fields[index], fieldType));
  };

  const handleIndexChange = (index: number, value: ScalarIndexTypeEnum) => {
    replaceField(index, reindexField(fields[index], value));
  };

  const handleAverageLength = (index: number, raw: string) => {
    const value = clampFieldNumber(raw, MIN_AVERAGE_LENGTH, MAX_AVERAGE_LENGTH);
    if (value === undefined) return;
    updateField(index, { averageLength: value });
  };

  const handleCardinality = (index: number, raw: string) => {
    const value = clampFieldNumber(raw, MIN_CARDINALITY, MAX_CARDINALITY);
    if (value === undefined) return;
    updateField(index, { cardinality: value });
  };

  const handleSubSchema = (
    index: number,
    key: 'capacity' | 'averageLength' | 'elementType',
    raw: string
  ) => {
    const current = fields[index].subSchema ?? createArraySubSchema();
    if (key === 'elementType') {
      updateField(index, {
        subSchema: { ...current, elementType: raw as FieldTypeEnum },
      });
      return;
    }
    const value =
      key === 'capacity'
        ? clampFieldNumber(raw, MIN_ARRAY_CAPACITY, MAX_ARRAY_CAPACITY)
        : clampFieldNumber(raw, MIN_AVERAGE_LENGTH, MAX_AVERAGE_LENGTH);
    if (value === undefined) return;
    updateField(index, { subSchema: { ...current, [key]: value } });
  };

  const indexLabel = (value: ScalarIndexTypeEnum) =>
    value === ScalarIndexTypeEnum.None ? t('form.schema.indexNone') : value;

  return (
    <div className={classes.schemaTable}>
      <div className={classes.schemaHeaderRow}>
        <p className={classes.schemaHeader}>{t('form.schema.field')}</p>
        <a
          className="flex items-center gap-[4px] font-[400] text-[12px] leading-[16px] text-black1 hover:underline"
          href="https://milvus.io/docs/zh/scalar_index.md"
          target="_blank"
        >
          {t('form.schema.indexTip')}
          <ExternalLinkIcon />
        </a>
      </div>
      <ul className={classes.schemaList}>
        {fields.map((field, index) => {
          const typeOptions = field.primary
            ? PRIMARY_KEY_TYPE_OPTIONS
            : SCALAR_FIELD_TYPE_OPTIONS;
          const showAverageLength = VARIABLE_LENGTH_TYPES.includes(
            field.fieldType
          );
          const isArray = field.fieldType === FieldTypeEnum.Array;
          const sub = field.subSchema ?? createArraySubSchema();
          const indexOptions = scalarIndexOptionsForType(field.fieldType);
          const isBitmap = field.index === ScalarIndexTypeEnum.Bitmap;
          const cardinalityTooHigh =
            isBitmap &&
            typeof field.cardinality === 'number' &&
            field.cardinality > BITMAP_RECOMMENDED_MAX_CARDINALITY;

          return (
            <li key={field.id} className={classes.schemaRow}>
              <div className={classes.schemaTypeCell}>
                <Select
                  value={field.fieldType}
                  onValueChange={value =>
                    handleTypeChange(index, value as FieldTypeEnum)
                  }
                >
                  <SelectTrigger className={classes.schemaSelectTrigger}>
                    <span className={classes.schemaTypeLabel}>
                      {field.fieldType}
                      {field.primary && (
                        <span className={classes.pkTag}>
                          {t('form.schema.pk')}
                        </span>
                      )}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className={classes.schemaParamCell}>
                {showAverageLength && (
                  <SizingInput
                    customSize="small"
                    label={t('form.schema.averageLength')}
                    unit={t('setup.basic.byte')}
                    value={field.averageLength}
                    onChange={e => handleAverageLength(index, e.target.value)}
                    placeholder={`[${MIN_AVERAGE_LENGTH}, ${MAX_AVERAGE_LENGTH.toLocaleString('en-US')}]`}
                    classes={{ root: classes.schemaInput }}
                  />
                )}
                {isArray && (
                  <>
                    <SizingInput
                      customSize="small"
                      label={t('form.schema.averageCapacity')}
                      value={sub.capacity}
                      onChange={e =>
                        handleSubSchema(index, 'capacity', e.target.value)
                      }
                      placeholder={`[${MIN_ARRAY_CAPACITY}, ${MAX_ARRAY_CAPACITY.toLocaleString('en-US')}]`}
                      classes={{ root: classes.schemaInput }}
                    />
                    <div className={classes.schemaInput}>
                      <div className={classes.schemaInputLabel}>
                        {t('form.schema.elementType')}
                      </div>
                      <Select
                        value={sub.elementType}
                        onValueChange={value =>
                          handleSubSchema(index, 'elementType', value)
                        }
                      >
                        <SelectTrigger className={classes.schemaSelectTrigger}>
                          {sub.elementType}
                        </SelectTrigger>
                        <SelectContent>
                          {ARRAY_ELEMENT_TYPE_OPTIONS.map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {sub.elementType === FieldTypeEnum.VarChar && (
                      <SizingInput
                        customSize="small"
                        label={t('form.schema.averageLength')}
                        unit={t('setup.basic.byte')}
                        value={sub.averageLength}
                        onChange={e =>
                          handleSubSchema(index, 'averageLength', e.target.value)
                        }
                        placeholder={`[${MIN_AVERAGE_LENGTH}, ${MAX_AVERAGE_LENGTH.toLocaleString('en-US')}]`}
                        classes={{ root: classes.schemaInput }}
                      />
                    )}
                  </>
                )}

                <div className={classes.schemaInput}>
                  <div className={classes.schemaInputLabel}>
                    {t('form.schema.index')}
                  </div>
                  {field.primary ? (
                    <div
                      className={clsx(
                        classes.schemaSelectTrigger,
                        classes.schemaStaticValue
                      )}
                    >
                      {t('form.schema.pkStats')}
                    </div>
                  ) : (
                    <Select
                      value={field.index}
                      onValueChange={value =>
                        handleIndexChange(index, value as ScalarIndexTypeEnum)
                      }
                    >
                      <SelectTrigger className={classes.schemaSelectTrigger}>
                        {indexLabel(field.index)}
                      </SelectTrigger>
                      <SelectContent>
                        {indexOptions.map(option => (
                          <SelectItem key={option} value={option}>
                            {indexLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {isBitmap && (
                  <div className={classes.schemaInput}>
                    <SizingInput
                      customSize="small"
                      label={t('form.schema.cardinality')}
                      value={field.cardinality}
                      onChange={e => handleCardinality(index, e.target.value)}
                      placeholder={`[${MIN_CARDINALITY}, ${MAX_CARDINALITY.toLocaleString('en-US')}]`}
                    />
                    {cardinalityTooHigh && (
                      <p className={classes.schemaWarning}>
                        {t('form.schema.cardinalityTip', {
                          max: BITMAP_RECOMMENDED_MAX_CARDINALITY,
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                className={classes.schemaDeleteBtn}
                onClick={() => removeField(index)}
                disabled={field.primary}
                aria-label={t('form.schema.remove')}
              >
                <DeleteIcon />
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className={clsx(classes.addFieldBtn)}
        onClick={addField}
        disabled={fields.length >= MAX_FIELD_COUNT}
      >
        + {t('form.schema.add')}
      </button>
    </div>
  );
};
