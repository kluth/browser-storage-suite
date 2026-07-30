export interface StackFrame {
  functionName: string;
  scriptUrl: string;
  lineNumber: number;
  columnNumber: number;
  rawLine: string;
}

function parseV8Frame(trimmed: string): StackFrame | null {
  if (!trimmed.startsWith('at ')) return null;
  const line = trimmed.slice(3).trim();
  if (!line) return null;

  if (line.endsWith(')')) {
    const firstParenIdx = line.indexOf('(');
    if (firstParenIdx !== -1) {
      const funcPart = line.slice(0, firstParenIdx).trim();
      const locPart = line.slice(firstParenIdx + 1, -1).trim();

      const lastColon = locPart.lastIndexOf(':');
      if (lastColon === -1) return null;
      const secondLastColon = locPart.lastIndexOf(':', lastColon - 1);
      if (secondLastColon === -1) return null;

      const scriptUrl = locPart.slice(0, secondLastColon);
      const lineStr = locPart.slice(secondLastColon + 1, lastColon);
      const colStr = locPart.slice(lastColon + 1);

      const lineNumber = parseInt(lineStr, 10);
      const columnNumber = parseInt(colStr, 10);

      if (!scriptUrl || isNaN(lineNumber) || isNaN(columnNumber)) return null;

      return {
        functionName: funcPart || 'anonymous',
        scriptUrl,
        lineNumber,
        columnNumber,
        rawLine: trimmed,
      };
    }
  }

  const lastColon = line.lastIndexOf(':');
  if (lastColon === -1) return null;
  const secondLastColon = line.lastIndexOf(':', lastColon - 1);
  if (secondLastColon === -1) return null;

  const scriptUrl = line.slice(0, secondLastColon);
  const lineStr = line.slice(secondLastColon + 1, lastColon);
  const colStr = line.slice(lastColon + 1);

  const lineNumber = parseInt(lineStr, 10);
  const columnNumber = parseInt(colStr, 10);

  if (!scriptUrl || isNaN(lineNumber) || isNaN(columnNumber)) return null;

  return {
    functionName: 'anonymous',
    scriptUrl,
    lineNumber,
    columnNumber,
    rawLine: trimmed,
  };
}

function parseGeckoWebKitFrame(trimmed: string): StackFrame | null {
  const atIdx = trimmed.indexOf('@');
  let funcPart = 'anonymous';
  let locPart = trimmed;

  if (atIdx !== -1) {
    funcPart = trimmed.slice(0, atIdx).trim() || 'anonymous';
    locPart = trimmed.slice(atIdx + 1).trim();
  }

  const lastColon = locPart.lastIndexOf(':');
  if (lastColon === -1) return null;
  const secondLastColon = locPart.lastIndexOf(':', lastColon - 1);
  if (secondLastColon === -1) return null;

  const scriptUrl = locPart.slice(0, secondLastColon);
  const lineStr = locPart.slice(secondLastColon + 1, lastColon);
  const colStr = locPart.slice(lastColon + 1);

  const lineNumber = parseInt(lineStr, 10);
  const columnNumber = parseInt(colStr, 10);

  if (!scriptUrl || isNaN(lineNumber) || isNaN(columnNumber)) return null;

  return {
    functionName: funcPart,
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
  'wxt/sandbox',
  'wxt',
];

const INTERNAL_FUNC_PATTERNS = [
  'datablameregistry',
  'storageinterceptoradapter',
  'proxysetitem',
  'proxyremoveitem',
  'proxyclear',
  'interceptorsetitem',
  'interceptorremoveitem',
  'interceptorclear',
];

const INTERNAL_RAW_PATTERNS = [
  'vitest/dist',
  'node:internal',
  'storageinterceptoradapter',
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
