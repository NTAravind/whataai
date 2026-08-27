export type SchemaFieldType =
  // Basic
  | "text"
  | "long_text"
  | "number"
  | "phone"
  | "email"
  // Date & Time
  | "date"
  | "time"
  | "date_range"
  | "date_time"
  | "duration"
  // Selection
  | "select"
  | "multi_select"
  | "checkbox"
  | "radio"
  // Booking
  | "resource"
  | "participants"
  | "guests";

export type SemanticRole =
  // Customer
  | "customer_name"
  | "customer_phone"
  | "customer_email"
  // Booking
  | "booking_date"
  | "booking_start"
  | "booking_end"
  | "booking_duration"
  // Resource
  | "resource"
  | "staff"
  | "room"
  // Capacity
  | "participants"
  | "guests"
  // Other
  | "notes"
  | "location"
  | "timezone"
  | "payment_amount"
  | "custom";

export interface SchemaFieldAIConfig {
  question?: string;
  confirmation?: string;
  extraction_hints?: string;
  examples?: string[];
  retry_prompt?: string;
  relative_date_support?: boolean;
  ambiguity_resolution?: string;
}

export interface SchemaFieldOption {
  label: string;
  value: string;
}

export interface SchemaField {
  id: string;
  label: string;
  type: SchemaFieldType;
  required: boolean;
  role: SemanticRole;
  placeholder?: string;
  options?: SchemaFieldOption[];
  ai?: SchemaFieldAIConfig;
  visible_if?: { field: string; equals: unknown } | null;
  required_if?: { field: string; equals: unknown } | null;
}

export interface ServiceSchemaPayload {
  fields: SchemaField[];
}

export const SUGGESTED_ROLES: { value: SemanticRole; label: string; category: string }[] = [
  { value: "customer_name", label: "Customer Name", category: "Customer" },
  { value: "customer_phone", label: "Customer Phone", category: "Customer" },
  { value: "customer_email", label: "Customer Email", category: "Customer" },
  { value: "booking_date", label: "Booking Date", category: "Booking" },
  { value: "booking_start", label: "Booking Start Time", category: "Booking" },
  { value: "booking_end", label: "Booking End Time", category: "Booking" },
  { value: "booking_duration", label: "Duration", category: "Booking" },
  { value: "resource", label: "Resource / Item", category: "Resource" },
  { value: "staff", label: "Staff / Provider", category: "Resource" },
  { value: "room", label: "Room / Space", category: "Resource" },
  { value: "participants", label: "Participants", category: "Capacity" },
  { value: "guests", label: "Number of Guests", category: "Capacity" },
  { value: "notes", label: "Notes / Special Requests", category: "Other" },
  { value: "location", label: "Location", category: "Other" },
  { value: "timezone", label: "Timezone", category: "Other" },
  { value: "payment_amount", label: "Payment Amount", category: "Other" },
  { value: "custom", label: "Custom Field", category: "Other" },
];

export const FIELD_TYPES_CONFIG: {
  type: SchemaFieldType;
  label: string;
  category: "Basic" | "Date & Time" | "Selection" | "Booking";
  defaultRole: SemanticRole;
  description: string;
}[] = [
  { type: "text", label: "Short Text", category: "Basic", defaultRole: "custom", description: "Single line text input" },
  { type: "long_text", label: "Long Text", category: "Basic", defaultRole: "notes", description: "Multi-line text area for notes or symptoms" },
  { type: "number", label: "Number", category: "Basic", defaultRole: "custom", description: "Numeric input" },
  { type: "phone", label: "Phone Number", category: "Basic", defaultRole: "customer_phone", description: "Phone number field" },
  { type: "email", label: "Email Address", category: "Basic", defaultRole: "customer_email", description: "Email address field" },

  { type: "date", label: "Date", category: "Date & Time", defaultRole: "booking_date", description: "Preferred booking date" },
  { type: "time", label: "Time", category: "Date & Time", defaultRole: "booking_start", description: "Preferred start time" },
  { type: "date_range", label: "Date Range", category: "Date & Time", defaultRole: "booking_date", description: "Check-in to Check-out date range" },
  { type: "date_time", label: "Date & Time", category: "Date & Time", defaultRole: "booking_start", description: "Combined date and time" },
  { type: "duration", label: "Duration", category: "Date & Time", defaultRole: "booking_duration", description: "Length of stay or session" },

  { type: "select", label: "Single Choice (Dropdown)", category: "Selection", defaultRole: "custom", description: "Select one option from a list" },
  { type: "multi_select", label: "Multi-Select", category: "Selection", defaultRole: "custom", description: "Select multiple options" },
  { type: "checkbox", label: "Checkbox", category: "Selection", defaultRole: "custom", description: "Yes/No toggle" },
  { type: "radio", label: "Radio Buttons", category: "Selection", defaultRole: "custom", description: "Select one option from visible choices" },

  { type: "resource", label: "Resource Selector", category: "Booking", defaultRole: "resource", description: "Select doctor, room, vehicle, or staff" },
  { type: "participants", label: "Participants Count", category: "Booking", defaultRole: "participants", description: "Number of attendees or participants" },
  { type: "guests", label: "Guests Count", category: "Booking", defaultRole: "guests", description: "Number of guests (for hotels, tables, etc.)" },
];
