export interface RedactionMatch {
  label: string;
  value: string;
}

export interface RedactionPattern {
  label: string;
  pattern: RegExp;
}

export interface AnonymizationOptions {
  defaultReplacement?: string;
  patterns?: RedactionPattern[];
}

export interface AnonymizedText {
  text: string;
  redactions: RedactionMatch[];
}

const defaultPatterns: RedactionPattern[] = [
  {
    label: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    label: 'token',
    pattern: /\b(?:sk|tok)-[A-Za-z0-9]{8,}\b/g,
  },
];

export function anonymizeText(
  input: string,
  options: AnonymizationOptions = {},
): AnonymizedText {
  const patterns = options.patterns ?? defaultPatterns;
  const redactions: RedactionMatch[] = [];
  let text = input;

  for (const { label, pattern } of patterns) {
    text = text.replace(pattern, (value) => {
      redactions.push({ label, value });
      return options.defaultReplacement ?? `<redacted:${label}>`;
    });
  }

  return { text, redactions };
}
