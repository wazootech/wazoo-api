export type Row = Record<string, unknown>;

export function id(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export async function all<T extends Row>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export async function first<T extends Row>(statement: D1PreparedStatement): Promise<T | null> {
  return statement.first<T>();
}

export type OrganizationRef = {
  id: string;
  slug: string;
  name: string;
  state: string;
};

export async function organizationByIdentifier(db: D1Database, identifier: string): Promise<OrganizationRef | null> {
  return first<OrganizationRef>(
    db.prepare("SELECT id, slug, name, state FROM organizations WHERE slug = ?").bind(identifier),
  );
}
