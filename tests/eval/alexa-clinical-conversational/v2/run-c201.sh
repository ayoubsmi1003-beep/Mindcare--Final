#!/usr/bin/env bash
# Runs the C201 campaign against the real pipeline and the disposable synthetic databases.
#   tests/eval/alexa-clinical-conversational/v2/run-c201.sh <label> [filter] [cases|holdout]
# Needs: Docker with the evaluation containers up, `pnpm install` done, the local model under the path below.
# Override any of these variables from the environment. Nothing here ever points at a real-patient database.
# Do NOT edit application code while this runs (the pipeline is loaded as it goes).
set -euo pipefail
label="${1:?usage: run-c201.sh <label> [filter] [cases|holdout]}"
filter="${2:-}"
set_name="${3:-cases}"
HOST="${C201_DB_HOST:-127.0.0.1:55445}"
MAIN_DB=alexa_eval_v8_intelligence_20261027
FIXTURE_DB=alexa_eval_v9_fixture_20261030
export ALEXA_NATIVE_AGENT_ENABLED=1 KNOWLEDGE_VECTOR=1 KNOWLEDGE_VECTOR_RECETTE=e5-base ALEXA_LOCAL_TIMINGS=1
export ALEXA_LOCAL_MODEL_ROOT="${ALEXA_LOCAL_MODEL_ROOT:-C:\\MindCare\\alexa-v8-final\\.cache\\alexa\\minicpm}"
export MINDCARE_ALEXA_EVAL_ADMIN_URL="postgres://postgres@${HOST}/${MAIN_DB}"
export MINDCARE_ALEXA_FIXTURE_ADMIN_URL="postgres://postgres@${HOST}/${FIXTURE_DB}"
export MINDCARE_C201=run MINDCARE_C201_LABEL="$label" MINDCARE_C201_FILTER="$filter" MINDCARE_C201_SET="$set_name"
node tests/eval/alexa-clinical-conversational/v2/build-cases.mjs
node tests/eval/alexa-clinical-conversational/v2/prepare-clock.mjs
if [ "$set_name" = "holdout" ]; then node tests/eval/alexa-clinical-conversational/v2/generate-oracles.mjs holdout > /dev/null
else node tests/eval/alexa-clinical-conversational/v2/generate-oracles.mjs > /dev/null; fi
for db in main fixture; do
  case "$db" in main) name=$MAIN_DB;; fixture) name=$FIXTURE_DB;; esac
  MINDCARE_C201_DB=$db MINDCARE_DATABASE_URL="postgres://mindcare_app@${HOST}/${name}" \
    pnpm exec vitest run tests/integration/alexa-c201.live.test.ts || true
done
