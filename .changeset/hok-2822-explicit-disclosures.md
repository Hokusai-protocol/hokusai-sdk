---
'@hokusai/scan': patch
---

Recognize explicit AI-authorship disclosures that name no known tool signature: affirmative AI-generated or agent-authored statements, named documentation-agent signatures, a checked AI co-author disclosure naming a tool, and commits tagged `[AI Codemod]`. Exports `detectBodyDisclosure`, `hasAiCodemodSubject` and `isUpstreamImportTitle`.
