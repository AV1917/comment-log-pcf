import * as React from 'react';
import {
  FluentProvider, Card, Text, Button, Spinner, Field, Dropdown, Option, Checkbox, Input, Textarea,
  type CheckboxOnChangeData, type Theme,
} from '@fluentui/react-components';
import { CommentCard } from './CommentCard';
import type { CommentViewModel, CreateModel, RecordReference, TypeOption } from '../types/commentLogTypes';
import { nonEmptyString, optionValue } from '../utils/values';
import '../styles/commentLog.css';

export interface ICommentLogProps {
  disabled: boolean;
  theme?: Theme;
  container: { width: number };
  canRead: boolean;
  canCreate: boolean;
  usesTitleColumn: boolean;
  usesTypeChoiceColumn: boolean;
  typeOptions: TypeOption[];
  pickerTypeOptions: TypeOption[];
  isTypePickerLoading: boolean;
  typeOnCreateValue?: number;
  showTypePickerOnCreate: boolean;
  selectedIds: string[];
  onToggleSelected: (id: string, selected: boolean) => void;
  comments: { records: CommentViewModel[]; isLoading: boolean };
  selection: {
    selectedCount: number;
    totalKnownCount: number;
    hasMore: boolean;
    isBusy: boolean;
    onSelectAll: () => void;
    onClearSelection: () => void;
  };
  infinite: { hasMore: boolean; isLoadingMore: boolean; onLoadMore: () => void };
  onOpenComment: (id: string) => void;
  onOpenAuthor: (author: RecordReference) => void;
  loadAuthorPhoto: (author: RecordReference) => Promise<string | undefined>;
  onCreate: (model: CreateModel) => Promise<boolean>;
}

