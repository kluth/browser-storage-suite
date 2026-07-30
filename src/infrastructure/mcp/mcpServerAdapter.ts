import { Result } from '../../../utils/result';
import { StorageStateAggregate } from '../../../utils/storageAggregate';
import { translateSqlToIDBCursor } from '../../../utils/sqlToIdb';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpServerAdapter {
  constructor(private readonly aggregate: StorageStateAggregate) {}

  public getTools(): McpToolDefinition[] {
    return [
      {
        name: 'query_storage_sql',
        description: 'Translates and executes a SQL query against site storage engines',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'SQL query e.g. SELECT * FROM storage WHERE key LIKE "%user%"' },
          },
          required: ['sql'],
        },
      },
      {
        name: 'get_storage_snapshot',
        description: 'Retrieves storage snapshot at a given timestamp for time-travel debugging',
        inputSchema: {
          type: 'object',
          properties: {
            timestamp: { type: 'number', description: 'Epoch timestamp in milliseconds' },
          },
          required: ['timestamp'],
        },
      },
    ];
  }

  public handleToolCall(toolName: string, args: Record<string, unknown>): Result<unknown, string> {
    if (toolName === 'query_storage_sql') {
      const sql = String(args.sql || '');
      const plan = translateSqlToIDBCursor(sql);
      return Result.ok({ plan });
    }

    if (toolName === 'get_storage_snapshot') {
      const ts = Number(args.timestamp || Date.now());
      const snapshotRes = this.aggregate.getSnapshotAt(ts);
      if (!snapshotRes.ok) return Result.err(snapshotRes.error.type);
      return Result.ok(snapshotRes.value);
    }

    return Result.err(`Unknown MCP tool call: ${toolName}`);
  }
}
