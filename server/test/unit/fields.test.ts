import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import { FieldDefinitions, validateFieldValues, type FieldDefinition } from "../../src/fields.js";

const fields: FieldDefinition[] = FieldDefinitions.parse([
  { key: "matric_number", label: "Matric number", type: "text" },
  { key: "level", label: "Level", type: "select", options: ["100L", "200L", "300L"] },
  { key: "email", label: "Email", type: "email", required: false },
  { key: "phone", label: "Phone", type: "phone", required: false },
  { key: "seats", label: "Seats", type: "number", required: false },
]);

function errorsFor(values: unknown): Record<string, string> {
  try {
    validateFieldValues(fields, values);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).details as Record<string, string>;
  }
  throw new Error("expected the values to be rejected");
}

describe("field definitions", () => {
  it("default to required", () => {
    expect(fields[0]?.required).toBe(true);
  });

  it("reject duplicate keys, bad keys and options on non-select fields", () => {
    expect(
      FieldDefinitions.safeParse([
        { key: "a", label: "A", type: "text" },
        { key: "a", label: "B", type: "text" },
      ]).success,
    ).toBe(false);
    expect(FieldDefinitions.safeParse([{ key: "Bad Key", label: "A", type: "text" }]).success).toBe(false);
    expect(FieldDefinitions.safeParse([{ key: "a", label: "A", type: "text", options: ["x"] }]).success).toBe(false);
    expect(FieldDefinitions.safeParse([{ key: "a", label: "A", type: "select" }]).success).toBe(false);
  });
});

describe("validateFieldValues", () => {
  it("accepts and cleans valid answers", () => {
    expect(
      validateFieldValues(fields, { matric_number: " 2019/1234 ", level: "300L", seats: "2", email: "a@b.co" }),
    ).toEqual({ matric_number: "2019/1234", level: "300L", seats: 2, email: "a@b.co" });
  });

  it("requires required fields", () => {
    expect(errorsFor({})).toEqual({
      matric_number: "Matric number is required.",
      level: "Level is required.",
    });
  });

  it("checks each type", () => {
    const errors = errorsFor({
      matric_number: "x",
      level: "500L",
      email: "not-an-email",
      phone: "call me",
      seats: "two",
    });
    expect(Object.keys(errors).sort()).toEqual(["email", "level", "phone", "seats"]);
  });

  it("rejects fields the pool doesn't have", () => {
    expect(errorsFor({ matric_number: "x", level: "100L", favourite_colour: "blue" })).toHaveProperty("favourite_colour");
  });

  it("accepts nothing for a pool without fields", () => {
    expect(validateFieldValues([], undefined)).toEqual({});
  });
});
