/**
 * Validation of Veritas config artifacts against the JSON Schemas this package ships.
 *
 * Modelled on src/surface/trust-bundle-validator.mjs: every sibling schema is registered
 * so cross-file `$ref`s resolve without network access, `addFormats` is installed, the
 * compiled instance is cached *only* after a fully successful build, and the catch path
 * returns `{ valid: false }` rather than a permissive fallback. An unexercised cross-file
 * `$ref` is exactly the failure mode where a validator silently resolves to nothing and
 * every subsequent "validation" is a no-op.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const SCHEMAS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../schemas');

export const REPO_MAP_SCHEMA = 'veritas-repo-map.schema.json';
export const REPO_STANDARDS_SCHEMA = 'veritas-repo-standards.schema.json';

export function listShippedSchemaFiles() {
  return readdirSync(SCHEMAS_DIR)
    .filter((file) => file.endsWith('.schema.json'))
    .sort();
}

let cachedAjv = null;

/**
 * Builds an Ajv instance with every shipped schema registered under its filename.
 * Absolute `$id`s stay registered too, so both `./veritas-graph.schema.json` style
 * relative refs and `$id`-absolute refs resolve locally.
 */
function getAjv() {
  if (cachedAjv) return cachedAjv;
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const file of listShippedSchemaFiles()) {
    const schema = JSON.parse(readFileSync(resolve(SCHEMAS_DIR, file), 'utf8'));
    ajv.addSchema(schema, file);
  }
  cachedAjv = ajv;
  return cachedAjv;
}

const cachedValidators = new Map();

export function getSchemaValidator(schemaFile) {
  const cached = cachedValidators.get(schemaFile);
  if (cached) return cached;
  const validate = getAjv().getSchema(schemaFile);
  if (!validate) {
    throw new Error(`Veritas does not ship a schema named ${schemaFile}`);
  }
  cachedValidators.set(schemaFile, validate);
  return validate;
}

function formatAjvError(error) {
  const location = error.instancePath || '/';
  const detail = error.message ?? 'is invalid';
  if (error.keyword === 'additionalProperties' && error.params?.additionalProperty) {
    return `${location}: ${detail} (${error.params.additionalProperty})`;
  }
  if (error.keyword === 'required' && error.params?.missingProperty) {
    return `${location}: ${detail}`;
  }
  return `${location}: ${detail}`;
}

/**
 * @returns {{ valid: boolean, errors: string[], schema: string }}
 */
export function validateAgainstSchema(schemaFile, data) {
  try {
    const validate = getSchemaValidator(schemaFile);
    if (validate(data)) return { valid: true, errors: [], schema: schemaFile };
    return {
      valid: false,
      errors: (validate.errors ?? []).map(formatAjvError),
      schema: schemaFile,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [`validator error: ${error?.message ?? String(error)}`],
      schema: schemaFile,
    };
  }
}

export function validateRepoMap(data) {
  return validateAgainstSchema(REPO_MAP_SCHEMA, data);
}

export function validateRepoStandards(data) {
  return validateAgainstSchema(REPO_STANDARDS_SCHEMA, data);
}
