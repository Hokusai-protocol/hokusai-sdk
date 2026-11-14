/**
 * Evidence that an agent tool worked on a PR, for a PR opened under a person's
 * account as much as one opened by a bot (HOK-3023).
 *
 * Absence proves nothing: people remove trailers and footers, so "no marker" is
 * never "human". Matching favours precision. Identities match whole names, since
 * "Claude Martin" and "Devin Binnie" are people, and footers must fill their line,
 * since a PR can discuss "code generated with Claude Code".
 *
 * Pure: callers supply evidence fixed at `as_of`, and git and GitHub access stays
 * with them. `classifyCommitActor` in the survival labeller is deliberately
 * separate, because it sets `undone_by` in versioned labels.
 */

import type { AgentToolFamily } from '@hokusai/core';

type Family = Exclude<AgentToolFamily, 'none' | 'multiple'>;

export interface AgentMarkerCommit {
  message: string;
  authorName?: string;
  authorEmail?: string;
}

export interface AgentMarkerInput {
  authorLogin: string | null;
  authorType: string | null;
  headRef: string | null;
  /** The PR's commits; null when they could not be read. */
  commits: readonly AgentMarkerCommit[] | null;
  /** The body at `as_of`. */
  body: string | null;
  /** True when the body at `as_of` could not be rebuilt. */
  bodyUnavailable?: boolean;
  /**
   * The commit that landed the PR. A squash keeps trailers the PR's own commits may
   * have lost, but it is not one of those commits, so it never changes the share.
   */
  landingMessage?: string;
}

export interface AgentMarkers {
  /** Null only when nothing was found and some evidence could not be read. */
  present: boolean | null;
  family: AgentToolFamily | null;
  markedCommitShare: number | null;
  /** Normalized model names found in commits, for segments and heuristic attribution. */
  modelIds: string[];
  exactModel: string | null;
  markedByAccount: boolean;
  markedByBranch: boolean;
  markedByCommit: boolean | null;
  markedByBody: boolean | null;
  /** A commit has an agent co-author trailer. */
  coAuthorTrailer: boolean;
  /** A commit has an agent footer or model tag, or the body has a footer or session link. */
  signature: boolean;
  dependencyBot: boolean;
  /** What matched, for audits. Holds raw commit and body text: never publish it. */
  evidence: { source: 'account' | 'branch' | 'commit_author' | 'co_author' | 'signature' | 'model_tag' | 'landing' | 'body'; rule: string; text: string }[];
}

const BOT_SUFFIX = String.raw`(?:\[bot\])?`;
const IDENTITIES: readonly { family: Family; name?: RegExp; email?: RegExp }[] = [
  {
    family: 'claude',
    // A bare "Claude" needs the tool's email or the bot suffix: it is also a first name.
    name: /^(?:claude\[bot\]|claude\s+(?:code|opus|sonnet|haiku|fable|\d)[\w.\s-]*(?:\([^)]*\))?)$/i,
    email: /^(?:noreply|claude)@anthropic\.com$/i,
  },
  { family: 'copilot', name: new RegExp(`^(?:github )?copilot(?:-swe-agent|-autofix)?${BOT_SUFFIX}$`, 'i'), email: /^(?:\d+\+)?copilot@users\.noreply\.github\.com$/i },
  { family: 'cursor', name: new RegExp(`^cursor(?:[ -]agent)?${BOT_SUFFIX}$`, 'i'), email: /^cursoragent@cursor\.com$/i },
  { family: 'codex', name: new RegExp(`^(?:openai[ -])?codex${BOT_SUFFIX}$|^chatgpt-codex-connector${BOT_SUFFIX}$`, 'i'), email: /^(?:codex|noreply)@openai\.com$/i },
  { family: 'devin', name: new RegExp(`^devin-ai-integration${BOT_SUFFIX}$|^devin ai$`, 'i'), email: /devin-ai-integration/i },
  { family: 'gemini', name: new RegExp(`^(?:google[ -])?gemini(?:[ -](?:cli|code[ -]assist))?${BOT_SUFFIX}$`, 'i') },
  { family: 'aider', name: /^aider(?:\s*\([^)]*\))?$|\(aider\)$/i, email: /^noreply@aider\.chat$/i },
  { family: 'openhands', name: new RegExp(`^openhands(?:-agent)?${BOT_SUFFIX}$`, 'i'), email: /^openhands@all-hands\.dev$/i },
  { family: 'other', name: new RegExp(`^(?:ai|coding)[ _-]agent${BOT_SUFFIX}$`, 'i') },
];

