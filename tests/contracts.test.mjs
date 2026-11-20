import test from "node:test";
import assert from "node:assert/strict";
import { validateSchema, validateAPIRequest, validateAPIResponse,
  validateServiceContract } from "../src/core/contract-validator.js";
import { API_CATALOG } from "../src/core/api-catalog.js";
test("schema: deeply typed request and response with meaningful paths", () => {
  const schema = { type: "object", required: ["id", "values"],
    additionalProperties: false,
    properties: { id: { type: "string", minLength: 2 },
      values: { type: "array", items: { type: "integer", minimum: 0 } } } };
  assert.equal(validateSchema(schema, { id:"abc", values:[1,2] }), true);
  assert.throws(() => validateSchema(schema, { id:"abc", values:[-1] }),
    error => error.code === "CONTRACT_VALIDATION_FAILED" &&
      error.location.path === "$.values[0]");
  assert.throws(() => validateSchema(schema, { id:"abc", values:[], extra:1 }));
});
test("API contract gates required arguments and response envelopes", () => {
  const api = validateAPIRequest(API_CATALOG, "PRMU.get", ["properties", "system.language"]);
  assert.equal(api.id, "PRMU.get");
  assert.throws(() => validateAPIRequest(API_CATALOG, "PRMU.get", []));
  assert.throws(() => validateAPIRequest(API_CATALOG, "PRMU.get", [1, "item"]));
  assert.throws(() => validateAPIRequest(API_CATALOG, "PRMU.get", ["a","b",null,5]));
  assert.equal(validateAPIResponse(api, { ok:true,status:200,data:5,error:null }), true);
  assert.throws(() => validateAPIResponse(api, { ok:"yes",status:200 }));
});
test("service payload and handler response are checked separately", () => {
  const contract = { id:"demo.echo", request: { type:"object",
    required:["text"],properties:{text:{type:"string"}} },
    response: { type:"object",required:["echoed"],
      properties:{echoed:{type:"string"}} } };
  assert.equal(validateServiceContract(contract, {text:"hello"}), true);
  assert.throws(() => validateServiceContract(contract, {text:10}));
  assert.throws(() => validateServiceContract(contract, {echoed:5}, true));
});
