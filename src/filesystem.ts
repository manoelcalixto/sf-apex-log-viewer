import path from 'node:path';
import { promises as fs } from 'node:fs';
import { sanitizeFileNameSegment } from './state.js';

export async function ensureDirectory(dirPath: string): Promise<string> {
  const resolved = path.resolve(dirPath);
  await fs.mkdir(resolved, { recursive: true });
  return resolved;
}

export function buildLogFilePath(outputDir: string, username: string, logId: string): string {
  const safeUser = sanitizeFileNameSegment(username);
  return path.resolve(outputDir, `${safeUser}_${logId}.log`);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function writeTextFileAtomic(filePath: string, contents: string): Promise<void> {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });

  const tempPath = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, contents, 'utf8');
  await fs.rename(tempPath, resolved);
}
