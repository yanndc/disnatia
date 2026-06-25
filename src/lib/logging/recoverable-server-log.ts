export function logRecoverableServerIssue(
  scope: string,
  error: unknown,
): void {
  if (process.env.NODE_ENV === "development") return;
  console.warn(scope, error);
}