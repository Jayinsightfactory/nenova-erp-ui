'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_RELEASES_DIR = '/var/lib/nenova/desktop-releases';
const ALLOWED_EXACT = new Set(['latest.yml', 'SHA256.txt']);
const ALLOWED_INSTALLER_RE = /^Nenova-Desktop-Setup-\d+\.\d+\.\d+-x64\.exe$/;
const ALLOWED_BLOCKMAP_RE = /^Nenova-Desktop-Setup-\d+\.\d+\.\d+-x64\.exe\.blockmap$/;
const MAX_INSTALLER_BYTES = 500 * 1024 ** 2;

function getReleasesDir() {
  return process.env.NENOVA_DESKTOP_RELEASES_DIR || DEFAULT_RELEASES_DIR;
}

function isAllowedReleaseFile(name) {
  if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    return false;
  }
  return ALLOWED_EXACT.has(name) || ALLOWED_INSTALLER_RE.test(name) || ALLOWED_BLOCKMAP_RE.test(name);
}

function contentTypeFor(name) {
  if (name === 'latest.yml') return 'text/yaml; charset=utf-8';
  if (name === 'SHA256.txt') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function cacheControlFor(name) {
  if (name === 'latest.yml' || name === 'SHA256.txt') return 'no-cache, no-store, must-revalidate';
  return 'public, max-age=31536000, immutable';
}

function resolveReleaseFilePath(rootDir, name) {
  if (!isAllowedReleaseFile(name)) return null;
  const resolvedRoot = path.resolve(rootDir);
  const full = path.resolve(resolvedRoot, name);
  if (path.dirname(full) !== resolvedRoot) return null;
  return full;
}

function stripYamlQuotes(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.length >= 2 && ((trimmed[0] === "'" && trimmed.at(-1) === "'") || (trimmed[0] === '"' && trimmed.at(-1) === '"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseLatestYml(yamlText) {
  if (typeof yamlText !== 'string' || !yamlText.trim()) return null;
  const versionMatch = yamlText.match(/^version:\s*(.+)$/m);
  const urlMatch = yamlText.match(/^\s*-\s*url:\s*(.+)$/m) || yamlText.match(/^path:\s*(.+)$/m);
  const shaMatch = yamlText.match(/^\s*sha512:\s*(.+)$/m);
  const sizeMatch = yamlText.match(/^\s*size:\s*(\d+)\s*$/m);
  if (!versionMatch || !urlMatch || !shaMatch || !sizeMatch) return null;

  const version = stripYamlQuotes(versionMatch[1]);
  const url = stripYamlQuotes(urlMatch[1]);
  const sha512 = stripYamlQuotes(shaMatch[1]);
  const size = Number(sizeMatch[1]);

  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  if (url !== `Nenova-Desktop-Setup-${version}-x64.exe`) return null;
  if (!/^[A-Za-z0-9+/]{86}==$/.test(sha512)) return null;
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_INSTALLER_BYTES) return null;

  return { version, url, sha512, size };
}

function verifyReleaseStage(stageDir) {
  const latestPath = path.join(stageDir, 'latest.yml');
  if (!fs.existsSync(latestPath)) throw new Error('latest.yml is missing in stage directory');
  const parsed = parseLatestYml(fs.readFileSync(latestPath, 'utf8'));
  if (!parsed) throw new Error('latest.yml failed strict metadata validation');

  const exePath = path.join(stageDir, parsed.url);
  if (!fs.existsSync(exePath)) throw new Error(`Installer file missing: ${parsed.url}`);
  const stat = fs.statSync(exePath);
  if (!stat.isFile() || stat.size !== parsed.size) {
    throw new Error(`Installer size mismatch: expected ${parsed.size}, got ${stat.size}`);
  }
  const actualSha512 = crypto.createHash('sha512').update(fs.readFileSync(exePath)).digest('base64');
  if (actualSha512 !== parsed.sha512) {
    throw new Error(`Installer sha512 mismatch for ${parsed.url}`);
  }
  return parsed;
}

module.exports = {
  DEFAULT_RELEASES_DIR,
  ALLOWED_INSTALLER_RE,
  ALLOWED_BLOCKMAP_RE,
  getReleasesDir,
  isAllowedReleaseFile,
  contentTypeFor,
  cacheControlFor,
  resolveReleaseFilePath,
  parseLatestYml,
  verifyReleaseStage,
};
