import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import { fail } from './respond.js';

export interface ToolDefinition<Shape extends z.ZodRawShape> {
  title: string;
  /** When to use the tool, what it returns, and an example input. */
  description: string;
  input: Shape;
  run: (args: z.output<z.ZodObject<Shape>>) => Promise<CallToolResult>;
}

/**
 * Registers a read-only tool that reaches TDX. Exceptions become tool errors the model can read
 * instead of protocol errors.
 */
export function defineTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  definition: ToolDefinition<Shape>,
): void {
  const { title, description, input, run } = definition;
  const handler = async (args: z.output<z.ZodObject<Shape>>): Promise<CallToolResult> => {
    try {
      return await run(args);
    } catch (error) {
      return fail(error);
    }
  };
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: input,
      annotations: { title, readOnlyHint: true, openWorldHint: true },
    },
    // The SDK validates `args` against `input` first; its conditional callback type cannot be
    // resolved for a generic `Shape`.
    handler as unknown as ToolCallback<Shape>,
  );
}
