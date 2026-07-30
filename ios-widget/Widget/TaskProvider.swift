import WidgetKit
import SwiftUI

/// One moment in the widget's timeline: the task to show at a given time.
struct TaskEntry: TimelineEntry {
    let date: Date
    let task: String
}

/// Decides *what* nudge to show and *when* the widget should refresh.
///
/// iOS budgets how often widgets can update (roughly a few dozen times a
/// day, controlled by the OS). So instead of asking for a new task "on
/// every glance," we hand iOS a schedule of upcoming tasks — one per hour
/// for the next several hours — and ask it to build a fresh schedule when
/// that runs out (`.atEnd`).
struct TaskProvider: TimelineProvider {

    /// Shown while the widget gallery renders a preview.
    func placeholder(in context: Context) -> TaskEntry {
        TaskEntry(date: Date(), task: Tasks.all.first ?? "Say hi to a stranger.")
    }

    /// A single representative entry (widget gallery, transient states).
    func getSnapshot(in context: Context, completion: @escaping (TaskEntry) -> Void) {
        completion(TaskEntry(date: Date(), task: Tasks.random()))
    }

    /// The real schedule of upcoming tasks.
    func getTimeline(in context: Context, completion: @escaping (Timeline<TaskEntry>) -> Void) {
        var entries: [TaskEntry] = []
        let now = Date()
        let calendar = Calendar.current

        // Rotate to a new nudge every hour for the next 6 hours.
        for hourOffset in 0..<6 {
            if let entryDate = calendar.date(byAdding: .hour, value: hourOffset, to: now) {
                entries.append(TaskEntry(date: entryDate, task: Tasks.random()))
            }
        }

        // When the last entry is reached, ask iOS to build a new timeline.
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}
