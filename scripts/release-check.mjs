import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultDist = resolve(root, 'apps/extension/dist');
const allowedPermissions = ['sidePanel', 'storage'];
const allowedHosts = ['http://127.0.0.1/*', 'http://localhost/*'];
const allowedManifestKeys = new Set([
  'manifest_version',
  'name',
  'version',
  'description',
  'permissions',
  'host_permissions',
  'side_panel',
]);
const forbiddenNames = new Set(['.env', '.git', 'node_modules']);
const forbiddenExtensions = /\.(?:map|ts|tsx|jsx)$/i;
const forbiddenContent = [
  /OPENAI_API_KEY/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /sourceMappingURL=/,
];

const validChromeVersion = (value) => {
  const parts = typeof value === 'string' ? value.split('.') : [];
  return (
    parts.length >= 1 &&
    parts.length <= 4 &&
    parts.some((part) => part !== '0') &&
    parts.every(
      (part) =>
        /^(?:0|[1-9]\d*)$/.test(part) &&
        Number(part) >= 0 &&
        Number(part) <= 65_535,
    )
  );
};

const forbiddenPathPart = (part) =>
  forbiddenNames.has(part) || part.startsWith('.env.');

const filesUnder = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported release entry: ${path}`);
  }
  return files;
};

export async function validateReleaseTree(distDirectory = defaultDist) {
  const dist = resolve(distDirectory);
  const manifest = JSON.parse(
    await readFile(resolve(dist, 'manifest.json'), 'utf8'),
  );
  if (manifest.manifest_version !== 3) throw new Error('Manifest must be MV3');
  if (!validChromeVersion(manifest.version)) {
    throw new Error('Manifest must use a valid non-zero Chrome version');
  }
  if (
    JSON.stringify(manifest.permissions) !== JSON.stringify(allowedPermissions)
  ) {
    throw new Error('Unexpected extension permissions');
  }
  if (
    JSON.stringify(manifest.host_permissions) !== JSON.stringify(allowedHosts)
  ) {
    throw new Error('Unexpected extension host permissions');
  }
  const unexpectedManifestKey = Object.keys(manifest).find(
    (key) => !allowedManifestKeys.has(key),
  );
  if (unexpectedManifestKey) {
    throw new Error(`Unexpected manifest capability: ${unexpectedManifestKey}`);
  }

  const files = await filesUnder(dist);
  if (files.length === 0) throw new Error('Release tree is empty');
  for (const file of files) {
    const name = relative(dist, file).split(sep).join('/');
    if (
      name.split('/').some(forbiddenPathPart) ||
      forbiddenExtensions.test(name)
    ) {
      throw new Error(`Forbidden release file: ${name}`);
    }
    const content = await readFile(file);
    const text = content.toString('utf8');
    if (forbiddenContent.some((pattern) => pattern.test(text))) {
      throw new Error(`Sensitive or debug content in release file: ${name}`);
    }
  }
  return { version: manifest.version, files: files.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await validateReleaseTree(process.argv[2]);
  process.stdout.write(
    `Release tree OK: ${result.files} files, version ${result.version}\n`,
  );
}
