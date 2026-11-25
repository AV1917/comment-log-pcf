import * as React from 'react';
import type { Theme } from '@fluentui/react-components';
import type { IInputs, IOutputs } from './generated/ManifestTypes';
import { CommentLogControl, type ICommentLogProps } from './components/CommentLogControl';
import type { CommentRecord, CreateModel, FieldMapping, Notice, RecordReference, TypeCatalogue, TypeOption, TypeValue } from './types/commentLogTypes';
import { DataverseService } from './services/dataverse';
import { DatasetOperationCancelled, DatasetState } from './services/datasetState';
import { getFieldMapping, readComments, toViewModel } from './services/commentAdapter';
import { ModelDrivenHost } from './services/modelDrivenHost';
import { errorMessage, nonEmptyString, normaliseGuid, optionValue, requireGuid } from './utils/values';
import { PrivilegeDepth, PrivilegeType } from './utils/entityPrivileges';
import { pickerOptions } from './utils/pickerOptions';

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string };

interface Access {
  canRead: boolean;
  canCreate: boolean;
  canWriteParent: boolean;
}

interface SelectionIntent {
  expected: string;
  previous: string;
  timer: ReturnType<typeof setTimeout>;
}

export class CommentLog implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private _context!: ComponentFramework.Context<IInputs>;
  private readonly _host = new ModelDrivenHost();
  private _dataverse!: DataverseService;
  private readonly _pages = new DatasetState<CommentRecord>();
  private readonly _types = new Map<string, Resource<TypeCatalogue>>();
  private readonly _historicalTypes = new Map<string, Resource<TypeOption | undefined>>();
  private readonly _access = new Map<string, Resource<Access>>();
  private readonly _privilegeMetadata = new Map<string, Promise<void>>();
  private _pageSize = 20;
  private _needsPageSizeRefresh = false;
  private _selectionBusy = false;
  private _selectedIds: string[] = [];
  private _selectionIntent?: SelectionIntent;
  private _reportedIssues = new Set<string>();
  private _dataError?: string;
  private _destroyed = false;

  public init(
    context: ComponentFramework.Context<IInputs>,
    _notifyOutputChanged: () => void,
    _state: ComponentFramework.Dictionary,
  ): void {
    this._context = context;
    this._dataverse = new DataverseService(this._host, context.userSettings.languageId);
    this._pageSize = this.pageSize(context);
    context.mode.trackContainerResize(true);
    this._needsPageSizeRefresh = context.parameters.commentLog.paging.pageSize !== this._pageSize;
    context.parameters.commentLog.paging.setPageSize(this._pageSize);
  }

  private pageSize(context: ComponentFramework.Context<IInputs>): number {
    const size = context.parameters.pageSize.raw ?? 20;
    if (!Number.isSafeInteger(size) || size < 1) throw new Error('Page Size must be a positive whole number.');
    return size;
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    this._context = context;
    const dataset = context.parameters.commentLog;
    const fields = getFieldMapping(dataset);
    const entityName = dataset.getTargetEntityType();
    const parent = this._host.getParent(context.mode);
    const size = this.pageSize(context);

    if (size !== this._pageSize) {
      this._pageSize = size;
      dataset.paging.setPageSize(size);
      this._needsPageSizeRefresh = true;
      this._pages.cancel('The page size changed.');
    }

    const queryKey = JSON.stringify([
      entityName, parent?.entityName, parent?.id, dataset.getViewId(),
      dataset.filtering.getFilter(), dataset.sorting, fields, size,
    ]);
    const previousGeneration = this._pages.generation;
    try {
      this._pages.update({
        queryKey,
        records: dataset.loading || dataset.error ? [] : readComments(dataset, fields),
        loading: dataset.loading,
        hasMore: dataset.paging.hasNextPage,
        firstPage: dataset.paging.firstPageNumber,
        lastPage: dataset.paging.lastPageNumber,
        error: dataset.error ? dataset.errorMessage || 'Comments could not be loaded.' : undefined,
        dataUpdated: context.updatedProperties.includes('dataset'),
      });
      this._dataError = dataset.error ? dataset.errorMessage || 'Comments could not be loaded.' : undefined;
    } catch (error) {
      this._dataError = errorMessage(error);
      this._pages.update({
        queryKey, records: [], loading: false, hasMore: dataset.paging.hasNextPage,
        firstPage: dataset.paging.firstPageNumber, lastPage: dataset.paging.lastPageNumber,
        error: this._dataError,
      });
    }
    this.syncSelection(dataset, previousGeneration !== this._pages.generation);

    const typeState = this.loadTypes(context, entityName, fields.type);
    const catalogue = typeState?.status === 'ready' ? typeState.value : undefined;
    const typeOptions = catalogue?.options ?? [];
    const optionMap = new Map(typeOptions.map(option => [option.value, option]));
    const accessState = entityName && parent
      ? this.ensure(this._access, this.accessKey(entityName, parent), () => this.loadAccess(context, entityName, parent))
      : undefined;
    const access = accessState?.status === 'ready' ? accessState.value : undefined;

    const fixedConfigured = fields.type !== undefined && !!nonEmptyString(context.parameters.typeOnCreate.raw);
    let fixedType: TypeValue | undefined;
    let fixedTypeError: string | undefined;
    if (catalogue) {
      try {
        fixedType = this.fixedType(context, catalogue);
      } catch (error) {
        fixedTypeError = errorMessage(error);
      }
    }
    const showTypePickerOnCreate = fields.type !== undefined && !fixedConfigured;
    const pickerTypeOptions = showTypePickerOnCreate ? pickerOptions(typeOptions) : [];
    const historicalError = Array.from(this._historicalTypes.values()).find(state => state.status === 'error');
    const issues = [
      this._dataError,
      typeState?.status === 'error' ? `Could not load comment types: ${typeState.message}` : undefined,
      historicalError?.status === 'error' ? `Could not load historical comment types: ${historicalError.message}` : undefined,
      fixedTypeError,
      accessState?.status === 'error' ? `Could not check permissions: ${accessState.message}` : undefined,
    ].filter((issue): issue is string => issue !== undefined).map<Notice>(message => ({
      level: 'error', message, action: { label: 'Retry', onClick: () => this.retry() },
    }));
    if (access?.canRead === false) {
      issues.push({ level: 'error', message: "You don't have permission to view these records." });
    }
    this.reportIssues(queryKey, issues);
    const unknownUserText = nonEmptyString(context.parameters.unknownUserText.raw) ?? 'Unknown User';
    const typePlaceholder = nonEmptyString(context.parameters.typePlaceholder.raw) ?? 'Created';
    const records = this._pages.records;
    const props: ICommentLogProps = {
      disabled: this.isControlDisabled(context, access?.canWriteParent ?? false),
      theme: context.fluentDesignLanguage?.tokenTheme as Theme | undefined,
      container: { width: context.mode.allocatedWidth },
      canRead: access?.canRead ?? true,
      canCreate: access?.canCreate === true && !!fields.body && !!fields.uploadDate,
      usesTitleColumn: fields.title !== undefined,
      usesTypeColumn: fields.type !== undefined,
      isTypeReady: !fields.type || (catalogue !== undefined && !fixedTypeError),
      pickerTypeOptions,
      isTypePickerLoading: showTypePickerOnCreate && typeState?.status === 'loading',
      typeOnCreateValue: fixedType,
      showTypePickerOnCreate,
      selectedIds: this._selectedIds,
      onToggleSelected: (id, selected) => {
        this.runOperation(() => this.toggleSelected(id, selected));
      },
      comments: {
        records: records.map(record => toViewModel(record, optionMap, unknownUserText, typePlaceholder)),
        isLoading: dataset.loading,
      },
      selection: {
        selectedCount: this._selectedIds.length,
        totalKnownCount: records.length,
        hasMore: this._pages.hasMore,
        isBusy: this._selectionBusy,
        onSelectAll: () => this.runOperation(() => this.selectAll()),
        onClearSelection: () => this.runOperation(() => this.writeSelection([])),
      },
      infinite: {
        hasMore: this._pages.hasMore,
        isLoadingMore: this._pages.isLoadingMore,
        onLoadMore: () => this.runOperation(() => this.loadMore()),
      },
      onOpenComment: id => this.runOperation(() => this.openComment(id)),
      onOpenAuthor: author => this.runOperation(() => this._host.openAuthor(author)),
      loadAuthorPhoto: this.loadAuthorPhoto,
      onCreate: model => this.createComment(model),
    };

    if (this._needsPageSizeRefresh && !dataset.loading) {
      this._needsPageSizeRefresh = false;
      this.runOperation(() => dataset.refresh());
    }
    return React.createElement(CommentLogControl, props);
  }

  private loadTypes(
    context: ComponentFramework.Context<IInputs>, entityName: string, attribute?: string,
  ): Resource<TypeCatalogue> | undefined {
    if (!entityName || !attribute) {
      this._types.clear();
      this._historicalTypes.clear();
      return undefined;
    }
    const view = nonEmptyString(context.parameters.typeView.raw)?.trim();
    const colour = nonEmptyString(context.parameters.typeColour.raw)?.trim();
    const includePicker = !nonEmptyString(context.parameters.typeOnCreate.raw);
    const ids = Array.from(new Set(this._pages.records.map(record => record.typeValue)
      .filter((value): value is string => typeof value === 'string'))).sort();
    const key = JSON.stringify([entityName, attribute, view, colour, includePicker, this._pages.generation]);
    if (!this._types.has(key)) {
      this._types.clear();
      this._historicalTypes.clear();
      this._dataverse.clearTypeMetadata();
      for (const id of ids) this._historicalTypes.set(id, { status: 'ready', value: undefined });
    }
    const state = this.ensure(this._types, key, () => this._dataverse.getTypes(entityName, attribute, view, colour, ids, includePicker));
    if (state.status !== 'ready' || !state.value.lookupTarget) return state;
    const known = new Set(state.value.options.map(option => option.value));
    const missing = ids.filter(id => !known.has(id) && !this._historicalTypes.has(id));
    if (missing.length) {
      this.loadHistoricalTypes(key, state, missing,
        () => this._dataverse.getTypes(entityName, attribute, undefined, colour, missing, false));
    }
    const historical = Array.from(this._historicalTypes.values()).flatMap(result =>
      result.status === 'ready' && result.value ? [result.value] : []);
    return { status: 'ready', value: { ...state.value, options: [...state.value.options, ...historical] } };
  }

  private loadHistoricalTypes(
    key: string, catalogue: Resource<TypeCatalogue>, ids: string[], load: () => Promise<TypeCatalogue>,
  ): void {
    const pending: Resource<TypeOption | undefined> = { status: 'loading' };
    for (const id of ids) this._historicalTypes.set(id, pending);
    void Promise.resolve().then(load).then(result => {
      if (this._destroyed || this._types.get(key) !== catalogue) return undefined;
      const options = new Map(result.options.map(option => [option.value, option]));
      for (const id of ids) this._historicalTypes.set(id, { status: 'ready', value: options.get(id) });
      this.requestRender();
      return undefined;
    }).catch((error: unknown) => {
      if (this._destroyed || this._types.get(key) !== catalogue) return;
      const failed: Resource<TypeOption | undefined> = { status: 'error', message: errorMessage(error) };
      for (const id of ids) this._historicalTypes.set(id, failed);
      this.requestRender();
    });
  }

  private fixedType(context: ComponentFramework.Context<IInputs>, catalogue: TypeCatalogue): TypeValue | undefined {
    const raw = nonEmptyString(context.parameters.typeOnCreate.raw);
    if (!raw) return undefined;
    const value = catalogue.lookupTarget ? normaliseGuid(raw) : optionValue(raw);
    if (value === undefined || (!catalogue.lookupTarget && !catalogue.options.some(option => option.value === value))) {
      throw new Error('Apply Type on Create does not identify an available comment type. Check the control configuration.');
    }
    return value;
  }

  private ensure<T>(cache: Map<string, Resource<T>>, key: string, load: () => Promise<T>): Resource<T> {
    const existing = cache.get(key);
    if (existing) return existing;
    const state: Resource<T> = { status: 'loading' };
    cache.set(key, state);
    void Promise.resolve().then(load).then(value => {
      if (!this._destroyed && cache.get(key) === state) cache.set(key, { status: 'ready', value });
      this.requestRender();
      return undefined;
    }).catch((error: unknown) => {
      if (!this._destroyed && cache.get(key) === state) {
        cache.set(key, { status: 'error', message: errorMessage(error) });
      }
      this.requestRender();
    });
    return state;
  }

  private accessKey(entityName: string, parent: RecordReference): string {
    return `${entityName}|${parent.entityName}|${parent.id}`;
  }

  private async warmPrivilegeMetadata(context: ComponentFramework.Context<IInputs>, entityName: string): Promise<void> {
    let pending = this._privilegeMetadata.get(entityName);
    if (!pending) {
      pending = context.utils.getEntityMetadata(entityName).then(() => undefined).catch((error: unknown) => {
        this._privilegeMetadata.delete(entityName);
        throw error;
      });
      this._privilegeMetadata.set(entityName, pending);
    }
    await pending;
  }

  private async loadAccess(
    context: ComponentFramework.Context<IInputs>,
    entityName: string,
    parent: RecordReference,
  ): Promise<Access> {
    const [, , canWriteParent] = await Promise.all([
      this.warmPrivilegeMetadata(context, entityName),
      this.warmPrivilegeMetadata(context, parent.entityName),
      this._dataverse.canWrite(parent, context.userSettings.userId),
    ]);
    const has = (name: string, privilege: ComponentFramework.PropertyHelper.Types.PrivilegeType) =>
      context.utils.hasEntityPrivilege(name, privilege, PrivilegeDepth.Basic);
    return {
      canRead: has(entityName, PrivilegeType.Read),
      canCreate: has(parent.entityName, PrivilegeType.AppendTo) &&
        has(entityName, PrivilegeType.Append) && has(entityName, PrivilegeType.Create),
      canWriteParent,
    };
  }

  private isControlDisabled(context: ComponentFramework.Context<IInputs>, canWriteParent: boolean): boolean {
    const lockIfNoParentWrite = context.parameters.lockIfNoParentWrite.raw !== false;
    if (lockIfNoParentWrite && !canWriteParent) return true;
    if (!context.mode.isControlDisabled) return false;
    const inactive = this._host.isParentInactive();
    if (inactive && context.parameters.overrideInactive.raw === true) return false;
    if (!inactive && !canWriteParent && !lockIfNoParentWrite) return false;
    return true;
  }

  private readSelection(dataset: DataSet): string[] {
    return Array.from(new Set(dataset.getSelectedRecordIds()
      .map(normaliseGuid).filter((id): id is string => id !== undefined)));
  }

  private selectionKey(ids: string[]): string {
    return [...ids].sort().join(',');
  }

  private syncSelection(dataset: DataSet, queryChanged: boolean): void {
    const hostIds = this.readSelection(dataset);
    const hostKey = this.selectionKey(hostIds);
    const intent = this._selectionIntent;
    if (intent && !queryChanged && hostKey === intent.previous && hostKey !== intent.expected) return;
    if (intent) clearTimeout(intent.timer);
    this._selectionIntent = undefined;
    const known = new Set(this._pages.records.map(record => record.id));
    this._selectedIds = hostIds.filter(id => known.has(id));
  }

  private writeSelection(ids: string[]): void {
    const dataset = this._context.parameters.commentLog;
    const previous = this.selectionKey(this.readSelection(dataset));
    if (this._selectionIntent) clearTimeout(this._selectionIntent.timer);
    dataset.setSelectedRecordIds(ids);
    this._selectedIds = ids;
    // selection generally acknowledged synchronously but in case
    const timer = setTimeout(() => {
      this._selectionIntent = undefined;
      if (!this._destroyed) {
        this.syncSelection(this._context.parameters.commentLog, false);
        this.requestRender();
      }
    }, 2000);
    this._selectionIntent = { expected: this.selectionKey(ids), previous, timer };
    this.syncSelection(dataset, false);
    this.requestRender();
  }

  private toggleSelected(id: string, selected: boolean): void {
    const ids = new Set(this._selectedIds);
    if (selected) ids.add(id);
    else ids.delete(id);
    this.writeSelection(Array.from(ids));
  }

  private async loadMore(): Promise<void> {
    const dataset = this._context.parameters.commentLog;
    if (dataset.loading) throw new Error('Comments are still loading. Try again when loading finishes.');
    const pending = this._pages.loadMore(() => dataset.paging.loadNextPage());
    this.requestRender();
    try {
      await pending;
    } finally {
      this.requestRender();
    }
  }

  private async selectAll(): Promise<void> {
    if (this._selectionBusy) return;
    this._selectionBusy = true;
    const generation = this._pages.generation;
    this.requestRender();
    try {
      while (this._pages.hasMore) {
        if (this._destroyed || generation !== this._pages.generation) {
          throw new DatasetOperationCancelled('The comment query changed.');
        }
        await this.loadMore();
      }
      if (!this._destroyed && generation === this._pages.generation) {
        this.writeSelection(this._pages.records.map(record => record.id));
      }
    } finally {
      this._selectionBusy = false;
      this.requestRender();
    }
  }

  private openComment(id: string): void {
    const record = this._pages.records.find(record => record.id === id);
    if (!record) throw new Error('This comment is no longer in the current list. Refresh the list and try again.');
    this._context.parameters.commentLog.openDatasetItem(record.entityReference);
  }

  private readonly loadAuthorPhoto = (author: RecordReference): Promise<string | undefined> =>
    this._dataverse.getImageUrl(author);

  private async buildCreateData(
    context: ComponentFramework.Context<IInputs>,
    entityName: string,
    fields: FieldMapping,
    model: CreateModel,
    parent: RecordReference,
  ): Promise<Record<string, unknown>> {
    if (!fields.body || !fields.uploadDate) throw new Error('Configure the Comment Body and Date columns before posting.');
    if (!nonEmptyString(model.body)) throw new Error('Enter a comment body before posting.');
    if (fields.title && !nonEmptyString(model.title)) throw new Error('Enter a comment title before posting.');
    const data: Record<string, unknown> = {
      [fields.body]: model.body,
    };
    data[fields.uploadDate] = new Date().toISOString();
    if (fields.title) data[fields.title] = model.title!.trim();
    const bindings: Promise<Record<string, string>>[] = [];
    if (fields.type) {
      const state = this.loadTypes(context, entityName, fields.type);
      if (state?.status !== 'ready') throw new Error('Comment types are unavailable. Refresh the list and try again.');
      const catalogue = state.value;
      const fixed = this.fixedType(context, catalogue);
      const type = fixed ?? model.typeValue;
      if (type === undefined || (fixed === undefined && !catalogue.options.some(option => option.selectable && option.value === type))) {
        throw new Error('The selected comment type is unavailable. Select another type and try again.');
      }
      if (catalogue.lookupTarget) {
        bindings.push(this._dataverse.getLookupBinding(entityName, fields.type, {
          id: requireGuid(type, 'Comment type'), entityName: catalogue.lookupTarget,
        }));
      } else {
        if (typeof type !== 'number') throw new Error('The selected comment type is not a Choice value.');
        data[fields.type] = type;
      }
    }
    if (fields.authorText) data[fields.authorText] = context.userSettings.userName;
    if (fields.authorLookup) {
      bindings.push(this._dataverse.getLookupBinding(entityName, fields.authorLookup, {
        id: requireGuid(context.userSettings.userId, 'Current user'), entityName: 'systemuser',
      }));
    }
    if (fields.relatedRecord) bindings.push(this._dataverse.getLookupBinding(entityName, fields.relatedRecord, parent));
    Object.assign(data, ...await Promise.all(bindings));
    return data;
  }

  private async createComment(model: CreateModel): Promise<boolean> {
    const context = this._context;
    const dataset = context.parameters.commentLog;
    try {
      const entityName = dataset.getTargetEntityType();
      const parent = this._host.getParent(context.mode);
      if (!entityName || !parent) throw new Error('Save the parent record before posting a comment.');
      const access = this._access.get(this.accessKey(entityName, parent));
      if (access?.status !== 'ready') throw new Error('Permissions could not be checked. Retry the permission check before posting.');
      if (!access.value.canCreate || this.isControlDisabled(context, access.value.canWriteParent)) {
        throw new Error('You do not have permission to post a comment on this record.');
      }
      const data = await this.buildCreateData(context, entityName, getFieldMapping(dataset), model, parent);
      if (this._destroyed) return false;
      await context.webAPI.createRecord(entityName, data);
    } catch (error) {
      this.showNotice({ level: 'error', message: `Comment could not be posted. ${errorMessage(error)}` });
      return false;
    }

    this.showNotice({ level: 'success', message: 'Comment posted successfully.' });
    try {
      dataset.refresh();
    } catch (error) {
      this.showNotice({ level: 'warning', message: `Comment posted, but the list could not be refreshed. ${errorMessage(error)}` });
    }
    return true;
  }

  private retry(): void {
    if (this._destroyed) return;
    this._types.clear();
    this._historicalTypes.clear();
    this._access.forEach((state, key) => { if (state.status === 'error') this._access.delete(key); });
    if (this._dataError) this.runOperation(() => this._context.parameters.commentLog.refresh());
    this.requestRender();
  }

  private runOperation(operation: () => void | Promise<void>): void {
    void Promise.resolve().then(() => {
      if (!this._destroyed) return operation();
      return undefined;
    }).catch((error: unknown) => {
      if (!(error instanceof DatasetOperationCancelled)) {
        this.showNotice({ level: 'error', message: errorMessage(error) });
      }
    });
  }

  private showNotice(notice: Notice): void {
    if (this._destroyed) return;
    void this._host.notify(notice);
  }

  private reportIssues(queryKey: string, issues: Notice[]): void {
    const current = new Set<string>();
    for (const notice of issues) {
      const key = JSON.stringify([queryKey, notice.message]);
      current.add(key);
      if (!this._reportedIssues.has(key)) {
        this.showNotice(notice);
      }
    }
    this._reportedIssues = current;
  }

  private requestRender(): void {
    if (!this._destroyed) this._context.factory.requestRender();
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    this._destroyed = true;
    this._pages.destroy();
    if (this._selectionIntent) clearTimeout(this._selectionIntent.timer);
    this._dataverse.destroy();
    this._host.destroy();
  }
}
