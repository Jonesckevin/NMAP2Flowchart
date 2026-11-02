import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const DIST_URL = 'https://nodejs.org/dist';

const TARGETS = {
  'win32-x64': { dist: 'win', archive: 'zip', member: 'node.exe' },
  'win32-arm64': { dist: 'win', archive: 'zip', member: 'node.exe' },
  'linux-x64': { dist: 'linux', archive: 'tar.gz', member: 'bin/node' },
  'linux-arm64': { dist: 'linux', archive: 'tar.gz', member: 'bin/node' },
};

export function nodePlatformKey(platform, arch) {
  return `${platform}-${arch}`;
}

export function supportsTarget(platform, arch) {
  return nodePlatformKey(platform, arch) in TARGETS;
}

export function describeTargets() {
  return Object.keys(TARGETS);
}

function archiveName(version, platform, arch) {
  const target = TARGETS[nodePlatformKey(platform, arch)];
  return `node-v${version}-${target.dist}-${arch}.${target.archive}`;
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot download ${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  return bytes;
}

function tarEntryName(header) {
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
  return prefix ? `${prefix}/${name}` : name;
}

function tarEntrySize(header) {
  const raw = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
  return Number.parseInt(raw, 8) || 0;
}

function matchesMember(member) {
  const suffix = `/${member}`;
  return (name) => name === member || name.endsWith(suffix);
}

export function readTarMember(buffer, member) {
  const matches = matchesMember(member);
  let offset = 0;
  let pendingPath = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarEntryName(header);
    const size = tarEntrySize(header);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    const data = buffer.subarray(dataStart, dataStart + size);

    if (type === 'x' || type === 'g') {
      const record = data.toString('utf8').match(/\d+ path=([^\n]+)\n/);
      pendingPath = record ? record[1] : pendingPath;
    } else if (type === 'L') {
      pendingPath = data.toString('utf8').replace(/\0.*$/, '');
    } else {
      const effective = pendingPath ?? name;
      pendingPath = null;
      if ((type === '0' || type === '\0') && matches(effective)) return Buffer.from(data);
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Archive does not contain ${member}`);
}

export function readZipMember(buffer, member) {
  const minEocd = 22;
  let eocd = -1;
  for (let index = buffer.length - minEocd; index >= Math.max(0, buffer.length - 66_000); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive: end of central directory not found');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const matches = matchesMember(member);

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (!matches(name)) continue;

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Corrupt zip local header');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) return Buffer.from(payload);
    if (method === 8) return inflateRawSync(payload);
    throw new Error(`Unsupported zip compression method ${method} for ${name}`);
  }
  throw new Error(`Archive does not contain ${member}`);
}

export async function ensureNodeBinary({ version, platform, arch, cacheDir }) {
  const key = nodePlatformKey(platform, arch);
  const target = TARGETS[key];
  if (!target) throw new Error(`Unsupported Node.js target ${key}`);

  const executableName = target.member === 'node.exe' ? 'node.exe' : 'node';
  const executable = path.join(cacheDir, `node-v${version}-${key}`, executableName);
  if (fs.existsSync(executable)) return executable;

  const file = archiveName(version, platform, arch);
  const cachedArchive = path.join(cacheDir, file);
  const bytes = fs.existsSync(cachedArchive)
    ? fs.readFileSync(cachedArchive)
    : await download(`${DIST_URL}/v${version}/${file}`, cachedArchive);

  const contents =
    target.archive === 'zip' ? readZipMember(bytes, target.member) : readTarMember(gunzipSync(bytes), target.member);

  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, contents);
  if (process.platform !== 'win32') fs.chmodSync(executable, 0o755);
  return executable;
}
