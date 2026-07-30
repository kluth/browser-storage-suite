import { Result } from './result';

export interface ExecutionPlan {
  originalQuery: string;
  parsedFields: string[];
  filterKeyPattern?: string;
  scanStrategy: 'INDEX_SCAN' | 'FULL_TABLE_SCAN';
  estimatedCostMs: number;
}

export type SqlOperator =
  | '='
  | 'LIKE'
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'IN'
  | 'IS NOT NULL'
  | 'IS NULL';

export interface WhereCondition {
  field: string;
  operator: SqlOperator;
  value?: string | string[];
}

export interface QueryOptions {
  totalEntries?: number;
  indexedFields?: string[];
}

export type SqlParseError =
  | { type: 'EMPTY_QUERY'; message: string }
  | { type: 'SYNTAX_ERROR'; message: string };

const DEFAULT_INDEXED_FIELDS = ['id', 'key'];
const DEFAULT_FIELDS = ['id', 'key', 'value', 'type'];

function parseSingleField(fieldExpr: string): string {
  const trimmed = fieldExpr.trim();
  const asMatch = trimmed.match(/^(.+?)\s+AS\s+.+$/i);
  const expr = asMatch ? asMatch[1].trim() : trimmed;
  const dotIndex = expr.lastIndexOf('.');
  const cleanField = dotIndex >= 0 ? expr.slice(dotIndex + 1) : expr;
  return cleanField.toLowerCase();
}

export function parseProjection(query: string): string[] {
  const match = query.match(/^\s*SELECT\s+(.*?)\s+FROM\s+/i);
  if (!match) return DEFAULT_FIELDS;
  const rawFields = match[1].trim();
  if (rawFields === '*' || rawFields === '') return DEFAULT_FIELDS;

  return rawFields
    .split(',')
    .map((f) => parseSingleField(f))
    .filter((f) => f.length > 0);
}

function cleanFieldName(rawField: string): string {
  const dotIndex = rawField.lastIndexOf('.');
  const name = dotIndex >= 0 ? rawField.slice(dotIndex + 1) : rawField;
  return name.toLowerCase();
}

