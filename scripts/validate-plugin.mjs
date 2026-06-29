#!/usr/bin/env node
/**
 * validate-plugin.mjs
 *
 * Validates .cursor-plugin/plugin.json against schemas/plugin.schema.json.
 * Checks manifest shape, kebab-case name, URI fields, and that referenced paths exist.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, '.cursor-plugin', 'plugin.json');
const SCHEMA_PATH = join(ROOT, 'schemas', 'plugin.schema.json');

const NAME_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const URI_PATTERN = /^https?:\/\/.+/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_KEYS = new Set([
  'name',
  'displayName',
  'description',
  'version',
  'author',
  'publisher',
  'homepage',
  'repository',
  'license',
  'logo',
  'keywords',
  'category',
  'tags',
  'commands',
  'agents',
  'skills',
  'rules',
  'hooks',
  'mcpServers',
]);

/** @param {string[]} failures */
export async function validatePluginManifest(failures, { root = ROOT } = {}) {
  const manifestPath = join(root, '.cursor-plugin', 'plugin.json');
  const schemaPath = join(root, 'schemas', 'plugin.schema.json');

  let manifestRaw;
  try {
    manifestRaw = await readFile(manifestPath, 'utf8');
  } catch {
    failures.push(`Missing plugin manifest: ${manifestPath}`);
    return;
  }

  let schemaRaw;
  try {
    schemaRaw = await readFile(schemaPath, 'utf8');
  } catch {
    failures.push(`Missing plugin schema: ${schemaPath}`);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (err) {
    failures.push(`Invalid JSON in plugin manifest: ${err.message}`);
    return;
  }

  try {
    JSON.parse(schemaRaw);
  } catch (err) {
    failures.push(`Invalid JSON in plugin schema: ${err.message}`);
    return;
  }

  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    failures.push('Plugin manifest must be a JSON object.');
    return;
  }

  for (const key of Object.keys(manifest)) {
    if (!ALLOWED_KEYS.has(key)) {
      failures.push(`Unknown plugin manifest field "${key}" (schema allows only known keys).`);
    }
  }

  if (!manifest.name || typeof manifest.name !== 'string') {
    failures.push('Plugin manifest requires non-empty string field "name".');
  } else if (!NAME_PATTERN.test(manifest.name)) {
    failures.push(
      `Plugin manifest "name" must be kebab-case (${NAME_PATTERN}): got "${manifest.name}".`,
    );
  }

  if (manifest.displayName !== undefined && typeof manifest.displayName !== 'string') {
    failures.push('Plugin manifest "displayName" must be a string.');
  }

  if (manifest.description !== undefined && typeof manifest.description !== 'string') {
    failures.push('Plugin manifest "description" must be a string.');
  }

  if (manifest.version !== undefined && typeof manifest.version !== 'string') {
    failures.push('Plugin manifest "version" must be a string.');
  }

  if (manifest.author !== undefined) {
    if (typeof manifest.author !== 'object' || manifest.author === null || Array.isArray(manifest.author)) {
      failures.push('Plugin manifest "author" must be an object.');
    } else {
      if (!manifest.author.name || typeof manifest.author.name !== 'string') {
        failures.push('Plugin manifest "author.name" is required and must be a string.');
      }
      if (
        manifest.author.email !== undefined &&
        (typeof manifest.author.email !== 'string' || !EMAIL_PATTERN.test(manifest.author.email))
      ) {
        failures.push('Plugin manifest "author.email" must be a valid email address.');
      }
      if (Object.keys(manifest.author).some((k) => !['name', 'email'].includes(k))) {
        failures.push('Plugin manifest "author" allows only "name" and "email".');
      }
    }
  }

  for (const uriField of ['homepage', 'repository']) {
    const value = manifest[uriField];
    if (value !== undefined) {
      if (typeof value !== 'string' || !URI_PATTERN.test(value)) {
        failures.push(`Plugin manifest "${uriField}" must be an http(s) URL.`);
      }
    }
  }

  for (const arrayField of ['keywords', 'tags']) {
    const value = manifest[arrayField];
    if (value !== undefined) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        failures.push(`Plugin manifest "${arrayField}" must be an array of strings.`);
      }
    }
  }

  for (const pathField of ['skills', 'rules', 'agents', 'commands']) {
    const value = manifest[pathField];
    if (value === undefined) continue;
    const paths = Array.isArray(value) ? value : [value];
    if (paths.some((p) => typeof p !== 'string')) {
      failures.push(`Plugin manifest "${pathField}" must be a string or array of strings.`);
      continue;
    }
    for (const rel of paths) {
      if (isAbsolute(rel) || rel.includes('..')) {
        failures.push(`Plugin manifest "${pathField}" path must be relative without "..": ${rel}`);
        continue;
      }
      const target = join(root, rel.replace(/^\.\//, ''));
      try {
        await stat(target);
      } catch {
        failures.push(`Plugin manifest "${pathField}" path does not exist: ${rel}`);
      }
    }
  }

  if (manifest.logo !== undefined) {
    if (typeof manifest.logo !== 'string') {
      failures.push('Plugin manifest "logo" must be a string.');
    } else if (!URI_PATTERN.test(manifest.logo)) {
      const logoPath = join(root, manifest.logo);
      try {
        await stat(logoPath);
      } catch {
        failures.push(`Plugin manifest "logo" file not found: ${manifest.logo}`);
      }
    }
  }
}

async function main() {
  const failures = [];
  await validatePluginManifest(failures);

  if (failures.length > 0) {
    console.error(`\nPlugin validation failed with ${failures.length} issue(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log('Plugin validation passed.');
  process.exit(0);
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((err) => {
    console.error('Undetermined failure during plugin validation:', err?.message ?? err);
    process.exit(1);
  });
}
