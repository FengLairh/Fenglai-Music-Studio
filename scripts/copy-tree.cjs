// Explicit traversal avoids a native fs.cpSync crash on this Windows/Node build.
const fs = require('node:fs');
const path = require('node:path');
function copyTree(source, target, filter = () => true, {skipLinks = false} = {}) {
  if (!filter(source)) return;
  fs.mkdirSync(target, {recursive: true});
  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (!filter(from)) continue;
    if (entry.isSymbolicLink() && skipLinks) continue;
    if (entry.isDirectory()) copyTree(from, to, filter, {skipLinks});
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else throw new Error(`Unexpected link or special file in package input: ${from}`);
  }
}
module.exports = {copyTree};
