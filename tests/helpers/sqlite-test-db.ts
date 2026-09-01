import { DatabaseSync } from "node:sqlite";

export function openTestDatabase(path: string): DatabaseSync {
  return new DatabaseSync(path);
}

export function initializeTestDatabase(db: DatabaseSync, schema: string): void {
  db.exec(schema);
}

export function closeTestDatabase(db: DatabaseSync): void {
  db.close();
}
