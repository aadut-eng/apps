(function () {
  "use strict";

  const STORAGE_KEY = "myeditor.workspace.v1";
  const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", ".next", ".cache"]);
  const DEFAULT_FONT_SIZE = 14;
  const MIN_FONT_SIZE = 10;
  const MAX_FONT_SIZE = 28;

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
    markButton: document.getElementById("markButton"),
    boldButton: document.getElementById("boldButton"),
    italicButton: document.getElementById("italicButton"),
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
    taskPanel: document.getElementById("taskPanel"),
    taskForm: document.getElementById("taskForm"),
    taskInput: document.getElementById("taskInput"),
    taskList: document.getElementById("taskList"),
    fileMenu: document.getElementById("fileMenu"),
    markMenu: document.getElementById("markMenu"),
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
    editorFontSize: DEFAULT_FONT_SIZE,
    editorBold: false,
    editorItalic: false,
    paletteMode: "commands",
    paletteItems: [],
    paletteIndex: 0,
    dialogResolve: null,
    contextPath: "",
    decorationTimer: 0,
    decorationFrame: 0,
    tasksOpen: false,
    findMatches: [],
    findIndex: -1,
    dragPath: "",
    dragJustEnded: false,
    toastTimer: 0
  };

  const markClasses = ["mark-yellow", "mark-green", "mark-blue", "mark-rose", "mark-violet"];
  const markLabels = {
    "mark-yellow": "Yellow",
    "mark-green": "Green",
    "mark-blue": "Blue",
    "mark-rose": "Rose",
    "mark-violet": "Violet"
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
    { id: "move-file-up", title: "Move File Up", meta: "Project", run: () => moveActiveFile(-1) },
    { id: "move-file-down", title: "Move File Down", meta: "Project", run: () => moveActiveFile(1) },
    { id: "find", title: "Find and Replace", meta: "Edit", run: openFind },
    { id: "toggle-tasks", title: "Toggle Page Tasks", meta: "Page", run: toggleTasks },
    { id: "open-mark-menu", title: "Mark Menu", meta: "Page", run: openMarkMenu },
    { id: "mark-keyword", title: "Color Selected Keyword", meta: "Page", run: markSelectedKeyword },
    { id: "remove-keyword-mark", title: "Remove Mark from Selection", meta: "Page", run: removeSelectedKeywordMark },
    { id: "clear-keyword-marks", title: "Clear Keyword Colors", meta: "Page", run: clearKeywordMarks },
    { id: "quick-open", title: "Quick Open", meta: "Navigate", run: () => openPalette("files") },
    { id: "command-palette", title: "Command Palette", meta: "Navigate", run: () => openPalette("commands") },
    { id: "toggle-wrap", title: "Toggle Word Wrap", meta: "View", run: toggleWrap },
    { id: "increase-font", title: "Increase Font Size", meta: "View", run: () => changeEditorFontSize(1) },
    { id: "decrease-font", title: "Decrease Font Size", meta: "View", run: () => changeEditorFontSize(-1) },
    { id: "reset-font", title: "Reset Font Size", meta: "View", run: resetEditorFontSize },
    { id: "toggle-bold", title: "Toggle Bold Text", meta: "View", run: toggleEditorBold },
    { id: "toggle-italic", title: "Toggle Italic Text", meta: "View", run: toggleEditorItalic },
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
      if (button.hasAttribute("data-editor-format")) {
        button.addEventListener("mousedown", (event) => event.preventDefault());
      }
      button.addEventListener("click", () => runCommand(button.dataset.command));
    });

    els.editor.addEventListener("input", () => {
      const file = getActiveFile();
      if (!file) return;
      const nextValue = els.editor.value;
      adjustTextStylesForContentChange(file, file.content, nextValue);
      file.content = nextValue;
      file.dirty = file.content !== file.savedContent;
      file.decorationCache = null;
      updateLineNumbers(file.content);
      requestEditorDecorations();
      renderTabs();
      renderTree();
      updateFindMatches({ decorate: false });
      updateStatus();
      persistSoon();
    });

    els.editor.addEventListener("keydown", handleEditorKeydown);
    els.editor.addEventListener("keyup", updateStatus);
    els.editor.addEventListener("click", updateStatus);
    els.editor.addEventListener("dblclick", handleEditorDoubleClick);
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
      button.addEventListener("mousedown", (event) => {
        if (button.dataset.find !== "close") event.preventDefault();
      });
      button.addEventListener("click", () => runFindAction(button.dataset.find));
    });

    els.findInput.addEventListener("input", () => {
      updateFindMatches();
      selectFindMatch(0, { preserveFindFocus: true });
    });

    els.findInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        selectFindMatch(state.findIndex + (event.shiftKey ? -1 : 1), { preserveFindFocus: true });
      }
      if (event.key === "Escape") closeFind();
    });

    els.replaceInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        replaceCurrentMatch();
        restoreFindControlFocus(els.replaceInput);
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

    els.taskForm.addEventListener("submit", (event) => {
      event.preventDefault();
      addTask();
    });

    document.querySelectorAll("[data-task]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.task === "close") toggleTasks(false);
      });
    });

    document.querySelectorAll("[data-file-action]").forEach((button) => {
      button.addEventListener("click", () => runFileAction(button.dataset.fileAction));
    });

    els.markMenu.querySelectorAll("button").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => runMarkMenuAction(button));
    });

    document.addEventListener("click", (event) => {
      if (!els.fileMenu.hidden && !els.fileMenu.contains(event.target)) hideFileMenu();
      if (!els.markMenu.hidden && !els.markMenu.contains(event.target) && event.target !== els.markButton) hideMarkMenu();
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
        nativePath: entry.nativePath || "",
        loaded: entry.loaded !== false,
        tasks: Array.isArray(entry.tasks) ? entry.tasks : [],
        keywordMarks: Array.isArray(entry.keywordMarks) ? entry.keywordMarks : [],
        textStyles: Array.isArray(entry.textStyles) ? entry.textStyles : [],
        order: Number.isFinite(entry.order) ? entry.order : undefined
      }));
      normalizeFileOrders();
      state.tabs = saved.tabs && saved.tabs.length ? saved.tabs.filter((path) => state.files.has(path)) : [];
      state.activePath = state.files.has(saved.activePath) ? saved.activePath : "";
      state.wrap = Boolean(saved.wrap);
      state.editorFontSize = clampFontSize(saved.editorFontSize);
      state.editorBold = Boolean(saved.editorBold);
      state.editorItalic = Boolean(saved.editorItalic);
      setTheme(saved.theme || "monokai", false);
    } else {
      samples.forEach((sample) => addFile(sample));
      state.tabs = samples.slice(0, 3).map((sample) => sample.path);
      state.activePath = samples[0].path;
      state.editorFontSize = DEFAULT_FONT_SIZE;
      state.editorBold = false;
      state.editorItalic = false;
      setTheme("monokai", false);
    }
    applyEditorTypography(false);
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
      nativePath: file.nativePath || "",
      loaded: file.loaded !== false,
      tasks: file.tasks || [],
      keywordMarks: file.keywordMarks || [],
      textStyles: file.textStyles || [],
      order: file.order
    }));
    const payload = {
      app: "MyEditor",
      version: 1,
      files,
      tabs: state.tabs,
      activePath: state.activePath,
      wrap: state.wrap,
      editorFontSize: state.editorFontSize,
      editorBold: state.editorBold,
      editorItalic: state.editorItalic,
      theme: els.shell.dataset.theme
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      showToast("Session backup is full");
    }
  }

  const persistSoon = debounce(persistWorkspace, 250);

  function addFile({ path, content, savedContent, handle, nativePath, loaded, tasks, keywordMarks, textStyles, order }) {
    const cleanPath = normalizePath(path || "untitled.txt");
    const existing = state.files.get(cleanPath);
    const fileContent = content || "";
    const file = {
      path: cleanPath,
      name: basename(cleanPath),
      language: languageForPath(cleanPath),
      content: fileContent,
      savedContent: typeof savedContent === "string" ? savedContent : fileContent,
      dirty: false,
      handle: handle || (existing && existing.handle) || null,
      nativePath: nativePath || (existing && existing.nativePath) || "",
      loaded: loaded !== false,
      tasks: Array.isArray(tasks) ? tasks : (existing && existing.tasks) || [],
      keywordMarks: Array.isArray(keywordMarks) ? keywordMarks : (existing && existing.keywordMarks) || [],
      textStyles: normalizeTextStyles(Array.isArray(textStyles) ? textStyles : (existing && existing.textStyles) || [], fileContent.length),
      order: Number.isFinite(order) ? order : (existing && Number.isFinite(existing.order) ? existing.order : nextFileOrder())
    };
    file.dirty = file.content !== file.savedContent;
    state.files.set(cleanPath, file);
    return file;
  }

  function normalizeTextStyles(styles, maxLength) {
    const limit = Math.max(0, maxLength);
    return (styles || []).map((style) => {
      const start = clampRangeOffset(style.start, limit);
      const end = clampRangeOffset(style.end, limit);
      const normalized = {
        start: Math.min(start, end),
        end: Math.max(start, end)
      };
      if (Object.prototype.hasOwnProperty.call(style, "fontSize")) normalized.fontSize = clampFontSize(style.fontSize);
      if (Object.prototype.hasOwnProperty.call(style, "bold")) normalized.bold = Boolean(style.bold);
      if (Object.prototype.hasOwnProperty.call(style, "italic")) normalized.italic = Boolean(style.italic);
      return normalized;
    }).filter((style) => style.end > style.start && hasTextStyleProperties(style));
  }

  function clampRangeOffset(value, maxLength) {
    const offset = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
    return Math.min(maxLength, Math.max(0, offset));
  }

  function hasTextStyleProperties(style) {
    return Object.prototype.hasOwnProperty.call(style, "fontSize") ||
      Object.prototype.hasOwnProperty.call(style, "bold") ||
      Object.prototype.hasOwnProperty.call(style, "italic");
  }

  function adjustTextStylesForContentChange(file, previous, next) {
    if (!file || !Array.isArray(file.textStyles) || !file.textStyles.length || previous === next) return;
    const edit = findTextEdit(previous, next);
    if (!edit) return;
    file.textStyles = normalizeTextStyles(file.textStyles.map((style) => adjustTextStyleForEdit(style, edit)).filter(Boolean), next.length);
  }

  function findTextEdit(previous, next) {
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;

    let oldEnd = previous.length;
    let newEnd = next.length;
    while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) {
      oldEnd -= 1;
      newEnd -= 1;
    }

    return {
      start,
      oldEnd,
      newEnd,
      delta: next.length - previous.length
    };
  }

  function adjustTextStyleForEdit(style, edit) {
    const nextStyle = { ...style };
    if (edit.oldEnd === edit.start) {
      if (style.end <= edit.start) return nextStyle;
      if (style.start >= edit.start) {
        nextStyle.start += edit.delta;
        nextStyle.end += edit.delta;
        return nextStyle;
      }
      nextStyle.end += edit.delta;
      return nextStyle;
    }

    if (style.end <= edit.start) return nextStyle;
    if (style.start >= edit.oldEnd) {
      nextStyle.start += edit.delta;
      nextStyle.end += edit.delta;
      return nextStyle;
    }

    if (style.start < edit.start && style.end > edit.oldEnd) {
      nextStyle.end += edit.delta;
      return nextStyle;
    }
    if (style.start < edit.start) {
      nextStyle.end = edit.start;
      return nextStyle;
    }
    if (style.end > edit.oldEnd) {
      nextStyle.start = edit.newEnd;
      nextStyle.end += edit.delta;
      return nextStyle;
    }
    return null;
  }

  function nextFileOrder() {
    let max = -1;
    state.files.forEach((file) => {
      if (Number.isFinite(file.order)) max = Math.max(max, file.order);
    });
    return max + 1;
  }

  function compareFileOrder(a, b) {
    const aOrder = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.path.localeCompare(b.path);
  }

  function getOrderedFiles() {
    return Array.from(state.files.values()).sort(compareFileOrder);
  }

  function normalizeFileOrders() {
    getOrderedFiles().forEach((file, index) => {
      file.order = index;
    });
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

    getOrderedFiles()
      .filter((file) => !filter || file.path.toLowerCase().includes(filter))
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
      button.draggable = true;
      button.dataset.path = file.path;
      button.addEventListener("click", () => {
        if (!state.dragJustEnded) activateFile(file.path);
      });
      button.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showFileMenu(file.path, event.clientX, event.clientY);
      });
      button.addEventListener("dragstart", (event) => handleFileDragStart(event, file.path));
      button.addEventListener("dragover", (event) => handleFileDragOver(event, file.path));
      button.addEventListener("dragleave", handleFileDragLeave);
      button.addEventListener("drop", (event) => handleFileDrop(event, file.path));
      button.addEventListener("dragend", handleFileDragEnd);

      const dot = document.createElement("span");
      dot.className = `file-dot ${file.language}${file.loaded === false ? " unloaded" : ""}`;

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

  async function activateFile(path) {
    if (!path || !state.files.has(path)) return;
    state.activePath = path;
    if (!state.tabs.includes(path)) state.tabs.push(path);
    const file = state.files.get(path);
    if (file && file.loaded === false) {
      showLoadingFile(file);
      renderTree();
      renderTabs();
      await ensureFileLoaded(file);
    }
    updateEditorFromState();
    renderTree();
    renderTabs();
    renderTasks();
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
    if (file.loaded === false) {
      showLoadingFile(file);
      return;
    }
    els.editor.disabled = false;
    if (els.editor.value !== file.content) {
      els.editor.value = file.content;
    }
    updateFindMatches({ decorate: false });
    updateEditorDecorations();
    updateStatus();
    renderTasks();
  }

  function showLoadingFile(file) {
    els.editor.disabled = true;
    els.editor.value = `Loading ${file.name}...`;
    els.highlight.textContent = els.editor.value;
    if (els.minimap) els.minimap.textContent = "";
    updateLineNumbers(els.editor.value);
    updateStatus();
  }

  async function ensureFileLoaded(file) {
    if (!file || file.loaded !== false || !file.nativePath || !hasNativeBridge()) {
      if (file) file.loaded = true;
      return;
    }

    try {
      const result = await nativeRequest("readFile", { nativePath: file.nativePath });
      file.content = result.content || "";
      file.savedContent = typeof result.savedContent === "string" ? result.savedContent : file.content;
      file.loaded = true;
      file.dirty = file.content !== file.savedContent;
    } catch (error) {
      if (error.message !== "cancelled") showToast(`Could not load ${file.name}`);
      file.loaded = true;
    } finally {
      els.editor.disabled = false;
    }
  }

  function updateEditorDecorations() {
    const file = getActiveFile();
    const code = els.editor.value;
    const language = file ? file.language : "text";
    const marksKey = JSON.stringify(file ? file.keywordMarks || [] : []);
    const textStylesKey = JSON.stringify(file ? file.textStyles || [] : []);
    const findKey = getFindDecorationKey();
    let html;
    if (file && file.decorationCache && file.decorationCache.content === code && file.decorationCache.language === language && file.decorationCache.marksKey === marksKey && file.decorationCache.textStylesKey === textStylesKey && file.decorationCache.findKey === findKey) {
      html = file.decorationCache.html;
    } else {
      html = code.length > 250000 ? decorateText(code) : highlightCode(code, language);
      if (file) file.decorationCache = { content: code, language, marksKey, textStylesKey, findKey, html };
    }
    const trailing = code.endsWith("\n") ? " " : "";
    els.highlight.innerHTML = html + trailing;
    if (els.minimap) els.minimap.textContent = code.slice(0, 60000);
    updateLineNumbers(code);
    syncScroll();
  }

  function requestEditorDecorations(delay = 90) {
    window.clearTimeout(state.decorationTimer);
    if (state.decorationFrame) window.cancelAnimationFrame(state.decorationFrame);
    state.decorationTimer = window.setTimeout(() => {
      state.decorationFrame = window.requestAnimationFrame(() => {
        state.decorationFrame = 0;
        updateEditorDecorations();
      });
    }, delay);
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
    if (els.minimap) {
      const miniMax = Math.max(0, els.minimap.scrollHeight - els.minimap.clientHeight);
      els.minimap.scrollTop = ratio * miniMax;
    }
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
    syncFormatControls();
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
    normalizeFileOrders();
    state.activePath = state.tabs[0] || entries[0].path;
    renderTree();
    renderTabs();
    activateFile(state.activePath);
    persistWorkspace();
  }

  async function restoreSampleWorkspace() {
    const ok = await askConfirm("Replace the current workspace with the sample files?");
    if (!ok) return;
    state.files.clear();
    samples.forEach((sample) => addFile(sample));
    normalizeFileOrders();
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
    normalizeFileOrders();
    state.activePath = entries[0] ? normalizePath(entries[0].path) : state.activePath;
    renderTree();
    renderTabs();
    activateFile(state.activePath);
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
    addFile({
      path,
      content: file.content,
      savedContent: file.content,
      order: file.order + 0.5,
      tasks: file.tasks ? file.tasks.map((task) => ({ ...task, id: `${Date.now()}-${Math.random().toString(16).slice(2)}` })) : [],
      keywordMarks: file.keywordMarks ? file.keywordMarks.map((mark) => ({ ...mark })) : [],
      textStyles: file.textStyles ? file.textStyles.map((style) => ({ ...style })) : []
    });
    normalizeFileOrders();
    activateFile(path);
  }

  async function deleteActiveFile() {
    const file = getActiveFile();
    if (!file) return;
    await deleteFilePath(file.path);
  }

  async function deleteFilePath(path) {
    const file = state.files.get(path);
    if (!file) return;
    const ok = await askConfirm(`Remove ${file.path} from this workspace?`);
    if (!ok) return;
    state.files.delete(path);
    state.tabs = state.tabs.filter((item) => item !== path);
    state.activePath = state.tabs[0] || Array.from(state.files.keys())[0] || "";
    normalizeFileOrders();
    renderAll();
    persistWorkspace();
  }

  function moveActiveFile(direction) {
    const file = getActiveFile();
    if (!file) return;
    moveFileInProject(file.path, direction);
  }

  function moveFileInProject(path, direction) {
    const ordered = getOrderedFiles();
    const index = ordered.findIndex((file) => file.path === path);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) {
      showToast(direction < 0 ? "Already at the top" : "Already at the bottom");
      return;
    }

    const current = ordered[index];
    const target = ordered[targetIndex];
    const currentOrder = current.order;
    current.order = target.order;
    target.order = currentOrder;
    normalizeFileOrders();
    renderTree();
    renderTabs();
    persistSoon();
    showToast(direction < 0 ? "Moved file up" : "Moved file down");
  }

  function handleFileDragStart(event, path) {
    state.dragPath = path;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", path);
    event.currentTarget.classList.add("dragging");
  }

  function handleFileDragOver(event, path) {
    const sourcePath = state.dragPath || event.dataTransfer.getData("text/plain");
    if (!sourcePath || sourcePath === path) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const position = getFileDropPosition(event);
    clearFileDragIndicators();
    event.currentTarget.classList.add(position === "before" ? "drag-over-before" : "drag-over-after");
    event.currentTarget.dataset.dropPosition = position;
  }

  function handleFileDragLeave(event) {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
    event.currentTarget.classList.remove("drag-over-before", "drag-over-after");
    delete event.currentTarget.dataset.dropPosition;
  }

  function handleFileDrop(event, path) {
    const sourcePath = state.dragPath || event.dataTransfer.getData("text/plain");
    if (!sourcePath || sourcePath === path) return;
    event.preventDefault();
    const position = event.currentTarget.dataset.dropPosition || getFileDropPosition(event);
    clearFileDragIndicators();
    reorderFileToPath(sourcePath, path, position);
  }

  function handleFileDragEnd(event) {
    state.dragPath = "";
    state.dragJustEnded = true;
    event.currentTarget.classList.remove("dragging");
    clearFileDragIndicators();
    setTimeout(() => {
      state.dragJustEnded = false;
    }, 0);
  }

  function getFileDropPosition(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  function clearFileDragIndicators() {
    els.tree.querySelectorAll(".tree-file.drag-over-before, .tree-file.drag-over-after").forEach((button) => {
      button.classList.remove("drag-over-before", "drag-over-after");
      delete button.dataset.dropPosition;
    });
  }

  function reorderFileToPath(sourcePath, targetPath, position) {
    const source = state.files.get(sourcePath);
    if (!source || !state.files.has(targetPath) || sourcePath === targetPath) return;

    const ordered = getOrderedFiles().filter((file) => file.path !== sourcePath);
    const targetIndex = ordered.findIndex((file) => file.path === targetPath);
    if (targetIndex < 0) return;

    const insertIndex = targetIndex + (position === "after" ? 1 : 0);
    ordered.splice(insertIndex, 0, source);
    ordered.forEach((file, index) => {
      file.order = index;
    });
    renderTree();
    renderTabs();
    persistSoon();
    showToast("Moved file");
  }

  function showFileMenu(path, x, y) {
    state.contextPath = path;
    els.fileMenu.style.left = `${Math.min(x, window.innerWidth - 170)}px`;
    els.fileMenu.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
    els.fileMenu.hidden = false;
  }

  function hideFileMenu() {
    state.contextPath = "";
    els.fileMenu.hidden = true;
  }

  async function runFileAction(action) {
    const path = state.contextPath;
    hideFileMenu();
    if (!path || !state.files.has(path)) return;
    await activateFile(path);
    if (action === "move-up") moveFileInProject(path, -1);
    if (action === "move-down") moveFileInProject(path, 1);
    if (action === "rename") renameActiveFile();
    if (action === "duplicate") duplicateActiveFile();
    if (action === "delete") deleteFilePath(path);
  }

  function openMarkMenu() {
    if (!els.markMenu.hidden) {
      hideMarkMenu();
      return;
    }
    const rect = els.markButton.getBoundingClientRect();
    els.markMenu.style.left = `${Math.min(rect.left, window.innerWidth - 180)}px`;
    els.markMenu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 230)}px`;
    els.markMenu.hidden = false;
  }

  function hideMarkMenu() {
    els.markMenu.hidden = true;
  }

  function runMarkMenuAction(button) {
    const color = button.dataset.markColor;
    const action = button.dataset.markAction;
    hideMarkMenu();
    if (color) applyKeywordMark(color);
    if (action === "remove") removeSelectedKeywordMark();
    if (action === "clear") clearKeywordMarks();
  }

  function toggleTasks(force) {
    state.tasksOpen = typeof force === "boolean" ? force : !state.tasksOpen;
    els.taskPanel.hidden = !state.tasksOpen;
    renderTasks();
    if (state.tasksOpen) setTimeout(() => els.taskInput.focus(), 0);
  }

  function renderTasks() {
    const file = getActiveFile();
    if (!file) {
      els.taskList.replaceChildren();
      return;
    }

    const tasks = file.tasks || [];
    els.taskList.replaceChildren();
    if (!tasks.length) {
      const empty = document.createElement("div");
      empty.className = "task-empty";
      empty.textContent = "No tasks for this page";
      els.taskList.append(empty);
      return;
    }

    tasks.forEach((task) => {
      const row = document.createElement("label");
      row.className = `task-row${task.done ? " done" : ""}`;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(task.done);
      checkbox.addEventListener("change", () => {
        task.done = checkbox.checked;
        persistSoon();
        renderTasks();
      });

      const text = document.createElement("span");
      text.textContent = task.text;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "task-remove";
      remove.textContent = "x";
      remove.setAttribute("aria-label", "Delete task");
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        file.tasks = tasks.filter((item) => item.id !== task.id);
        persistSoon();
        renderTasks();
      });

      row.append(checkbox, text, remove);
      els.taskList.append(row);
    });
  }

  function addTask() {
    const file = getActiveFile();
    if (!file) return;
    const text = els.taskInput.value.trim();
    if (!text) return;
    file.tasks = file.tasks || [];
    file.tasks.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, text, done: false });
    els.taskInput.value = "";
    persistSoon();
    renderTasks();
  }

  function markSelectedKeyword() {
    const file = getActiveFile();
    if (!file || file.loaded === false) return;
    const selected = getSelectedMarkText();
    if (!selected) return;

    const existingIndex = getKeywordMarkIndex(file, selected);
    if (existingIndex >= 0) {
      file.keywordMarks.splice(existingIndex, 1);
      showToast(`Removed mark from ${selected}`);
    } else {
      const className = markClasses[file.keywordMarks.length % markClasses.length];
      setKeywordMark(file, selected, className);
      showToast(`Marked ${selected} ${markLabels[className]}`);
    }

    finishKeywordMarkChange();
  }

  function applyKeywordMark(className) {
    const file = getActiveFile();
    if (!file || file.loaded === false) return;
    if (!markClasses.includes(className)) return;
    const selected = getSelectedMarkText();
    if (!selected) return;

    setKeywordMark(file, selected, className);
    finishKeywordMarkChange();
    showToast(`Marked ${selected} ${markLabels[className]}`);
  }

  function removeSelectedKeywordMark() {
    const file = getActiveFile();
    if (!file || file.loaded === false) return;
    const selected = getSelectedMarkText();
    if (!selected) return;

    const existingIndex = getKeywordMarkIndex(file, selected);
    if (existingIndex < 0) {
      showToast("No mark on selected text");
      return;
    }
    file.keywordMarks.splice(existingIndex, 1);
    finishKeywordMarkChange();
    showToast(`Removed mark from ${selected}`);
  }

  function setKeywordMark(file, selected, className) {
    file.keywordMarks = file.keywordMarks || [];
    const existingIndex = getKeywordMarkIndex(file, selected);
    const nextMark = { text: selected, className };
    if (existingIndex >= 0) file.keywordMarks.splice(existingIndex, 1, nextMark);
    else file.keywordMarks.push(nextMark);
  }

  function getKeywordMarkIndex(file, selected) {
    file.keywordMarks = file.keywordMarks || [];
    return file.keywordMarks.findIndex((mark) => mark.text === selected);
  }

  function getSelectedMarkText() {
    const selected = els.editor.value.slice(els.editor.selectionStart, els.editor.selectionEnd).trim();
    if (!selected) {
      showToast("Select text first");
      return "";
    }
    if (selected.length > 80 || /\n/.test(selected)) {
      showToast("Select one short word or phrase");
      return "";
    }
    return selected;
  }

  function finishKeywordMarkChange() {
    const file = getActiveFile();
    if (!file) return;
    file.decorationCache = null;
    updateEditorDecorations();
    persistSoon();
  }

  function clearKeywordMarks() {
    const file = getActiveFile();
    if (!file) return;
    if (!file.keywordMarks || !file.keywordMarks.length) {
      showToast("No marks on this page");
      return;
    }
    file.keywordMarks = [];
    file.decorationCache = null;
    updateEditorDecorations();
    persistSoon();
    showToast("All page marks removed");
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

  function changeEditorFontSize(delta) {
    const selection = getEditorSelectionRange();
    if (selection) {
      const current = getTextStyleAtOffset(selection.start).fontSize;
      const nextSize = clampFontSize(current + delta);
      if (nextSize === current) {
        showToast(delta > 0 ? "Selection at maximum size" : "Selection at minimum size");
        return;
      }
      applyTextStyleToSelection({ fontSize: nextSize }, `Selection font size ${nextSize}px`);
      return;
    }

    const nextSize = clampFontSize(state.editorFontSize + delta);
    if (nextSize === state.editorFontSize) {
      showToast(delta > 0 ? "Maximum font size" : "Minimum font size");
      return;
    }
    state.editorFontSize = nextSize;
    applyEditorTypography();
    showToast(`Font size ${state.editorFontSize}px`);
  }

  function resetEditorFontSize() {
    const selection = getEditorSelectionRange();
    if (selection) {
      applyTextStyleToSelection({ fontSize: state.editorFontSize }, "Selection font size reset");
      return;
    }

    state.editorFontSize = DEFAULT_FONT_SIZE;
    applyEditorTypography();
    showToast("Font size reset");
  }

  function toggleEditorBold() {
    const selection = getEditorSelectionRange();
    if (selection) {
      const nextValue = !getTextStyleAtOffset(selection.start).bold;
      applyTextStyleToSelection({ bold: nextValue }, nextValue ? "Selection bold on" : "Selection bold off");
      return;
    }

    state.editorBold = !state.editorBold;
    applyEditorTypography();
    showToast(state.editorBold ? "Bold on" : "Bold off");
  }

  function toggleEditorItalic() {
    const selection = getEditorSelectionRange();
    if (selection) {
      const nextValue = !getTextStyleAtOffset(selection.start).italic;
      applyTextStyleToSelection({ italic: nextValue }, nextValue ? "Selection italic on" : "Selection italic off");
      return;
    }

    state.editorItalic = !state.editorItalic;
    applyEditorTypography();
    showToast(state.editorItalic ? "Italic on" : "Italic off");
  }

  function applyEditorTypography(shouldPersist = true) {
    state.editorFontSize = clampFontSize(state.editorFontSize);
    els.shell.style.setProperty("--editor-font-size", `${state.editorFontSize}px`);
    els.shell.style.setProperty("--editor-font-weight", state.editorBold ? "700" : "400");
    els.shell.style.setProperty("--editor-font-style", state.editorItalic ? "italic" : "normal");
    els.boldButton.classList.toggle("active", state.editorBold);
    els.boldButton.setAttribute("aria-pressed", state.editorBold ? "true" : "false");
    els.italicButton.classList.toggle("active", state.editorItalic);
    els.italicButton.setAttribute("aria-pressed", state.editorItalic ? "true" : "false");
    updateLineNumbers(els.editor.value);
    syncScroll();
    syncFormatControls();
    if (shouldPersist) persistWorkspace();
  }

  function clampFontSize(value) {
    const size = Number.isFinite(Number(value)) ? Math.round(Number(value)) : DEFAULT_FONT_SIZE;
    return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
  }

  function getEditorSelectionRange() {
    if (document.activeElement !== els.editor) return null;
    const start = Math.min(els.editor.selectionStart, els.editor.selectionEnd);
    const end = Math.max(els.editor.selectionStart, els.editor.selectionEnd);
    return end > start ? { start, end } : null;
  }

  function applyTextStyleToSelection(patch, message) {
    const file = getActiveFile();
    const selection = getEditorSelectionRange();
    if (!file || !selection) {
      showToast("Select text first");
      return;
    }

    const style = {
      start: selection.start,
      end: selection.end
    };
    if (Object.prototype.hasOwnProperty.call(patch, "fontSize")) style.fontSize = clampFontSize(patch.fontSize);
    if (Object.prototype.hasOwnProperty.call(patch, "bold")) style.bold = Boolean(patch.bold);
    if (Object.prototype.hasOwnProperty.call(patch, "italic")) style.italic = Boolean(patch.italic);
    if (!hasTextStyleProperties(style)) return;

    file.textStyles = normalizeTextStyles([...(file.textStyles || []), style], file.content.length).slice(-400);
    file.decorationCache = null;
    updateEditorDecorations();
    restoreEditorSelection(selection.start, selection.end);
    syncFormatControls();
    persistSoon();
    showToast(message);
  }

  function restoreEditorSelection(start, end) {
    try {
      els.editor.focus({ preventScroll: true });
    } catch (error) {
      els.editor.focus();
    }
    els.editor.setSelectionRange(start, end);
  }

  function syncFormatControls() {
    const style = getCurrentFormatStyle();
    els.boldButton.classList.toggle("active", style.bold);
    els.boldButton.setAttribute("aria-pressed", style.bold ? "true" : "false");
    els.italicButton.classList.toggle("active", style.italic);
    els.italicButton.setAttribute("aria-pressed", style.italic ? "true" : "false");
  }

  function getCurrentFormatStyle() {
    const selection = getEditorSelectionRange();
    if (selection) return getTextStyleAtOffset(selection.start);
    return {
      fontSize: state.editorFontSize,
      bold: state.editorBold,
      italic: state.editorItalic
    };
  }

  function getTextStyleAtOffset(offset) {
    const file = getActiveFile();
    const safeOffset = Math.max(0, Math.min(offset, els.editor.value.length));
    const style = {
      fontSize: state.editorFontSize,
      bold: state.editorBold,
      italic: state.editorItalic
    };
    if (!file || !Array.isArray(file.textStyles)) return style;

    file.textStyles.forEach((entry) => {
      if (entry.start > safeOffset || entry.end <= safeOffset) return;
      if (Object.prototype.hasOwnProperty.call(entry, "fontSize")) style.fontSize = clampFontSize(entry.fontSize);
      if (Object.prototype.hasOwnProperty.call(entry, "bold")) style.bold = Boolean(entry.bold);
      if (Object.prototype.hasOwnProperty.call(entry, "italic")) style.italic = Boolean(entry.italic);
    });
    return style;
  }

  function handleEditorDoubleClick() {
    [0, 16, 50].forEach((delay) => {
      window.setTimeout(selectExactWordFromCurrentSelection, delay);
    });
  }

  function selectExactWordFromCurrentSelection() {
    const value = els.editor.value;
    if (!value) return;

    const originalStart = Math.min(els.editor.selectionStart, els.editor.selectionEnd);
    const originalEnd = Math.max(els.editor.selectionStart, els.editor.selectionEnd);
    let start = originalStart;
    let end = originalEnd;

    while (start < end && !isExactWordCharacter(value[start])) start += 1;
    while (end > start && !isExactWordCharacter(value[end - 1])) end -= 1;

    if (start === end) {
      const collapsed = getCollapsedWordRange(start, value);
      if (!collapsed) {
        updateStatus();
        return;
      }
      start = collapsed.start;
      end = collapsed.end;
    } else {
      const exactRange = getNearestWordRangeInSelection(value, start, end, (originalStart + originalEnd) / 2);
      if (!exactRange) {
        updateStatus();
        return;
      }
      start = exactRange.start;
      end = exactRange.end;
    }

    while (start > 0 && isExactWordCharacter(value[start - 1])) start -= 1;
    while (end < value.length && isExactWordCharacter(value[end])) end += 1;

    if (end > start) {
      els.editor.setSelectionRange(start, end);
      updateStatus();
    }
  }

  function getCollapsedWordRange(offset, value) {
    const candidate = Math.min(Math.max(0, offset), value.length - 1);
    if (isExactWordCharacter(value[candidate])) return { start: candidate, end: candidate + 1 };
    if (candidate > 0 && isExactWordCharacter(value[candidate - 1])) return { start: candidate - 1, end: candidate };
    return null;
  }

  function getNearestWordRangeInSelection(value, start, end, targetOffset) {
    const ranges = [];
    let index = start;
    while (index < end) {
      while (index < end && !isExactWordCharacter(value[index])) index += 1;
      if (index >= end) break;
      const wordStart = index;
      while (index < end && isExactWordCharacter(value[index])) index += 1;
      ranges.push({ start: wordStart, end: index });
    }
    if (!ranges.length) return null;
    return ranges.reduce((best, range) => {
      const currentDistance = Math.abs((range.start + range.end) / 2 - targetOffset);
      const bestDistance = Math.abs((best.start + best.end) / 2 - targetOffset);
      return currentDistance < bestDistance ? range : best;
    }, ranges[0]);
  }

  function isExactWordCharacter(character) {
    return /[\p{L}\p{N}_$]/u.test(character || "");
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
    updateEditorDecorations();
    els.editor.focus();
  }

  function runFindAction(action) {
    const focusTarget = getFindControlFocus();
    if (action === "next") selectFindMatch(state.findIndex + 1, { preserveFindFocus: true });
    if (action === "prev") selectFindMatch(state.findIndex - 1, { preserveFindFocus: true });
    if (action === "replace") replaceCurrentMatch();
    if (action === "replace-all") replaceAllMatches();
    if (action === "close") closeFind();
    else restoreFindControlFocus(focusTarget);
  }

  function updateFindMatches(options = {}) {
    const query = els.findInput.value;
    state.findMatches = [];
    state.findIndex = -1;
    if (!query) {
      updateFindCount();
      if (options.decorate !== false) updateEditorDecorations();
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
    if (options.decorate !== false) updateEditorDecorations();
  }

  function selectFindMatch(index, options = {}) {
    const shouldFocusEditor = options.focusEditor === true;
    const focusTarget = options.preserveFindFocus ? getFindControlFocus() : null;
    if (!state.findMatches.length) {
      updateFindCount();
      restoreFindControlFocus(focusTarget);
      return;
    }
    const length = state.findMatches.length;
    state.findIndex = ((index % length) + length) % length;
    const match = state.findMatches[state.findIndex];
    if (shouldFocusEditor) els.editor.focus();
    els.editor.setSelectionRange(match.start, match.end);
    els.editor.scrollTop = estimateScrollForOffset(match.start);
    syncScroll();
    updateFindCount();
    updateEditorDecorations();
    restoreFindControlFocus(focusTarget);
  }

  function getFindDecorationKey() {
    if (els.findBar.hidden || !els.findInput.value || !state.findMatches.length) return "";
    return `${els.findInput.value}\u0000${state.findIndex}\u0000${state.findMatches.length}`;
  }

  function getFindControlFocus() {
    if (document.activeElement === els.findInput) return els.findInput;
    if (document.activeElement === els.replaceInput) return els.replaceInput;
    return null;
  }

  function restoreFindControlFocus(target) {
    if (!target || els.findBar.hidden) return;
    window.requestAnimationFrame(() => {
      if (els.findBar.hidden) return;
      try {
        target.focus({ preventScroll: true });
      } catch (error) {
        target.focus();
      }
    });
  }

  function estimateScrollForOffset(offset) {
    const before = els.editor.value.slice(0, offset);
    const line = before.split("\n").length;
    const lineHeight = getEditorLineHeight();
    return Math.max(0, (line - 5) * lineHeight);
  }

  function getEditorLineHeight() {
    const lineHeight = Number.parseFloat(window.getComputedStyle(els.editor).lineHeight);
    return Number.isFinite(lineHeight) ? lineHeight : state.editorFontSize * 1.55;
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
    if (state.findIndex < 0) selectFindMatch(0, { preserveFindFocus: true });
    const match = state.findMatches[state.findIndex];
    const replacement = els.replaceInput.value;
    const value = els.editor.value.slice(0, match.start) + replacement + els.editor.value.slice(match.end);
    applyEditorValue(value, match.start + replacement.length);
    updateFindMatches();
    selectFindMatch(state.findIndex, { preserveFindFocus: true });
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
    adjustTextStylesForContentChange(file, file.content, value);
    els.editor.value = value;
    const safeCursor = Math.min(value.length, Math.max(0, cursor));
    els.editor.setSelectionRange(safeCursor, safeCursor);
    file.content = value;
    file.dirty = file.content !== file.savedContent;
    file.decorationCache = null;
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
    if (key === "=" || key === "+") {
      event.preventDefault();
      changeEditorFontSize(1);
      return;
    }
    if (key === "-") {
      event.preventDefault();
      changeEditorFontSize(-1);
      return;
    }
    if (key === "0") {
      event.preventDefault();
      resetEditorFontSize();
      return;
    }
    if (key === "b") {
      event.preventDefault();
      toggleEditorBold();
      return;
    }
    if (key === "i") {
      event.preventDefault();
      toggleEditorItalic();
      return;
    }
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
        content: file.content,
        textStyles: file.textStyles || []
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
        savedContent: entry.content || "",
        textStyles: Array.isArray(entry.textStyles) ? entry.textStyles : []
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
    return decorateText(code);
  }

  function highlightWithRegex(code, regex, classify) {
    let output = "";
    let lastIndex = 0;
    code.replace(regex, (match, ...args) => {
      const offset = args[args.length - 2];
      output += decorateText(code.slice(lastIndex, offset), lastIndex);
      output += `<span class="${classify(match, offset, code)}">${decorateText(match, offset)}</span>`;
      lastIndex = offset + match.length;
      return match;
    });
    output += decorateText(code.slice(lastIndex), lastIndex);
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
    let offset = 0;
    return code.split("\n").map((line) => {
      const lineOffset = offset;
      offset += line.length + 1;
      if (/^#{1,6}\s/.test(line)) return `<span class="token-heading">${decorateText(line, lineOffset)}</span>`;
      let output = decorateText(line, lineOffset);
      if (!getKeywordMarks().length && !hasVisibleFindHighlights()) {
        output = output.replace(/(`[^`]+`)/g, '<span class="token-string">$1</span>');
        output = output.replace(/(\*\*[^*]+\*\*)/g, '<span class="token-emphasis">$1</span>');
        output = output.replace(/^(\s*[-*]\s)/, '<span class="token-keyword">$1</span>');
      }
      return output;
    }).join("\n");
  }

  function decorateText(value, baseOffset = 0) {
    const textStyles = getTextStylesForRange(baseOffset, baseOffset + value.length);
    if (textStyles.length) {
      let output = "";
      const boundaries = new Set([0, value.length]);
      textStyles.forEach((style) => {
        boundaries.add(Math.max(0, style.start - baseOffset));
        boundaries.add(Math.min(value.length, style.end - baseOffset));
      });
      const points = Array.from(boundaries).sort((a, b) => a - b);
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        if (end <= start) continue;
        const absoluteStart = baseOffset + start;
        const segment = decorateFindAndKeyword(value.slice(start, end), absoluteStart);
        const style = combineTextStylesForRange(textStyles, absoluteStart, baseOffset + end);
        output += wrapTextStyle(segment, style);
      }
      return output;
    }
    return decorateFindAndKeyword(value, baseOffset);
  }

  function decorateFindAndKeyword(value, baseOffset = 0) {
    const findHighlights = getFindHighlightsForRange(baseOffset, baseOffset + value.length);
    if (findHighlights.length) {
      let output = "";
      let lastIndex = 0;
      findHighlights.forEach((match) => {
        const start = Math.max(0, match.start - baseOffset);
        const end = Math.min(value.length, match.end - baseOffset);
        if (end <= lastIndex) return;
        const safeStart = Math.max(lastIndex, start);
        output += decorateKeywordMarks(value.slice(lastIndex, safeStart));
        const className = match.index === state.findIndex ? "find-match active" : "find-match";
        output += `<span class="${className}">${decorateKeywordMarks(value.slice(safeStart, end))}</span>`;
        lastIndex = end;
      });
      output += decorateKeywordMarks(value.slice(lastIndex));
      return output;
    }
    return decorateKeywordMarks(value);
  }

  function getTextStylesForRange(start, end) {
    const file = getActiveFile();
    if (!file || !Array.isArray(file.textStyles) || start >= end) return [];
    return file.textStyles.filter((style) => style.end > start && style.start < end);
  }

  function combineTextStylesForRange(styles, start, end) {
    const combined = {};
    styles.forEach((style) => {
      if (style.end <= start || style.start >= end) return;
      if (Object.prototype.hasOwnProperty.call(style, "fontSize")) combined.fontSize = clampFontSize(style.fontSize);
      if (Object.prototype.hasOwnProperty.call(style, "bold")) combined.bold = Boolean(style.bold);
      if (Object.prototype.hasOwnProperty.call(style, "italic")) combined.italic = Boolean(style.italic);
    });
    return combined;
  }

  function wrapTextStyle(content, style) {
    if (!hasTextStyleProperties(style)) return content;
    const rules = [];
    if (Object.prototype.hasOwnProperty.call(style, "fontSize")) rules.push(`font-size:${clampFontSize(style.fontSize)}px`);
    if (Object.prototype.hasOwnProperty.call(style, "bold")) rules.push(`font-weight:${style.bold ? "700" : "400"}`);
    if (Object.prototype.hasOwnProperty.call(style, "italic")) rules.push(`font-style:${style.italic ? "italic" : "normal"}`);
    return `<span class="text-style" style="${rules.join(";")}">${content}</span>`;
  }

  function decorateKeywordMarks(value) {
    const marks = getKeywordMarks();
    if (!marks.length || !value) return escapeHtml(value);
    const orderedMarks = marks.slice().sort((a, b) => b.text.length - a.text.length);
    const pattern = orderedMarks.map((mark) => escapeRegExp(mark.text)).join("|");
    const expression = new RegExp(pattern, "g");
    let output = "";
    let lastIndex = 0;
    value.replace(expression, (match, offset) => {
      output += escapeHtml(value.slice(lastIndex, offset));
      const mark = orderedMarks.find((item) => item.text === match) || orderedMarks[0];
      output += `<span class="keyword-mark ${mark.className}">${escapeHtml(match)}</span>`;
      lastIndex = offset + match.length;
      return match;
    });
    output += escapeHtml(value.slice(lastIndex));
    return output;
  }

  function getFindHighlightsForRange(start, end) {
    if (els.findBar.hidden || !els.findInput.value || !state.findMatches.length || start >= end) return [];
    return state.findMatches
      .map((match, index) => ({ ...match, index }))
      .filter((match) => match.end > start && match.start < end);
  }

  function hasVisibleFindHighlights() {
    return !els.findBar.hidden && Boolean(els.findInput.value) && state.findMatches.length > 0;
  }

  function getKeywordMarks() {
    const file = getActiveFile();
    return file && Array.isArray(file.keywordMarks) ? file.keywordMarks.filter((mark) => mark.text) : [];
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
