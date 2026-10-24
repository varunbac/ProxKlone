#!/bin/zsh
PROJECT_DIR="$(dirname "$0")/Proxyy-Favour"
if [[ ! -d "$PROJECT_DIR" ]]; then
    echo "Could not find Proxyy-Favour beside this launcher."
    exit 1
fi
cd "$PROJECT_DIR" || exit 1
exec "./Start Favour.command"
