import Cocoa

if CommandLine.arguments.contains("--check") {
    print("MyEditor native app ready")
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
