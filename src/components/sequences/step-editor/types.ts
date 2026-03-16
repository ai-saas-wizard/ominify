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

export interface WaitContent {
  reason: string;
}

export interface ConditionContent {
  check: string;
  true_step: number;
  false_step: number;
}

// ── Channel type ─────────────────────────────────────────────────────────────

export type ChannelType = "sms" | "email" | "voice" | "wait" | "condition";

// ── Existing step (mirrors DB row) ───────────────────────────────────────────

export interface ExistingStep {
  id: string;
  step_order: number;
  channel: string;
  delay_minutes: number;
  delay_type: string;
  content: any;
  skip_conditions: any;
  on_success: any;
  on_failure: any;
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

// ── Channel options ──────────────────────────────────────────────────────────

export const CHANNEL_OPTIONS: { value: ChannelType; label: string }[] = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "voice", label: "Voice Call" },
  { value: "wait", label: "Wait / Delay" },
  { value: "condition", label: "Condition" },
];

// ── Delay type options ───────────────────────────────────────────────────────

export const DELAY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
];

// ── On-success options ───────────────────────────────────────────────────────

export const ON_SUCCESS_OPTIONS: { value: string; label: string }[] = [
  { value: "continue", label: "Continue to next step" },
  { value: "stop", label: "Stop sequence" },
];

// ── On-failure options ───────────────────────────────────────────────────────

export const ON_FAILURE_OPTIONS: { value: string; label: string }[] = [
  { value: "continue", label: "Continue to next step" },
  { value: "retry", label: "Retry this step" },
  { value: "stop", label: "Stop sequence" },
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
  content: SmsContent | EmailContent | VoiceContent | WaitContent | ConditionContent
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
): SmsContent | EmailContent | VoiceContent | WaitContent | ConditionContent {
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

    case "wait":
      return {
        reason: parsed.reason ?? "",
      } as WaitContent;

    case "condition":
      return {
        check: parsed.check ?? "",
        true_step: parsed.true_step ?? 0,
        false_step: parsed.false_step ?? 0,
      } as ConditionContent;

    default:
      return { body: "" } as SmsContent;
  }
}

// ── Build FormData for the addSequenceStep server action ─────────────────────

export interface StepFormState {
  channel: ChannelType;
  delay_minutes: number;
  delay_type: string;
  content: SmsContent | EmailContent | VoiceContent | WaitContent | ConditionContent;
  skip_conditions: SkipConditionKey[];
  on_success: string;
  on_failure: string;
  enable_ai_mutation: boolean;
  mutation_instructions: string;
}

export function buildFormData(state: StepFormState): FormData {
  const fd = new FormData();

  fd.set("channel", state.channel);
  fd.set("delay_minutes", String(state.delay_minutes));
  fd.set("delay_type", state.delay_type);
  fd.set("content_template", serializeContent(state.channel, state.content));
  fd.set("skip_conditions", JSON.stringify(state.skip_conditions));
  fd.set("on_success", state.on_success);
  fd.set("on_failure", state.on_failure);
  fd.set("enable_ai_mutation", String(state.enable_ai_mutation));
  fd.set("mutation_instructions", state.mutation_instructions || "");

  return fd;
}
