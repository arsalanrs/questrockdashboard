/** GoHighLevel (GHL) integration types — stub for future implementation. */

export type GHLContact = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  tags: string[];
  createdAt: string;
  customFields: Record<string, string>;
};

export type GHLWebhookPayload = {
  type: "ContactCreate" | "ContactUpdate" | "ContactDelete";
  locationId: string;
  contact: GHLContact;
};
