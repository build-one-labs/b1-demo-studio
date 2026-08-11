#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Project Rename Setup
# =============================================================================
# This script provides an interactive wizard for renaming the project from
# the template name to the actual project name.
#
# Usage: ./project-rename-setup.sh [--force]
#   --force: Run setup even if previously completed
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source project configuration
source "$SCRIPT_DIR/../lib/project-config.sh"
secrets_init_paths

RENAME_COMPLETE_MARKER="${SECRETS_STATE_DIR}/project_rename_complete.marker"

# =============================================================================
# Rename Functions
# =============================================================================

rename_in_file() {
  local file="$1"
  local old_name="$2"
  local new_name="$3"
  local workspace_root="$SECRETS_WORKSPACE_ROOT"
  local full_path="$workspace_root/$file"

  if [ ! -f "$full_path" ]; then
    secrets_print_warning "File not found: $file (skipping)"
    return 0
  fi

  # Check if file contains the old name
  if ! grep -q "$old_name" "$full_path" 2>/dev/null; then
    secrets_print_info "No changes needed in: $file"
    return 0
  fi

  # Perform the replacement
  if sed -i "s/${old_name}/${new_name}/g" "$full_path"; then
    secrets_print_success "Updated: $file"
    return 0
  else
    secrets_print_error "Failed to update: $file"
    return 1
  fi
}

prompt_for_project_name() {
  local suggested_name="$1"
  local project_name=""

  echo "" >&2
  echo -e "${SECRETS_COLOR_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${SECRETS_COLOR_NC}" >&2
  echo -e "${SECRETS_COLOR_BOLD}Enter New Project Name${SECRETS_COLOR_NC}" >&2
  echo -e "${SECRETS_COLOR_CYAN}Use lowercase letters, numbers, and hyphens only.${SECRETS_COLOR_NC}" >&2
  echo -e "${SECRETS_COLOR_CYAN}Example: my-awesome-app, client-portal, inventory-system${SECRETS_COLOR_NC}" >&2
  echo -e "${SECRETS_COLOR_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${SECRETS_COLOR_NC}" >&2
  echo "" >&2

  if [ -n "$suggested_name" ]; then
    echo -e "Suggested name: ${SECRETS_COLOR_GREEN}${suggested_name}${SECRETS_COLOR_NC}" >&2
    read -r -p "Press Enter to use '$suggested_name', or type a different name: " project_name </dev/tty
    if [ -z "$project_name" ]; then
      project_name="$suggested_name"
      secrets_print_info "Using suggested name: $project_name" >&2
    fi
  else
    read -r -p "Project name: " project_name </dev/tty
  fi

  # Validate and re-prompt if needed
  while ! validate_project_name "$project_name"; do
    echo "" >&2
    secrets_print_error "Invalid project name: '$project_name'" >&2
    echo -e "${SECRETS_COLOR_YELLOW}Requirements:${SECRETS_COLOR_NC}" >&2
    echo "  • Start with a lowercase letter" >&2
    echo "  • Use only lowercase letters, numbers, and hyphens" >&2
    echo "  • No consecutive hyphens" >&2
    echo "  • End with a letter or number" >&2
    echo "" >&2
    read -r -p "Project name: " project_name </dev/tty
  done

  echo "$project_name"
}

# =============================================================================
# Main Setup Logic
# =============================================================================

check_prerequisites() {
  secrets_print_section "Checking Prerequisites"

  if ! secrets_is_codespace; then
    secrets_print_error "This script is designed for GitHub Codespaces only."
    secrets_print_info "Current environment: ${CODESPACES:-not-set}"
    return 1
  fi
  secrets_print_success "Running in GitHub Codespace"

  # Check if sed is available
  if ! command -v sed &> /dev/null; then
    secrets_print_error "sed is not installed."
    return 1
  fi
  secrets_print_success "Required tools available"

  return 0
}

perform_rename() {
  local new_name="$1"
  local success_count=0
  local fail_count=0

  secrets_print_section "Renaming Project"

  echo -e "${SECRETS_COLOR_CYAN}Replacing '${TEMPLATE_PROJECT_NAME}' with '${new_name}' in configuration files...${SECRETS_COLOR_NC}"
  echo ""

  for file in "${PROJECT_NAME_FILES[@]}"; do
    if rename_in_file "$file" "$TEMPLATE_PROJECT_NAME" "$new_name"; then
      ((success_count++))
    else
      ((fail_count++))
    fi
  done

  echo ""
  secrets_print_header "Rename Complete"
  secrets_print_success "Updated $success_count file(s)"

  if [ $fail_count -gt 0 ]; then
    secrets_print_warning "Failed to update $fail_count file(s)"
    return 1
  fi

  return 0
}

show_next_steps() {
  secrets_print_section "Next Steps"

  echo -e "${SECRETS_COLOR_CYAN}The project has been renamed in the configuration files.${SECRETS_COLOR_NC}"
  echo ""
  echo -e "${SECRETS_COLOR_BOLD}You may also want to:${SECRETS_COLOR_NC}"
  echo "  1. Update the app title in src/web-app/nuxt.config.ts"
  echo "  2. Update the README.md with your project description"
  echo "  3. Commit the changes to your repository"
  echo ""
  secrets_print_info "Run 'git diff' to review the changes."
}

main() {
  local force_setup=false

  while [[ $# -gt 0 ]]; do
    case $1 in
      --force)
        force_setup=true
        shift
        ;;
      *)
        secrets_print_error "Unknown option: $1"
        echo "Usage: $0 [--force]"
        exit 1
        ;;
    esac
  done

  secrets_print_header "Project Rename Wizard"

  # Check if already completed
  if [ -f "$RENAME_COMPLETE_MARKER" ] && [ "$force_setup" = "false" ]; then
    if ! is_template_project; then
      secrets_print_info "Project has already been renamed."
      secrets_print_info "Use --force to run setup again."
      exit 0
    fi
  fi

  # Check prerequisites
  if ! check_prerequisites; then
    secrets_print_error "Prerequisites check failed. Exiting."
    exit 1
  fi

  # Verify project still needs renaming
  if ! is_template_project; then
    secrets_print_success "Project has already been renamed from template."
    touch "$RENAME_COMPLETE_MARKER"
    exit 0
  fi

  # Show what will be changed
  secrets_print_section "Project Rename"
  show_project_rename_instructions
  echo ""

  read -r -p "Press Enter to continue..." </dev/tty

  # Get new project name
  local suggested_name=$(get_suggested_project_name)
  local new_name=$(prompt_for_project_name "$suggested_name")

  echo ""
  echo -e "${SECRETS_COLOR_BOLD}Confirm rename:${SECRETS_COLOR_NC}"
  echo -e "  From: ${SECRETS_COLOR_RED}${TEMPLATE_PROJECT_NAME}${SECRETS_COLOR_NC}"
  echo -e "  To:   ${SECRETS_COLOR_GREEN}${new_name}${SECRETS_COLOR_NC}"
  echo ""

  read -r -p "Proceed with rename? (Y/n): " -n 1 reply </dev/tty
  echo ""

  if [[ $reply =~ ^[Nn]$ ]]; then
    secrets_print_warning "Rename cancelled."
    exit 1
  fi

  # Perform the rename
  if ! perform_rename "$new_name"; then
    secrets_print_error "Rename failed."
    exit 1
  fi

  # Mark as complete
  touch "$RENAME_COMPLETE_MARKER"

  # Show next steps
  show_next_steps

  secrets_print_success "Project rename completed successfully!"
}

main "$@"
