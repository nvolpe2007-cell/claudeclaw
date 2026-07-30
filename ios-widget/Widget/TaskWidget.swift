import WidgetKit
import SwiftUI

/// Declares the widget: which provider feeds it, which view renders it,
/// and which sizes/placements it supports.
struct TaskWidget: Widget {
    let kind = "TaskWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TaskProvider()) { entry in
            TaskWidgetView(entry: entry)
                // Tapping the widget deep-links into the host app.
                .widgetURL(URL(string: "nudge://open"))
                // Required on iOS 17+. Harmless/clear on lock-screen accessories.
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Today's Nudge")
        .description("A random social-norm challenge, right on your lock screen.")
        .supportedFamilies([
            .accessoryRectangular,
            .accessoryInline,
            .accessoryCircular,
            .systemSmall
        ])
    }
}
