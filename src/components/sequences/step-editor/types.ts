// ── Content schemas per channel ──────────────────────────────────────────────

export interface SmsContent {
  body: string;
}

export interface EmailContent {
  subject: string;
  body_html: string;
  body_text: string;
}

export interface VoiceContent {
  first_message: string;
  system_prompt: string;
  vapi_assistant_id?: string;
}

// ── Channel type ─────────────────────────────────────────────────────────────
// Only the channels the sequencer runtime actually dispatches. 'wait' and
// 'condition' were authored here but never read by the scheduler, so they are
// no longer offered.

export type ChannelType = "sms" | "email" | "voice";

// ── Existing step (mirrors DB row) ───────────────────────────────────────────

export interface ExistingStep {
  id: string;
  step_order: number;
  channel: string;
  delay_minutes: number;
  content: any;
  skip_conditions: any;
  enable_ai_mutation?: boolean;
  mutation_instructions?: string | null;
}

// ── Step editor props ────────────────────────────────────────────────────────

export interface StepEditorProps {
  sequenceId: string;
  existingStep?: ExistingStep | null;
  onClose: () => void;
  onSaved: () => void;
}

// ── Skip condition options ───────────────────────────────────────────────────

export type SkipConditionKey =
  | "contact_replied"
  | "contact_answered_call"
  | "appointment_booked";

export const SKIP_CONDITION_OPTIONS: { key: SkipConditionKey; label: string }[] = [
  { key: "contact_replied", label: "Contact replied" },
  { key: "contact_answered_call", label: "Contact answered call" },
  { key: "appointment_booked", label: "Appointment booked" },
];

// ── Template variables ───────────────────────────────────────────────────────

export const TEMPLATE_VARIABLES: { key: string; label: string }[] = [
  { key: "customer_name", label: "Customer Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "business_name", label: "Business Name" },
  { key: "property_address", label: "Property Address" },
];

// ── Serialize content to JSON string ─────────────────────────────────────────

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export function serializeContent(
  channel: ChannelType,
  content: SmsContent | EmailContent | VoiceContent
): string {
  if (channel === "email") {
    const emailContent = content as EmailContent;
    return JSON.stringify({
      subject: emailContent.subject,
      body_html: emailContent.body_html,
      body_text: stripHtmlTags(emailContent.body_html),
    });
  }

  return JSON.stringify(content);
}

// ── Deserialize raw DB content to typed content with safe defaults ───────────

export function deserializeContent(
  channel: ChannelType,
  rawContent: any
): SmsContent | EmailContent | VoiceContent {
  const parsed =
    typeof rawContent === "string"
      ? (() => {
          try {
            return JSON.parse(rawContent);
          } catch {
            return {};
          }
        })()
      : rawContent ?? {};

  switch (channel) {
    case "sms":
      return {
        body: parsed.body ?? "",
      } as SmsContent;

    case "email":
      return {
        subject: parsed.subject ?? "",
        body_html: parsed.body_html ?? "",
        body_text: parsed.body_text ?? "",
      } as EmailContent;

    case "voice":
      return {
        first_message: parsed.first_message ?? "",
        system_prompt: parsed.system_prompt ?? "",
        ...(parsed.vapi_assistant_id
          ? { vapi_assistant_id: parsed.vapi_assistant_id }
          : {}),
      } as VoiceContent;

    default:
      return { body: "" } as SmsContent;
  }
}
