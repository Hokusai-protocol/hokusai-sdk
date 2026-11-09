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
  gemini: 'gemini', aider: 'aider', openhands: 'openhands', agent: 'other', bot: 'other',
};

const DEPENDENCY_BOT = /^(?:dependabot(?:-preview)?|renovate(?:-bot)?|greenkeeper|pyup-bot|snyk-bot|depfu)(?:\[bot\])?$/i;

export function isDependencyBotLogin(login: string | null | undefined): boolean {
  return !!login && DEPENDENCY_BOT.test(login);
}

function identityFamily(name: string, email: string): Family | null {
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  return IDENTITIES.find((rule) => rule.name?.test(trimmedName) || rule.email?.test(trimmedEmail))?.family ?? null;
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

function signatureFamilies(text: string): Family[] {
  const cleaned = withoutQuotedText(text);
  const found: Family[] = [];
  const footer = FOOTER.exec(cleaned);
  if (footer) found.push(FOOTER_TOOLS[footer[1]!.toLowerCase()]!);
  for (const { family, link } of SESSION_LINKS) if (link.test(cleaned)) found.push(family);
  return found;
}

function modelFamily(model: string): Family {
  return model.startsWith('claude-') ? 'claude' : model.startsWith('gemini-') ? 'gemini' : 'other';
}

export function detectAgentMarkers(input: AgentMarkerInput): AgentMarkers {
  const families = new Set<Family>();
  const modelIds = new Set<string>();
  let coAuthorTrailer = false;
  let signature = false;

  const login = input.authorLogin ?? '';
  const isBotAccount = /\[bot\]$/i.test(login) || (input.authorType ?? '').toLowerCase() === 'bot';
  // Normalized to the [bot] form: a bare "claude" login could be a person.
  const accountFamily = isBotAccount ? identityFamily(`${login.replace(/\[bot\]$/i, '')}[bot]`, '') : null;
  if (accountFamily) families.add(accountFamily);

  const branchFamily = branchAgentFamily(input.headRef);
  if (branchFamily) families.add(branchFamily);

  let markedCommits = 0;
  for (const commit of input.commits ?? []) {
    let marked = false;
    const authorFamily = identityFamily(commit.authorName ?? '', commit.authorEmail ?? '');
    if (authorFamily) {
      families.add(authorFamily);
      marked = true;
      const model = modelFromIdentity(commit.authorName ?? '');
      if (model) modelIds.add(model);
    }
    for (const [, name = '', email = ''] of commit.message.matchAll(CO_AUTHOR_TRAILER)) {
      const family = identityFamily(name, email);
      if (!family) continue;
      families.add(family);
      coAuthorTrailer = true;
      marked = true;
      const model = modelFromIdentity(name);
      if (model) modelIds.add(model);
    }
    for (const family of signatureFamilies(commit.message)) {
      families.add(family);
      signature = true;
      marked = true;
    }
    for (const [, model = ''] of commit.message.matchAll(MODEL_TAG)) {
      const normalized = model.toLowerCase();
      modelIds.add(normalized);
      families.add(modelFamily(normalized));
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
    for (const family of signatureFamilies(input.landingMessage)) {
      families.add(family);
      signature = true;
      markedByLanding = true;
    }
  }

  const bodyFamilies = input.bodyUnavailable ? [] : signatureFamilies(input.body ?? '');
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
