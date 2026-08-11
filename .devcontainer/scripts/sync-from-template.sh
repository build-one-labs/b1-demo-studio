#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Sync from Starter Template
# =============================================================================
# Generates and applies a patch from the Build.One starter template repo
# to keep downstream apps up-to-date with template changes.
#
# Version detection: reads @buildone/swat-cli version from package.json to
# find the matching "Build.One <version> Starter App" commit in the template.
#
# Usage:
#   sync-from-template.sh [--dry-run] [--from <version|commit>] [--to <version|commit>]
#
# Options:
#   --dry-run   Show what would change without applying
#   --from      Override starting point (version like "24.3.0-VG.130" or commit hash)
#   --to        Override target (version or commit; default: latest on develop)
# =============================================================================

WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"
TEMPLATE_REPO="https://github.com/build-one-labs/starter.git"
TEMPLATE_BRANCH="develop"
TEMP_DIR=""

# Commit message pattern in the template repo
COMMIT_PATTERN="Build.One %s Starter App"

# Files/patterns to exclude from sync (project-specific)
EXCLUDE_PATTERNS=(
    "package.json"
    "*/package.json"
    "yarn.lock"
    "CLAUDE.md"
    "README.md"
    ".env"
    ".env.*"
    ".env.secrets"
    "src/data/"
    "src/app-server-ts/src/drizzle/schema/"
    "src/app-server-ts/drizzle/"
    "src/app-server-ts/src/server-actions/"
    "src/web-app/src/pages/"
    "src/web-app/src/components/"
    "src/web-app/nuxt.config.ts"
)

# Parse arguments
DRY_RUN=false
FROM_ARG=""
TO_ARG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --from)
            FROM_ARG="$2"
            shift 2
            ;;
        --to)
            TO_ARG="$2"
            shift 2
            ;;
        *)
            echo "[ERROR] Unknown option: $1"
            exit 1
            ;;
    esac
done

cleanup() {
    if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
        rm -rf "$TEMP_DIR"
    fi
}
trap cleanup EXIT

# =============================================================================
# Helpers
# =============================================================================

# Read @buildone/swat-cli version from package.json
get_current_version() {
    local pkg_file="${WORKSPACE_ROOT}/package.json"
    if [[ ! -f "$pkg_file" ]]; then
        echo "[ERROR] package.json not found at ${pkg_file}" >&2
        return 1
    fi
    # Extract version using node (available in devcontainer) for reliable JSON parsing
    node -e "console.log(require('${pkg_file}').devDependencies['@buildone/swat-cli'])" 2>/dev/null
}

# Resolve a version string or commit hash to an actual commit in the template repo
# Accepts: "24.3.0-VG.134" (version) or a git commit hash
resolve_commit() {
    local ref="$1"
    local template_dir="$2"

    # If it looks like a commit hash (hex, 7+ chars), try it directly
    if [[ "$ref" =~ ^[0-9a-f]{7,40}$ ]]; then
        if git -C "$template_dir" cat-file -e "$ref" 2>/dev/null; then
            echo "$ref"
            return 0
        fi
    fi

    # Otherwise treat it as a version — find the matching commit message
    local commit_msg
    commit_msg=$(printf "$COMMIT_PATTERN" "$ref")

    local commit_hash
    commit_hash=$(git -C "$template_dir" log --all --oneline --grep="^${commit_msg}$" --fixed-strings --format="%H" | head -1)

    if [[ -n "$commit_hash" ]]; then
        echo "$commit_hash"
        return 0
    fi

    echo "[ERROR] Could not find commit for version '${ref}'" >&2
    echo "        Expected commit message: '${commit_msg}'" >&2
    echo "        Available versions in template:" >&2
    git -C "$template_dir" log --oneline --grep="^Build.One.*Starter App$" --format="  %s" | head -10 >&2
    return 1
}

# =============================================================================
# Step 1: Clone template to temp directory
# =============================================================================
echo "[INFO] Cloning starter template..."
TEMP_DIR=$(mktemp -d)
git clone --quiet --single-branch --branch "$TEMPLATE_BRANCH" "$TEMPLATE_REPO" "$TEMP_DIR/template"

TEMPLATE_DIR="$TEMP_DIR/template"

