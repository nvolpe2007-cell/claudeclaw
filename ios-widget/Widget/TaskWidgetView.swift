import WidgetKit
import SwiftUI

/// The visual card. Lock-screen widgets come in several tiny "accessory"
/// families, each with very little room, so we render a tailored layout for
/// each one. `systemSmall` is included so it also works on the Home Screen.
struct TaskWidgetView: View {
    @Environment(\.widgetFamily) private var family
    var entry: TaskProvider.Entry

    var body: some View {
        switch family {

        // A single line of text (e.g. above the clock).
        case .accessoryInline:
            Text(entry.task)

        // A tiny circle — no room for the full task, so show an icon.
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "sparkles")
                    .font(.title2)
            }

        // The roomy lock-screen rectangle: label + the task.
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text("TODAY'S NUDGE")
                    .font(.caption2)
                    .fontWeight(.bold)
                    .widgetAccentable()
                Text(entry.task)
                    .font(.caption)
                    .lineLimit(3)
            }

        // Home Screen small tile (and any future families).
        default:
            VStack(alignment: .leading, spacing: 6) {
                Text("Today's Nudge")
                    .font(.caption)
                    .bold()
                    .foregroundStyle(.secondary)
                Text(entry.task)
                    .font(.headline)
                    .minimumScaleFactor(0.5)
                Spacer(minLength: 0)
            }
        }
    }
}
