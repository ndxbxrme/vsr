#!/usr/bin/env bash
set -euo pipefail

# Bootstraps a local tenant against the running VitalSpace remake API.
#
# Required env vars:
#   VS_EMAIL
#   VS_PASSWORD
#   VS_TENANT_NAME
#   VS_TENANT_SLUG
#   VS_BRANCH_NAME
#   VS_BRANCH_SLUG
#   VS_DEZREZ_AGENCY_ID
#   VS_DEZREZ_CLIENT_ID
#   VS_DEZREZ_CLIENT_SECRET
#
# Optional env vars:
#   VS_API_BASE_URL          default: http://localhost:4220/api/v1
#   VS_WEB_BASE_URL          default: http://localhost:5173
#   VS_DEZREZ_NAME           default: Main Dezrez
#   VS_DEZREZ_AUTH_URL
#   VS_DEZREZ_CORE_API_URL
#   VS_DEZREZ_API_URL
#   VS_DEZREZ_API_KEY
#   VS_TENANT_ID             skip tenant creation and reuse this tenant id
#   VS_BRANCH_ID             printed back if supplied alongside VS_TENANT_ID
#   VS_REQUEST_SYNC          default: true

API_BASE_URL="${VS_API_BASE_URL:-http://localhost:4220/api/v1}"
WEB_BASE_URL="${VS_WEB_BASE_URL:-http://localhost:5173}"
DEZREZ_NAME="${VS_DEZREZ_NAME:-Main Dezrez}"
REQUEST_SYNC="${VS_REQUEST_SYNC:-true}"

required_vars=(
  VS_EMAIL
  VS_PASSWORD
  VS_DEZREZ_AGENCY_ID
  VS_DEZREZ_CLIENT_ID
  VS_DEZREZ_CLIENT_SECRET
)

if [[ -z "${VS_TENANT_ID:-}" ]]; then
  required_vars+=(
    VS_TENANT_NAME
    VS_TENANT_SLUG
    VS_BRANCH_NAME
    VS_BRANCH_SLUG
  )
fi

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required env var: ${var_name}" >&2
    exit 1
  fi
done

json_read() {
  local path="$1"
  node -e '
const fs = require("fs");

const pathArg = process.argv[1];
const body = fs.readFileSync(0, "utf8").trim();

if (!body) {
  process.exit(1);
}

const object = JSON.parse(body);
let current = object;

for (const key of pathArg.split(".")) {
  if (current == null || !(key in current)) {
    process.exit(1);
  }
  current = current[key];
}

if (current == null) {
  process.exit(1);
}

if (typeof current === "object") {
  process.stdout.write(JSON.stringify(current));
} else {
  process.stdout.write(String(current));
}
' "$path"
}

json_escape() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1] ?? ""))' "${1}"
}

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local auth_token="${4:-}"
  local response
  local auth_args=()

  if [[ -n "${auth_token}" ]]; then
    auth_args=(-H "Authorization: Bearer ${auth_token}")
  fi

  if [[ -n "${body}" ]]; then
    response="$(
      curl -sS \
        -X "${method}" \
        "${auth_args[@]}" \
        -H 'Content-Type: application/json' \
        "${API_BASE_URL}${path}" \
        -d "${body}" \
        -w $'\n%{http_code}'
    )"
  else
    response="$(
      curl -sS \
        -X "${method}" \
        "${auth_args[@]}" \
        "${API_BASE_URL}${path}" \
        -w $'\n%{http_code}'
    )"
  fi

  HTTP_CODE="${response##*$'\n'}"
  RESPONSE_BODY="${response%$'\n'*}"
}

expect_http() {
  local expected="$1"
  if [[ "${HTTP_CODE}" != "${expected}" ]]; then
    echo "Unexpected HTTP ${HTTP_CODE}. Response:" >&2
    echo "${RESPONSE_BODY}" >&2
    exit 1
  fi
}

echo "Signing up ${VS_EMAIL} if needed..."
signup_payload="$(
  cat <<JSON
{"email":$(json_escape "${VS_EMAIL}"),"password":$(json_escape "${VS_PASSWORD}")}
JSON
)"
request POST /auth/signup "${signup_payload}"
if [[ "${HTTP_CODE}" != "201" && "${HTTP_CODE}" != "409" ]]; then
  echo "Signup failed with HTTP ${HTTP_CODE}. Response:" >&2
  echo "${RESPONSE_BODY}" >&2
  exit 1
fi

