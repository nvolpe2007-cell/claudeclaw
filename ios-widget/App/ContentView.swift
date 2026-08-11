import SwiftUI
import WidgetKit

/// The single screen of the host app: a live nudge preview, a button to
/// draw a new one, and instructions for adding the lock-screen widget.
struct ContentView: View {
    @State private var task = Tasks.random()

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundStyle(.tint)

            Text("Nudge")
                .font(.largeTitle.bold())

            Text("A little dare to break a small social norm.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            // Live preview of a nudge.
            Text(task)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
                .padding()
                .frame(maxWidth: .infinity)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal)

            Button {
                task = Tasks.random()
                // Nudge the widget to rebuild its timeline too.
                WidgetCenter.shared.reloadAllTimelines()
            } label: {
                Label("New nudge", systemImage: "arrow.clockwise")
                    .font(.headline)
            }
            .buttonStyle(.borderedProminent)

            Spacer()

            // How to add the widget to the lock screen.
            VStack(alignment: .leading, spacing: 8) {
                Text("Add it to your lock screen")
                    .font(.headline)
                Text("Lock your phone → touch and hold the lock screen → tap Customize → Lock Screen → tap the widget area → find “Nudge.”")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)
        }
        .padding(.vertical)
        // Handle taps coming from the widget (nudge://open).
        .onOpenURL { _ in
            task = Tasks.random()
        }
    }
}

#Preview {
    ContentView()
}
