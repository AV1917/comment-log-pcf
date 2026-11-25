export interface RecordReference {
  id: string;
  entityName: string;
  name?: string;
}

export type TypeValue = number | string;

export interface CommentRecord {
  id: string;
  title?: string;
  body: string;
  typeValue?: TypeValue;
  typeLabel?: string;
  author?: RecordReference;
  authorText?: string;
  dateText?: string;
  entityReference: ComponentFramework.EntityReference;
}

export interface CommentViewModel {
  id: string;
  title?: string;
  body: string;
  typeLabel: string;
  typeColor?: string;
  usesTypePlaceholder: boolean;
  authorName: string;
  author?: RecordReference;
  dateText: string;
}

export interface TypeOption {
  value: TypeValue;
  label: string;
  color?: string;
  selectable: boolean;
}

export interface TypeCatalogue {
  lookupTarget?: string;
  options: TypeOption[];
}

export interface CreateModel {
  title?: string;
  body: string;
  typeValue?: TypeValue;
}

export interface Notice {
  level: 'success' | 'error' | 'warning';
  message: string;
  action?: { label: string; onClick: () => void };
}

export interface FieldMapping {
  title?: string;
  body?: string;
  type?: string;
  authorLookup?: string;
  authorText?: string;
  uploadDate?: string;
  relatedRecord?: string;
}
