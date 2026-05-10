#!/usr/bin/env bash
# Run all integration tests in sequence. Each script may "skip:" if its
# preconditions aren't met (no docker, wrong arch, etc.) without failing
# the whole run. A real assertion failure exits non-zero and stops here.
set -euo pipefail

cd "$(dirname "$0")"

failed=0
ran=0
skipped=0

for t in test-hooks.sh test-doh-proxy.sh test-sundocked.sh test-sundocked-services.sh test-sundohed.sh test-sundohed-disable.sh; do
    echo
    echo "===> $t"
    if ! out=$(bash "./$t" 2>&1); then
        echo "$out"
        failed=$((failed + 1))
        continue
    fi
    echo "$out"
    if echo "$out" | grep -q '^skip:'; then
        skipped=$((skipped + 1))
    else
        ran=$((ran + 1))
    fi
done

echo
echo "===> summary: ran=$ran skipped=$skipped failed=$failed"
exit "$failed"
