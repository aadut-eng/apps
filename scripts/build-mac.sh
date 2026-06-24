#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/dist/MyEditor.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources/sublime-lite"
MODULE_CACHE="$ROOT_DIR/.build/module-cache"

mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$MODULE_CACHE"

cp "$ROOT_DIR/web/index.html" "$ROOT_DIR/web/styles.css" "$ROOT_DIR/web/app.js" "$RESOURCES_DIR/"
cp "$ROOT_DIR/macos/Info.plist" "$CONTENTS_DIR/Info.plist"

CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" swiftc \
  -target arm64-apple-macosx13.0 \
  -O \
  -framework Cocoa \
  -framework WebKit \
  "$ROOT_DIR/macos/main.swift" \
  "$ROOT_DIR/macos/AppDelegate.swift" \
  -o "$MACOS_DIR/MyEditor"

codesign --force --deep --sign - "$APP_DIR"

ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ROOT_DIR/dist/MyEditor-native-mac.zip"

echo "Built $ROOT_DIR/dist/MyEditor-native-mac.zip"
