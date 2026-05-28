#!/bin/bash
# Read-only inspection of Supabase schema_migrations drift.
#
# Compares remote (via Management API) vs local supabase/migrations/.
# For each drift or foreign migration found on the remote, searches the
# user's home for matching migration files in other git worktrees so the
# source of the unexpected version can be traced (other branch, MCP from
# another session, dashboard apply, etc.).
#
# This script MUTATES NOTHING. Safe to run anytime, anywhere.
#
# Required env: SUPABASE_PROJECT_REF (or sourced from .env.staging/.env.production)
# Required auth: ~/.supabase/access-token (created by `supabase login`)
# Required tools: curl, jq, find, awk

set -euo pipefail

# ─── Project ref resolution ────────────────────────────────────────────────
PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
ENV_FILE=""
if [ -z "$PROJECT_REF" ]; then
  for f in .env.staging .env.production; do
    if [ -f "$f" ] && grep -q "^SUPABASE_PROJECT_REF=" "$f"; then
      ENV_FILE="$f"
      PROJECT_REF="$(grep "^SUPABASE_PROJECT_REF=" "$f" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")"
      break
    fi
  done
fi

if [ -z "$PROJECT_REF" ]; then
  echo "❌ SUPABASE_PROJECT_REF introuvable" >&2
  echo "   Export-le ou place-le dans .env.staging / .env.production" >&2
  exit 1
fi

# ─── Auth ──────────────────────────────────────────────────────────────────
# Resolution order:
#   1. $SUPABASE_ACCESS_TOKEN env var (CI-friendly)
#   2. ~/.supabase/access-token (Linux, older CLIs)
#   3. macOS Keychain "Supabase CLI" (CLI v2.x default on macOS)
resolve_supabase_token() {
  if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    printf '%s' "$SUPABASE_ACCESS_TOKEN"
    return 0
  fi
  if [ -s "$HOME/.supabase/access-token" ]; then
    cat "$HOME/.supabase/access-token"
    return 0
  fi
  if command -v security >/dev/null 2>&1; then
    local raw
    raw="$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null || true)"
    if [ -n "$raw" ]; then
      if [ "${raw#go-keyring-base64:}" != "$raw" ]; then
        # macOS base64 uses -D; GNU uses -d. Try both.
        local b64="${raw#go-keyring-base64:}"
        printf '%s' "$b64" | base64 -D 2>/dev/null \
          || printf '%s' "$b64" | base64 -d 2>/dev/null \
          || return 1
        return 0
      fi
      printf '%s' "$raw"
      return 0
    fi
  fi
  return 1
}

ACCESS_TOKEN="$(resolve_supabase_token || true)"
if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ Token Supabase introuvable" >&2
  echo "   Cherché dans: \$SUPABASE_ACCESS_TOKEN, ~/.supabase/access-token, macOS Keychain" >&2
  echo "   Lance 'supabase login' (sur ce poste tu as déjà été loggé, le keychain peut demander accès)." >&2
  exit 1
fi

# ─── Tool check ────────────────────────────────────────────────────────────
for cmd in curl jq find awk; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ Commande requise manquante: $cmd" >&2
    exit 1
  fi
done

echo "🔍 Inspection schema_migrations (read-only)"
echo "   project_ref : $PROJECT_REF"
[ -n "$ENV_FILE" ] && echo "   source env  : $ENV_FILE"
echo ""

# ─── Fetch remote migrations ───────────────────────────────────────────────
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/migrations"
REMOTE_JSON="$(curl -sf -H "Authorization: Bearer $ACCESS_TOKEN" "$API" || true)"

if [ -z "$REMOTE_JSON" ]; then
  echo "❌ API Supabase: pas de réponse (token expiré ou project_ref invalide ?)" >&2
  exit 1
fi
if ! echo "$REMOTE_JSON" | jq -e 'type == "array"' >/dev/null 2>&1; then
  echo "❌ Réponse API inattendue:" >&2
  echo "$REMOTE_JSON" | head -3 >&2
  exit 1
fi

