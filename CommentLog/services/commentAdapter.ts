import type { CommentRecord, CommentViewModel, FieldMapping, RecordReference, TypeOption } from '../types/commentLogTypes';
import { isRecord, nonEmptyString, normaliseGuid, optionValue, requireGuid } from '../utils/values';

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type EntityRecord = ComponentFramework.PropertyHelper.DataSetApi.EntityRecord;

export const getFieldMapping = (dataset: DataSet): FieldMapping => {
  const field = (alias: string): string | undefined => {
    const column = dataset.columns.find(column => column.alias?.toLowerCase() === alias.toLowerCase());
    return column ? nonEmptyString(column.name) : undefined;
  };
  return {
    title: field('commentTitle'), body: field('commentBody'), type: field('commentType'),
    authorLookup: field('authorLookup'), authorText: field('authorText'),
    uploadDate: field('uploadDate'), relatedRecord: field('relatedRecord'),
  };
};

/** either entityrefrence or lookupvalue */
export const readLookup = (value: unknown): RecordReference | undefined => {
  if (Array.isArray(value)) value = value[0] as unknown;
  if (!isRecord(value)) return undefined;
  const id = normaliseGuid(isRecord(value.id) ? value.id.guid : value.id);
  const entityName = nonEmptyString(typeof value.entityType === 'string' ? value.entityType : value.etn);
  if (!id || !entityName) return undefined;
  return { id, entityName, name: nonEmptyString(value.name) };
};

const textValue = (record: EntityRecord, alias: string): string | undefined => {
  const value: unknown = record.getValue(alias);
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`The ${alias} column did not return text.`);
  return nonEmptyString(value);
};

export const readComments = (dataset: DataSet, fields: FieldMapping): CommentRecord[] =>
  dataset.sortedRecordIds.map(key => {
    const record = dataset.records[key];
    if (!record) throw new Error('A comment record is missing from the dataset. Refresh the list and try again.');
    return {
      id: requireGuid(record.getRecordId(), 'Comment'),
      title: fields.title ? textValue(record, 'commentTitle') : undefined,
      body: textValue(record, 'commentBody') ?? '',
      typeValue: fields.type ? optionValue(record.getValue('commentType')) : undefined,
      typeLabel: fields.type ? nonEmptyString(record.getFormattedValue('commentType')) : undefined,
      author: fields.authorLookup ? readLookup(record.getValue('authorLookup')) : undefined,
      authorText: fields.authorText ? textValue(record, 'authorText') : undefined,
      dateText: nonEmptyString(record.getFormattedValue('uploadDate')),
      entityReference: record.getNamedReference(),
    };
  });

export const toViewModel = (
  record: CommentRecord,
  options: ReadonlyMap<number, TypeOption>,
  unknownUserText: string,
  typePlaceholder: string,
): CommentViewModel => {
  const option = record.typeValue === undefined ? undefined : options.get(record.typeValue);
  return {
    id: record.id, title: record.title, body: record.body,
    typeLabel: option?.label ?? record.typeLabel ?? typePlaceholder,
    typeColor: option?.color,
    usesTypePlaceholder: record.typeValue === undefined && !record.typeLabel,
    authorName: record.author?.name ?? record.authorText ?? unknownUserText,
    author: record.author,
    dateText: record.dateText ?? 'Unknown Date',
  };
};