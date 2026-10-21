import { z } from "zod";
import { ApiError } from "./errors.ts";

/** Checks a request body or query against `schema`, answering 400 with the problems if it doesn't fit. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new ApiError(400, "invalid_request", "Some of the request is missing or invalid.", z.flattenError(result.error));
  }
  return result.data;
}
