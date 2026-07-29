import { Result } from './result';
import { parseStackTrace, filterInternalFrames, StackFrame } from './stackParser';
import { ScriptOrigin, BlameActor, type ActorType } from '../src/domain/model/dataBlameValueObjects';

export type { ActorType };
export { ScriptOrigin, BlameActor };

export interface DataBlameInfo {
  key: string;
  lastModifiedAt: string;
  actor: BlameActor;
  revisionCount: number;
  previousValue?: string;
}

export type DataBlameError = {
  code: string;
  message: string;
};

interface KeyHistory {
  currentValue: string;
  previousValue?: string;
  revisionCount: number;
  lastModifiedAt: string;
  actorInfo?: BlameActor;
}

function extractFilename(url: string): string {
  if (!url || url === 'unknown') return 'unknown';
  try {
    const parts = url.split('/');
    const last = parts[parts.length - 1] || url;
    return last.split('?')[0].split('#')[0] || last;
  } catch {
    return url;
  }
}

const EXTENSION_PATTERNS = ['chrome-extension://', 'moz-extension://', 'extension'];
const ANALYTICS_PATTERNS = ['analytics', 'gtag', 'pixel'];
const USER_ACTION_FUNC_PATTERNS = [
  'onclick',
  'click',
  'eventlistener',
  'toggle',
  'submit',
  'user',
];
const USER_ACTION_RAW_PATTERNS = ['htmlbuttonelement', 'onclick'];

function isExtensionActor(url: string): boolean {
  return EXTENSION_PATTERNS.some((pattern) => url.includes(pattern));
}

function isAnalyticsActor(url: string, func: string): boolean {
  return ANALYTICS_PATTERNS.some((pattern) => url.includes(pattern)) || func.includes('analytics');
}

function isUserActionActor(func: string, raw: string): boolean {
  return (
    USER_ACTION_FUNC_PATTERNS.some((pattern) => func.includes(pattern)) ||
    USER_ACTION_RAW_PATTERNS.some((pattern) => raw.includes(pattern))
  );
}

function getUserActionName(funcName: string, filename: string): string {
  return funcName !== 'anonymous' ? funcName : `Click on ${filename}`;
}

function getScriptName(funcName: string, filename: string): string {
  return funcName !== 'anonymous' ? `${funcName} (${filename})` : `Script (${filename})`;
}

function classifyActor(frame?: StackFrame): { name: string; type: ActorType } {
  if (!frame) {
    return { name: 'Script (unknown)', type: 'script' };
  }

  const url = frame.scriptUrl.toLowerCase();
  const func = frame.functionName.toLowerCase();
  const raw = frame.rawLine.toLowerCase();
  const filename = extractFilename(frame.scriptUrl);

  if (isExtensionActor(url)) {
    return { name: `Extension (${filename})`, type: 'extension' };
  }

  if (isAnalyticsActor(url, func)) {
    return { name: `Analytics (${filename})`, type: 'analytics' };
  }

  if (isUserActionActor(func, raw)) {
    return { name: `User Action (${getUserActionName(frame.functionName, filename)})`, type: 'user_action' };
  }

  return { name: getScriptName(frame.functionName, filename), type: 'script' };
}

function buildActorFromStack(rawStack?: string): BlameActor {
  const stack = rawStack || new Error().stack || '';
  const parsed = parseStackTrace(stack);
  const filtered = filterInternalFrames(parsed);
  const topFrame = filtered[0];

  const { name, type } = classifyActor(topFrame);
  const snippet = filtered.length > 0 ? filtered.map((f) => f.rawLine).join('\n') : undefined;

  let origin: ScriptOrigin | undefined;
  if (topFrame) {
    const originRes = ScriptOrigin.create(
      topFrame.scriptUrl,
      topFrame.functionName,
      topFrame.lineNumber,
      topFrame.columnNumber
    );
    if (originRes.ok) {
      origin = originRes.value;
    }
  }

  const actorRes = BlameActor.create(name, type, origin, snippet);
  if (actorRes.ok) {
    return actorRes.value;
  }

  // Safe fallback if BlameActor creation fails
  const defaultOrigin = ScriptOrigin.create('unknown', 'anonymous', 0, 0);
  const fallbackOrigin = defaultOrigin.ok ? defaultOrigin.value : undefined;
  const fallbackRes = BlameActor.create('Script (unknown)', 'script', fallbackOrigin);
  if (fallbackRes.ok) {
    return fallbackRes.value;
  }
  throw new Error('Failed to create fallback BlameActor');
}

export class DataBlameRegistry {
  private static instance = new DataBlameRegistry();
  private history = new Map<string, KeyHistory>();

  public static getInstance(): DataBlameRegistry {
    return DataBlameRegistry.instance;
  }

  public recordMutation(key: string, newValue: string, rawStack?: string): void {
    const existing = this.history.get(key);
    const revisionCount = existing ? existing.revisionCount + 1 : 1;
    const previousValue = existing ? existing.currentValue : undefined;
    const actorInfo = buildActorFromStack(rawStack);

    this.history.set(key, {
      currentValue: newValue,
      previousValue,
      revisionCount,
      lastModifiedAt: new Date().toISOString(),
      actorInfo,
    });
  }

  public getMetadata(key: string, currentValue: string, rawStack?: string): Result<DataBlameInfo, DataBlameError> {
    try {
      let entry = this.history.get(key);

      if (!entry) {
        const actorInfo = buildActorFromStack(rawStack);
        entry = {
          currentValue,
          previousValue: undefined,
          revisionCount: 1,
          lastModifiedAt: new Date().toISOString(),
          actorInfo,
        };
        this.history.set(key, entry);
      } else {
        if (currentValue !== entry.currentValue) {
          entry.previousValue = entry.currentValue;
          entry.currentValue = currentValue;
          entry.revisionCount += 1;
          entry.lastModifiedAt = new Date().toISOString();
        }
        if (rawStack) {
          entry.actorInfo = buildActorFromStack(rawStack);
        }
      }

      const blameInfo: DataBlameInfo = {
        key,
        lastModifiedAt: entry.lastModifiedAt,
        actor: entry.actorInfo || buildActorFromStack(rawStack),
        revisionCount: entry.revisionCount,
        previousValue: entry.previousValue,
      };

      return Result.ok(blameInfo);
    } catch (err) {
      return Result.err({
        code: 'BLAME_EVALUATION_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  public clear(): void {
    this.history.clear();
  }
}

export function getStorageDataBlameResult(
  key: string,
  currentValue: string,
  rawStack?: string
): Result<DataBlameInfo, DataBlameError> {
  return DataBlameRegistry.getInstance().getMetadata(key, currentValue, rawStack);
}

export function getStorageDataBlame(key: string, currentValue: string, rawStack?: string): DataBlameInfo {
  const result = getStorageDataBlameResult(key, currentValue, rawStack);
  if (result.ok) {
    return result.value;
  }
  const defaultOrigin = ScriptOrigin.create('unknown', 'anonymous', 0, 0);
  const fallbackOrigin = defaultOrigin.ok ? defaultOrigin.value : undefined;
  const fallbackRes = BlameActor.create('Script (unknown)', 'script', fallbackOrigin);
  const fallbackActor = fallbackRes.ok ? fallbackRes.value : ({} as BlameActor);

  return {
    key,
    lastModifiedAt: new Date().toISOString(),
    actor: fallbackActor,
    revisionCount: 1,
  };
}
