import type { Notice, RecordReference } from '../types/commentLogTypes';
import { errorMessage, normaliseGuid, nonEmptyString } from '../utils/values';

interface HostXrm {
  Utility?: {
    getGlobalContext?: () => { getClientUrl?: () => string };
    getEntityMetadata?: (entityName: string) => Promise<unknown>;
  };
  Navigation?: {
    openForm?: (options: { entityName: string; entityId: string }) => Promise<unknown>;
  };
  App?: {
    addGlobalNotification(notification: {
      type: number;
      level: number;
      message: string;
      showCloseButton: boolean;
      action?: { actionLabel: string; eventHandler: () => void };
    }): Promise<string>;
    clearGlobalNotification?: (id: string) => Promise<unknown>;
  };
  Page?: {
    getAttribute?: (name: string) => { getValue?: () => unknown } | null;
    ui?: { getFormType?: () => number };
  };
}

export class ModelDrivenHost {
  private disposed = false;

  private get xrm(): HostXrm | undefined {
    return (window as Window & { Xrm?: HostXrm }).Xrm;
  }

  public getClientUrl(): string {
    const url = nonEmptyString(this.xrm?.Utility?.getGlobalContext?.()?.getClientUrl?.());
    if (!url) throw new Error('The Dataverse organisation URL is unavailable. Reload the form and try again.');
    return url.replace(/\/$/, '');
  }

  public getParent(mode: ComponentFramework.Mode): RecordReference | undefined {
    const info = (mode as ComponentFramework.Mode & {
      contextInfo?: { entityId?: string; entityTypeName?: string };
    }).contextInfo;
    const id = normaliseGuid(info?.entityId);
    const entityName = nonEmptyString(info?.entityTypeName);
    return id && entityName ? { id, entityName } : undefined;
  }

  public isParentInactive(): boolean {
    const page = this.xrm?.Page;
    const formType = page?.ui?.getFormType?.();
    if (formType === 4) return true;
    if (formType === 3) return false;
    const state = page?.getAttribute?.('statecode')?.getValue?.();
    return typeof state === 'number' && state !== 0;
  }

  public getEntityMetadata(entityName: string): Promise<unknown> | undefined {
    return this.xrm?.Utility?.getEntityMetadata?.(entityName);
  }

  public async openAuthor(author: RecordReference): Promise<void> {
    const navigation = this.xrm?.Navigation;
    if (!navigation?.openForm) throw new Error('Record navigation is unavailable. Reload the form and try again.');
    await navigation.openForm({ entityName: author.entityName, entityId: author.id });
  }

  public async notify(notice: Notice): Promise<void> {
    const app = this.xrm?.App;
    if (!app || this.disposed) return;
    try {
      const id = await app.addGlobalNotification({
        type: 1,
        level: notice.level === 'success' ? 1 : notice.level === 'error' ? 2 : 3,
        message: notice.message,
        showCloseButton: true,
        ...(notice.action ? { action: { actionLabel: notice.action.label, eventHandler: notice.action.onClick } } : {}),
      });
      if (notice.level === 'success' && app.clearGlobalNotification) {
        setTimeout(() => {
          void app.clearGlobalNotification?.(id).catch(error => console.warn(errorMessage(error)));
        }, 3000);
      }
    } catch (error) {
      console.warn(`Could not display a global notification: ${errorMessage(error)}`);
    }
  }

  public destroy(): void {
    this.disposed = true;
  }
}
