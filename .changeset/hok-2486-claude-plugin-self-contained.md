---
'@hokusai/adapter-claude-code': patch
---

Make the Claude Code plugin bundle self-contained for marketplace `git-subdir` installs so `hokusai-doctor` and the other launchers can load without a missing `dist/index.js` error.
