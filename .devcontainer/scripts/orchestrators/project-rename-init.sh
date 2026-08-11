#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Project Rename Initialization
# =============================================================================
# This script runs during postAttachCommand to check if the project has been
# renamed from the template name. If not, it prompts the user to rename it.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source project configuration
source "$SCRIPT_DIR/../lib/project-config.sh"
secrets_init_paths

# Marker to track if rename was completed or skipped
RENAME_COMPLETE_MARKER="${SECRETS_STATE_DIR}/project_rename_complete.marker"

main() {
  # Only run in Codespaces
  if ! secrets_is_codespace; then
    exit 0
  fi

  # If rename was already completed or skipped, don't prompt again
  if [ -f "$RENAME_COMPLETE_MARKER" ]; then
    exit 0
  fi

  # Check if project still has template name
  if ! is_template_project; then
    touch "$RENAME_COMPLETE_MARKER"
    exit 0
  fi

  # Get suggested name from repo
  local suggested_name=$(get_suggested_project_name)

  # Display notice about template project
  echo ""
  echo -e "${SECRETS_COLOR_BOLD}${SECRETS_COLOR_YELLOW}╔════════════════════════════════════════════════════════════════════════╗${SECRETS_COLOR_NC}"
  echo -e "${SECRETS_COLOR_BOLD}${SECRETS_COLOR_YELLOW}║                                                                        ║${SECRETS_COLOR_NC}"
  echo -e "${SECRETS_COLOR_BOLD}${SECRETS_COLOR_YELLOW}║  📦 PROJECT RENAME RECOMMENDED                                         ║${SECRETS_COLOR_NC}"
  echo -e "${SECRETS_COLOR_BOLD}${SECRETS_COLOR_YELLOW}║                                                                        ║${SECRETS_COLOR_NC}"
  echo -e "${SECRETS_COLOR_BOLD}${SECRETS_COLOR_YELLOW}╚════════════════════════════════════════════════════════════════════════╝${SECRETS_COLOR_NC}"
  echo ""
  show_project_rename_instructions
  echo ""

  if [ -n "$suggested_name" ]; then
    echo -e "${SECRETS_COLOR_GREEN}Suggested name based on repository: ${SECRETS_COLOR_BOLD}${suggested_name}${SECRETS_COLOR_NC}"
    echo ""
  fi

  echo -e "${SECRETS_COLOR_BOLD}${SECRETS_COLOR_CYAN}Would you like to rename the project now?${SECRETS_COLOR_NC}"
  echo ""

  read -r -p "Rename project? (Y/n): " -n 1 reply </dev/tty
  echo ""

  if [[ $reply =~ ^[Nn]$ ]]; then
    echo ""
    secrets_print_warning "Rename skipped."
    echo ""
    echo -e "${SECRETS_COLOR_BOLD}To rename later, run:${SECRETS_COLOR_NC}"
    echo -e "  ${SECRETS_COLOR_CYAN}.devcontainer/scripts/orchestrators/project-rename-setup.sh${SECRETS_COLOR_NC}"
    echo ""

    # Mark as skipped so we don't prompt again this session
    touch "$RENAME_COMPLETE_MARKER"
    exit 0
  fi

  # Run the rename wizard
  echo ""
  secrets_print_info "Starting project rename wizard..."
  echo ""

  "${SCRIPT_DIR}/project-rename-setup.sh"

  local setup_exit_code=$?

  if [ $setup_exit_code -eq 0 ]; then
    echo ""
    secrets_print_success "Project renamed successfully!"
    touch "$RENAME_COMPLETE_MARKER"
  else
    echo ""
    secrets_print_error "Project rename failed or was cancelled."
    echo ""
    echo -e "${SECRETS_COLOR_BOLD}To try again, run:${SECRETS_COLOR_NC}"
    echo -e "  ${SECRETS_COLOR_CYAN}.devcontainer/scripts/orchestrators/project-rename-setup.sh${SECRETS_COLOR_NC}"
    echo ""
    exit 1
  fi
}

main "$@"