function parseSingleCondition(clause: string): WhereCondition | null {
  const trimmed = clause.trim();
  if (!trimmed) return null;

  const nullMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s+(IS\s+NOT\s+NULL|IS\s+NULL)$/i);
  if (nullMatch) {
    const field = cleanFieldName(nullMatch[1]);
    const operator = nullMatch[2].toUpperCase().replace(/\s+/g, ' ') as SqlOperator;
    return { field, operator, value: '' };
  }

  const inMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s+IN\s*\(([^)]+)\)$/i);
  if (inMatch) {
    const field = cleanFieldName(inMatch[1]);
    const rawValues = inMatch[2];
    const values = rawValues.split(',').map((v) => v.trim().replace(/^['"]|['"]$/g, ''));
    return { field, operator: 'IN', value: values };
  }

  const compMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s*(=|LIKE|!=|>=|<=|>|<)\s*(['"](.*?)['"]|\S+)$/i);
  if (compMatch) {
    const field = cleanFieldName(compMatch[1]);
    const operator = compMatch[2].toUpperCase() as SqlOperator;
    const value = compMatch[4] !== undefined ? compMatch[4] : compMatch[3];
    return { field, operator, value };
  }

  return null;
}

export function parseWhereConditions(query: string): WhereCondition[] {
  const match = query.match(/WHERE\s+(.*?)($|ORDER\s+BY|LIMIT)/i);
  if (!match) return [];
  const rawWhere = match[1].trim();
  if (!rawWhere) return [];

  const clauses = rawWhere.split(/\s+(?:AND|OR)\s+/i);
  const conditions: WhereCondition[] = [];
  for (const clause of clauses) {
    const cond = parseSingleCondition(clause);
    if (cond) {
      conditions.push(cond);
    }
  }
  return conditions;
}

export function isIndexableOperator(op: SqlOperator): boolean {
  return op === '=' || op === 'LIKE' || op === '>' || op === '<' || op === '>=' || op === '<=' || op === 'IN';
}

export function extractFilterKeyPattern(
  conditions: WhereCondition[],
  indexedFields: string[] = DEFAULT_INDEXED_FIELDS
): string | undefined {
  const matchCond = conditions.find((c) => indexedFields.includes(c.field) && isIndexableOperator(c.operator));
  if (!matchCond) return undefined;
  if (typeof matchCond.value === 'string') return matchCond.value;
  if (Array.isArray(matchCond.value) && matchCond.value.length > 0) return matchCond.value[0];
  return undefined;
}

export function determineScanStrategy(
  conditions: WhereCondition[],
  indexedFields: string[] = DEFAULT_INDEXED_FIELDS,
  query?: string
): 'INDEX_SCAN' | 'FULL_TABLE_SCAN' {
  if (conditions.length === 0) return 'FULL_TABLE_SCAN';

  const isOrQuery = query ? /\bOR\b/i.test(query) : false;

  if (isOrQuery) {
    const allIndexed = conditions.every(
      (c) => indexedFields.includes(c.field) && isIndexableOperator(c.operator)
    );
    return allIndexed ? 'INDEX_SCAN' : 'FULL_TABLE_SCAN';
  }

  const hasIndexMatch = conditions.some(
    (c) => indexedFields.includes(c.field) && isIndexableOperator(c.operator)
  );
  return hasIndexMatch ? 'INDEX_SCAN' : 'FULL_TABLE_SCAN';
}

export function calculateDynamicCost(
  strategy: 'INDEX_SCAN' | 'FULL_TABLE_SCAN',
  filterPattern?: string,
  totalEntries: number = 100
): number {
  const setupOverheadMs = 0.10;
  if (strategy === 'INDEX_SCAN') {
    let matchedCount = 1;
    if (totalEntries > 100 && filterPattern && filterPattern.includes('%')) {
      matchedCount = Math.max(1, Math.floor(totalEntries * 0.05));
    }
    const cost = setupOverheadMs + matchedCount * 0.005 + 0.315;
    return Number(cost.toFixed(2));
  }
  const scanCostPerEntry = 0.127;
  const cost = setupOverheadMs + totalEntries * scanCostPerEntry;
  return Number(cost.toFixed(2));
}

export function validateSqlQuery(query: string): Result<void, SqlParseError> {
  const trimmed = query.trim();
  if (!trimmed) {
    return Result.err({ type: 'EMPTY_QUERY', message: 'SQL query string cannot be empty' });
  }
  const selectRegex = /^\s*SELECT\s+(.+?)\s+FROM\s+([a-zA-Z0-9_.]+)/i;
  if (!selectRegex.test(trimmed)) {
    return Result.err({
      type: 'SYNTAX_ERROR',
      message: 'Invalid SQL syntax: Query must be a valid SELECT ... FROM statement',
    });
  }
  return Result.ok(undefined);
}

export function translateSqlToIDBCursorResult(
  query: string,
  options?: QueryOptions
): Result<ExecutionPlan, SqlParseError> {
  const validation = validateSqlQuery(query);
  if (!validation.ok) {
    return Result.err(validation.error);
  }

  const trimmed = query.trim();
  const indexedFields = options?.indexedFields ?? DEFAULT_INDEXED_FIELDS;
  const totalEntries = options?.totalEntries ?? 100;

  const parsedFields = parseProjection(trimmed);
  const conditions = parseWhereConditions(trimmed);
  const filterKeyPattern = extractFilterKeyPattern(conditions, indexedFields);
  const scanStrategy = determineScanStrategy(conditions, indexedFields, trimmed);
  const estimatedCostMs = calculateDynamicCost(scanStrategy, filterKeyPattern, totalEntries);

  return Result.ok({
    originalQuery: query,
    parsedFields,
    filterKeyPattern,
    scanStrategy,
    estimatedCostMs,
  });
}

export function translateSqlToIDBCursor(query: string, options?: QueryOptions): ExecutionPlan {
  const res = translateSqlToIDBCursorResult(query, options);
  if (!res.ok) {
    return {
      originalQuery: query,
      parsedFields: DEFAULT_FIELDS,
      scanStrategy: 'FULL_TABLE_SCAN',
      estimatedCostMs: calculateDynamicCost('FULL_TABLE_SCAN', undefined, options?.totalEntries ?? 100),
    };
  }
  return res.value;
}
