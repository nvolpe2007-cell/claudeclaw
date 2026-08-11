import WidgetKit
import SwiftUI

/// The entry point for the widget extension. A bundle can hold several
/// widgets; for now it's just the one nudge widget.
@main
struct NudgeWidgetBundle: WidgetBundle {
    var body: some Widget {
        TaskWidget()
    }
}
