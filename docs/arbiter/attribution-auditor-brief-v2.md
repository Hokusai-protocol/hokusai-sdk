# Attribution audit, second sample: instructions for the reviewer

## Question

Unchanged from the [first brief](./attribution-auditor-brief.md): for each sampled
PR, what evidence available at merge time shows that an AI agent helped author at
least part of the merged change?

Do not assess whether the PR was correct or needed repair.

## Materials

- A historical-evidence packet for the sampled PRs, as Markdown and as JSON lines.
- An unfilled label sheet with item IDs and PR links. Return those IDs unchanged.
- This brief.

Items are in no meaningful order. You are not told how an item was selected or
what any detector found. Most items are expected to contain no evidence; that is
a useful result. Use the packet rather than the live page: GitHub text can have
changed since merge.

## Verdicts

Use the same four verdicts: `agent_evidence`, `ordinary_automation`,
`no_evidence`, `ambiguous`. Their definitions are unchanged.

## Clarifications after the first sample

The first sample showed three places where the brief was unclear. Apply these:

1. **Agent evidence on any commit counts.** An agent co-author trailer or
   generation signature on any commit of the PR is `agent_evidence`. It does not
   need to be on every commit, and it does not need to be in the PR body. Read the
   commit messages before recording `no_evidence`.
2. **The kind of change does not cancel the evidence.** A dependency bump, a
   merge commit or another mechanical change that carries an agent co-author
   trailer or signature is `agent_evidence`, not `ordinary_automation`. Use
   `ordinary_automation` only when no affirmative agent evidence is present.
3. **A bot account alone is still not enough.** A bot author, or a bot named as
   co-author, is `ordinary_automation` unless something identifies it as an AI
   coding agent. If you believe a specific bot account is itself an AI coding
   agent, record `agent_evidence` and say in the note what identifies it.

Imported upstream work is unchanged: when markers arrive through a subtree
update, codeflow or upstream sync, record the verdict the evidence supports and
set `evidence_scope` to `inherited_upstream`.

## Return format

Fill `verdict`, `reviewer`, `note` and `evidence_scope` for every item. Scope
values are `direct_merged_change`, `inherited_upstream`, `nonmerged_example` and
`unknown`. Keep notes short and evidence-based; name the commit or the line that
supports an `agent_evidence` verdict.

Do not aim for any percentage. No pass mark is attached to this sample.
