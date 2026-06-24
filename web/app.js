(function () {
  "use strict";

  const STORAGE_KEY = "myeditor.workspace.v1";
  const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", ".next", ".cache"]);

  const els = {
    shell: document.querySelector(".app-shell"),
    tree: document.getElementById("tree"),
    tabs: document.getElementById("tabs"),
    editor: document.getElementById("editor"),
    highlight: document.getElementById("highlightLayer"),
    lineNumbers: document.getElementById("lineNumbers"),
    minimap: document.getElementById("minimap"),
    fileFilter: document.getElementById("fileFilter"),
    fileInput: document.getElementById("fileInput"),
    importInput: document.getElementById("importInput"),
    themeSelect: document.getElementById("themeSelect"),
    findBar: document.getElementById("findBar"),
    findInput: document.getElementById("findInput"),
    replaceInput: document.getElementById("replaceInput"),
    findCount: document.getElementById("findCount"),
    paletteOverlay: document.getElementById("paletteOverlay"),
    paletteInput: document.getElementById("paletteInput"),
    paletteList: document.getElementById("paletteList"),
    dialogOverlay: document.getElementById("dialogOverlay"),
    dialogTitle: document.getElementById("dialogTitle"),
    dialogMessage: document.getElementById("dialogMessage"),
    dialogInput: document.getElementById("dialogInput"),
    dialogCancel: document.getElementById("dialogCancel"),
    dialogConfirm: document.getElementById("dialogConfirm"),
    toast: document.getElementById("toast"),
    statusPath: document.getElementById("statusPath"),
    statusDirty: document.getElementById("statusDirty"),
    statusCursor: document.getElementById("statusCursor"),
    statusLanguage: document.getElementById("statusLanguage"),
    statusSize: document.getElementById("statusSize")
  };

  const state = {
    files: new Map(),
    tabs: [],
    activePath: "",
    wrap: false,
    paletteMode: "commands",
    paletteItems: [],
    paletteIndex: 0,
    dialogResolve: null,
    findMatches: [],
    findIndex: -1,
    toastTimer: 0
  };

  window.MyEditorNative = window.MyEditorNative || {
    pending: new Map(),
    request(action, payload = {}) {
      const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.myEditorNative;
      if (!handler) return Promise.reject(new Error("Native bridge unavailable"));
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        handler.postMessage({ id, action, payload });
      });
    },
    _complete(response) {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error || "Native action failed"));
    }
  };

  function hasNativeBridge() {
    return Boolean(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.myEditorNative);
  }

  async function nativeRequest(action, payload) {
    return window.MyEditorNative.request(action, payload);
  }

  const samples = [
    {
      path: "src/app.js",
      content: [
        "const editor = document.querySelector('#editor');",
        "const status = document.querySelector('#status');",
        "",
        "function formatCount(lines) {",
        "  return `${lines.length} lines ready`;",
        "}",
        "",
        "editor.addEventListener('input', () => {",
        "  const lines = editor.value.split('\\n');",
        "  status.textContent = formatCount(lines);",
        "});"
      ].join("\n")
    },
    {
      path: "src/theme.css",
      content: [
        ":root {",
        "  --accent: #f8c555;",
        "  --surface: #1b1c1f;",
        "}",
        "",
        ".editor {",
        "  background: var(--surface);",
        "  color: #f4f1e8;",
        "  min-height: 100vh;",
        "}"
      ].join("\n")
    },
    {
      path: "README.md",
      content: [
        "# MyEditor",
        "",
        "A fast local editor inspired by Sublime Text.",
        "",
        "- Multi-file workspace",
        "- Tabs, command palette, find and replace",
        "- Local file open and save support in modern Chrome"
      ].join("\n")
    },
    {
      path: "package.json",
      content: [
        "{",
        "  \"name\": \"myeditor-sample\",",
        "  \"private\": true,",
        "  \"scripts\": {",
        "    \"start\": \"vite --host 127.0.0.1\"",
        "  }",
        "}"
      ].join("\n")
    }
  ];

  const commands = [
    { id: "new-file", title: "New File", meta: "File", run: createNewFile },
    { id: "open-folder", title: "Open Folder", meta: "File", run: openWorkspace },
    { id: "open-files", title: "Open Files", meta: "File", run: openLooseFiles },
    { id: "save-file", title: "Save", meta: "File", run: () => saveActiveFile(false) },
    { id: "save-as", title: "Save As", meta: "File", run: () => saveActiveFile(true) },
    { id: "save-all", title: "Save All", meta: "File", run: saveAllFiles },
    { id: "close-tab", title: "Close Tab", meta: "Tabs", run: closeActiveTab },
    { id: "rename-file", title: "Rename File", meta: "File", run: renameActiveFile },
    { id: "duplicate-file", title: "Duplicate File", meta: "File", run: duplicateActiveFile },
    { id: "delete-file", title: "Delete File", meta: "File", run: deleteActiveFile },
    { id: "find", title: "Find and Replace", meta: "Edit", run: openFind },
    { id: "quick-open", title: "Quick Open", meta: "Navigate", run: () => openPalette("files") },
    { id: "command-palette", title: "Command Palette", meta: "Navigate", run: () => openPalette("commands") },
    { id: "toggle-wrap", title: "Toggle Word Wrap", meta: "View", run: toggleWrap },
    { id: "theme-monokai", title: "Theme: Monokai", meta: "View", run: () => setTheme("monokai") },
    { id: "theme-paper", title: "Theme: Paper", meta: "View", run: () => setTheme("paper") },
    { id: "theme-contrast", title: "Theme: Contrast", meta: "View", run: () => setTheme("contrast") },
    { id: "export-workspace", title: "Export Workspace", meta: "File", run: exportWorkspace },
    { id: "import-workspace", title: "Import Workspace", meta: "File", run: () => els.importInput.click() },
    { id: "restore-samples", title: "Restore Sample Workspace", meta: "File", run: restoreSampleWorkspace }
  ];

  function init() {
    restoreWorkspace();
    bindEvents();
    renderAll();
    activateFile(state.activePath || state.tabs[0] || Array.from(state.files.keys())[0]);
    showToast("MyEditor is ready");
  }

  function bindEvents() {
    document.querySelectorAll("[data-command]").forEach((button) => {
      button.addEventListener("click", () => runCommand(button.dataset.command));
    });

    els.editor.addEventListener("input", () => {
      const file = getActiveFile();
      if (!file) return;
      file.content = els.editor.value;
      file.dirty = file.content !== file.savedContent;
      updateEditorDecorations();
      renderTabs();
      renderTree();
      updateFindMatches();
      updateStatus();
      persistSoon();
    });

    els.editor.addEventListener("keydown", handleEditorKeydown);
    els.editor.addEventListener("keyup", updateStatus);
    els.editor.addEventListener("click", updateStatus);
    els.editor.addEventListener("select", updateStatus);

    els.editor.addEventListener("scroll", syncScroll);
    els.fileFilter.addEventListener("input", renderTree);

    els.fileInput.addEventListener("change", async () => {
      await readInputFiles(els.fileInput.files);
      els.fileInput.value = "";
    });

    els.importInput.addEventListener("change", async () => {
      await importWorkspaceFile(els.importInput.files[0]);
      els.importInput.value = "";
    });

    els.themeSelect.addEventListener("change", () => setTheme(els.themeSelect.value));

    document.querySelectorAll("[data-find]").forEach((button) => {
      button.addEventListener("click", () => runFindAction(button.dataset.find));
    });

    els.findInput.addEventListener("input", () => {
      updateFindMatches();
      selectFindMatch(0);
    });

    els.findInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        selectFindMatch(state.findIndex + (event.shiftKey ? -1 : 1));
      }
      if (event.key === "Escape") closeFind();
    });

    els.replaceInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        replaceCurrentMatch();
      }
      if (event.key === "Escape") closeFind();
    });

    els.paletteOverlay.addEventListener("click", (event) => {
      if (event.target === els.paletteOverlay) closePalette();
    });

    els.paletteInput.addEventListener("input", () => {
      state.paletteIndex = 0;
      renderPalette();
    });

    els.paletteInput.addEventListener("keydown", handlePaletteKeydown);

    els.dialogOverlay.addEventListener("click", (event) => {
      if (event.target === els.dialogOverlay) closeDialog(null);
    });

    els.dialogCancel.addEventListener("click", () => closeDialog(null));
    els.dialogConfirm.addEventListener("click", () => {
      closeDialog(els.dialogInput.hidden ? true : els.dialogInput.value);
    });

    els.dialogInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        closeDialog(els.dialogInput.value);
      }
      if (event.key === "Escape") closeDialog(null);
    });

    document.addEventListener("keydown", handleGlobalKeydown);
  }

  function restoreWorkspace() {
    const saved = readStoredWorkspace();
    if (saved && Array.isArray(saved.files) && saved.files.length) {
      saved.files.forEach((entry) => addFile({
        path: entry.path,
        content: entry.content || "",
        savedContent: typeof entry.savedContent === "string" ? entry.savedContent : entry.content || "",
        nativePath: entry.nativePath || ""
      }));
      state.tabs = saved.tabs && saved.tabs.length ? saved.tabs.filter((path) => state.files.has(path)) : [];
      state.activePath = state.files.has(saved.activePath) ? saved.activePath : "";
      state.wrap = Boolean(saved.wrap);
      setTheme(saved.theme || "monokai", false);
    } else {
      samples.forEach((sample) => addFile(sample));
      state.tabs = samples.slice(0, 3).map((sample) => sample.path);
      state.activePath = samples[0].path;
      setTheme("monokai", false);
    }
  }

  function readStoredWorkspace() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (error) {
      return null;
    }
  }

  function persistWorkspace() {
    const files = Array.from(state.files.values()).map((file) => ({
      path: file.path,
      content: file.content,
      savedContent: file.savedContent,
      nativePath: file.nativePath || ""
    }));
    const payload = {
      app: "MyEditor",
      version: 1,
      files,
      tabs: state.tabs,
      activePath: state.activePath,
      wrap: state.wrap,
      theme: els.shell.dataset.theme
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      showToast("Session backup is full");
    }
  }

  const persistSoon = debounce(persistWorkspace, 250);

  function addFile({ path, content, savedContent, handle, nativePath }) {
    const cleanPath = normalizePath(path || "untitled.txt");
    const existing = state.files.get(cleanPath);
    const file = {
      path: cleanPath,
      name: basename(cleanPath),
      language: languageForPath(cleanPath),
      content: content || "",
      savedContent: typeof savedContent === "string" ? savedContent : content || "",
      dirty: false,
      handle: handle || (existing && existing.handle) || null,
      nativePath: nativePath || (existing && existing.nativePath) || ""
    };
    file.dirty = file.content !== file.savedContent;
    state.files.set(cleanPath, file);
    return file;
  }

  function moveFilePath(file, nextPath) {
    const oldPath = file.path;
    let resolvedPath = normalizePath(nextPath);
    if (state.files.has(resolvedPath) && state.files.get(resolvedPath) !== file) {
      resolvedPath = nextAvailablePath(resolvedPath);
    }
    if (oldPath === resolvedPath) return;
    state.files.delete(oldPath);
    file.path = resolvedPath;
    file.name = basename(resolvedPath);
    file.language = languageForPath(resolvedPath);
    state.files.set(resolvedPath, file);
    state.tabs = state.tabs.map((path) => (path === oldPath ? resolvedPath : path));
    if (state.activePath === oldPath) state.activePath = resolvedPath;
  }

  function safeExtension(filename) {
    const name = basename(filename);
    const ext = name.includes(".") ? name.split(".").pop() : "txt";
    return /^[a-z0-9]{1,16}$/i.test(ext) ? `.${ext}` : ".txt";
  }

  function normalizePath(path) {
    return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/").trim() || "untitled.txt";
  }

  function basename(path) {
    const parts = normalizePath(path).split("/");
    return parts[parts.length - 1] || path;
  }

  function dirname(path) {
    const parts = normalizePath(path).split("/");
    parts.pop();
    return parts.join("/");
  }

  function languageForPath(path) {
    const ext = basename(path).toLowerCase().split(".").pop();
    const map = {
      js: "javascript",
      jsx: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      ts: "typescript",
      tsx: "typescript",
      json: "json",
      css: "css",
      scss: "css",
      html: "html",
      htm: "html",
      md: "markdown",
      markdown: "markdown",
      py: "python",
      txt: "text",
      yml: "text",
      yaml: "text",
      sh: "text"
    };
    return map[ext] || "text";
  }

  function renderAll() {
    renderTree();
    renderTabs();
    updateEditorFromState();
    updateWrapClass();
  }

  function renderTree() {
    const filter = els.fileFilter.value.trim().toLowerCase();
    const root = { folders: new Map(), files: [] };

    Array.from(state.files.values())
      .filter((file) => !filter || file.path.toLowerCase().includes(filter))
      .sort((a, b) => a.path.localeCompare(b.path))
      .forEach((file) => {
        const parts = file.path.split("/");
        let cursor = root;
        parts.slice(0, -1).forEach((part) => {
          if (!cursor.folders.has(part)) cursor.folders.set(part, { folders: new Map(), files: [] });
          cursor = cursor.folders.get(part);
        });
        cursor.files.push(file);
      });

    els.tree.replaceChildren(renderTreeNode(root, 0));
  }

  function renderTreeNode(node, depth) {
    const list = document.createElement("ul");
    Array.from(node.folders.entries()).forEach(([name, child]) => {
      const item = document.createElement("li");
      const label = document.createElement("div");
      label.className = "tree-folder";
      label.textContent = name;
      item.append(label, renderTreeNode(child, depth + 1));
      list.append(item);
    });

    node.files.forEach((file) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tree-file${file.path === state.activePath ? " active" : ""}`;
      button.style.paddingLeft = `${7 + depth * 4}px`;
      button.addEventListener("click", () => activateFile(file.path));

      const dot = document.createElement("span");
      dot.className = `file-dot ${file.language}`;

      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = file.name;

      button.append(dot, name);
      if (file.dirty) {
        const dirty = document.createElement("span");
        dirty.className = "dirty-dot";
        button.append(dirty);
      }
      item.append(button);
      list.append(item);
    });
    return list;
  }

  function renderTabs() {
    els.tabs.replaceChildren();
    state.tabs.forEach((path) => {
      const file = state.files.get(path);
      if (!file) return;
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `tab-button${path === state.activePath ? " active" : ""}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", path === state.activePath ? "true" : "false");
      tab.title = path;
      tab.addEventListener("click", () => activateFile(path));

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = file.name;

      const dirty = document.createElement("span");
      dirty.className = "dirty-dot";
      dirty.hidden = !file.dirty;

      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "x";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        closeTab(path);
      });

      tab.append(title, dirty, close);
      els.tabs.append(tab);
    });
  }

  function activateFile(path) {
    if (!path || !state.files.has(path)) return;
    state.activePath = path;
    if (!state.tabs.includes(path)) state.tabs.push(path);
    updateEditorFromState();
    renderTree();
    renderTabs();
    persistSoon();
  }

  function updateEditorFromState() {
    const file = getActiveFile();
    if (!file) {
      els.editor.value = "";
      updateEditorDecorations();
      updateStatus();
      return;
    }
    if (els.editor.value !== file.content) {
      els.editor.value = file.content;
    }
    updateEditorDecorations();
    updateFindMatches();
    updateStatus();
  }

  function updateEditorDecorations() {
    const file = getActiveFile();
    const code = els.editor.value;
    const language = file ? file.language : "text";
    const html = highlightCode(code, language);
    const trailing = code.endsWith("\n") ? " " : "";
    els.highlight.innerHTML = html + trailing;
    els.minimap.innerHTML = html;
    updateLineNumbers(code);
    syncScroll();
  }

  function updateLineNumbers(code) {
    const count = Math.max(1, code.split("\n").length);
    let output = "";
    for (let index = 1; index <= count; index += 1) {
      output += `${index}\n`;
    }
    els.lineNumbers.textContent = output;
  }

  function syncScroll() {
    els.highlight.scrollTop = els.editor.scrollTop;
    els.highlight.scrollLeft = els.editor.scrollLeft;
    els.lineNumbers.scrollTop = els.editor.scrollTop;

    const maxScroll = Math.max(1, els.editor.scrollHeight - els.editor.clientHeight);
    const ratio = els.editor.scrollTop / maxScroll;
    const miniMax = Math.max(0, els.minimap.scrollHeight - els.minimap.clientHeight);
    els.minimap.scrollTop = ratio * miniMax;
  }

  function updateStatus() {
    const file = getActiveFile();
    if (!file) {
      els.statusPath.textContent = "No file";
      els.statusDirty.textContent = "";
      els.statusCursor.textContent = "";
      els.statusLanguage.textContent = "";
      els.statusSize.textContent = "";
      return;
    }
    const cursor = cursorPosition(els.editor.value, els.editor.selectionStart);
    const bytes = new Blob([els.editor.value]).size;
    els.statusPath.textContent = file.path;
    els.statusDirty.textContent = file.dirty ? "Modified" : "Saved";
    els.statusCursor.textContent = `Ln ${cursor.line}, Col ${cursor.column}`;
    els.statusLanguage.textContent = file.language;
    els.statusSize.textContent = `${bytes.toLocaleString()} bytes`;
  }

  function cursorPosition(text, offset) {
    const before = text.slice(0, offset);
    const lines = before.split("\n");
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1
    };
  }

  function getActiveFile() {
    return state.files.get(state.activePath) || null;
  }

  function runCommand(id) {
    const command = commands.find((item) => item.id === id);
    if (command) command.run();
  }

  async function openWorkspace() {
    if (hasNativeBridge()) {
      try {
        const entries = await nativeRequest("openWorkspace");
        if (!entries || !entries.length) return;
        replaceWorkspace(entries);
        showToast(`Opened ${entries.length} files`);
      } catch (error) {
        if (error.message !== "cancelled") showToast("Folder open failed");
      }
      return;
    }

    if ("showDirectoryPicker" in window) {
      try {
        const dirHandle = await window.showDirectoryPicker();
        const entries = [];
        await readDirectoryHandle(dirHandle, "", entries);
        if (!entries.length) {
          showToast("No readable files found");
          return;
        }
        replaceWorkspace(entries);
        showToast(`Opened ${entries.length} files`);
      } catch (error) {
        if (error.name !== "AbortError") showToast("Folder open failed");
      }
      return;
    }
    els.fileInput.click();
  }

  async function openLooseFiles() {
    if (hasNativeBridge()) {
      try {
        const entries = await nativeRequest("openFiles");
        if (!entries || !entries.length) return;
        mergeFiles(entries);
        showToast(`Opened ${entries.length} files`);
      } catch (error) {
        if (error.message !== "cancelled") showToast("File open failed");
      }
      return;
    }

    if ("showOpenFilePicker" in window) {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true });
        const entries = [];
        for (const handle of handles) {
          const file = await handle.getFile();
          const content = await file.text();
          entries.push({
            path: file.name,
            content,
            savedContent: content,
            handle
          });
        }
        mergeFiles(entries);
        showToast(`Opened ${entries.length} files`);
      } catch (error) {
        if (error.name !== "AbortError") showToast("File open failed");
      }
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.addEventListener("change", async () => readInputFiles(input.files, true), { once: true });
    input.click();
  }

  async function readDirectoryHandle(dirHandle, basePath, entries) {
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === "directory") {
        if (IGNORED_DIRECTORIES.has(name)) continue;
        await readDirectoryHandle(handle, `${basePath}${name}/`, entries);
        continue;
      }
      const file = await handle.getFile();
      if (!isLikelyTextFile(file)) continue;
      const content = await file.text();
      entries.push({
        path: `${basePath}${file.name}`,
        content,
        savedContent: content,
        handle
      });
    }
  }

  async function readInputFiles(fileList, mergeOnly) {
    const files = Array.from(fileList || []).filter(isLikelyTextFile);
    const entries = [];
    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      const content = await file.text();
      entries.push({ path, content, savedContent: content });
    }
    if (!entries.length) {
      showToast("No readable files found");
      return;
    }
    if (mergeOnly) mergeFiles(entries);
    else replaceWorkspace(entries);
    showToast(`Opened ${entries.length} files`);
  }

  function isLikelyTextFile(file) {
    if (!file) return false;
    if (file.size > 5 * 1024 * 1024) return false;
    if (file.type && file.type.startsWith("text/")) return true;
    const name = file.name.toLowerCase();
    return /\.(js|jsx|ts|tsx|json|css|scss|html|htm|md|txt|py|yml|yaml|sh|xml|svg|csv|env|gitignore)$/i.test(name);
  }

  function replaceWorkspace(entries) {
    state.files.clear();
    state.tabs = [];
    entries.forEach((entry) => {
      const file = addFile(entry);
      if (state.tabs.length < 6) state.tabs.push(file.path);
    });
    state.activePath = state.tabs[0] || entries[0].path;
    renderAll();
    persistWorkspace();
  }

  async function restoreSampleWorkspace() {
    const ok = await askConfirm("Replace the current workspace with the sample files?");
    if (!ok) return;
    state.files.clear();
    samples.forEach((sample) => addFile(sample));
    state.tabs = samples.slice(0, 3).map((sample) => sample.path);
    state.activePath = samples[0].path;
    renderAll();
    persistWorkspace();
    showToast("Sample workspace restored");
  }

  function mergeFiles(entries) {
    entries.forEach((entry) => {
      const file = addFile(entry);
      if (!state.tabs.includes(file.path)) state.tabs.push(file.path);
    });
    state.activePath = entries[0] ? normalizePath(entries[0].path) : state.activePath;
    renderAll();
    persistWorkspace();
  }

  async function saveActiveFile(forceSaveAs) {
    const file = getActiveFile();
    if (!file) return;
    try {
      await saveFile(file, forceSaveAs);
      renderAll();
      showToast(`Saved ${file.name}`);
    } catch (error) {
      if (error.name !== "AbortError" && error.message !== "cancelled") showToast("Save failed");
    }
  }

  async function saveFile(file, forceSaveAs) {
    if (hasNativeBridge()) {
      const result = await nativeRequest("saveFile", {
        path: file.path,
        name: file.name,
        nativePath: file.nativePath || "",
        content: file.content,
        forceSaveAs: Boolean(forceSaveAs || !file.nativePath)
      });
      if (result && result.path && result.path !== file.path) moveFilePath(file, result.path);
      if (result && result.nativePath) file.nativePath = result.nativePath;
      file.savedContent = file.content;
      file.dirty = false;
      persistWorkspace();
      return;
    }

    if ("showSaveFilePicker" in window && (forceSaveAs || !file.handle)) {
      const extension = safeExtension(file.name);
      const handle = await window.showSaveFilePicker({
        suggestedName: file.name,
        types: [{ description: "Text file", accept: { "text/plain": [extension] } }]
      });
      file.handle = handle;
      moveFilePath(file, normalizePath(handle.name || file.path));
    }

    if (file.handle && "createWritable" in file.handle) {
      const writable = await file.handle.createWritable();
      await writable.write(file.content);
      await writable.close();
    } else {
      downloadBlob(file.name, new Blob([file.content], { type: "text/plain;charset=utf-8" }));
    }

    file.savedContent = file.content;
    file.dirty = false;
    persistWorkspace();
  }

  async function saveAllFiles() {
    const dirtyFiles = Array.from(state.files.values()).filter((file) => file.dirty);
    if (!dirtyFiles.length) {
      showToast("Everything is saved");
      return;
    }
    let saved = 0;
    for (const file of dirtyFiles) {
      try {
        await saveFile(file, false);
        saved += 1;
      } catch (error) {
        if (error.name === "AbortError" || error.message === "cancelled") break;
      }
    }
    renderAll();
    showToast(`Saved ${saved} files`);
  }

  async function createNewFile() {
    const rawPath = await askText("File path", "untitled.js");
    if (!rawPath) return;
    const path = nextAvailablePath(normalizePath(rawPath));
    addFile({ path, content: "", savedContent: "" });
    activateFile(path);
    els.editor.focus();
    persistWorkspace();
  }

  function nextAvailablePath(path) {
    if (!state.files.has(path)) return path;
    const directory = dirname(path);
    const name = basename(path);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let index = 2; index < 1000; index += 1) {
      const candidateName = `${stem}-${index}${ext}`;
      const candidate = directory ? `${directory}/${candidateName}` : candidateName;
      if (!state.files.has(candidate)) return candidate;
    }
    return `${Date.now()}-${name}`;
  }

  function closeActiveTab() {
    if (state.activePath) closeTab(state.activePath);
  }

  function closeTab(path) {
    const index = state.tabs.indexOf(path);
    if (index === -1) return;
    state.tabs.splice(index, 1);
    if (state.activePath === path) {
      const next = state.tabs[index] || state.tabs[index - 1] || Array.from(state.files.keys())[0] || "";
      state.activePath = next;
    }
    renderAll();
    persistWorkspace();
  }

  async function renameActiveFile() {
    const file = getActiveFile();
    if (!file) return;
    const rawPath = await askText("New path", file.path);
    if (!rawPath) return;
    const newPath = normalizePath(rawPath);
    if (newPath === file.path) return;
    if (state.files.has(newPath)) {
      showToast("A file already has that path");
      return;
    }
    state.files.delete(file.path);
    const oldPath = file.path;
    file.path = newPath;
    file.name = basename(newPath);
    file.language = languageForPath(newPath);
    state.files.set(newPath, file);
    state.tabs = state.tabs.map((path) => (path === oldPath ? newPath : path));
    state.activePath = newPath;
    renderAll();
    persistWorkspace();
  }

  function duplicateActiveFile() {
    const file = getActiveFile();
    if (!file) return;
    const path = nextAvailablePath(file.path);
    addFile({ path, content: file.content, savedContent: file.content });
    activateFile(path);
  }

  async function deleteActiveFile() {
    const file = getActiveFile();
    if (!file) return;
    const ok = await askConfirm(`Remove ${file.path} from this workspace?`);
    if (!ok) return;
    const path = file.path;
    state.files.delete(path);
    state.tabs = state.tabs.filter((item) => item !== path);
    state.activePath = state.tabs[0] || Array.from(state.files.keys())[0] || "";
    renderAll();
    persistWorkspace();
  }

  function toggleWrap() {
    state.wrap = !state.wrap;
    updateWrapClass();
    persistWorkspace();
    showToast(state.wrap ? "Word wrap on" : "Word wrap off");
  }

  function updateWrapClass() {
    document.querySelector(".code-wrap").classList.toggle("wrap", state.wrap);
  }

  function setTheme(theme, shouldPersist = true) {
    const value = ["monokai", "paper", "contrast"].includes(theme) ? theme : "monokai";
    els.shell.dataset.theme = value;
    els.themeSelect.value = value;
    if (shouldPersist) persistWorkspace();
  }

  function openFind() {
    els.findBar.hidden = false;
    updateFindMatches();
    setTimeout(() => {
      els.findInput.focus();
      els.findInput.select();
    }, 0);
  }

  function closeFind() {
    els.findBar.hidden = true;
    els.editor.focus();
  }

  function runFindAction(action) {
    if (action === "next") selectFindMatch(state.findIndex + 1);
    if (action === "prev") selectFindMatch(state.findIndex - 1);
    if (action === "replace") replaceCurrentMatch();
    if (action === "replace-all") replaceAllMatches();
    if (action === "close") closeFind();
  }

  function updateFindMatches() {
    const query = els.findInput.value;
    state.findMatches = [];
    state.findIndex = -1;
    if (!query) {
      updateFindCount();
      return;
    }
    const content = els.editor.value;
    const haystack = content.toLowerCase();
    const needle = query.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      state.findMatches.push({ start: index, end: index + query.length });
      index = haystack.indexOf(needle, index + Math.max(1, query.length));
    }
    updateFindCount();
  }

  function selectFindMatch(index) {
    if (!state.findMatches.length) {
      updateFindCount();
      return;
    }
    const length = state.findMatches.length;
    state.findIndex = ((index % length) + length) % length;
    const match = state.findMatches[state.findIndex];
    els.editor.focus();
    els.editor.setSelectionRange(match.start, match.end);
    els.editor.scrollTop = estimateScrollForOffset(match.start);
    syncScroll();
    updateFindCount();
  }

  function estimateScrollForOffset(offset) {
    const before = els.editor.value.slice(0, offset);
    const line = before.split("\n").length;
    const lineHeight = 21.7;
    return Math.max(0, (line - 5) * lineHeight);
  }

  function updateFindCount() {
    if (!els.findInput.value) {
      els.findCount.textContent = "";
      return;
    }
    if (!state.findMatches.length) {
      els.findCount.textContent = "0 / 0";
      return;
    }
    els.findCount.textContent = `${state.findIndex + 1 || 1} / ${state.findMatches.length}`;
  }

  function replaceCurrentMatch() {
    const query = els.findInput.value;
    if (!query || !state.findMatches.length) return;
    if (state.findIndex < 0) selectFindMatch(0);
    const match = state.findMatches[state.findIndex];
    const replacement = els.replaceInput.value;
    const value = els.editor.value.slice(0, match.start) + replacement + els.editor.value.slice(match.end);
    applyEditorValue(value, match.start + replacement.length);
    updateFindMatches();
    selectFindMatch(state.findIndex);
  }

  function replaceAllMatches() {
    const query = els.findInput.value;
    if (!query) return;
    const replacement = els.replaceInput.value;
    const escaped = escapeRegExp(query);
    const expression = new RegExp(escaped, "gi");
    const next = els.editor.value.replace(expression, replacement);
    applyEditorValue(next, els.editor.selectionStart);
    updateFindMatches();
    showToast("Replaced matches");
  }

  function applyEditorValue(value, cursor) {
    const file = getActiveFile();
    if (!file) return;
    els.editor.value = value;
    const safeCursor = Math.min(value.length, Math.max(0, cursor));
    els.editor.setSelectionRange(safeCursor, safeCursor);
    file.content = value;
    file.dirty = file.content !== file.savedContent;
    updateEditorDecorations();
    renderTabs();
    renderTree();
    updateStatus();
    persistSoon();
  }

  function openPalette(mode) {
    state.paletteMode = mode;
    state.paletteIndex = 0;
    els.paletteInput.value = "";
    els.paletteInput.placeholder = mode === "files" ? "Open file" : "Run command";
    els.paletteOverlay.hidden = false;
    renderPalette();
    setTimeout(() => els.paletteInput.focus(), 0);
  }

  function closePalette() {
    els.paletteOverlay.hidden = true;
    els.editor.focus();
  }

  function renderPalette() {
    const query = els.paletteInput.value.trim().toLowerCase();
    const items = state.paletteMode === "files"
      ? Array.from(state.files.values()).map((file) => ({
        title: file.path,
        meta: file.language,
        run: () => activateFile(file.path)
      }))
      : commands;

    const filtered = items
      .filter((item) => matchesQuery(`${item.title} ${item.meta || ""}`, query))
      .slice(0, 80);

    state.paletteItems = filtered;
    if (state.paletteIndex >= filtered.length) state.paletteIndex = Math.max(0, filtered.length - 1);
    els.paletteList.replaceChildren();

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "palette-item";
      empty.textContent = "No matches";
      els.paletteList.append(empty);
      return;
    }

    filtered.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `palette-item${index === state.paletteIndex ? " active" : ""}`;
      button.addEventListener("mousemove", () => {
        state.paletteIndex = index;
        renderPalette();
      });
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        runPaletteItem(index);
      });

      const title = document.createElement("span");
      title.className = "palette-main";
      title.textContent = item.title;

      const meta = document.createElement("span");
      meta.className = "palette-meta";
      meta.textContent = item.meta || "";

      button.append(title, meta);
      els.paletteList.append(button);
    });
  }

  function handlePaletteKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.paletteIndex = Math.min(state.paletteItems.length - 1, state.paletteIndex + 1);
      renderPalette();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.paletteIndex = Math.max(0, state.paletteIndex - 1);
      renderPalette();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runPaletteItem(state.paletteIndex);
    }
  }

  function runPaletteItem(index) {
    const item = state.paletteItems[index];
    if (!item) return;
    closePalette();
    item.run();
  }

  function matchesQuery(text, query) {
    if (!query) return true;
    const parts = query.split(/\s+/).filter(Boolean);
    const haystack = text.toLowerCase();
    return parts.every((part) => haystack.includes(part));
  }

  function handleGlobalKeydown(event) {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") {
      if (!els.dialogOverlay.hidden) closeDialog(null);
      else if (!els.paletteOverlay.hidden) closePalette();
      else if (!els.findBar.hidden) closeFind();
      return;
    }
    if (!mod) return;

    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      saveActiveFile(event.shiftKey);
    }
    if (key === "p" && event.shiftKey) {
      event.preventDefault();
      openPalette("commands");
    } else if (key === "p") {
      event.preventDefault();
      openPalette("files");
    }
    if (key === "f") {
      event.preventDefault();
      openFind();
    }
    if (key === "n") {
      event.preventDefault();
      createNewFile();
    }
    if (key === "w") {
      event.preventDefault();
      closeActiveTab();
    }
  }

  function handleEditorKeydown(event) {
    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) unindentSelection();
      else indentSelection();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "/") {
      event.preventDefault();
      toggleLineComment();
    }
  }

  function indentSelection() {
    const start = els.editor.selectionStart;
    const end = els.editor.selectionEnd;
    const value = els.editor.value;
    if (start === end) {
      applyEditorValue(value.slice(0, start) + "  " + value.slice(end), start + 2);
      return;
    }
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const block = value.slice(lineStart, end);
    const indented = block.replace(/^/gm, "  ");
    const next = value.slice(0, lineStart) + indented + value.slice(end);
    applyEditorValue(next, start + 2);
    els.editor.setSelectionRange(start + 2, end + indented.length - block.length);
  }

  function unindentSelection() {
    const start = els.editor.selectionStart;
    const end = els.editor.selectionEnd;
    const value = els.editor.value;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const block = value.slice(lineStart, end);
    const unindented = block.replace(/^( {1,2}|\t)/gm, "");
    const next = value.slice(0, lineStart) + unindented + value.slice(end);
    applyEditorValue(next, Math.max(lineStart, start - (block.length - unindented.length)));
    els.editor.setSelectionRange(Math.max(lineStart, start - 2), Math.max(lineStart, end - (block.length - unindented.length)));
  }

  function toggleLineComment() {
    const file = getActiveFile();
    if (!file) return;
    const marker = commentMarkerFor(file.language);
    if (!marker) return;

    const start = els.editor.selectionStart;
    const end = els.editor.selectionEnd;
    const value = els.editor.value;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = end === start ? value.indexOf("\n", end) : end;
    const safeLineEnd = lineEnd === -1 ? value.length : lineEnd;
    const block = value.slice(lineStart, safeLineEnd);
    const lines = block.split("\n");
    const uncomment = lines.every((line) => line.trim() === "" || line.trimStart().startsWith(marker));
    const changed = lines.map((line) => {
      if (!line.trim()) return line;
      if (uncomment) {
        const leading = line.match(/^\s*/)[0];
        const rest = line.slice(leading.length);
        return leading + rest.replace(marker, "").replace(/^ /, "");
      }
      return `${line.match(/^\s*/)[0]}${marker} ${line.trimStart()}`;
    }).join("\n");
    const next = value.slice(0, lineStart) + changed + value.slice(safeLineEnd);
    applyEditorValue(next, start);
    els.editor.setSelectionRange(start, start + changed.length);
  }

  function commentMarkerFor(language) {
    if (["javascript", "typescript"].includes(language)) return "//";
    if (language === "python") return "#";
    return null;
  }

  async function exportWorkspace() {
    const payload = {
      app: "MyEditor",
      version: 1,
      exportedAt: new Date().toISOString(),
      files: Array.from(state.files.values()).map((file) => ({
        path: file.path,
        content: file.content
      }))
    };
    const content = JSON.stringify(payload, null, 2);
    if (hasNativeBridge()) {
      try {
        await nativeRequest("saveRaw", { name: "myeditor-workspace.json", content });
        showToast("Workspace exported");
      } catch (error) {
        if (error.message !== "cancelled") showToast("Export failed");
      }
      return;
    }
    downloadBlob("myeditor-workspace.json", new Blob([content], { type: "application/json" }));
    showToast("Workspace exported");
  }

  function askText(title, value) {
    return openDialog({ mode: "text", title, value });
  }

  function askConfirm(message) {
    return openDialog({ mode: "confirm", title: "Confirm", message });
  }

  function openDialog({ mode, title, value = "", message = "" }) {
    if (state.dialogResolve) closeDialog(null);
    return new Promise((resolve) => {
      state.dialogResolve = resolve;
      els.dialogTitle.textContent = title;
      els.dialogMessage.textContent = message;
      els.dialogInput.hidden = mode !== "text";
      els.dialogInput.value = value;
      els.dialogConfirm.textContent = mode === "confirm" ? "Remove" : "OK";
      els.dialogOverlay.hidden = false;
      setTimeout(() => {
        if (mode === "text") {
          els.dialogInput.focus();
          els.dialogInput.select();
        } else {
          els.dialogConfirm.focus();
        }
      }, 0);
    });
  }

  function closeDialog(result) {
    if (!state.dialogResolve) {
      els.dialogOverlay.hidden = true;
      return;
    }
    const resolve = state.dialogResolve;
    state.dialogResolve = null;
    els.dialogOverlay.hidden = true;
    resolve(result);
  }

  async function importWorkspaceFile(file) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (!Array.isArray(payload.files)) throw new Error("Invalid file");
      const entries = payload.files.map((entry) => ({
        path: entry.path,
        content: entry.content || "",
        savedContent: entry.content || ""
      }));
      replaceWorkspace(entries);
      showToast("Workspace imported");
    } catch (error) {
      showToast("Import failed");
    }
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function highlightCode(code, language) {
    if (language === "javascript" || language === "typescript") return highlightJavaScript(code);
    if (language === "json") return highlightJson(code);
    if (language === "css") return highlightCss(code);
    if (language === "html") return highlightHtml(code);
    if (language === "markdown") return highlightMarkdown(code);
    if (language === "python") return highlightPython(code);
    return escapeHtml(code);
  }

  function highlightWithRegex(code, regex, classify) {
    let output = "";
    let lastIndex = 0;
    code.replace(regex, (match, ...args) => {
      const offset = args[args.length - 2];
      output += escapeHtml(code.slice(lastIndex, offset));
      output += `<span class="${classify(match, offset, code)}">${escapeHtml(match)}</span>`;
      lastIndex = offset + match.length;
      return match;
    });
    output += escapeHtml(code.slice(lastIndex));
    return output;
  }

  function highlightJavaScript(code) {
    const keywords = new Set([
      "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "delete",
      "do", "else", "export", "extends", "false", "finally", "for", "from", "function", "if", "import",
      "in", "instanceof", "let", "new", "null", "of", "return", "static", "super", "switch", "this",
      "throw", "true", "try", "typeof", "undefined", "var", "while", "yield"
    ]);
    const regex = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\b[A-Za-z_$][\w$]*\b|\b\d+(?:\.\d+)?\b/g;
    return highlightWithRegex(code, regex, (match) => {
      if (match.startsWith("//") || match.startsWith("/*")) return "token-comment";
      if (/^['"`]/.test(match)) return "token-string";
      if (/^\d/.test(match)) return "token-number";
      if (keywords.has(match)) return "token-keyword";
      return "token-function";
    });
  }

  function highlightPython(code) {
    const keywords = new Set([
      "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else",
      "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "None",
      "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield"
    ]);
    const regex = /#[^\n]*|'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\b[A-Za-z_]\w*\b|\b\d+(?:\.\d+)?\b/g;
    return highlightWithRegex(code, regex, (match) => {
      if (match.startsWith("#")) return "token-comment";
      if (/^['"]/.test(match)) return "token-string";
      if (/^\d/.test(match)) return "token-number";
      if (keywords.has(match)) return "token-keyword";
      return "token-function";
    });
  }

  function highlightJson(code) {
    const regex = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?\b|\b(?:true|false|null)\b/g;
    return highlightWithRegex(code, regex, (match, offset, source) => {
      const after = source.slice(offset + match.length).match(/^\s*:/);
      if (match.startsWith("\"") && after) return "token-property";
      if (match.startsWith("\"")) return "token-string";
      if (/^-?\d/.test(match)) return "token-number";
      return "token-keyword";
    });
  }

  function highlightCss(code) {
    const regex = /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)?\b|--?[A-Za-z_][\w-]*(?=\s*:)|[.#]?[A-Za-z_][\w-]*(?=\s*\{)/g;
    return highlightWithRegex(code, regex, (match) => {
      if (match.startsWith("/*")) return "token-comment";
      if (/^['"]/.test(match)) return "token-string";
      if (/^#/.test(match) || /^\d/.test(match)) return "token-number";
      if (match.includes("-") || /^[A-Za-z]/.test(match)) return "token-property";
      return "token-function";
    });
  }

  function highlightHtml(code) {
    const regex = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|&(?:[a-z]+|#[0-9]+);/g;
    return highlightWithRegex(code, regex, (match) => {
      if (match.startsWith("<!--")) return "token-comment";
      if (match.startsWith("&")) return "token-number";
      return "token-tag";
    });
  }

  function highlightMarkdown(code) {
    return code.split("\n").map((line) => {
      if (/^#{1,6}\s/.test(line)) return `<span class="token-heading">${escapeHtml(line)}</span>`;
      let output = escapeHtml(line);
      output = output.replace(/(`[^`]+`)/g, '<span class="token-string">$1</span>');
      output = output.replace(/(\*\*[^*]+\*\*)/g, '<span class="token-emphasis">$1</span>');
      output = output.replace(/^(\s*[-*]\s)/, '<span class="token-keyword">$1</span>');
      return output;
    }).join("\n");
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 2300);
  }

  function debounce(fn, delay) {
    let timer = 0;
    return function debounced(...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), delay);
    };
  }

  init();
}());
