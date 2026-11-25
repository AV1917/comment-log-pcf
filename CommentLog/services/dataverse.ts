import type { RecordReference, TypeCatalogue, TypeOption } from '../types/commentLogTypes';
import { defaultTypeColour, isRecord, nonEmptyString, normaliseColour, requireGuid } from '../utils/values';
import type { ModelDrivenHost } from './modelDrivenHost';

interface EntityDefinition {
  entitySetName: string;
  primaryImageAttribute?: string;
}

type TypeDefinition =
  | { kind: 'choice'; options: TypeOption[] }
  | { kind: 'lookup'; target: string; entitySet: string; idColumn: string; nameColumn: string };
type LookupDefinition = Extract<TypeDefinition, { kind: 'lookup' }>;

const parseXml = (xml: string, root: string): XMLDocument => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.documentElement.tagName !== root || doc.getElementsByTagName('parsererror').length) {
    throw new Error(`Dataverse returned invalid ${root} XML.`);
  }
  return doc;
};

const rows = (json: unknown): Record<string, unknown>[] => {
  if (!isRecord(json) || !Array.isArray(json.value) || !json.value.every(isRecord)) {
    throw new Error('Dataverse returned an invalid record collection.');
  }
  return json.value;
};

const logicalName = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Invalid Dataverse logical name: ${name}`);
  return name;
};

export class DataverseService {
  private readonly entities = new Map<string, Promise<EntityDefinition>>();
  private readonly typeDefinitions = new Map<string, Promise<TypeDefinition>>();
  private readonly navigationProperties = new Map<string, Promise<string>>();
  private readonly abortController = new AbortController();

  public constructor(private readonly host: ModelDrivenHost, private readonly languageId: number) {}

  private cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = load().catch((error: unknown) => {
      if (cache.get(key) === pending) cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
    return pending;
  }

  public get apiBase(): string {
    return `${this.host.getClientUrl()}/api/data/v9.2`;
  }

  public clearTypeMetadata(): void {
    this.typeDefinitions.clear();
  }

  public async fetchJson(path: string, prefer?: string): Promise<unknown> {
    const response = await fetch(`${this.apiBase}/${path}`, {
      credentials: 'same-origin',
      signal: this.abortController.signal,
      headers: { 'OData-MaxVersion': '4.0', 'OData-Version': '4.0', Accept: 'application/json',
        ...(prefer ? { Prefer: prefer } : {}) },
    });
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error(`Dataverse returned an invalid response (${response.status} ${response.statusText}).`);
    }
    if (!response.ok) {
      const detail = isRecord(json) && isRecord(json.error) ? nonEmptyString(json.error.message) : undefined;
      throw new Error(detail ?? `Dataverse request failed (${response.status} ${response.statusText}).`);
    }
    return json;
  }

  public getEntity(entityName: string): Promise<EntityDefinition> {
    return this.cached(this.entities, entityName, async () => {
      logicalName(entityName);
      const metadata = await this.host.getEntityMetadata(entityName);
      if (!isRecord(metadata) || !nonEmptyString(metadata.EntitySetName)) {
        throw new Error(`Dataverse did not return an entity set for ${entityName}.`);
      }
      return {
        entitySetName: logicalName(metadata.EntitySetName as string),
        primaryImageAttribute: nonEmptyString(metadata.PrimaryImageAttribute),
      };
    });
  }

  private getTypeDefinition(entityName: string, attributeName: string): Promise<TypeDefinition> {
    return this.cached(this.typeDefinitions, `${entityName}|${attributeName}`, async () => {
      const path = `EntityDefinitions(LogicalName='${logicalName(entityName)}')/Attributes(LogicalName='${logicalName(attributeName)}')`;
      const metadata = await this.fetchJson(`${path}?$select=AttributeType`);
      const type = isRecord(metadata) ? metadata.AttributeType : undefined;
      if (type === 'Lookup') {
        const lookup = await this.fetchJson(`${path}/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=Targets`);
        const targets: unknown = isRecord(lookup) ? lookup.Targets : undefined;
        if (!Array.isArray(targets) || targets.length !== 1 || typeof targets[0] !== 'string') {
          throw new Error('Comment Type must be a single-table lookup.');
        }
        const target = logicalName(targets[0]);
        const definition = await this.fetchJson(`EntityDefinitions(LogicalName='${target}')?$select=EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute`);
        if (!isRecord(definition) || typeof definition.EntitySetName !== 'string' ||
          typeof definition.PrimaryIdAttribute !== 'string' || typeof definition.PrimaryNameAttribute !== 'string') {
          throw new Error(`Could not resolve the primary name and ID of ${target}.`);
        }
        return {
          kind: 'lookup', target, entitySet: logicalName(definition.EntitySetName),
          idColumn: logicalName(definition.PrimaryIdAttribute), nameColumn: logicalName(definition.PrimaryNameAttribute),
        };
      }
      if (type !== 'Picklist' && type !== 'State' && type !== 'Status') {
        throw new Error(`${attributeName} is not a choice, status reason, or lookup column.`);
      }
      const json = await this.fetchJson(`${path}/Microsoft.Dynamics.CRM.${type}AttributeMetadata?$expand=OptionSet($select=Options)`);
      if (!isRecord(json)) throw new Error(`Invalid choice metadata for ${attributeName}.`);
      const options: unknown = isRecord(json.OptionSet) ? json.OptionSet.Options : undefined;
      if (!Array.isArray(options)) throw new Error(`No choice options were returned for ${attributeName}.`);
      const choiceOptions = options.map((option: unknown) => {
        if (!isRecord(option) || typeof option.Value !== 'number' || !Number.isInteger(option.Value)) {
          throw new Error(`Invalid choice value in ${attributeName} metadata.`);
        }
        const state: unknown = type === 'State' ? option.Value : option.State;
        return {
          value: option.Value,
          label: this.optionLabel(option.Label) ?? String(option.Value),
          color: normaliseColour(option.Color),
          selectable: option.IsHidden !== true && (typeof state !== 'number' || state === 0),
        };
      }).sort((left, right) => left.value - right.value);
      const fallbackColour = choiceOptions.some(option => option.color !== undefined) ? defaultTypeColour : undefined;
      return {
        kind: 'choice',
        options: choiceOptions.map(option => ({ ...option, color: option.color ?? fallbackColour })),
      };
    });
  }

  private async lookupView(target: string, configuredView?: string): Promise<string> {
    const columns = '$select=fetchxml,returnedtypecode,statecode';
    let view: unknown;
    if (configuredView) {
      view = await this.fetchJson(`savedqueries(${requireGuid(configuredView, 'Type View')})?${columns}`);
    } else {
      // https://pcfhub.dev/components/pcf-lookup-search/docs/api
      const filter = encodeURIComponent(`returnedtypecode eq '${target}' and querytype eq 64 and statecode eq 0`);
      const defaults = rows(await this.fetchJson(`savedqueries?${columns}&$filter=${filter}`));
      if (defaults.length !== 1) throw new Error(`Could not resolve a unique default Lookup View for ${target}. Configure Type View explicitly.`);
      view = defaults[0];
    }
    if (!isRecord(view) || view.returnedtypecode !== target || view.statecode !== 0 || typeof view.fetchxml !== 'string') {
      throw new Error(`Type View must be an active system view on ${target}.`);
    }
    return view.fetchxml;
  }

  private async fetchViewRows(definition: LookupDefinition, xml: string, columns: string[]): Promise<Record<string, unknown>[]> {
    const doc = parseXml(xml, 'fetch');
    const fetch = doc.documentElement;
    const entity = Array.from(fetch.children).find(child => child.tagName === 'entity');
    if (!entity || entity.getAttribute('name') !== definition.target || fetch.getAttribute('aggregate') === 'true') {
      throw new Error('Type View must return individual records from the lookup target table.');
    }
    if (!Array.from(entity.children).some(child => child.tagName === 'all-attributes')) {
      for (const name of columns) {
        if (Array.from(entity.children).some(child => child.tagName === 'attribute' &&
          child.getAttribute('name') === name && !child.hasAttribute('alias'))) continue;
        const attribute = doc.createElement('attribute');
        attribute.setAttribute('name', name);
        entity.insertBefore(attribute, entity.firstChild);
      }
    }
    const result: Record<string, unknown>[] = [];
    fetch.removeAttribute('paging-cookie');
    fetch.removeAttribute('page');
    if (!fetch.hasAttribute('top')) fetch.setAttribute('count', '500');
    else fetch.removeAttribute('count');
    const serializer = new XMLSerializer();
    for (let page = 1; ; page++) {
      if (!fetch.hasAttribute('top')) fetch.setAttribute('page', String(page));
      const json = await this.fetchJson(
        `${definition.entitySet}?fetchXml=${encodeURIComponent(serializer.serializeToString(doc))}`,
        'odata.include-annotations="Microsoft.Dynamics.CRM.fetchxmlpagingcookie,Microsoft.Dynamics.CRM.morerecords"',
      );
      result.push(...rows(json));
      if (!isRecord(json) || json['@Microsoft.Dynamics.CRM.morerecords'] !== true) return result;
      if (fetch.hasAttribute('top')) throw new Error('Type View returned unexpected additional pages.');
      const cookie = json['@Microsoft.Dynamics.CRM.fetchxmlpagingcookie'];
      if (typeof cookie === 'string') {
        const encoded = parseXml(cookie, 'cookie').documentElement.getAttribute('pagingcookie');
        if (!encoded) throw new Error('Dataverse returned an invalid Type View paging cookie.');
        fetch.setAttribute('paging-cookie', decodeURIComponent(decodeURIComponent(encoded)));
      } else {
        fetch.removeAttribute('paging-cookie');
        if (page >= 100) throw new Error('Type View exceeds the Dataverse simple paging limit. Narrow the view.');
      }
    }
  }

  public async getTypes(
    entityName: string, attributeName: string, configuredView: string | undefined,
    configuredColour: string | undefined, historicalIds: string[], includePicker = true,
  ): Promise<TypeCatalogue> {
    const definition = await this.getTypeDefinition(entityName, attributeName);
    if (definition.kind === 'choice') return { options: definition.options };
    const colour = configuredColour ? logicalName(configuredColour) : undefined;
    const columns = Array.from(new Set([definition.idColumn, definition.nameColumn, ...(colour ? [colour] : [])]));
    const options = new Map<string, TypeOption>();
    const add = (records: Record<string, unknown>[], selectable: boolean) => {
      for (const record of records) {
        const id = requireGuid(record[definition.idColumn], 'Comment type');
        if (!options.has(id)) options.set(id, {
          value: id,
          label: nonEmptyString(record[definition.nameColumn]) ?? id,
          color: colour ? normaliseColour(record[colour]) ?? defaultTypeColour : undefined,
          selectable,
        });
      }
    };
    if (includePicker) {
      const view = await this.lookupView(definition.target, configuredView);
      add(await this.fetchViewRows(definition, view, columns), true);
    }
    const missing = Array.from(new Set(historicalIds)).filter(id => !options.has(id));
    for (let start = 0; start < missing.length; start += 50) {
      const filter = missing.slice(start, start + 50).map(id => `${definition.idColumn} eq ${requireGuid(id, 'Comment type')}`).join(' or ');
      add(rows(await this.fetchJson(`${definition.entitySet}?$select=${columns.join(',')}&$filter=${encodeURIComponent(filter)}`)), false);
    }
    return { lookupTarget: definition.target, options: Array.from(options.values()) };
  }

  private optionLabel(label: unknown): string | undefined {
    if (!isRecord(label)) return undefined;
    if (isRecord(label.UserLocalizedLabel)) {
      const localized = nonEmptyString(label.UserLocalizedLabel.Label);
      if (localized) return localized;
    }
    if (!Array.isArray(label.LocalizedLabels)) return undefined;
    const labels = label.LocalizedLabels.filter(isRecord);
    const localized = labels.find(item => item.LanguageCode === this.languageId) ?? labels[0];
    return localized ? nonEmptyString(localized.Label) : undefined;
  }

  private getNavigationProperty(entityName: string, attributeName: string, targetEntityName: string): Promise<string> {
    const key = `${entityName}|${attributeName}|${targetEntityName}`;
    return this.cached(this.navigationProperties, key, async () => {
      logicalName(entityName);
      logicalName(attributeName);
      logicalName(targetEntityName);
      const filter = encodeURIComponent(`ReferencingAttribute eq '${attributeName}' and ReferencedEntity eq '${targetEntityName}'`);
      const json = await this.fetchJson(
        `EntityDefinitions(LogicalName='${entityName}')/ManyToOneRelationships` +
        `?$select=ReferencingEntityNavigationPropertyName&$filter=${filter}`,
      );
      const relationships = isRecord(json) && Array.isArray(json.value) ? json.value.filter(isRecord) : [];
      const property = relationships.length === 1
        ? nonEmptyString(relationships[0].ReferencingEntityNavigationPropertyName)
        : undefined;
      if (!property) {
        throw new Error(`Could not resolve the ${entityName}.${attributeName} relationship to ${targetEntityName}. The comment was not posted.`);
      }
      return property;
    });
  }

  public async getLookupBinding(entityName: string, attributeName: string, target: RecordReference): Promise<Record<string, string>> {
    const id = requireGuid(target.id, 'Lookup target');
    const [property, entity] = await Promise.all([
      this.getNavigationProperty(entityName, attributeName, target.entityName),
      this.getEntity(target.entityName),
    ]);
    return { [`${property}@odata.bind`]: `/${entity.entitySetName}(${id})` };
  }

  public async getImageUrl(author: RecordReference): Promise<string | undefined> {
    const entity = await this.getEntity(author.entityName);
    return entity.primaryImageAttribute
      ? `${this.apiBase}/${entity.entitySetName}(${author.id})/${logicalName(entity.primaryImageAttribute)}/$value`
      : undefined;
  }

  public async canWrite(parent: RecordReference, userId: string): Promise<boolean> {
    const entity = await this.getEntity(parent.entityName);
    const target = encodeURIComponent(JSON.stringify({ '@odata.id': `${entity.entitySetName}(${parent.id})` }));
    const json = await this.fetchJson(
      `systemusers(${requireGuid(userId, 'Current user')})/Microsoft.Dynamics.CRM.RetrievePrincipalAccess(Target=@Target)?@Target=${target}`,
    );
    if (!isRecord(json)) throw new Error('Dataverse returned an invalid access check response.');
    if (typeof json.AccessRights === 'string') {
      return json.AccessRights.split(',').some(right => right.trim() === 'WriteAccess');
    }
    throw new Error('Dataverse did not return access rights for the parent record.');
  }

  public destroy(): void {
    this.abortController.abort();
  }
}
