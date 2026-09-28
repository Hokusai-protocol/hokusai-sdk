/**
 * Git-output parsing shared by the labeller and extractor.
 *
 * Extracted subset of the upstream cross-PR revert detector: only the pieces
 * the scanner core consumes (`parseNameStatusOutput`, `extractPrNumber`,
 * `parseRevertAcknowledgements`). The full `detectCrossPrReverts` scanner
 * stays with its original consumer until the scan package has a real caller
 * for it — port it here rather than importing the whole detector if one
 * appears.
 *
 * Pure string parsing: no git, no filesystem, no ambient state.
 */

/** One `git diff --name-status` line, rename/copy pairs resolved. */
export interface NameStatusEntry {
  status: string;
  path: string;
  previousPath?: string | undefined;
}

/**
 * Parse `git diff --name-status [--find-renames]` output into entries.
 * Rename/copy rows (`R100`, `C085`, …) collapse their similarity score to the
 * status letter and report the post-change path with `previousPath` set.
 */
export function parseNameStatusOutput(output: string): NameStatusEntry[] {
  if (!output.trim()) {
    return [];
  }

  return output
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [statusToken, firstPath = '', secondPath = ''] = line.split('\t');
      const status = statusToken?.trim() ?? '';
      const normalizedStatus = status[0] ?? '';
      const path = normalizedStatus === 'R' || normalizedStatus === 'C' ? secondPath : firstPath;

      return {
        status: normalizedStatus,
        path,
        previousPath:
          normalizedStatus === 'R' || normalizedStatus === 'C' ? firstPath : undefined,
      };
    })
    .filter((entry) => entry.status && entry.path);
}

/**
 * Extract the PR number a first-parent commit landed, covering both true
 * merge commits ("Merge pull request #N …") and squash commits ("… (#N)").
 */
export function extractPrNumber(subject: string): number | null {
  const match = subject.match(/merge pull request #(\d+)\b/i) ?? subject.match(/\(#(\d+)\)\s*$/i);
  if (!match) {
    return null;
  }

  const prNumber = Number(match[1]);
  return Number.isInteger(prNumber) ? prNumber : null;
}

/**
 * Collect PR numbers explicitly acknowledged as intentional reverts in a body
 * of text ("reverts #123", "intentionally reverts #45").
 */
export function parseRevertAcknowledgements(text?: string | null): Set<number> {
  const acknowledgements = new Set<number>();
  if (!text) {
    return acknowledgements;
  }

  for (const match of text.matchAll(/\b(?:reverts|intentionally reverts)\s+#(\d+)\b/gi)) {
    acknowledgements.add(Number(match[1]));
  }

  return acknowledgements;
}
