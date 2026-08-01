import { Result } from './result';
import {
  MockStorageArea,
  MockStoragePort,
  StorageQuotaConfig,
  StorageChangeMap,
  StorageChangeListener,
  StorageHarnessError,
  ContractTestResult,
  ContractTestFailure,
} from '../src/domain/ports/secondary/mockStoragePort';

interface FaultRule {
  type: 'read' | 'write' | 'quota';
  area?: MockStorageArea;
  keyPattern?: string;
}

export class StorageTestHarness implements MockStoragePort {
  private stores: Map<MockStorageArea, Map<string, string>> = new Map();
  private quotas: Map<MockStorageArea, StorageQuotaConfig> = new Map();
  private listeners: Set<StorageChangeListener> = new Set();
  private faults: FaultRule[] = [];
  private latencyMs: number = 0;

  constructor() {
    this.initDefaultQuotas();
    this.resetStores();
  }

  private initDefaultQuotas(): void {
    this.quotas.set('sync', { maxItemBytes: 8192, maxBytes: 102400, maxItems: 512, isReadOnly: false });
    this.quotas.set('local', { maxBytes: 10485760, isReadOnly: false });
    this.quotas.set('session', { maxBytes: 10485760, isReadOnly: false });
    this.quotas.set('managed', { maxBytes: 10485760, isReadOnly: true });
    this.quotas.set('localStorage', { maxBytes: 5242880, isReadOnly: false });
    this.quotas.set('sessionStorage', { maxBytes: 5242880, isReadOnly: false });
    this.quotas.set('indexedDB', { maxBytes: 52428800, isReadOnly: false });
  }

  private resetStores(): void {
    this.stores.clear();
  }

  public setQuotaConfig(area: MockStorageArea, config: Partial<StorageQuotaConfig>): void {
    const current = this.getQuotaConfig(area);
    this.quotas.set(area, { ...current, ...config });
  }

  public getQuotaConfig(area: MockStorageArea): StorageQuotaConfig {
    return this.quotas.get(area) || { maxBytes: 10485760, isReadOnly: false };
  }

