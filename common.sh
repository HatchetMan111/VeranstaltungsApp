# common.sh — von provision-lxc.sh, deploy-event.sh und install.sh eingebunden
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'

# banner "Titel" "Zeile 1" "Zeile 2" ...
banner() {
  local title="$1"; shift
  echo
  echo -e "${GREEN}${BOLD}✔ ${title}${RESET}"
  echo -e "${YELLOW}────────────────────────────────────────────────────${RESET}"
  for line in "$@"; do
    echo -e "  $line"
  done
  echo -e "${YELLOW}────────────────────────────────────────────────────${RESET}"
  echo
}
