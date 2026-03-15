export type EmailTemplate =
  | "confirm_account"
  | "welcome_user"
  | "producer_activation"
  | "purchase_receipt"
  | "license_ready"
  | "battle_won"
  | "comment_received"
  | "contact_reply";

export const UNIQUE_EMAIL_TEMPLATES = new Set<EmailTemplate>([
  "confirm_account",
  "welcome_user",
  "producer_activation",
]);

export const REPEATABLE_EMAIL_TEMPLATES = new Set<EmailTemplate>([
  "purchase_receipt",
  "license_ready",
  "battle_won",
  "comment_received",
  "contact_reply",
]);

export const ALL_EMAIL_TEMPLATES = new Set<EmailTemplate>([
  ...UNIQUE_EMAIL_TEMPLATES,
  ...REPEATABLE_EMAIL_TEMPLATES,
]);

export const isEmailTemplate = (value: unknown): value is EmailTemplate =>
  typeof value === "string" && ALL_EMAIL_TEMPLATES.has(value as EmailTemplate);

export const isUniqueEmailTemplate = (template: EmailTemplate) =>
  UNIQUE_EMAIL_TEMPLATES.has(template);
