import type { FieldDef } from './schema';

export interface StageConfig {
  name: string;
  label: string;
  swaggerUrl: string;
}

export const stages: StageConfig[] = [
  { name: "live", label: "LIVE", swaggerUrl: "https://pool.cpit.app/swagger/v1/swagger.json" },
  { name: "qa",   label: "QA",   swaggerUrl: "https://pool.qa.cpit.app/swagger/v1/swagger.json" },
  { name: "dev",  label: "DEV",  swaggerUrl: "https://pool.cpit.dev/swagger/v1/swagger.json" },
];

// Sparte name → swagger schema name prefix mapping
const sparteToSchemaName: Record<string, string> = {
  Kfz: "Kfz", Bu: "Bu", Rlv: "Rlv", Pr: "Pr", Br: "Br",
  Gf: "Gf", Hr: "Hr", Wg: "Wg", Kvv: "Kvv", Kvz: "Kvz", Phv: "Phv",
};

interface SwaggerSpec {
  components: {
    schemas: Record<string, SwaggerSchema>;
  };
}

interface SwaggerSchema {
  type?: string;
  enum?: string[];
  nullable?: boolean;
  format?: string;
  properties?: Record<string, SwaggerSchema>;
  allOf?: SwaggerSchema[];
  items?: SwaggerSchema;
  $ref?: string;
  additionalProperties?: boolean;
}

export interface LoadedSchema {
  enums: Record<string, readonly string[]>;
  prefillSchemas: Record<string, { fields: Record<string, FieldDef> }>;
  loadedAt: number;
  stage: string;
}

// Cache per stage
const cache: Record<string, LoadedSchema> = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function resolveRef(ref: string, allSchemas: Record<string, SwaggerSchema>): SwaggerSchema {
  // "#/components/schemas/FooEnum" → "FooEnum"
  const name = ref.split("/").pop()!;
  return allSchemas[name] ?? {};
}

function refName(ref: string): string {
  return ref.split("/").pop()!;
}

function convertProperty(
  prop: SwaggerSchema,
  allSchemas: Record<string, SwaggerSchema>,
): FieldDef {
  // Follow $ref
  if (prop.$ref) {
    const name = refName(prop.$ref);
    const resolved = resolveRef(prop.$ref, allSchemas);

    // If it's an enum
    if (resolved.enum) {
      return { type: "enum", enumName: name, nullable: true };
    }

    // If it's an object with properties
    if (resolved.type === "object" || resolved.properties) {
      return {
        type: "object",
        nullable: true,
        objectSchema: convertProperties(resolved, allSchemas),
      };
    }

    // Fallback — treat as string
    return { type: "string", nullable: true };
  }

  // Array
  if (prop.type === "array" && prop.items) {
    const itemSchema = prop.items.$ref
      ? resolveRef(prop.items.$ref, allSchemas)
      : prop.items;

    if (itemSchema.type === "object" || itemSchema.properties) {
      return {
        type: "array",
        nullable: prop.nullable ?? true,
        arrayItemSchema: convertProperties(itemSchema, allSchemas),
      };
    }

    return { type: "array", nullable: prop.nullable ?? true };
  }

  // Object
  if (prop.type === "object" && prop.properties) {
    return {
      type: "object",
      nullable: prop.nullable ?? true,
      objectSchema: convertProperties(prop, allSchemas),
    };
  }

  // Primitives
  if (prop.type === "integer") return { type: "integer", nullable: prop.nullable ?? true };
  if (prop.type === "number")  return { type: "number",  nullable: prop.nullable ?? true };
  if (prop.type === "boolean") return { type: "boolean", nullable: prop.nullable ?? true };

  // String with format
  if (prop.type === "string") {
    const def: FieldDef = { type: "string", nullable: prop.nullable ?? true };
    if (prop.format) def.format = prop.format;
    return def;
  }

  return { type: "string", nullable: true };
}

function convertProperties(
  schema: SwaggerSchema,
  allSchemas: Record<string, SwaggerSchema>,
): Record<string, FieldDef> {
  const result: Record<string, FieldDef> = {};
  const props = schema.properties ?? {};

  // Handle allOf (inheritance)
  if (schema.allOf) {
    for (const part of schema.allOf) {
      if (part.$ref) {
        const resolved = resolveRef(part.$ref, allSchemas);
        Object.assign(props, resolved.properties ?? {});
      } else if (part.properties) {
        Object.assign(props, part.properties);
      }
    }
  }

  for (const [key, prop] of Object.entries(props)) {
    result[key] = convertProperty(prop, allSchemas);
  }

  return result;
}

export async function loadSchema(stageName: string): Promise<LoadedSchema> {
  // Check cache
  const cached = cache[stageName];
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
    return cached;
  }

  const stage = stages.find(s => s.name === stageName);
  if (!stage) throw new Error(`Unknown stage: ${stageName}`);

  const res = await fetch(stage.swaggerUrl);
  if (!res.ok) throw new Error(`Failed to fetch swagger from ${stage.label}: ${res.status}`);

  const spec: SwaggerSpec = await res.json() as SwaggerSpec;
  const allSchemas = spec.components.schemas;

  // Extract enums
  const enums: Record<string, readonly string[]> = {};
  for (const [name, schema] of Object.entries(allSchemas)) {
    if (schema.enum && schema.type === "string") {
      enums[name] = schema.enum;
    }
  }

  // Extract prefill schemas per sparte
  const prefillSchemas: Record<string, { fields: Record<string, FieldDef> }> = {};
  for (const [sparte, prefix] of Object.entries(sparteToSchemaName)) {
    const schemaName = `${prefix}PrefillDataInput`;
    const schema = allSchemas[schemaName];
    if (!schema) continue;

    prefillSchemas[sparte] = {
      fields: convertProperties(schema, allSchemas),
    };
  }

  const loaded: LoadedSchema = {
    enums,
    prefillSchemas,
    loadedAt: Date.now(),
    stage: stageName,
  };

  cache[stageName] = loaded;
  return loaded;
}

export function getCachedSchema(stageName: string): LoadedSchema | undefined {
  return cache[stageName];
}

export function clearCache(stageName?: string): void {
  if (stageName) {
    delete cache[stageName];
  } else {
    for (const key of Object.keys(cache)) delete cache[key];
  }
}
