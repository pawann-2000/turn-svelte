import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const packagePath = new URL('../package.json', import.meta.url);
const backupPath = new URL('../.package-json.prepack-backup', import.meta.url);

if (existsSync(backupPath)) {
	throw new Error('Refusing to overwrite existing package.json prepack backup.');
}

const source = await readFile(packagePath, 'utf8');
const manifest = JSON.parse(source);

await copyFile(packagePath, backupPath);

delete manifest.devDependencies;
delete manifest.scripts;
delete manifest.publishConfig;

await writeFile(packagePath, `${JSON.stringify(manifest, null, '\t')}\n`);
