import { AbsolutePath, RootRelativePath } from '@shopify/liquid-html-parser/src/types';
import path from 'node:path';
import { promisify } from 'node:util';
import glob = require('glob');

export const asyncGlob = promisify(glob);

export function posixPath(inputPath: RootRelativePath) {
  return path.posix.normalize(inputPath.split(path.sep).join(path.posix.sep));
}

export function isInDirectory(filePath: RootRelativePath, directory: RootRelativePath) {
  return filePath.startsWith(directory);
}

export async function getFiles(root: AbsolutePath): Promise<RootRelativePath[]> {
  // On windows machines - the separator provided by path.join is '\'
  // however the glob function fails silently since '\' is used to escape glob charater
  // as mentioned in the documentation of node-glob
  // the path is normalised and '\' are replaced with '/' and then passed to the glob function
  const normalizedGlob = path.normalize(path.join(root, '**/*.{liquid,json}')).replace(/\\/g, '/');
  const absolutePaths = await asyncGlob(normalizedGlob, {
    ignore: ['node_modules/**/*'],
  });
  return absolutePaths.map((p) => path.relative(root, p)).map(posixPath);
}
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}
export function assertNever(module: never) {
  throw new Error(`Unknown module type ${module}`);
}
export function isTemplateFile(relativePath: string) {
  return isInDirectory(relativePath, 'templates');
}
