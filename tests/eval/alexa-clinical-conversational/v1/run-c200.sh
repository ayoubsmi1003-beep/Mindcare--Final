#!/usr/bin/env bash
# Runs the C200 campaign against the real pipeline and the disposable synthetic databases.
#   tests/eval/alexa-clinical-conversational/v1/run-c200.sh <label> [filter]
# Needs: Docker with the evaluation containers up, `pnpm install` done, the local model under the path below.
# Override any of these variables from the environment. Nothing here ever points at a real-patient database.
set -euo pipefail
label="${1:?usage: run-c200.sh <label> [filter]}"
filter="${2:-}"
HOST="${C200_DB_HOST:-127.0.0.1:55445}"
MAIN_DB=alexa_eval_v8_intelligence_20261027
FIXTURE_DB=alexa_eval_v9_fixture_20261030
export ALEXA_NATIVE_AGENT_ENABLED=1 KNOWLEDGE_VECTOR=1 KNOWLEDGE_VECTOR_RECETTE=e5-base ALEXA_LOCAL_TIMINGS=1
export ALEXA_LOCAL_MODEL_ROOT="${ALEXA_LOCAL_MODEL_ROOT:-C:\\MindCare\\alexa-v8-final\\.cache\\alexa\\minicpm}"
export MINDCARE_ALEXA_EVAL_ADMIN_URL="postgres://postgres@${HOST}/${MAIN_DB}"
export MINDCARE_ALEXA_FIXTURE_ADMIN_URL="postgres://postgres@${HOST}/${FIXTURE_DB}"
export MINDCARE_C200=run MINDCARE_C200_LABEL="$label" MINDCARE_C200_FILTER="$filter"
node tests/eval/alexa-clinical-conversational/v1/build-cases.mjs
node tests/eval/alexa-clinical-conversational/v1/generate-oracles.mjs > /dev/null
for db in main fixture; do
  case "$db" in main) name=$MAIN_DB;; fixture) name=$FIXTURE_DB;; esac
  MINDCARE_C200_DB=$db MINDCARE_DATABASE_URL="postgres://mindcare_app@${HOST}/${name}" \
    pnpm exec vitest run tests/integration/alexa-c200.live.test.ts || true
done
