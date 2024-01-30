import { DBSchema, IDBPDatabase, openDB } from 'idb';

type Checksum = string;
type RelativePath = string;

export interface File {
  path: RelativePath;
  checksum: Checksum;
  contents: string;
}

export interface FileSystem {
  readFile(path: RelativePath): Promise<File | undefined>;
  writeFile(path: RelativePath, file: File): Promise<void>;
}

export class InMemoryFileSystem implements FileSystem {
  private files: {
    [path in RelativePath]: File;
  } = {};

  async readFile(path: string): Promise<File | undefined> {
    return this.files[path];
  }

  async writeFile(path: string, value: File): Promise<void> {
    this.files[path] = value;
  }
}

interface ThemeDB extends DBSchema {
  theme: {
    key: File['path'];
    value: File;
  };
}

export async function createIndexedDbFileSystem(databaseName: string) {
  const db = await openDB<ThemeDB>(databaseName, 1, {
    upgrade(dbi) {
      dbi.createObjectStore('theme', {
        keyPath: 'path',
      });
    },
  });

  return new IndexedDbFileSystem(db);
}

// FS backed by IndexedDB
export class IndexedDbFileSystem implements FileSystem {
  constructor(private database: IDBPDatabase<ThemeDB>) {}

  async readFile(path: string) {
    return await this.database.get('theme', path);
  }

  async writeFile(_path: string, file: File) {
    await this.database.put('theme', file);
  }
}

// export class BackendFileSystem implements FileSystem {
//   readFile(path): Promise<File | null> {
//     return graphQl.query(...);
//   }
//
//   writeFile(path) {
//     return graphQul.query(...);
//   }
// }

export interface IntegrityManager {
  checksum(path: RelativePath): Promise<Checksum | null>;
}

export class MockIntegrityManager implements IntegrityManager {
  async checksum(_path: RelativePath) {
    return '1';
  }
}

export function createFile(path: RelativePath, contents: string, checksum = '1'): File {
  return {
    path,
    contents,
    checksum,
  };
}

// export class BackendIntegrityManager {
//   checksum(path) {
//     // with caching with timeout / good til date
//     return graphql.query(...);
//   }
// }
//

/**
 * The LayeredFileSystem is a multi-layer cache over different
 * implementations.
 *
 * It will try to retrieve items from the fastest filesystem first and
 * query the other layers if no items are found (or if the checksums don't
 * match).
 */
export class LayeredFileSystem implements FileSystem {
  constructor(
    /** Assumes fast to slow order (inMemory > IDB > Backend) */
    private fileSystems: FileSystem[],
    private integrityManager: IntegrityManager,
  ) {}

  async readFile(path: RelativePath): Promise<File | undefined> {
    const fsWithMissingData = [];
    const checksum = await this.integrityManager.checksum(path);

    for (const fs of this.fileSystems) {
      const result = await fs.readFile(path);
      if (result && result.checksum == checksum) {
        // propagate back to other layers
        await Promise.all(fsWithMissingData.map((fsW) => fsW.writeFile(path, result)));
        return result;
      } else {
        fsWithMissingData.push(fs);
      }
    }
  }

  async writeFile(path: RelativePath, file: File) {
    await Promise.all(this.fileSystems.map((fs) => fs.writeFile(path, file)));
  }
}
