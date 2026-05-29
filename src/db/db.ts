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
  title: string;
  content: string; // JSON string representation of block contents or text
  paths: DrawingPath[];
  pinned: number; // 0 for false, 1 for true (IndexedDB works well indexing numbers)
  lastModified: number;
  locked?: number; // 0 for unlocked, 1 for locked
}

export interface PasswordRecord {
  uuid: string; // Used for cloud matching and merging
  encryptedData: string; // AES-GCM encrypted JSON string
  lastModified: number;
}

export interface CreditCardRecord {
  uuid: string; // Used for cloud matching and merging
  encryptedData: string; // AES-GCM encrypted JSON string
  lastModified: number;
}

export interface FolderRecord {
  id?: number;
  parentId?: number; // undefined for root
  name: string;
  lastModified: number;
}

export interface FileRecord {
  id?: number;
  folderId?: number; // undefined for root
  displayName: string;
  mimeType: string;
  blob: Blob; // Binary Blob stored natively in IndexedDB
  lastModified: number;
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
    this.version(1).stores({
      notes: '++id, title, pinned, lastModified',
      passwords: 'uuid, lastModified',
      creditCards: 'uuid, lastModified',
      localFiles: '++id, displayName, lastModified',
      settings: 'key'
    });

    this.version(2).stores({
      localFiles: '++id, displayName, folderId, lastModified',
      localFolders: '++id, parentId, name, lastModified'
    });
  }
}

export const db = new OneDatabase();
