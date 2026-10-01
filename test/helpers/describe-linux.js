'use strict';

// The helper scripts only ever run inside Linux app containers (bash 4+, GNU coreutils).
// macOS ships bash 3.2 without mapfile or sha256sum, and Windows runners only have Git Bash,
// so the bash-backed suites run on Linux and are skipped elsewhere.
module.exports = process.platform === 'linux' ? describe : describe.skip;