  private async applyLatency(): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
  }

  private checkFault(type: 'read' | 'write', area: MockStorageArea, key?: string): StorageHarnessError | null {
    for (const fault of this.faults) {
      if (fault.type === 'quota' && type === 'write' && (!fault.area || fault.area === area)) {
        return new StorageHarnessError('QUOTA_EXCEEDED', `Simulated quota exceeded for area ${area}`, area);
      }
      if (fault.type === type && (!fault.area || fault.area === area)) {
        if (!fault.keyPattern || (key && key.includes(fault.keyPattern))) {
          return new StorageHarnessError('SIMULATED_FAULT', `Simulated ${type} fault for key '${key ?? ''}' in area ${area}`, area);
        }
      }
    }
    return null;
  }

  private getAreaStore(area: MockStorageArea): Map<string, string> {
    let store = this.stores.get(area);
    if (!store) {
      store = new Map<string, string>();
      this.stores.set(area, store);
    }
    return store;
  }

  private calculateBytes(key: string, rawJsonValue: string): number {
    return new TextEncoder().encode(key + rawJsonValue).length;
  }

  private emitChanges(changes: StorageChangeMap, area: MockStorageArea): void {
    if (Object.keys(changes).length === 0) return;
    this.listeners.forEach((listener) => {
      try {
        listener(changes, area);
      } catch {
        // Zero-throw fault isolation for listeners
      }
    });
  }

  public async getItem<T = unknown>(area: MockStorageArea, key: string): Promise<Result<T | null, StorageHarnessError>> {
    await this.applyLatency();
    const fault = this.checkFault('read', area, key);
    if (fault) return Result.err(fault);

    const store = this.getAreaStore(area);
    if (!store.has(key)) return Result.ok(null);

    const jsonStr = store.get(key)!;
    try {
      const parsed = JSON.parse(jsonStr) as T;
      return Result.ok(parsed);
    } catch (err) {
      return Result.err(new StorageHarnessError('DESERIALIZATION_FAILED', `Failed to parse value for key '${key}'`, area, err));
    }
  }

  public async getItems<T = Record<string, unknown>>(area: MockStorageArea, keys?: string | string[] | null): Promise<Result<T, StorageHarnessError>> {
    await this.applyLatency();
    const fault = this.checkFault('read', area);
    if (fault) return Result.err(fault);

    const store = this.getAreaStore(area);
    const resultObj: Record<string, unknown> = {};

    let targetKeys: string[];
    if (keys === null || keys === undefined) {
      targetKeys = Array.from(store.keys());
    } else if (typeof keys === 'string') {
      targetKeys = [keys];
    } else {
      targetKeys = keys;
    }

    for (const key of targetKeys) {
      if (store.has(key)) {
        try {
          resultObj[key] = JSON.parse(store.get(key)!);
        } catch (err) {
          return Result.err(new StorageHarnessError('DESERIALIZATION_FAILED', `Failed to parse key '${key}'`, area, err));
        }
      }
    }

    return Result.ok(resultObj as T);
  }

  public async setItem<T = unknown>(area: MockStorageArea, key: string, value: T): Promise<Result<void, StorageHarnessError>> {
    return this.setItems(area, { [key]: value });
  }

  public async setItems(area: MockStorageArea, items: Record<string, unknown>): Promise<Result<void, StorageHarnessError>> {
    await this.applyLatency();
    const quotaConfig = this.getQuotaConfig(area);
    if (quotaConfig.isReadOnly) {
      return Result.err(new StorageHarnessError('READ_ONLY_AREA', `Storage area '${area}' is read-only`, area));
    }

    const store = this.getAreaStore(area);
    const serializedMap = new Map<string, string>();

    for (const [key, val] of Object.entries(items)) {
      const fault = this.checkFault('write', area, key);
      if (fault) return Result.err(fault);

      let jsonStr: string;
      try {
        const valToSerialize = val === undefined ? null : val;
        jsonStr = JSON.stringify(valToSerialize);
        if (jsonStr === undefined) jsonStr = 'null';
      } catch (err) {
        return Result.err(new StorageHarnessError('SERIALIZATION_FAILED', `Value for key '${key}' is not JSON-serializable`, area, err));
      }

      const itemBytes = this.calculateBytes(key, jsonStr);
      if (quotaConfig.maxItemBytes && itemBytes > quotaConfig.maxItemBytes) {
        return Result.err(new StorageHarnessError('QUOTA_EXCEEDED', `Item '${key}' bytes (${itemBytes}) exceeds maxItemBytes (${quotaConfig.maxItemBytes})`, area));
      }

      serializedMap.set(key, jsonStr);
    }

    // Check total quota and max items
    let currentTotalBytes = 0;
    store.forEach((val, k) => {
      if (!serializedMap.has(k)) {
        currentTotalBytes += this.calculateBytes(k, val);
      }
    });
    serializedMap.forEach((val, k) => {
      currentTotalBytes += this.calculateBytes(k, val);
    });

    if (quotaConfig.maxBytes && currentTotalBytes > quotaConfig.maxBytes) {
      return Result.err(new StorageHarnessError('QUOTA_EXCEEDED', `Storage area '${area}' total bytes (${currentTotalBytes}) exceeds maxBytes (${quotaConfig.maxBytes})`, area));
    }

    const newTotalItems = store.size + Array.from(serializedMap.keys()).filter((k) => !store.has(k)).length;
    if (quotaConfig.maxItems && newTotalItems > quotaConfig.maxItems) {
      return Result.err(new StorageHarnessError('QUOTA_EXCEEDED', `Storage area '${area}' total items (${newTotalItems}) exceeds maxItems (${quotaConfig.maxItems})`, area));
    }

    // Apply mutations and collect change events
    const changes: StorageChangeMap = {};
    serializedMap.forEach((jsonStr, key) => {
      const oldRaw = store.get(key);
      const oldParsed = oldRaw !== undefined ? JSON.parse(oldRaw) : undefined;
      const newParsed = JSON.parse(jsonStr);

      if (oldRaw !== jsonStr) {
        store.set(key, jsonStr);
        changes[key] = { oldValue: oldParsed, newValue: newParsed };
      }
    });

    this.emitChanges(changes, area);
    return Result.ok(undefined);
  }

  public async removeItem(area: MockStorageArea, key: string): Promise<Result<void, StorageHarnessError>> {
    return this.removeItems(area, [key]);
  }

  public async removeItems(area: MockStorageArea, keys: string[]): Promise<Result<void, StorageHarnessError>> {
    await this.applyLatency();
    const quotaConfig = this.getQuotaConfig(area);
    if (quotaConfig.isReadOnly) {
      return Result.err(new StorageHarnessError('READ_ONLY_AREA', `Storage area '${area}' is read-only`, area));
    }

    const store = this.getAreaStore(area);
    const changes: StorageChangeMap = {};

    for (const key of keys) {
      const fault = this.checkFault('write', area, key);
      if (fault) return Result.err(fault);

      if (store.has(key)) {
        const oldRaw = store.get(key)!;
        const oldParsed = JSON.parse(oldRaw);
        store.delete(key);
        changes[key] = { oldValue: oldParsed, newValue: undefined };
      }
    }

    this.emitChanges(changes, area);
    return Result.ok(undefined);
  }

  public async clear(area: MockStorageArea): Promise<Result<void, StorageHarnessError>> {
    await this.applyLatency();
    const quotaConfig = this.getQuotaConfig(area);
    if (quotaConfig.isReadOnly) {
      return Result.err(new StorageHarnessError('READ_ONLY_AREA', `Storage area '${area}' is read-only`, area));
    }

    const fault = this.checkFault('write', area);
    if (fault) return Result.err(fault);

    const store = this.getAreaStore(area);
    const changes: StorageChangeMap = {};

    store.forEach((val, key) => {
      changes[key] = { oldValue: JSON.parse(val), newValue: undefined };
    });

    store.clear();
    this.emitChanges(changes, area);
    return Result.ok(undefined);
  }

  public async getBytesInUse(area: MockStorageArea, keys?: string | string[] | null): Promise<Result<number, StorageHarnessError>> {
    await this.applyLatency();
    const fault = this.checkFault('read', area);
    if (fault) return Result.err(fault);

    const store = this.getAreaStore(area);
    let totalBytes = 0;

    let targetKeys: string[] | null = null;
    if (typeof keys === 'string') targetKeys = [keys];
    else if (Array.isArray(keys)) targetKeys = keys;

    store.forEach((val, key) => {
      if (!targetKeys || targetKeys.includes(key)) {
        totalBytes += this.calculateBytes(key, val);
      }
    });

    return Result.ok(totalBytes);
  }

  public seed(area: MockStorageArea, items: Record<string, unknown>): void {
    const store = this.getAreaStore(area);
    Object.entries(items).forEach(([k, v]) => {
      const valToSerialize = v === undefined ? null : v;
      store.set(k, JSON.stringify(valToSerialize));
    });
  }

  public snapshot(): Record<MockStorageArea, Record<string, unknown>> {
    const snap: Record<string, Record<string, unknown>> = {};
    this.stores.forEach((storeMap, area) => {
      const areaObj: Record<string, unknown> = {};
      storeMap.forEach((val, k) => {
        areaObj[k] = JSON.parse(val);
      });
      snap[area] = areaObj;
    });
    return snap as Record<MockStorageArea, Record<string, unknown>>;
  }

  public restoreSnapshot(state: Partial<Record<MockStorageArea, Record<string, unknown>>>): void {
    this.reset();
    Object.entries(state).forEach(([areaName, items]) => {
      if (items) {
        this.seed(areaName as MockStorageArea, items);
      }
    });
  }

  public reset(): void {
    this.stores.clear();
    this.listeners.clear();
    this.faults = [];
    this.latencyMs = 0;
    this.initDefaultQuotas();
  }

  public injectReadFault(area?: MockStorageArea, keyPattern?: string): void {
    this.faults.push({ type: 'read', area, keyPattern });
  }

  public injectWriteFault(area?: MockStorageArea, keyPattern?: string): void {
    this.faults.push({ type: 'write', area, keyPattern });
  }

  public injectQuotaFault(area?: MockStorageArea): void {
    this.faults.push({ type: 'quota', area });
  }

  public injectLatency(delayMs: number): void {
    this.latencyMs = delayMs;
  }

  public clearFaults(): void {
    this.faults = [];
    this.latencyMs = 0;
  }

  public onChanged(listener: StorageChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async runContractTests(targetPort: MockStoragePort): Promise<Result<ContractTestResult, StorageHarnessError>> {
    const failures: ContractTestFailure[] = [];
    let passed = 0;

    const runTest = async (testName: string, fn: () => Promise<void>) => {
      try {
        await fn();
        passed++;
      } catch (err: any) {
        failures.push({ testName, error: err?.message || String(err) });
      }
    };

    // Contract Test 1: Basic Write and Read
    await runTest('Contract: Set and Get Item', async () => {
      targetPort.reset();
      const setRes = await targetPort.setItem('local', 'contractKey', { active: true });
      if (!setRes.ok) throw new Error(`setItem failed: ${setRes.error.message}`);
      const getRes = await targetPort.getItem<{ active: boolean }>('local', 'contractKey');
      if (!getRes.ok) throw new Error(`getItem failed: ${getRes.error.message}`);
      if (!getRes.value || getRes.value.active !== true) throw new Error(`Expected value { active: true }, got ${JSON.stringify(getRes.value)}`);
    });

    // Contract Test 2: Remove Item
    await runTest('Contract: Remove Item', async () => {
      targetPort.reset();
      await targetPort.setItem('local', 'remKey', 'hello');
      const remRes = await targetPort.removeItem('local', 'remKey');
      if (!remRes.ok) throw new Error(`removeItem failed: ${remRes.error.message}`);
      const getRes = await targetPort.getItem('local', 'remKey');
      if (!getRes.ok || getRes.value !== null) throw new Error('Expected key to be null after removal');
    });

    // Contract Test 3: Clear Storage Area
    await runTest('Contract: Clear Area', async () => {
      targetPort.reset();
      await targetPort.setItems('local', { k1: 1, k2: 2 });
      const clrRes = await targetPort.clear('local');
      if (!clrRes.ok) throw new Error(`clear failed: ${clrRes.error.message}`);
      const getRes = await targetPort.getItems('local', null);
      if (!getRes.ok || Object.keys(getRes.value).length !== 0) throw new Error('Expected storage area to be empty after clear');
    });

    // Contract Test 4: Read-Only Enforcement on Managed Area
    await runTest('Contract: Managed Area Read-Only Protection', async () => {
      targetPort.reset();
      const setRes = await targetPort.setItem('managed', 'adminKey', 'val');
      if (setRes.ok) throw new Error('Expected managed area write to return error');
      if (setRes.error.code !== 'READ_ONLY_AREA') throw new Error(`Expected READ_ONLY_AREA code, got ${setRes.error.code}`);
    });

    // Contract Test 5: Storage Event Emission
    await runTest('Contract: Event Dispatch on Mutation', async () => {
      targetPort.reset();
      let eventFired = false;
      const unsub = targetPort.onChanged((changes, area) => {
        if (area === 'local' && changes['evtKey'] && changes['evtKey'].newValue === 'evtVal') {
          eventFired = true;
        }
      });
      await targetPort.setItem('local', 'evtKey', 'evtVal');
      unsub();
      if (!eventFired) throw new Error('Expected onChanged listener to be invoked on setItem');
    });

    return Result.ok({ passed, failed: failures.length, failures });
  }
}
