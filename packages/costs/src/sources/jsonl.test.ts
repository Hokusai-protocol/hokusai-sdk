import { describe, expect, it } from 'vitest';
import { parseJsonl } from './jsonl.js';

describe('parseJsonl', () => {
  it('parses well-formed rows and skips blank lines', () => {
    const blob = '{"a":1}\n\n{"b":2}\n';
    const { rows, diagnostics } = parseJsonl(blob);
    expect(rows).toEqual([{ a: 1 }, { b: 2 }]);
    expect(diagnostics).toEqual([]);
  });

  it('counts malformed JSON lines without throwing', () => {
    const blob = '{"a":1}\nnot json\n{"b":2}\n';
    const { rows, diagnostics } = parseJsonl(blob);
    expect(rows).toEqual([{ a: 1 }, { b: 2 }]);
    expect(diagnostics).toEqual([{ code: 'malformed_json', count: 1 }]);
  });

  it('treats non-object payloads as malformed', () => {
    const blob = '[1,2,3]\n42\nnull\n"str"\n{"ok":true}';
    const { rows, diagnostics } = parseJsonl(blob);
    expect(rows).toEqual([{ ok: true }]);
    expect(diagnostics).toEqual([{ code: 'malformed_json', count: 4 }]);
  });

  it('caps line count and length via input_truncated', () => {
    const short = '{"a":1}';
    const blob = [short, short, short].join('\n');
    const { rows, diagnostics } = parseJsonl(blob, { maxLines: 2 });
    expect(rows).toHaveLength(2);
    expect(diagnostics).toEqual([{ code: 'input_truncated', count: 1 }]);

    const oversized = '{"x":"' + 'x'.repeat(200) + '"}';
    const capped = parseJsonl(oversized, { maxLineBytes: 50 });
    expect(capped.rows).toEqual([]);
    expect(capped.diagnostics).toEqual([{ code: 'input_truncated', count: 1 }]);
  });
});
