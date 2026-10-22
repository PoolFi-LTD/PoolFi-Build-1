/** An error the screens can show as-is. `code` matches the backend's error codes. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** Extra facts from the server, e.g. why a sign-in was turned away. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}
