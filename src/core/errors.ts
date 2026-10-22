/**
 * A problem with the tool input that the model can fix (no match for a name, an ambiguous
 * name, a malformed path). Reported as a tool error, never thrown to the MCP client.
 */
export class ToolInputError extends Error {
  override readonly name = 'ToolInputError';
}
