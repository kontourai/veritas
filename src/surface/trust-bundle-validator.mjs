/**
 * Hachure trust-bundle schema validation.
 *
 * Uses the normative trust-bundle.schema.json shipped by the `hachure` package.
 * Sub-schemas (claim.schema.json, evidence.schema.json, etc.) are loaded from
 * the same package export and added to the Ajv instance so $ref resolution works
 * without HTTP access.
 */
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { schemas as hachureSchemas } from 'hachure';

function loadHachureSchemas() {
  const schemas = {};
  for (const [name, schema] of hachureSchemas.entries()) {
    schemas[`${name}.schema.json`] = schema;
  }
  return schemas;
}

let _validate = null;

function getValidator() {
  if (_validate) return _validate;

  const hachureSchemas = loadHachureSchemas();
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);

  // Add all sub-schemas so $ref can resolve locally
  for (const [filename, schema] of Object.entries(hachureSchemas)) {
    if (filename === 'trust-bundle.schema.json') continue;
    ajv.addSchema(schema, filename);
  }

  const trustBundleSchema = hachureSchemas['trust-bundle.schema.json'];
  if (!trustBundleSchema) throw new Error('hachure trust-bundle.schema.json not found');
  _validate = ajv.compile(trustBundleSchema);
  return _validate;
}

/**
 * @param {unknown} bundle
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTrustBundleSchema(bundle) {
  try {
    const validate = getValidator();
    const valid = validate(bundle);
    if (valid) return { valid: true, errors: [] };
    const errors = (validate.errors ?? []).map((err) => {
      const loc = err.instancePath || err.schemaPath || '';
      return `${loc} ${err.message ?? 'invalid'}`.trim();
    });
    return { valid: false, errors };
  } catch (err) {
    return { valid: false, errors: [`validator error: ${err?.message ?? String(err)}`] };
  }
}
