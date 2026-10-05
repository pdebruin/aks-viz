#!/usr/bin/env bash
# Build the plugin and copy it into the AKS Desktop (Linux) development plugins directory.
# AKS Desktop loads this directory only when Plugin Development Mode is on (Settings > Plugins).
# Override the target with AKS_DESKTOP_PLUGINS_DIR=/path/to/plugins.
set -euo pipefail

cd "$(dirname "$0")/.."

name=$(node -p "require('./package.json').name")

if [[ -n "${AKS_DESKTOP_PLUGINS_DIR:-}" ]]; then
  plugins_dir="$AKS_DESKTOP_PLUGINS_DIR"
else
  # Mirrors Headlamp's defaultAppDataDir: data dir if it exists, else config dir.
  data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/AKS-Desktop"
  config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/AKS-Desktop"
  if [[ -d "$data_dir" ]]; then
    plugins_dir="$data_dir/plugins"
  else
    plugins_dir="$config_dir/plugins"
  fi
fi

if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  npm run build
fi

target="$plugins_dir/$name"
mkdir -p "$target"
cp dist/main.js package.json "$target/"
echo "Installed $name into $target"
echo "Restart AKS Desktop (or reload its window) to pick up the change."
