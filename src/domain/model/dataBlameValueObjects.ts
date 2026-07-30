import { Result } from '../../../utils/result';

export type ActorType = 'script' | 'user_action' | 'extension' | 'analytics';

export class ScriptOrigin {
  private constructor(
    public readonly scriptUrl: string,
    public readonly functionName: string,
    public readonly lineNumber: number,
    public readonly columnNumber: number
  ) {}

  public static create(
    rawUrl: string,
    functionName: string = 'anonymous',
    line: number = 0,
    col: number = 0
  ): Result<ScriptOrigin, string> {
    const url = (rawUrl || '').trim() || 'unknown';
    const func = (functionName || '').trim() || 'anonymous';
    return Result.ok(new ScriptOrigin(url, func, Math.max(0, line), Math.max(0, col)));
  }

  public toFormattedString(): string {
    return `${this.scriptUrl}:L${this.lineNumber}:${this.columnNumber}`;
  }
}

export class BlameActor {
  private constructor(
    public readonly name: string,
    public readonly type: ActorType,
    public readonly origin?: ScriptOrigin,
    public readonly stackTraceSnippet?: string
  ) {}

  public static create(
    name: string,
    type: ActorType,
    origin?: ScriptOrigin,
    stackTraceSnippet?: string
  ): Result<BlameActor, string> {
    if (!name || name.trim().length === 0) {
      return Result.err('Actor name cannot be empty');
    }
    return Result.ok(new BlameActor(name.trim(), type, origin, stackTraceSnippet));
  }

  public get scriptUrl(): string | undefined {
    return this.origin ? `${this.origin.scriptUrl}:L${this.origin.lineNumber}` : undefined;
  }

  public get lineNumber(): number | undefined {
    return this.origin?.lineNumber;
  }

  public get columnNumber(): number | undefined {
    return this.origin?.columnNumber;
  }
}
