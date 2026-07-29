import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist']);
const files = [];

async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
            continue;
        }
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            await walk(path);
        } else if (extname(entry.name) === '.js' || extname(entry.name) === '.mjs') {
            files.push(path);
        }
    }
}

await walk(root);

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
        encoding: 'utf8',
    });
    if (result.status !== 0) {
        process.stderr.write(result.stderr);
        process.exit(result.status ?? 1);
    }
}

const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
for (const key of ['display_name', 'loading_order', 'js', 'version', 'generate_interceptor']) {
    if (manifest[key] === undefined || manifest[key] === '') {
        throw new Error(`manifest.json is missing required field: ${key}`);
    }
}

console.log(`Checked ${files.length} JavaScript files and manifest.json.`);
