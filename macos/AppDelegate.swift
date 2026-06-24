import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let ignoredDirectories: Set<String> = [".git", "node_modules", "dist", "build", ".next", ".cache"]
    private let textExtensions: Set<String> = [
        "js", "jsx", "ts", "tsx", "json", "css", "scss", "html", "htm", "md", "markdown",
        "txt", "py", "yml", "yaml", "sh", "xml", "svg", "csv", "env", "gitignore"
    ]

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let contentController = WKUserContentController()
        contentController.add(self, name: "myEditorNative")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 780),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "MyEditor"
        window.minSize = NSSize(width: 900, height: 560)
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        guard let htmlURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "sublime-lite") else {
            showAlert(message: "MyEditor could not find its bundled editor files.")
            return
        }

        webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            message.name == "myEditorNative",
            let body = message.body as? [String: Any],
            let id = body["id"] as? String,
            let action = body["action"] as? String
        else {
            return
        }

        let payload = body["payload"] as? [String: Any] ?? [:]

        do {
            switch action {
            case "openWorkspace":
                if let result = openWorkspace() {
                    complete(id: id, result: result)
                } else {
                    fail(id: id, error: "cancelled")
                }
            case "openFiles":
                if let result = openFiles() {
                    complete(id: id, result: result)
                } else {
                    fail(id: id, error: "cancelled")
                }
            case "saveFile":
                let result = try saveFile(payload: payload)
                complete(id: id, result: result)
            case "saveRaw":
                let result = try saveRaw(payload: payload)
                complete(id: id, result: result)
            case "readFile":
                let result = try readFile(payload: payload)
                complete(id: id, result: result)
            default:
                fail(id: id, error: "Unknown native action")
            }
        } catch NativeError.cancelled {
            fail(id: id, error: "cancelled")
        } catch {
            fail(id: id, error: error.localizedDescription)
        }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        completionHandler(panel.runModal() == .OK ? panel.urls : nil)
    }

    private func buildMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About MyEditor", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit MyEditor", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApp.mainMenu = mainMenu
    }

    private func openWorkspace() -> [[String: Any]]? {
        let panel = NSOpenPanel()
        panel.message = "Open a folder in MyEditor"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false

        guard panel.runModal() == .OK, let root = panel.url else {
            return nil
        }

        return collectFiles(root: root, current: root)
    }

    private func openFiles() -> [[String: Any]]? {
        let panel = NSOpenPanel()
        panel.message = "Open files in MyEditor"
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = true

        guard panel.runModal() == .OK else {
            return nil
        }

        let files = panel.urls.compactMap { url -> [String: Any]? in
            guard let content = readTextFile(url) else { return nil }
            return [
                "path": url.lastPathComponent,
                "content": content,
                "savedContent": content,
                "nativePath": url.path
            ]
        }

        return files.isEmpty ? nil : files
    }

    private func saveFile(payload: [String: Any]) throws -> [String: Any] {
        let content = payload["content"] as? String ?? ""
        let suggestedName = payload["name"] as? String ?? "untitled.txt"
        let forceSaveAs = payload["forceSaveAs"] as? Bool ?? false
        let existingPath = payload["nativePath"] as? String ?? ""

        let targetURL: URL
        if !forceSaveAs, !existingPath.isEmpty {
            targetURL = URL(fileURLWithPath: existingPath)
        } else {
            guard let chosenURL = chooseSaveURL(suggestedName: suggestedName) else {
                throw NativeError.cancelled
            }
            targetURL = chosenURL
        }

        try content.write(to: targetURL, atomically: true, encoding: .utf8)

        return [
            "path": targetURL.lastPathComponent,
            "name": targetURL.lastPathComponent,
            "nativePath": targetURL.path
        ]
    }

    private func saveRaw(payload: [String: Any]) throws -> [String: Any] {
        let content = payload["content"] as? String ?? ""
        let suggestedName = payload["name"] as? String ?? "myeditor-workspace.json"

        guard let targetURL = chooseSaveURL(suggestedName: suggestedName) else {
            throw NativeError.cancelled
        }

        try content.write(to: targetURL, atomically: true, encoding: .utf8)

        return [
            "name": targetURL.lastPathComponent,
            "nativePath": targetURL.path
        ]
    }

    private func readFile(payload: [String: Any]) throws -> [String: Any] {
        guard let nativePath = payload["nativePath"] as? String, !nativePath.isEmpty else {
            throw NativeError.cancelled
        }

        let url = URL(fileURLWithPath: nativePath)
        guard let content = readTextFile(url) else {
            throw NativeError.cancelled
        }

        return [
            "content": content,
            "savedContent": content
        ]
    }

    private func chooseSaveURL(suggestedName: String) -> URL? {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.canCreateDirectories = true
        return panel.runModal() == .OK ? panel.url : nil
    }

    private func collectFiles(root: URL, current: URL) -> [[String: Any]] {
        let fileManager = FileManager.default
        guard let urls = try? fileManager.contentsOfDirectory(
            at: current,
            includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }

        var result: [[String: Any]] = []

        for url in urls.sorted(by: { $0.path < $1.path }) {
            let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
            if values?.isDirectory == true {
                if ignoredDirectories.contains(url.lastPathComponent) { continue }
                result.append(contentsOf: collectFiles(root: root, current: url))
                continue
            }

            guard isLikelyTextFile(url) else { continue }
            let relativePath = relativePath(from: root, to: url)
            result.append([
                "path": relativePath,
                "content": "",
                "savedContent": "",
                "nativePath": url.path,
                "loaded": false
            ])
        }

        return result
    }

    private func readTextFile(_ url: URL) -> String? {
        guard isLikelyTextFile(url) else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    private func isLikelyTextFile(_ url: URL) -> Bool {
        let values = try? url.resourceValues(forKeys: [.fileSizeKey])
        if let size = values?.fileSize, size > 5 * 1024 * 1024 {
            return false
        }

        let name = url.lastPathComponent.lowercased()
        if name == ".env" || name == ".gitignore" {
            return true
        }

        let ext = url.pathExtension.lowercased()
        return textExtensions.contains(ext)
    }

    private func relativePath(from root: URL, to file: URL) -> String {
        let rootPath = root.standardizedFileURL.path
        let filePath = file.standardizedFileURL.path
        if filePath.hasPrefix(rootPath + "/") {
            return String(filePath.dropFirst(rootPath.count + 1))
        }
        return file.lastPathComponent
    }

    private func complete(id: String, result: Any) {
        sendResponse(["id": id, "ok": true, "result": result])
    }

    private func fail(id: String, error: String) {
        sendResponse(["id": id, "ok": false, "error": error])
    }

    private func sendResponse(_ response: [String: Any]) {
        guard
            JSONSerialization.isValidJSONObject(response),
            let data = try? JSONSerialization.data(withJSONObject: response, options: []),
            let json = String(data: data, encoding: .utf8)
        else {
            return
        }

        webView.evaluateJavaScript("window.MyEditorNative && window.MyEditorNative._complete(\(json));")
    }

    private func showAlert(message: String) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .critical
        alert.runModal()
    }
}

private enum NativeError: Error {
    case cancelled
}
