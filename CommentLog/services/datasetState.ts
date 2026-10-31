export class DatasetOperationCancelled extends Error {}

export interface DatasetSnapshot<T> {
  queryKey: string;
  records: T[];
  loading: boolean;
  hasMore: boolean;
  firstPage: number;
  lastPage: number;
  error?: string;
}

interface PageRequest {
  signature: string | undefined;
  sawLoading: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DatasetState<T extends { id: string }> {
  private byId = new Map<string, T>();
  private order: string[] = [];
  private signature?: string;
  private queryKey?: string;
  private sawLoading = false;
  private request?: PageRequest;
  private disposed = false;
  public hasMore = false;
  public generation = 0;

  public get records(): T[] {
    return this.order.map(id => this.byId.get(id)!);
  }

  public get isLoadingMore(): boolean {
    return this.request !== undefined;
  }

  public update(snapshot: DatasetSnapshot<T>): void {
    const queryChanged = snapshot.queryKey !== this.queryKey;
    if (queryChanged) {
      this.cancel('The comment query changed.');
      this.queryKey = snapshot.queryKey;
      this.signature = undefined;
      this.byId.clear();
      this.order = [];
      this.generation += 1;
    }
    if (snapshot.loading) {
      this.sawLoading = true;
      if (this.request) this.request.sawLoading = true;
      return;
    }
    if (snapshot.error) {
      this.finish(new Error(snapshot.error));
      return;
    }

    const signature = JSON.stringify([
      snapshot.records.map(record => record.id), snapshot.firstPage, snapshot.lastPage, snapshot.hasMore,
    ]);
    if (this.request) {
      if (signature === this.request.signature && !this.request.sawLoading) return;
      const previousCount = this.order.length;
      this.absorb(snapshot.records);
      this.hasMore = snapshot.hasMore;
      this.signature = signature;
      this.sawLoading = false;
      this.finish(this.order.length === previousCount && this.hasMore
        ? new Error('The next page contained no additional comments. Refresh the list before trying again.')
        : undefined);
      return;
    }

    if (queryChanged || signature !== this.signature || this.sawLoading) {
      this.byId.clear();
      this.order = [];
      this.generation += queryChanged ? 0 : 1;
    }
    this.absorb(snapshot.records);
    this.hasMore = snapshot.hasMore;
    this.signature = signature;
    this.sawLoading = false;
  }

  private absorb(records: T[]): void {
    for (const record of records) {
      if (!this.byId.has(record.id)) this.order.push(record.id);
      this.byId.set(record.id, record);
    }
  }

  public loadMore(requestPage: () => void, timeoutMs = 30000): Promise<void> {
    if (this.disposed) return Promise.reject(new DatasetOperationCancelled('The control was closed.'));
    if (this.request) return this.request.promise;
    if (!this.hasMore) return Promise.resolve();
    let resolvePage!: () => void;
    let rejectPage!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => { resolvePage = resolve; rejectPage = reject; });
    const timer = setTimeout(() => this.finish(new Error('Loading comments timed out. Try again or refresh the list.')), timeoutMs);
    this.request = { signature: this.signature, sawLoading: false, promise, resolve: resolvePage, reject: rejectPage, timer };
    try {
      requestPage();
    } catch (error) {
      this.finish(error instanceof Error ? error : new Error('The next page could not be requested.'));
    }
    return promise;
  }

  private finish(error?: Error): void {
    const request = this.request;
    if (!request) return;
    this.request = undefined;
    clearTimeout(request.timer);
    if (error) request.reject(error);
    else request.resolve();
  }

  public cancel(reason: string): void {
    this.finish(new DatasetOperationCancelled(reason));
  }

  public destroy(): void {
    this.disposed = true;
    this.cancel('The control was closed.');
  }
}