echo "Logging in..."
login_payload="$(
  cat <<JSON
{"email":$(json_escape "${VS_EMAIL}"),"password":$(json_escape "${VS_PASSWORD}")}
JSON
)"
request POST /auth/login "${login_payload}"
expect_http 200
if ! ACCESS_TOKEN="$(printf '%s' "${RESPONSE_BODY}" | json_read 'accessToken')"; then
  echo "Login succeeded but accessToken was missing. Response:" >&2
  echo "${RESPONSE_BODY}" >&2
  exit 1
fi

TENANT_ID="${VS_TENANT_ID:-}"
BRANCH_ID="${VS_BRANCH_ID:-}"

if [[ -z "${TENANT_ID}" ]]; then
  echo "Creating tenant ${VS_TENANT_NAME}..."
  tenant_payload="$(
    cat <<JSON
{"name":$(json_escape "${VS_TENANT_NAME}"),"slug":$(json_escape "${VS_TENANT_SLUG}"),"branchName":$(json_escape "${VS_BRANCH_NAME}"),"branchSlug":$(json_escape "${VS_BRANCH_SLUG}")}
JSON
  )"
  request POST /tenants "${tenant_payload}" "${ACCESS_TOKEN}"
  expect_http 201
  if ! TENANT_ID="$(printf '%s' "${RESPONSE_BODY}" | json_read 'tenant.id')"; then
    echo "Tenant creation succeeded but tenant.id was missing. Response:" >&2
    echo "${RESPONSE_BODY}" >&2
    exit 1
  fi
  if ! BRANCH_ID="$(printf '%s' "${RESPONSE_BODY}" | json_read 'branch.id')"; then
    echo "Tenant creation succeeded but branch.id was missing. Response:" >&2
    echo "${RESPONSE_BODY}" >&2
    exit 1
  fi
else
  echo "Reusing tenant ${TENANT_ID}..."
fi

echo "Configuring Dezrez integration for tenant ${TENANT_ID}..."
auth_url_line=''
core_api_url_line=''
search_api_url_line=''
api_key_line=''

if [[ -n "${VS_DEZREZ_AUTH_URL:-}" ]]; then
  auth_url_line=",\"authUrl\":$(json_escape "${VS_DEZREZ_AUTH_URL}")"
fi

if [[ -n "${VS_DEZREZ_CORE_API_URL:-}" ]]; then
  core_api_url_line=",\"coreApiUrl\":$(json_escape "${VS_DEZREZ_CORE_API_URL}")"
fi

if [[ -n "${VS_DEZREZ_API_URL:-}" ]]; then
  search_api_url_line=",\"searchApiUrl\":$(json_escape "${VS_DEZREZ_API_URL}")"
fi

if [[ -n "${VS_DEZREZ_API_KEY:-}" ]]; then
  api_key_line="\"apiKey\":$(json_escape "${VS_DEZREZ_API_KEY}"),"
fi

integration_payload="$(
  cat <<JSON
{
  "tenantId": $(json_escape "${TENANT_ID}"),
  "name": $(json_escape "${DEZREZ_NAME}"),
  "settings": {
    "mode": "live",
    "agencyId": ${VS_DEZREZ_AGENCY_ID}${auth_url_line}${core_api_url_line}${search_api_url_line}
  },
  "credentials": {
    ${api_key_line}"clientId": $(json_escape "${VS_DEZREZ_CLIENT_ID}"),
    "clientSecret": $(json_escape "${VS_DEZREZ_CLIENT_SECRET}")
  }
}
JSON
)"
request POST /integrations/dezrez/accounts "${integration_payload}" "${ACCESS_TOKEN}"
if [[ "${HTTP_CODE}" != "200" && "${HTTP_CODE}" != "201" ]]; then
  echo "Failed to configure Dezrez integration. Response:" >&2
  echo "${RESPONSE_BODY}" >&2
  exit 1
fi

if [[ "${REQUEST_SYNC}" == "true" ]]; then
  echo "Requesting initial sync..."
  sync_payload="$(
    cat <<JSON
{"tenantId":$(json_escape "${TENANT_ID}")}
JSON
  )"
  request POST /integrations/dezrez/sync "${sync_payload}" "${ACCESS_TOKEN}"
  if [[ "${HTTP_CODE}" != "202" ]]; then
    echo "Initial sync request failed. Response:" >&2
    echo "${RESPONSE_BODY}" >&2
    exit 1
  fi
fi

cat <<EOF

Bootstrap complete.

Access token:
${ACCESS_TOKEN}

Tenant id:
${TENANT_ID}

Branch id:
${BRANCH_ID:-"(not created by this run)"}

Open these:
- ${WEB_BASE_URL}/explorer
- ${WEB_BASE_URL}/workspace/sales
- ${WEB_BASE_URL}/pilot-readiness

Paste into the UI:
- tenantId: ${TENANT_ID}
- accessToken: ${ACCESS_TOKEN}
EOF
