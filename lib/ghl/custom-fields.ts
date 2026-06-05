/**
 * lib/ghl/custom-fields.ts
 *
 * Fetches GHL custom field definitions and caches them in-memory.
 * Maps field IDs to human-readable names + folder groupings.
 */
import { ghl, locationId } from "@/lib/ghl/client";

export interface CustomFieldDef {
  id: string;
  name: string;
  fieldKey: string;
  dataType: string;
  placeholder?: string;
  /** The folder/group this field belongs to (e.g. "Form | Email Ads") */
  folder?: string;
}

interface CustomFieldsResponse {
  customFields: Array<{
    id: string;
    name: string;
    fieldKey: string;
    dataType: string;
    placeholder?: string;
    parentId?: string;
  }>;
}

interface CustomFieldFoldersResponse {
  customFields: Array<{
    id: string;
    name: string;
    fieldKey?: string;
    dataType?: string;
  }>;
}

// Module-level cache
let _fieldMap: Map<string, CustomFieldDef> | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Returns a Map of fieldId → CustomFieldDef with human-readable names.
 * Cached for 10 minutes per process.
 */
export async function getCustomFieldMap(): Promise<Map<string, CustomFieldDef>> {
  const now = Date.now();
  if (_fieldMap && now - _cachedAt < CACHE_TTL_MS) return _fieldMap;

  const loc = locationId();

  // Fetch all custom fields — GHL returns them in a flat list
  const data = await ghl.get<CustomFieldsResponse>(
    `/locations/${loc}/customFields`
  );

  const fields = data.customFields ?? [];
  const map = new Map<string, CustomFieldDef>();

  // Build a parentId→folderName lookup by fetching folders
  // GHL custom field folders are returned via the same endpoint — items with no fieldKey are folders
  let folderMap: Map<string, string> | undefined;
  try {
    const foldersData = await ghl.get<CustomFieldFoldersResponse>(
      `/locations/${loc}/customFields/folders`
    );
    folderMap = new Map<string, string>();
    for (const f of foldersData.customFields ?? []) {
      folderMap.set(f.id, f.name);
    }
  } catch {
    // Folders endpoint may not exist — fall back to no folders
  }

  for (const f of fields) {
    map.set(f.id, {
      id: f.id,
      name: f.name,
      fieldKey: f.fieldKey,
      dataType: f.dataType,
      placeholder: f.placeholder,
      folder: f.parentId && folderMap ? folderMap.get(f.parentId) : undefined,
    });
  }

  _fieldMap = map;
  _cachedAt = Date.now();
  return map;
}

export function invalidateCustomFieldCache(): void {
  _fieldMap = null;
  _cachedAt = 0;
}
