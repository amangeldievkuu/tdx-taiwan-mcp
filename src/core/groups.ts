/** The areas tools are grouped in, for loading only some of them (`TDX_TOOLS`). */
export const TOOL_GROUPS = [
  'bike',
  'bus',
  'rail',
  'flight',
  'ferry',
  'road',
  'parking',
  'ev',
  'raw',
] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number];

/**
 * The groups named in a `TDX_TOOLS` value: a comma-separated list of groups, `all`, or
 * exclusions (`-road`). A list of exclusions only starts from every group. Unknown names are
 * returned so the caller can report them.
 */
export function parseToolGroups(spec: string | undefined): {
  groups: ToolGroup[];
  unknown: string[];
} {
  const words = (spec ?? '')
    .split(/[\s,]+/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  const included = words.filter((word) => !word.startsWith('-'));
  const excluded = words.filter((word) => word.startsWith('-')).map((word) => word.slice(1));
  const unknown = [...included, ...excluded].filter((word) => word !== 'all' && !isGroup(word));
  const start =
    !included.length || included.includes('all') ? [...TOOL_GROUPS] : included.filter(isGroup);
  const groups = TOOL_GROUPS.filter(
    (g) => start.includes(g) && !excluded.includes(g) && !excluded.includes('all'),
  );
  return { groups, unknown };
}

function isGroup(word: string): word is ToolGroup {
  return (TOOL_GROUPS as readonly string[]).includes(word);
}
