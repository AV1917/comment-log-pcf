import type { RecordReference, TypeOption } from '../types/commentLogTypes';
import { isRecord, nonEmptyString, normaliseColour, requireGuid } from '../utils/values';
import type { ModelDrivenHost } from './modelDrivenHost';

interface EntityDefinition {
  entitySetName: string;
  primaryImageAttribute?: string;
}

const logicalName = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Invalid Dataverse logical name: ${name}`);
  return name;
};

export class DataverseService {
  private readonly entities = new Map<string, Promise<EntityDefinition>>();
  private readonly choices = new Map<string, Promise<TypeOption[]>>();
  private readonly navigationProperties = new Map<string, Promise<string>>();
  private readonly abortController = new AbortController();

  public constructor(private readonly host: ModelDrivenHost, private readonly languageId: number) {}

  private cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = load().catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
    return pending;
  }

  public get apiBase(): string {
    return `${this.host.getClientUrl()}/api/data/v9.2`;
  }

  public async fetchJson(path: string): Promise<unknown> {
    const response = await fetch(`${this.apiBase}/${path}`, {
      credentials: 'same-origin',
      signal: this.abortController.signal,
      headers: { 'OData-MaxVersion': '4.0', 'OData-Version': '4.0', Accept: 'application/json' },
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

  public getChoices(entityName: string, attributeName: string): Promise<TypeOption[]> {
    return this.cached(this.choices, `${entityName}|${attributeName}`, async () => {
      const path = `EntityDefinitions(LogicalName='${logicalName(entityName)}')/Attributes(LogicalName='${logicalName(attributeName)}')`;
      const metadata = await this.fetchJson(`${path}?$select=AttributeType`);
      const type = isRecord(metadata) ? metadata.AttributeType : undefined;
      if (type !== 'Picklist' && type !== 'State' && type !== 'Status') {
        throw new Error(`${attributeName} is not a choice, state, or status reason column.`);
      }
      const json = await this.fetchJson(`${path}/Microsoft.Dynamics.CRM.${type}AttributeMetadata?$expand=OptionSet($select=Options)`);
      if (!isRecord(json)) throw new Error(`Invalid choice metadata for ${attributeName}.`);
      const options: unknown = isRecord(json.OptionSet) ? json.OptionSet.Options : undefined;
      if (!Array.isArray(options)) throw new Error(`No choice options were returned for ${attributeName}.`);
      return options.map((option: unknown) => {
        if (!isRecord(option) || typeof option.Value !== 'number' || !Number.isInteger(option.Value)) {
          throw new Error(`Invalid choice value in ${attributeName} metadata.`);
        }
        const result: TypeOption = {
          value: option.Value,
          label: this.optionLabel(option.Label) ?? String(option.Value),
          color: normaliseColour(option.Color),
        };
        if (typeof option.IsHidden === 'boolean') result.isHidden = option.IsHidden;
        const state: unknown = type === 'State' ? option.Value : option.State;
        if (typeof state === 'number' && Number.isInteger(state)) result.state = state;
        return result;
      }).sort((left, right) => left.value - right.value);
    });
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