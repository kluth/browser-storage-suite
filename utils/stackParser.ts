export interface StackFrame {
  functionName: string;
  scriptUrl: string;
  lineNumber: number;
  columnNumber: number;
  rawLine: string;
}

const V8_PATTERN = /^\s*at (?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
const GECKO_WEBKIT_PATTERN = /^(?:([^@]*)\@)?(.+?):(\d+):(\d+)$/;

function parseV8Frame(trimmed: string): StackFrame | null {
  const match = V8_PATTERN.exec(trimmed);
  if (!match) return null;

  const rawFunc = match[1];
  const scriptUrl = match[2];
  const lineNumber = parseInt(match[3], 10);
  const columnNumber = parseInt(match[4], 10);

  if (!scriptUrl || isNaN(lineNumber) || isNaN(columnNumber)) return null;

  return {
    functionName: rawFunc && rawFunc.trim() ? rawFunc.trim() : 'anonymous',
    scriptUrl,
    lineNumber,
    columnNumber,
    rawLine: trimmed,
  };
}

function parseGeckoWebKitFrame(trimmed: string): StackFrame | null {
  const match = GECKO_WEBKIT_PATTERN.exec(trimmed);
  if (!match) return null;

  const rawFunc = match[1];
  const scriptUrl = match[2];
  const lineNumber = parseInt(match[3], 10);
  const columnNumber = parseInt(match[4], 10);

  if (!scriptUrl || isNaN(lineNumber) || isNaN(columnNumber)) return null;

  return {
    functionName: rawFunc && rawFunc.trim() ? rawFunc.trim() : 'anonymous',
    scriptUrl,
    lineNumber,
    columnNumber,
    rawLine: trimmed,
  };
}

export function parseStackFrameLine(line: string): StackFrame | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('Error')) return null;

  const v8 = parseV8Frame(trimmed);
  if (v8) return v8;

  return parseGeckoWebKitFrame(trimmed);
}

export function parseStackTrace(rawStack: string): StackFrame[] {
  if (!rawStack || typeof rawStack !== 'string') return [];
  const lines = rawStack.split('\n');
  const frames: StackFrame[] = [];
  for (let i = 0; i < lines.length; i++) {
    const frame = parseStackFrameLine(lines[i]);
    if (frame) {
      frames.push(frame);
    }
  }
  return frames;
}

const INTERNAL_URL_PATTERNS = [
  'datablamer',
  'storageinterceptoradapter',
  'stackparser',
  'node_modules',
  'vitest',
  'node:internal',
  'node:events',
];

const INTERNAL_FUNC_PATTERNS = [
  'datablameregistry',
  'storageinterceptoradapter',
];

const INTERNAL_RAW_PATTERNS = [
  'vitest/dist',
  'node:internal',
];

export function isInternalFrame(frame: StackFrame): boolean {
  const url = frame.scriptUrl.toLowerCase().replace(/\\/g, '/');
  const func = frame.functionName.toLowerCase();
  const raw = frame.rawLine.toLowerCase().replace(/\\/g, '/');

  const isInternalUrl = INTERNAL_URL_PATTERNS.some((p) => url.includes(p));
  const isInternalFunc = INTERNAL_FUNC_PATTERNS.some((p) => func.includes(p));
  const isInternalRaw = INTERNAL_RAW_PATTERNS.some((p) => raw.includes(p));

  return isInternalUrl || isInternalFunc || isInternalRaw;
}

export function filterInternalFrames(frames: StackFrame[]): StackFrame[] {
  return frames.filter((frame) => !isInternalFrame(frame));
}