const CO_AUTHOR_TRAILER = /^[ \t]*co-authored-by:[ \t]*(.*?)[ \t]*<([^>]*)>/gim;

/** A tool as a whole word, with the capitalization tools use, so "cursor-based" is not Cursor. */
const TOOL_WORDS = String.raw`Claude Code|Claude|GitHub Copilot|Copilot|Cursor|OpenAI Codex|Codex|Gemini CLI|Gemini|Devin|Aider|aider|OpenHands`;
const toolFamily = (word: string): Family => FOOTER_TOOLS[word.toLowerCase()]!;

/** `Assisted-by: codex (gpt-5.5)`, as AI-use policies such as LLVM's ask for. The first tool named wins. */
const ASSISTED_TRAILER = new RegExp(String.raw`^[ \t]*(?:assisted|generated|co-developed)-by:[ \t]*.*?\b(${TOOL_WORDS})\b`, 'gim');

/** "Authored by Claude Code", "Co-authored with PostHog Code (Claude Opus 4.7)": a statement, not a mention. */
const AUTHORSHIP = new RegExp(
  String.raw`(?<!\b(?:not|never|n't)[ \t]+)(?<!\bnot[ \t]+(?:been[ \t]+)?)\b(?:[Cc]o-?[Aa]uthored|[Aa]uthored|[Bb]uilt|[Ww]ritten|[Ii]mplemented|[Dd]eveloped)[ \t]+(?:by|with|using|via)\b[ \t]+(?:the[ \t]+)?(?:[\w-]+[ \t]+){0,3}?\(?(${TOOL_WORDS})\b`,
  'gm',
);

/** Tool names that, with a bot or agent word, make an organization's own agent account (`acme-claude-bot`). */
const TOOL_TOKENS: Readonly<Record<string, Family>> = {
  claude: 'claude', copilot: 'copilot', cursor: 'cursor', codex: 'codex', devin: 'devin', gemini: 'gemini', aider: 'aider', openhands: 'openhands',
};
const AGENT_TOKENS = new Set(['bot', 'agent', 'ai']);

