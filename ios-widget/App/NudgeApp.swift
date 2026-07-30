import SwiftUI

/// The host app. Apple requires a widget to ship inside a normal app; this
/// is that shell. It shows how to add the widget and lets you preview a
/// random nudge.
@main
struct NudgeApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
