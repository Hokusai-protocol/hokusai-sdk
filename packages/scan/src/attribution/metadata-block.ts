/** Extract only the first-party metadata block; raw content stays local. */
const BLOCK_REGEX = /<!-- wavemill-meta\n([\s\S]*?)\n-->/g;
export function extractMetadataBlock(body: string): { block: string | null; bodyWithoutBlock: string } {
  let block: string | null = null;
  for (const match of body.matchAll(BLOCK_REGEX)) block = match[1] ?? '';
  return { block, bodyWithoutBlock: block === null ? body : body.replace(BLOCK_REGEX, '').trim() };
}
