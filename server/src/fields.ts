import { z } from "zod";
import { ApiError } from "./errors.js";

/** A field the pool admin asks contributors to fill in, e.g. matric number. */
export const FieldDefinition = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "use lowercase letters, digits and underscores"),
    label: z.string().trim().min(1).max(100),
    type: z.enum(["text", "number", "email", "phone", "select"]),
    required: z.boolean().default(true),
    options: z.array(z.string().trim().min(1).max(100)).min(1).max(50).optional(),
  })
  .refine((f) => f.type === "select" || f.options === undefined, {
    message: "only select fields have options",
    path: ["options"],
  })
  .refine((f) => f.type !== "select" || f.options !== undefined, {
    message: "select fields need options",
    path: ["options"],
  });

export const FieldDefinitions = z
  .array(FieldDefinition)
  .max(20)
  .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, "field keys must be unique");

export type FieldDefinition = z.infer<typeof FieldDefinition>;
export type FieldValues = Record<string, string | number>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;

/** Checks a contributor's answers against the pool's fields and returns the cleaned values. */
export function validateFieldValues(fields: FieldDefinition[], input: unknown): FieldValues {
  const values = input ?? {};
  if (typeof values !== "object" || Array.isArray(values)) {
    throw new ApiError(400, "invalid_field_values", "Field values must be an object.");
  }
  const raw = values as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const clean: FieldValues = {};

  for (const key of Object.keys(raw)) {
    if (!fields.some((f) => f.key === key)) errors[key] = "This pool has no such field.";
  }
  for (const field of fields) {
    const value = raw[field.key];
    if (value === undefined || value === null || value === "") {
      if (field.required) errors[field.key] = `${field.label} is required.`;
      continue;
    }
    if (field.type === "number") {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
      if (!Number.isFinite(n)) errors[field.key] = `${field.label} must be a number.`;
      else clean[field.key] = n;
      continue;
    }
    if (typeof value !== "string") {
      errors[field.key] = `${field.label} must be text.`;
      continue;
    }
    const text = value.trim();
    if (text.length > 500) errors[field.key] = `${field.label} is too long.`;
    else if (field.type === "email" && !EMAIL.test(text)) errors[field.key] = `${field.label} must be an email address.`;
    else if (field.type === "phone" && !PHONE.test(text)) errors[field.key] = `${field.label} must be a phone number.`;
    else if (field.type === "select" && !field.options?.includes(text))
      errors[field.key] = `${field.label} must be one of: ${field.options?.join(", ")}.`;
    else clean[field.key] = text;
  }

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, "invalid_field_values", "Some fields are missing or invalid.", errors);
  }
  return clean;
}
