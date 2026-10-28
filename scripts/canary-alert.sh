#!/usr/bin/env bash
# Open, update, or close the "Production canary failing" issue from the
# canary outcome. Deduped by exact title: at most one open issue at a time.
# Env: CANARY_RESULT (success|failure), RUN_URL, FAIL_FILE (canary stderr),
# GH_TOKEN, GH_REPO. Optional: ALERT_MENTION, one or more space-separated
# @user or @org/team handles to notify. A mention notifies the person even if
# they are not watching the repository. Anything else in it is ignored. Uses
# only the gh CLI; carries no secret values.
set -euo pipefail

TITLE="Production canary failing"
: "${CANARY_RESULT:?}" "${RUN_URL:?}"
FAIL_FILE="${FAIL_FILE:-canary.err}"

# Accept only GitHub handles, so the variable cannot put anything else into an
# issue body.
handle='@[A-Za-z0-9][A-Za-z0-9-]*(/[A-Za-z0-9._-]+)?'
pattern="^${handle}( ${handle})*\$"
mention=""
if [[ -n "${ALERT_MENTION:-}" ]]; then
  # Matched as one string (grep would test each line separately).
  if [[ "$ALERT_MENTION" =~ $pattern ]]; then
    mention="$ALERT_MENTION "
  else
    echo "canary-alert: ALERT_MENTION is not a list of @handles; ignoring it" >&2
  fi
fi

number=$(gh issue list --state open --search "\"$TITLE\" in:title" \
  --json number,title --jq "[.[] | select(.title == \"$TITLE\")][0].number // empty")

if [[ "$CANARY_RESULT" == "success" ]]; then
  if [[ -n "$number" ]]; then
    gh issue comment "$number" --body "${mention}Recovered: the canary passed. Run: $RUN_URL"
    gh issue close "$number" --reason completed
  fi
  exit 0
fi

fails=$(grep '^FAIL ' "$FAIL_FILE" 2>/dev/null || true)
[[ -n "$fails" ]] || fails="(no FAIL lines captured; see the run log)"
body=$(printf '%sThe scheduled production canary failed.\n\nRun: %s\n\nFailing checks:\n\n```\n%s\n```\n' "$mention" "$RUN_URL" "$fails")

if [[ -n "$number" ]]; then
  gh issue comment "$number" --body "$body"
else
  gh issue create --title "$TITLE" --body "$body"
fi
