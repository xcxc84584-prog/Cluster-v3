/**
 * Cluster JSON Schema subset (draft 2020-style shape). Rejects invalid
 * input/output before it crosses a Router or Host bridge boundary.
 * Supported: type, properties, required, additionalProperties, items,
 * enum, const, min/max, min/maxLength, pattern, anyOf, oneOf, allOf.
 */
export class ContractViolation extends Error {
  constructor(path, explanation, status = 400) {
    super(path + ": " + explanation);
    this.name = "ContractViolation";
    this.code = "CONTRACT_VALIDATION_FAILED";
    this.status = status;
    this.location = { unit: "Contract", path };
  }
}
const objectLike = v => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fits = (value, type) => {
  switch (type) {
    case "object": return objectLike(value);
    case "array": return Array.isArray(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "null": return value === null;
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    default: return false;
  }
};
export function validateSchema(schema, value, path = "$", depth = 0) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    throw new ContractViolation(path, "invalid schema");
  if (depth > 24) throw new ContractViolation(path, "schema recursion limit");
  const check = (rule, data, next) => validateSchema(rule, data, next, depth + 1);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => fits(value, type)))
      throw new ContractViolation(path, "expected " + types.join("|"));
  }
  if (schema.const !== undefined && !same(schema.const, value))
    throw new ContractViolation(path, "const mismatch");
  if (schema.enum && !schema.enum.some(item => same(item, value)))
    throw new ContractViolation(path, "not in enum");
  if (schema.anyOf) {
    if (!schema.anyOf.some(rule => {
      try { check(rule, value, path); return true; } catch { return false; }
    })) throw new ContractViolation(path, "anyOf mismatch");
  }
  if (schema.oneOf) {
    let count = 0;
    for (const rule of schema.oneOf) {
      try { check(rule, value, path); count++; } catch { /* mismatch */ }
    }
    if (count !== 1) throw new ContractViolation(path, "oneOf mismatch");
  }
  for (const rule of schema.allOf || []) check(rule, value, path);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      throw new ContractViolation(path, "below minLength");
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      throw new ContractViolation(path, "above maxLength");
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      throw new ContractViolation(path, "pattern mismatch");
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      throw new ContractViolation(path, "below minimum");
    if (schema.maximum !== undefined && value > schema.maximum)
      throw new ContractViolation(path, "above maximum");
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      throw new ContractViolation(path, "below minItems");
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      throw new ContractViolation(path, "above maxItems");
    if (schema.items) value.forEach((v, i) =>
      check(schema.items, v, path + "[" + i + "]"));
  }
  if (objectLike(value)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key))
        throw new ContractViolation(path + "." + key, "missing required value");
    }
    for (const [key, v] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties || {}, key))
        check(schema.properties[key], v, path + "." + key);
      else if (schema.additionalProperties === false)
        throw new ContractViolation(path + "." + key, "unknown property");
      else if (objectLike(schema.additionalProperties))
        check(schema.additionalProperties, v, path + "." + key);
    }
  }
  return true;
}
export function validateAPIRequest(catalog, method, args) {
  const api = catalog.find(entry => entry.id === method);
  if (!api || api.implementation === "planned") {
    const error = new ContractViolation(method, "API not implemented", 404);
    error.code = "API_UNAVAILABLE";
    throw error;
  }
  const signature = api.signature.split(",").map(part => {
    const [raw, type] = part.split(":");
    return { key: raw.replace(/\?$/, ""), optional: raw.endsWith("?"),
      type };
  });
  const payload = {};
  for (let i = 0; i < signature.length; i++) {
    if (args[i] !== undefined) payload[signature[i].key] = args[i];
  }
  validateSchema(api.request, payload, method + ".req");
  return api;
}
export function validateAPIResponse(api, envelope) {
  validateSchema(api.response, envelope, api.id + ".rep");
  return true;
}
export function validateServiceContract(contract, payload, response = false) {
  const schema = response ? contract.response : contract.request;
  if (schema) validateSchema(schema, payload,
    (contract.id || contract.action) + (response ? ".rep" : ".req"));
  return true;
}
