/**
 * GoHighLevel (GHL) API client — stub for future integration.
 * Website traffic leads come through GHL (set up by Geoey).
 *
 * Environment variables (add to .env.local):
 *   GHL_API_KEY=your-api-key
 *   GHL_LOCATION_ID=your-location-id
 */

import type { GHLContact } from "./types";

const API_KEY = process.env.GHL_API_KEY ?? "";
const LOCATION_ID = process.env.GHL_LOCATION_ID ?? "";

// TODO: Implement when GHL API credentials are available
export async function fetchContacts(): Promise<GHLContact[]> {
  void API_KEY;
  void LOCATION_ID;
  console.warn("[GHL] fetchContacts is a stub — not yet implemented");
  return [];
}

export async function fetchContact(_contactId: string): Promise<GHLContact | null> {
  console.warn("[GHL] fetchContact is a stub — not yet implemented");
  return null;
}
