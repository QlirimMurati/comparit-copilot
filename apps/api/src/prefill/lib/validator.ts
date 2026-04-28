import { enums as defaultEnums, prefillSchemas as defaultPrefillSchemas, type FieldDef } from './schema';

export interface ValidationError {
  path: string;
  message: string;
  value: unknown;
  expected?: string;
}

export interface SchemaSource {
  enums: Record<string, readonly string[]>;
  prefillSchemas: Record<string, { fields: Record<string, FieldDef> }>;
}

export function validatePrefill(
  sparte: string,
  data: Record<string, unknown>,
  source?: SchemaSource,
): ValidationError[] {
  const schemas = source?.prefillSchemas ?? defaultPrefillSchemas;
  const schema = schemas[sparte];
  if (!schema) {
    return [{ path: "(root)", message: `Unknown sparte "${sparte}". Valid: ${Object.keys(schemas).join(", ")}`, value: sparte }];
  }

  const enumsToUse = source?.enums ?? defaultEnums;
  const errors: ValidationError[] = [];
  validateObject(data, schema.fields, "", errors, enumsToUse);
  return errors;
}

function validateObject(
  data: Record<string, unknown>,
  fields: Record<string, FieldDef>,
  parentPath: string,
  errors: ValidationError[],
  enumSource: Record<string, readonly string[]>,
): void {
  for (const [key, value] of Object.entries(data)) {
    const fieldPath = parentPath ? `${parentPath}.${key}` : key;
    const fieldDef = fields[key];

    if (!fieldDef) {
      continue;
    }

    if (value === null || value === undefined) {
      continue;
    }

    validateField(value, fieldDef, fieldPath, errors, enumSource);
  }
}

function validateField(
  value: unknown,
  fieldDef: FieldDef,
  path: string,
  errors: ValidationError[],
  enumSource: Record<string, readonly string[]>,
): void {
  if (value === null || value === undefined) {
    return;
  }

  switch (fieldDef.type) {
    case "enum": {
      if (fieldDef.enumName) {
        const allowedValues = enumSource[fieldDef.enumName];
        if (allowedValues && typeof value === "string" && !allowedValues.includes(value)) {
          errors.push({
            path,
            message: `Invalid enum value for ${fieldDef.enumName}`,
            value,
            expected: allowedValues.join(", "),
          });
        }
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        errors.push({
          path,
          message: `Expected boolean`,
          value,
          expected: "true | false",
        });
      }
      break;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push({
          path,
          message: `Expected integer`,
          value,
          expected: "integer number",
        });
      }
      break;
    }
    case "number": {
      if (typeof value !== "number") {
        errors.push({
          path,
          message: `Expected number`,
          value,
          expected: "number (double)",
        });
      }
      break;
    }
    case "string": {
      if (typeof value !== "string") {
        errors.push({
          path,
          message: `Expected string`,
          value,
          expected: fieldDef.format ? `string (${fieldDef.format})` : "string",
        });
      }
      break;
    }
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) {
        errors.push({
          path,
          message: `Expected object`,
          value: typeof value,
        });
      } else if (fieldDef.objectSchema) {
        validateObject(value as Record<string, unknown>, fieldDef.objectSchema, path, errors, enumSource);
      }
      break;
    }
    case "array": {
      if (!Array.isArray(value)) {
        errors.push({
          path,
          message: `Expected array`,
          value: typeof value,
        });
      } else if (fieldDef.arrayItemSchema) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (item && typeof item === "object" && !Array.isArray(item)) {
            validateObject(item as Record<string, unknown>, fieldDef.arrayItemSchema, `${path}[${i}]`, errors, enumSource);
          }
        }
      }
      break;
    }
  }
}

export function formatErrors(errors: ValidationError[]): string {
  if (errors.length === 0) {
    return "All prefill data is valid.";
  }

  const lines: string[] = [`Found ${errors.length} validation error(s):\n`];

  for (const err of errors) {
    lines.push(`  Field: ${err.path}`);
    lines.push(`  Error: ${err.message}`);
    lines.push(`  Value: ${JSON.stringify(err.value)}`);
    if (err.expected) {
      lines.push(`  Expected: ${err.expected}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
