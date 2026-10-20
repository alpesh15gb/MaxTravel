export const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;

/** Replaying a completion must preserve when the work was actually completed. */
export function taskCompletedAt(
  current: { status: string; completedAt: Date | null },
  status: string,
  now = new Date(),
): Date | null {
  return status === "DONE" ? (current.status === "DONE" ? current.completedAt ?? now : now) : null;
}
