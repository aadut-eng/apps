# MyEditor

MyEditor is a lightweight macOS code editor inspired by Sublime Text. It uses a native AppKit/WebKit shell with a browser-based editor surface bundled inside the app.

## Features

- Native macOS app window using WebKit
- File tree, tabs, command palette, and minimap
- Syntax highlighting for common web and scripting files
- Find and replace
- Page tasks saved inside the app workspace
- Selected keyword coloring across the active page
- Double-click file actions in the side panel
- Theme switching and word wrap
- Native macOS file open/save dialogs
- Standard macOS edit commands for copy, paste, cut, undo, redo, and select all
- Workspace export/import

## Download

The packaged macOS app is included at:

```text
dist/MyEditor-native-mac.zip
```

Unzip it and open `MyEditor.app`. If macOS blocks the first launch, right-click the app and choose **Open** once.

## Build From Source

Requirements:

- macOS
- Xcode Command Line Tools with `swiftc`

Build:

```bash
./scripts/build-mac.sh
```

The script creates:

```text
dist/MyEditor.app
dist/MyEditor-native-mac.zip
```

## Project Layout

```text
web/      Editor HTML, CSS, and JavaScript
macos/    Native AppKit/WebKit host source
scripts/  Build script
dist/     Packaged app artifact
```

## Notes

The included app is ad-hoc signed for local use. Public distribution outside your own Mac would normally require an Apple Developer ID signature and notarization.