const FOOTER_TOOLS: Readonly<Record<string, Family>> = {
  'claude code': 'claude', claude: 'claude', 'github copilot': 'copilot', copilot: 'copilot', cursor: 'cursor',
  'openai codex': 'codex', codex: 'codex', 'gemini cli': 'gemini', gemini: 'gemini', devin: 'devin', aider: 'aider', openhands: 'openhands',
};
const FOOTER = new RegExp(
  String.raw`^\W*(?:generated|created|written|authored|made)\s+(?:with|by|using)\W+(${Object.keys(FOOTER_TOOLS).join('|')})\]?(?:\([^)\s]*\))?\W*$`,
  'im',
);
const SESSION_LINKS: readonly { family: Family; link: RegExp }[] = [
  { family: 'claude', link: /https:\/\/claude\.ai\/code\/session/i },
  { family: 'devin', link: /https:\/\/app\.devin\.ai\/sessions\//i },
  { family: 'codex', link: /https:\/\/chatgpt\.com\/codex\/tasks\//i },
  { family: 'cursor', link: /https:\/\/cursor\.com\/(?:agents|background-agent)/i },
];
const MODEL_TAG = /^[ \t]*model[ \t]*[=:][ \t]*((?:claude|gpt|gemini)-[\w.-]+|o[13](?:-[\w.-]+)?)[ \t]*$/gim;

const BRANCH_FAMILIES: Readonly<Record<string, Family>> = {
  claude: 'claude', 'claude-code': 'claude', copilot: 'copilot', cursor: 'cursor', codex: 'codex', devin: 'devin',
  // Not `bot/`: release and dependency automation use it (`bot/bump-version/...`).
  gemini: 'gemini', aider: 'aider', openhands: 'openhands', agent: 'other',
};

const DEPENDENCY_BOT = /^(?:dependabot(?:-preview)?|renovate(?:-bot)?|greenkeeper|pyup-bot|snyk-bot|depfu)(?:\[bot\])?$/i;

export function isDependencyBotLogin(login: string | null | undefined): boolean {
  return !!login && DEPENDENCY_BOT.test(login);
}

/** A tool word together with a bot or agent word in one name or email local part. */
function botAccountFamily(name: string, email: string): Family | null {
  for (const text of [name, email.split('@')[0] ?? '']) {
    const tokens = text.toLowerCase().replace(/\[bot\]$/, '-bot').split(/[^a-z0-9]+/).filter(Boolean);
    if (!tokens.some((token) => AGENT_TOKENS.has(token))) continue;
    const tool = tokens.find((token) => token in TOOL_TOKENS);
    if (tool) return TOOL_TOKENS[tool]!;
  }
  return null;
}

function identityFamily(name: string, email: string): Family | null {
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  return IDENTITIES.find((rule) => rule.name?.test(trimmedName) || rule.email?.test(trimmedEmail))?.family ?? botAccountFamily(trimmedName, trimmedEmail);
}

/** The family a branch's first path segment names, if any. */
export function branchAgentFamily(headRef: string | null | undefined): Family | null {
  const prefix = headRef?.includes('/') ? headRef.split('/')[0]?.toLowerCase() : undefined;
  return prefix ? BRANCH_FAMILIES[prefix] ?? null : null;
}

function modelFromIdentity(name: string): string | null {
  const aider = /^aider\s*\(([^)]+)\)/i.exec(name.trim());
  const raw = aider ? aider[1]!.split('/').at(-1)! : /^claude\s+\S/i.test(name.trim()) ? name.replace(/\([^)]*\)/g, '') : null;
  if (!raw) return null;
  const slug = raw.trim().toLowerCase().replace(/[\s.]+/g, '-');
  if (slug === 'claude-code') return null;
  return /^(?:claude-|gpt-|gemini-|o[13](?:-|$))/.test(slug) ? slug : null;
}

/** Quoted text, code blocks and comments can show a footer without being one. */
function withoutQuotedText(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n');
}

function signatureMatches(text: string): { family: Family; rule: string; text: string }[] {
  const cleaned = withoutQuotedText(text);
  const found: { family: Family; rule: string; text: string }[] = [];
  const footer = FOOTER.exec(cleaned);
  if (footer) found.push({ family: FOOTER_TOOLS[footer[1]!.toLowerCase()]!, rule: 'footer', text: footer[0] });
  for (const { family, link } of SESSION_LINKS) {
    const match = link.exec(cleaned);
    if (match) found.push({ family, rule: 'session_link', text: match[0] });
  }
  for (const match of cleaned.matchAll(ASSISTED_TRAILER)) found.push({ family: toolFamily(match[1]!), rule: 'assisted_trailer', text: match[0] });
  for (const match of cleaned.matchAll(AUTHORSHIP)) found.push({ family: toolFamily(match[1]!), rule: 'authorship', text: match[0] });
  return found;
}

function signatureFamilies(text: string, evidence?: AgentMarkers['evidence'], source: AgentMarkers['evidence'][number]['source'] = 'signature'): Family[] {
  return signatureMatches(text).map((match) => {
    evidence?.push({ source, rule: match.rule, text: match.text.trim().slice(0, 200) });
    return match.family;
  });
}

function modelFamily(model: string): Family {
  return model.startsWith('claude-') ? 'claude' : model.startsWith('gemini-') ? 'gemini' : 'other';
}

