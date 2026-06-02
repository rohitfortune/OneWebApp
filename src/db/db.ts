import Dexie, { type Table } from 'dexie';

// Define Types for our Records
export interface Point {
  x: number;
  y: number;
}

export interface DrawingPath {
  points: Point[];
  colorArgb: number;
  widthDp: number;
}

export interface NoteRecord {
  id?: number;
  uuid: string;
  title: string;
  content: string; // JSON string representation of block contents or text
  paths: DrawingPath[];
  pinned: number; // 0 for false, 1 for true (IndexedDB works well indexing numbers)
  lastModified: number;
  locked?: number; // 0 for unlocked, 1 for locked
  deleted?: number; // 1 for true
}

export interface PasswordRecord {
  uuid: string; // Used for cloud matching and merging
  encryptedData: string; // AES-GCM encrypted JSON string
  lastModified: number;
  deleted?: number;
}

export interface CreditCardRecord {
  uuid: string; // Used for cloud matching and merging
  encryptedData: string; // AES-GCM encrypted JSON string
  lastModified: number;
  deleted?: number;
}

export interface FolderRecord {
  id?: number;
  uuid: string;
  parentId?: number; // undefined for root
  name: string;
  lastModified: number;
  deleted?: number;
}

export interface FileRecord {
  id?: number;
  uuid: string;
  folderId?: number; // undefined for root
  displayName: string;
  mimeType: string;
  blob: Blob; // Binary Blob stored natively in IndexedDB
  lastModified: number;
  deleted?: number;
}

export interface SettingRecord {
  key: string;
  value: string;
}

export class OneDatabase extends Dexie {
  notes!: Table<NoteRecord>;
  passwords!: Table<PasswordRecord>;
  creditCards!: Table<CreditCardRecord>;
  localFiles!: Table<FileRecord>;
  localFolders!: Table<FolderRecord>;
  settings!: Table<SettingRecord>;

  constructor() {
    super('OneDatabase');
    
    // Define schema versions and indexes
    this.version(4).stores({
      notes: '++id, uuid, lastModified',
      passwords: 'uuid',
      creditCards: 'uuid',
      settings: 'key',
      localFiles: '++id, uuid, folderId',
      localFolders: '++id, uuid, parentId'
    });
  }
}

export const db = new OneDatabase();

export const triggerGlobalSync = () => {
  window.dispatchEvent(new CustomEvent('one-vault-updated'));
};

['creating', 'updating', 'deleting'].forEach((hookName) => {
  db.notes.hook(hookName as any, triggerGlobalSync);
  db.passwords.hook(hookName as any, triggerGlobalSync);
  db.creditCards.hook(hookName as any, triggerGlobalSync);
  db.localFiles.hook(hookName as any, triggerGlobalSync);
  db.localFolders.hook(hookName as any, triggerGlobalSync);
});