export const CommentLogControl: React.FC<ICommentLogProps> = props => {
  const [busy, setBusy] = React.useState(false);
  const [createTitle, setCreateTitle] = React.useState('');
  const [createBody, setCreateBody] = React.useState('');
  const [createType, setCreateType] = React.useState<number | undefined>(props.typeOnCreateValue);
  const mounted = React.useRef(true);
  const submitting = React.useRef(false);
  const hasTypePicker = props.usesTypeChoiceColumn && props.showTypePickerOnCreate;

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  React.useEffect(() => {
    if (props.typeOnCreateValue !== undefined) setCreateType(props.typeOnCreateValue);
    else if (!hasTypePicker) setCreateType(undefined);
  }, [hasTypePicker, props.typeOnCreateValue]);

  const selectedSet = React.useMemo(() => new Set(props.selectedIds), [props.selectedIds]);
  const records = props.comments.records;
  const inf = props.infinite;
  const sel = props.selection;
  const selectedType = props.pickerTypeOptions.find(option => option.value === createType);
  const createDisabled = props.disabled || busy || !props.canCreate ||
    (props.usesTitleColumn && !nonEmptyString(createTitle)) ||
    (hasTypePicker && !selectedType) || !nonEmptyString(createBody);

  const create = async () => {
    if (createDisabled || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const posted = await props.onCreate({
        body: createBody,
        title: props.usesTitleColumn ? createTitle.trim() : undefined,
        typeValue: props.usesTypeChoiceColumn ? props.typeOnCreateValue ?? createType : undefined,
      });
      if (posted && mounted.current) {
        setCreateBody('');
        setCreateTitle('');
        if (hasTypePicker) setCreateType(undefined);
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const checkedAll = !sel.hasMore && sel.totalKnownCount > 0 && sel.selectedCount === sel.totalKnownCount;
  const selectAllChecked: boolean | 'mixed' = checkedAll ? true : sel.selectedCount > 0 ? 'mixed' : false;
  const toolbarDisabled = sel.totalKnownCount === 0 && !props.comments.isLoading;
  const onSelectAllToggle = (_event: React.ChangeEvent<HTMLInputElement>, _data: CheckboxOnChangeData) => {
    if (toolbarDisabled || busy || sel.isBusy) return;
    if (checkedAll) sel.onClearSelection();
    else sel.onSelectAll();
  };
  const containerStyle: React.CSSProperties = {
    width: props.container.width >= 0 ? `${props.container.width}px` : '100%',
    height: 'auto',
  };

  return (
    <FluentProvider theme={props.theme}>
      <div className="comment-container" style={containerStyle}>
        {props.canRead ? (
          <>
            {props.canCreate && !props.disabled ? (
              <Card className="create-card" appearance="filled">
                <div className="create-stack">
                  {hasTypePicker ? (
                    <Field label="Type" required className="dv-field create-type-field">
                      <div className="dv-control">
                        <Dropdown className="type-create-dropdown dv-dropdown" appearance="filled-lighter"
                          selectedOptions={selectedType ? [String(selectedType.value)] : []}
                          value={selectedType?.label ?? (props.isTypePickerLoading ? 'Loading types…' : '---')}
                          placeholder="---" inlinePopup
                          onOptionSelect={(_event, data) => setCreateType(optionValue(data.optionValue))}
                          disabled={props.disabled || busy || props.isTypePickerLoading}>
                          {props.pickerTypeOptions.map(option => (
                            <Option key={option.value} value={String(option.value)} text={option.label}>
                              <span className="type-option-row" aria-hidden="true">
                                <span className="type-option-swatch" style={{ backgroundColor: option.color ?? '#f3f2f1' }} />
                                <span className="type-option-label">{option.label}</span>
                              </span>
                            </Option>
                          ))}
                        </Dropdown>
                      </div>
                    </Field>
                  ) : null}
                  {props.usesTitleColumn ? (
                    <Field label="Title" required className="dv-field">
                      <div className="dv-control">
                        <Input className="dv-input" appearance="filled-lighter" value={createTitle}
                          onChange={(_event, data) => setCreateTitle(data.value)} disabled={props.disabled || busy} />
                      </div>
                    </Field>
                  ) : null}
                  <Field label="Body" required className="dv-field">
                    <div className="dv-control">
                      <Textarea className="dv-textarea" appearance="filled-lighter" value={createBody}
                        onChange={(_event, data) => setCreateBody(data.value)} disabled={props.disabled || busy}
                        rows={3} resize="vertical" />
                    </div>
                  </Field>
                  <div className="create-actions">
                    <Button className="create-button" appearance="primary" onClick={() => void create()} disabled={createDisabled}>Create</Button>
                    {busy ? <Spinner size="tiny" /> : null}
                  </div>
                </div>
              </Card>
            ) : null}
            <div className="selection-row">
              <Checkbox className="select-all-checkbox" checked={selectAllChecked} onChange={onSelectAllToggle}
                disabled={busy || sel.isBusy || toolbarDisabled} label="Select all" />
              <Text className={toolbarDisabled ? 'selection-count is-disabled' : 'selection-count'}>
                {sel.selectedCount}/{sel.totalKnownCount}{sel.hasMore ? '+' : ''}
              </Text>
              {sel.isBusy ? <Spinner size="tiny" /> : null}
              <span className="spacer" />
            </div>
            <div className="comment-list" role="list" aria-label="Comment timeline">
              {props.comments.isLoading && records.length === 0 ? <Spinner /> :
                records.map(comment => (
                  <CommentCard key={comment.id} comment={comment} disabled={busy}
                    isSelected={selectedSet.has(comment.id)} onToggleSelected={props.onToggleSelected}
                    onOpen={() => props.onOpenComment(comment.id)} onOpenAuthor={props.onOpenAuthor}
                    loadAuthorPhoto={props.loadAuthorPhoto} />
                ))}
              {inf.hasMore ? (
                <div className="show-more-row">
                  <Button className="show-more-button" appearance="subtle" onClick={inf.onLoadMore}
                    disabled={busy || sel.isBusy || inf.isLoadingMore || props.comments.isLoading}>
                    <span className="show-more-content">
                      {inf.isLoadingMore ? <Spinner size="tiny" className="show-more-spinner" /> : null}
                      <span>{inf.isLoadingMore ? 'Loading…' : 'Show more'}</span>
                    </span>
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </FluentProvider>
  );
};