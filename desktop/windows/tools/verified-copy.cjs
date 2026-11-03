const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');

async function fingerprint(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('ARCHIVE_COPY_FILE_INVALID');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1024 * 1024 })) hash.update(chunk);
  return { bytes: stat.size, sha256: hash.digest('hex') };
}
async function assertCopy(expected, target) {
  const actual = await fingerprint(target);
  if (actual.bytes !== expected.bytes) throw Error('ARCHIVE_COPY_INCOMPLETE');
  if (actual.sha256 !== expected.sha256) throw Error('ARCHIVE_COPY_HASH_MISMATCH');
  return actual;
}
async function copyVerifiedFile(source, target) {
  const expected = await fingerprint(source);
  if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) throw Error('ARCHIVE_COPY_FILE_INVALID');
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error('ARCHIVE_COPY_FILE_INVALID');
  // Some mounted filesystems truncate a large file on rename. Stream and flush
  // the final path, then compare it to the complete temporary archive.
  await pipeline(fs.createReadStream(source), fs.createWriteStream(target, { flags: 'w', mode: 0o600, flush: true }));
  return assertCopy(expected, target);
}
module.exports = { fingerprint, assertCopy, copyVerifiedFile };
