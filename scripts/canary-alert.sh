#!/usr/bin/env bash
# Open, update, or close the "Production canary failing" issue from the
# canary outcome. Deduped by exact title: at most one open issue at a time.
# Env: CANARY_RESULT (success|failure), RUN_URL, FAIL_FILE (canary stderr),
# GH_TOKEN, GH_REPO. Uses only the gh CLI; carries no secret values.
set -euo pipefail

TITLE="Production canary failing"
: "${CANARY_RESULT:?}" "${RUN_URL:?}"
FAIL_FILE="${FAIL_FILE:-canary.err}"

number=$(gh issue list --state open --search "\"$TITLE\" in:title" \
  --json number,title --jq "[.[] | select(.title == \"$TITLE\")][0].number // empty")

if [[ "$CANARY_RESULT" == "success" ]]; then
  if [[ -n "$number" ]]; then
    gh issue comment "$number" --body "Recovered: the canary passed. Run: $RUN_URL"
    gh issue close "$number" --reason completed
  fi
  exit 0
fi

fails=$(grep '^FAIL ' "$FAIL_FILE" 2>/dev/null || true)
[[ -n "$fails" ]] || fails="(no FAIL lines captured; see the run log)"
body=$(printf 'The scheduled production canary failed.\n\nRun: %s\n\nFailing checks:\n\n```\n%s\n```\n' "$RUN_URL" "$fails")

if [[ -n "$number" ]]; then
  gh issue comment "$number" --body "$body"
else
  gh issue create --title "$TITLE" --body "$body"
fi
