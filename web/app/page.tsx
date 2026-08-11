import Generator from "./generator";
import { randomTask, categoryOf } from "@/lib/tasks";

// Server component: pick the first nudge on the server so there's something
// on screen instantly, then let the client swap it with the dice button.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const task = randomTask();
  return <Generator initialTask={task} initialCategory={categoryOf(task)} />;
}