REMOTE_COUNT="$(echo "$REMOTE_JSON" | jq 'length')"
echo "📡 Remote : ${REMOTE_COUNT} migration(s) tracked"

# ─── Scan local migrations ─────────────────────────────────────────────────
LOCAL_DIR="supabase/migrations"
if [ ! -d "$LOCAL_DIR" ]; then
  echo "❌ Dossier $LOCAL_DIR introuvable (lance depuis le repo root)" >&2
  exit 1
fi

LOCAL_PAIRS="$(
  for f in "$LOCAL_DIR"/*.sql; do
    [ -e "$f" ] || continue
    base="$(basename "$f" .sql)"
    ver="${base%%_*}"
    name="${base#*_}"
    if [ "$ver" != "$base" ] && [ -n "$name" ]; then
      printf '%s|%s\n' "$ver" "$name"
    fi
  done
)"
LOCAL_COUNT="$(printf '%s\n' "$LOCAL_PAIRS" | grep -c . || true)"
echo "📁 Local  : ${LOCAL_COUNT} fichier(s) dans $LOCAL_DIR"
echo ""

# ─── Worktree search helper ────────────────────────────────────────────────
# Locates supabase/migrations/*_<NAME>.sql in other places on disk so we can
# trace where an unexpected migration came from (other worktree, side repo).
#
# Strategy:
#   1. Git worktrees of the current repo (fast, scoped)
#   2. Bounded find on ~/Desktop, ~/Documents, ~/Projects (fallback)
#
# Wrapped in `|| true` everywhere to keep set -o pipefail from killing the
# whole script when find hits permission-denied paths in ~/Library etc.
SEARCH_DIRS=()
for d in "$HOME/Desktop" "$HOME/Documents" "$HOME/Projects" "$HOME/Code"; do
  [ -d "$d" ] && SEARCH_DIRS+=("$d")
done
CURRENT_DIR_ABS="$(pwd -P)"

search_other_worktrees() {
  local name="$1"
  local printed=""

  # Pass 1: git worktrees of this repo
  if git rev-parse --git-dir >/dev/null 2>&1; then
    while IFS= read -r wt_line; do
      case "$wt_line" in
        worktree*)
          local wt="${wt_line#worktree }"
          [ "$wt" = "$CURRENT_DIR_ABS" ] && continue
          for match in "$wt"/supabase/migrations/*_"$name".sql; do
            [ -e "$match" ] || continue
            printf '   ↳ %s\n' "${match/#$HOME/~}"
            printed="yes"
          done
          ;;
      esac
    done < <(git worktree list --porcelain 2>/dev/null || true)
  fi

  # Pass 2: bounded find in common work dirs
  if [ ${#SEARCH_DIRS[@]} -gt 0 ]; then
    local matches
    matches="$(find "${SEARCH_DIRS[@]}" -maxdepth 6 -type f \
                 -path "*/supabase/migrations/*_${name}.sql" 2>/dev/null || true)"
    if [ -n "$matches" ]; then
      while IFS= read -r match; do
        [ -z "$match" ] && continue
        local match_root
        match_root="$(cd "$(dirname "$match")/../.." 2>/dev/null && pwd -P || true)"
        if [ -n "$match_root" ] && [ "$match_root" != "$CURRENT_DIR_ABS" ]; then
          # Avoid duplicates from pass 1
          local rel="${match/#$HOME/~}"
          case "$printed" in
            *"$rel"*) : ;;
            *) printf '   ↳ %s\n' "$rel"; printed="$printed $rel" ;;
          esac
        fi
      done <<< "$matches"
    fi
  fi
}

# ─── Categorize ────────────────────────────────────────────────────────────
# Drift = a LOCAL file whose timestamp is absent from remote, AND remote has
# the SAME name at a different timestamp. That signature matches the MCP
# apply_migration drift pattern. Multiple-row remote names (legitimate
# history of re-applies, e.g. `remote_schema` from db pulls) are NOT counted
# as drift as long as ONE remote row matches the local timestamp.
#
# Foreign = a REMOTE row whose name has no local file at all.
ALIGNED=0
DRIFT=0
FOREIGN=0
PENDING=0
DRIFT_DETAILS=""
FOREIGN_DETAILS=""
PENDING_DETAILS=""

# All remote versions + name→[versions] map for fast lookup
REMOTE_VERSIONS="$(echo "$REMOTE_JSON" | jq -r '.[] | .version')"
REMOTE_NAMES="$(echo "$REMOTE_JSON" | jq -r '.[] | select(.name != null) | .name' | sort -u)"

remote_has_version() {
  printf '%s\n' "$REMOTE_VERSIONS" | grep -qx "$1"
}
remote_versions_for_name() {
  echo "$REMOTE_JSON" | jq -r --arg n "$1" '.[] | select(.name == $n) | .version'
}
local_has_name() {
  printf '%s\n' "$LOCAL_PAIRS" | awk -F'|' -v n="$1" '$2==n {found=1; exit} END {exit !found}'
}

# Phase 1: iterate local files
while IFS='|' read -r l_ver l_name; do
  [ -z "$l_ver" ] && continue
  if remote_has_version "$l_ver"; then
    ALIGNED=$((ALIGNED + 1))
    continue
  fi
  remote_vers_same_name="$(remote_versions_for_name "$l_name" | sort -u)"
  if [ -n "$remote_vers_same_name" ]; then
    DRIFT=$((DRIFT + 1))
    remote_list="$(printf '%s\n' "$remote_vers_same_name" | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')"
    DRIFT_DETAILS+="
⚠️  DRIFT     name=${l_name}
             local ver  : ${l_ver}  (fichier présent, absent de schema_migrations)
             remote vers: ${remote_list}  (même name, autres timestamps)
             → typique de MCP apply_migration avec timestamp régénéré"
  else
    PENDING=$((PENDING + 1))
    PENDING_DETAILS+="
📦 PENDING   name=${l_name}  local ver=${l_ver}"
  fi
done <<EOF
$LOCAL_PAIRS
EOF

# Phase 2: iterate remote, surface only truly foreign migrations
while IFS= read -r r_name; do
  [ -z "$r_name" ] && continue
  if local_has_name "$r_name"; then
    continue  # covered above (aligned, drift, or legacy history)
  fi
  FOREIGN=$((FOREIGN + 1))
  remote_vers="$(remote_versions_for_name "$r_name" | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')"
  found="$(search_other_worktrees "$r_name" | sort -u | head -5)"
  FOREIGN_DETAILS+="
❓ FOREIGN   name=${r_name}
             remote ver(s): ${remote_vers}
             aucun fichier local"
  if [ -n "$found" ]; then
    FOREIGN_DETAILS+="
             trouvé dans:
$found"
  else
    FOREIGN_DETAILS+="
             introuvable dans les autres worktrees scannés"
  fi
done <<EOF
$REMOTE_NAMES
EOF

# ─── Report ────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════"
echo "  Résumé"
echo "═══════════════════════════════════════════"
printf "  ✅ Aligné       : %d\n" "$ALIGNED"
printf "  ⚠️  Drift        : %d (même name, timestamp différent)\n" "$DRIFT"
printf "  ❓ Foreign      : %d (sur remote, absent localement)\n" "$FOREIGN"
printf "  📦 À pousser    : %d (local-only, sera poussé)\n" "$PENDING"
echo "═══════════════════════════════════════════"

[ -n "$DRIFT_DETAILS" ] && printf '%s\n' "$DRIFT_DETAILS"
[ -n "$FOREIGN_DETAILS" ] && printf '%s\n' "$FOREIGN_DETAILS"
[ -n "$PENDING_DETAILS" ] && printf '%s\n' "$PENDING_DETAILS"

echo ""
echo "ℹ️  Script read-only — rien n'a été modifié."
echo "   Pour repair manuel :"
echo "     supabase migration repair --status reverted <remote_ver>"
echo "     supabase migration repair --status applied <local_ver>"

exit 0
