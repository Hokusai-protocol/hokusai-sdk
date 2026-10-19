/** Pull a bounded YAML metadata block out of a PR body without retaining the rest. */
export function extractMetadataBlock(body: string | null | undefined): Record<string, unknown> | null {
  if (!body) return null;
  const match = body.match(/<!--\s*wavemill-meta\s*([\s\S]*?)\s*-->/i);
  if (!match) return null;
  const data: Record<string, unknown> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = line.match(/^\s*([A-Za-z][\w.-]{0,63})\s*:\s*(.{1,256})\s*$/);
    if (pair) data[pair[1]!.toLowerCase()] = pair[2]!.trim().replace(/^['"]|['"]$/g, '');
  }
  return data;
}
