import { getAccessToken } from "./sheets-auth";

interface AllowlistCache {
  emails: Set<string>;
  expiresAt: number;
}

let cache: AllowlistCache | null = null;
const TTL_MS = 60_000;
const DEFAULT_SHEET_ID = "1LPzBKy8ZPSUgh4V44PeXYM1p2o7L4d_ceFE__CIPr6o";

async function fetchAllowlist(
  serviceAccountKey: string,
  sheetId: string,
): Promise<Set<string>> {
  const token = await getAccessToken(serviceAccountKey);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/'Form Responses 1'!B2:E`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Google Sheets API error: ${res.status}`);
  }

  const { values = [] } = (await res.json()) as { values?: string[][] };
  const emails = new Set<string>();

  for (const row of values) {
    const email = row[0]?.trim().toLowerCase();
    const approved = row[3]?.trim().toUpperCase();
    if (email && approved === "TRUE") {
      emails.add(email);
    }
  }

  return emails;
}

export async function getApprovedEmails(
  serviceAccountKey: string,
  sheetId?: string,
): Promise<Set<string>> {
  const targetSheetId = sheetId || DEFAULT_SHEET_ID;

  if (!serviceAccountKey) {
    return new Set(["ethan.r.davidson@gmail.com"]);
  }

  if (cache && cache.expiresAt > Date.now()) {
    return cache.emails;
  }

  try {
    const emails = await fetchAllowlist(serviceAccountKey, targetSheetId);
    cache = { emails, expiresAt: Date.now() + TTL_MS };
    return emails;
  } catch {
    if (cache) return cache.emails;
    return new Set(["ethan.r.davidson@gmail.com"]);
  }
}

export function clearAllowlistCache(): void {
  cache = null;
}