# =============================================================================
# Step 2: Determine commit range
# =============================================================================

# Resolve FROM: use --from arg, or detect from package.json
if [[ -n "$FROM_ARG" ]]; then
    FROM_COMMIT=$(resolve_commit "$FROM_ARG" "$TEMPLATE_DIR")
    FROM_VERSION="$FROM_ARG"
else
    FROM_VERSION=$(get_current_version)
    if [[ -z "$FROM_VERSION" || "$FROM_VERSION" == "undefined" ]]; then
        echo "[ERROR] Could not read @buildone/swat-cli version from package.json"
        exit 1
    fi
    echo "[INFO] Current @buildone/swat-cli version: ${FROM_VERSION}"
    FROM_COMMIT=$(resolve_commit "$FROM_VERSION" "$TEMPLATE_DIR")
fi

# Resolve TO: use --to arg, or latest on develop
if [[ -n "$TO_ARG" ]]; then
    TO_COMMIT=$(resolve_commit "$TO_ARG" "$TEMPLATE_DIR")
    TO_VERSION="$TO_ARG"
else
    TO_COMMIT=$(git -C "$TEMPLATE_DIR" rev-parse HEAD)
    # Extract version from the latest commit message if it matches the pattern
    TO_VERSION=$(git -C "$TEMPLATE_DIR" log -1 --format="%s" "$TO_COMMIT" | sed -n 's/^Build\.One \(.*\) Starter App$/\1/p')
    if [[ -z "$TO_VERSION" ]]; then
        TO_VERSION="${TO_COMMIT:0:12}"
    fi
fi

if [[ "$FROM_COMMIT" == "$TO_COMMIT" ]]; then
    echo "[INFO] Already up-to-date (version: ${FROM_VERSION})."
    exit 0
fi

SHORT_FROM="${FROM_COMMIT:0:12}"
SHORT_TO="${TO_COMMIT:0:12}"

echo "[INFO] Syncing: ${FROM_VERSION} (${SHORT_FROM}) -> ${TO_VERSION} (${SHORT_TO})"

# Show commits in range
echo ""
echo "=== Template commits to sync ==="
git -C "$TEMPLATE_DIR" log --oneline "${FROM_COMMIT}..${TO_COMMIT}"
echo "================================="
echo ""

# =============================================================================
# Step 3: Generate patch with exclusions
# =============================================================================
PATCH_FILE="$TEMP_DIR/template.patch"

# Build exclude arguments for git diff
EXCLUDE_ARGS=()
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    EXCLUDE_ARGS+=(":(exclude)${pattern}")
done

git -C "$TEMPLATE_DIR" diff "$FROM_COMMIT" "$TO_COMMIT" -- . "${EXCLUDE_ARGS[@]}" > "$PATCH_FILE"

if [[ ! -s "$PATCH_FILE" ]]; then
    echo "[INFO] No changes to sync (all changes are in excluded paths)."
    exit 0
fi

# Show summary of changes
echo "=== Files affected ==="
git -C "$TEMPLATE_DIR" diff --stat "$FROM_COMMIT" "$TO_COMMIT" -- . "${EXCLUDE_ARGS[@]}"
echo "======================"
echo ""

# =============================================================================
# Step 4: Apply or preview
# =============================================================================
if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Patch preview:"
    echo ""
    cat "$PATCH_FILE"
    echo ""
    echo "[DRY-RUN] No changes applied. Run without --dry-run to apply."
    exit 0
fi

echo "[INFO] Applying patch..."
cd "$WORKSPACE_ROOT"

# Try to apply the patch, allowing conflicts to be resolved
if git apply --3way --verbose "$PATCH_FILE" 2>&1; then
    echo ""
    echo "[SUCCESS] Patch applied cleanly."
else
    APPLY_EXIT=$?
    echo ""
    echo "[WARNING] Patch applied with conflicts (exit code: $APPLY_EXIT)."
    echo "          Review the changes and resolve any conflicts marked with >>>>>>>"
fi

echo ""
echo "=== Next steps ==="
echo "1. Review the changes:  git diff"
echo "2. Update @buildone/swat-cli version in package.json to ${TO_VERSION}"
echo "3. Run yarn install"
echo "4. Test the application"
echo "5. Commit the changes"
echo "==================="
