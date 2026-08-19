import { rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const packagePath = new URL('../package.json', import.meta.url);
const backupPath = new URL('../.package-json.prepack-backup', import.meta.url);

if (existsSync(backupPath)) {
	await rename(backupPath, packagePath);
}
