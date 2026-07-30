import PostForm from "./post-form";
import { randomTask } from "@/lib/tasks";

// The task comes in via ?task=... from the generator. Fall back to a random
// one if someone lands here directly.
export default function PostPage({
  searchParams,
}: {
  searchParams: { task?: string };
}) {
  const task = searchParams.task?.trim() || randomTask();
  return <PostForm task={task} />;
}