export function detectAgentMarkers(input: AgentMarkerInput): AgentMarkers {
  const families = new Set<Family>();
  const modelIds = new Set<string>();
  const evidence: AgentMarkers['evidence'] = [];
  let coAuthorTrailer = false;
  let signature = false;

  const login = input.authorLogin ?? '';
  const isBotAccount = /\[bot\]$/i.test(login) || (input.authorType ?? '').toLowerCase() === 'bot';
  // Normalized to the [bot] form: a bare "claude" login could be a person.
  const accountFamily = isBotAccount ? identityFamily(`${login.replace(/\[bot\]$/i, '')}[bot]`, '') : null;
  if (accountFamily) {
    families.add(accountFamily);
    evidence.push({ source: 'account', rule: 'identity', text: login });
  }

  const branchFamily = branchAgentFamily(input.headRef);
  if (branchFamily) {
    families.add(branchFamily);
    evidence.push({ source: 'branch', rule: 'prefix', text: input.headRef ?? '' });
  }

  let markedCommits = 0;
  for (const commit of input.commits ?? []) {
    let marked = false;
    const authorFamily = identityFamily(commit.authorName ?? '', commit.authorEmail ?? '');
    if (authorFamily) {
      families.add(authorFamily);
      evidence.push({ source: 'commit_author', rule: 'identity', text: `${commit.authorName ?? ''} <${commit.authorEmail ?? ''}>` });
      marked = true;
      const model = modelFromIdentity(commit.authorName ?? '');
      if (model) modelIds.add(model);
    }
    for (const [, name = '', email = ''] of commit.message.matchAll(CO_AUTHOR_TRAILER)) {
      const family = identityFamily(name, email);
      if (!family) continue;
      families.add(family);
      evidence.push({ source: 'co_author', rule: 'identity', text: `${name} <${email}>` });
      coAuthorTrailer = true;
      marked = true;
      const model = modelFromIdentity(name);
      if (model) modelIds.add(model);
    }
    for (const family of signatureFamilies(commit.message, evidence)) {
      families.add(family);
      signature = true;
      marked = true;
    }
    for (const [, model = ''] of commit.message.matchAll(MODEL_TAG)) {
      const normalized = model.toLowerCase();
      modelIds.add(normalized);
      families.add(modelFamily(normalized));
      evidence.push({ source: 'model_tag', rule: 'model_tag', text: model });
      signature = true;
      marked = true;
    }
    if (marked) markedCommits += 1;
  }

  let markedByLanding = false;
  if (input.landingMessage) {
    for (const [, name = '', email = ''] of input.landingMessage.matchAll(CO_AUTHOR_TRAILER)) {
      const family = identityFamily(name, email);
      if (!family) continue;
      families.add(family);
      coAuthorTrailer = true;
      markedByLanding = true;
      const model = modelFromIdentity(name);
      if (model) modelIds.add(model);
    }
    for (const family of signatureFamilies(input.landingMessage, evidence, 'landing')) {
      families.add(family);
      signature = true;
      markedByLanding = true;
    }
  }

  const bodyFamilies = input.bodyUnavailable ? [] : signatureFamilies(input.body ?? '', evidence, 'body');
  for (const family of bodyFamilies) {
    families.add(family);
    signature = true;
  }

  const commitsKnown = input.commits !== null;
  const specific = [...families].filter((family) => family !== 'other');
  const named: AgentToolFamily = specific.length > 1 ? 'multiple' : specific[0] ?? (families.has('other') ? 'other' : 'none');
  const present = families.size > 0 ? true : commitsKnown && !input.bodyUnavailable ? false : null;
  const models = [...modelIds];

  return {
    present,
    family: present === null ? null : named,
    markedCommitShare: !commitsKnown ? null : input.commits!.length === 0 ? 0 : markedCommits / input.commits!.length,
    modelIds: models,
    exactModel: models.length === 1 ? models[0]! : null,
    markedByAccount: accountFamily !== null,
    markedByBranch: branchFamily !== null,
    markedByCommit: markedByLanding || markedCommits > 0 ? true : commitsKnown ? false : null,
    markedByBody: input.bodyUnavailable ? null : bodyFamilies.length > 0,
    coAuthorTrailer,
    signature,
    dependencyBot: isDependencyBotLogin(input.authorLogin),
    evidence,
  };
}

/** The manifest columns for one row, so the extractor and the manifest cannot drift apart. */
export function agentMarkerColumns(markers: AgentMarkers): Record<string, boolean | number | string | null> {
  return {
    'feature.agent.marker_present': markers.present,
    'feature.agent.tool_family': markers.family,
    'feature.agent.marked_commit_share': markers.markedCommitShare,
    'segment.agent.exact_model': markers.exactModel,
    'segment.agent.marked_by_account': markers.markedByAccount,
    'segment.agent.marked_by_branch': markers.markedByBranch,
    'segment.agent.marked_by_commit': markers.markedByCommit,
    'segment.agent.marked_by_body': markers.markedByBody,
    'segment.author.dependency_bot': markers.dependencyBot,
  };
}
