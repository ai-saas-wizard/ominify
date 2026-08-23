# Design brief: Omnify Analytics

Paste everything below into Claude Design.

---

Design the **Analytics** page for Omnify, a multi-tenant AI outreach CRM.

## What the product does

Clients deploy AI voice agents (running on VAPI) that call and text their leads. Those agents are driven by **sequences**: multi-step outbound campaigns. Most sequences are AI-driven, meaning the AI decides the channel, wording and timing of each touch per lead rather than following a fixed script. A lead is "enrolled" in a sequence and receives up to N touches across voice and SMS until they reply, book, opt out, or the sequence runs out.

The people using this page are operators running outbound campaigns: agency owners and SMB sales leads. They pay per voice minute, so wasted dialling costs them real money.

## What the page has to answer

Rank the layout around these, in roughly this order of importance:

1. **Is the outreach working?** Contact rate, reply rate, booking rate, and how those move over time.
2. **Which sequences convert, and which burn minutes for nothing?** Compare campaigns side by side.
3. **Which agents perform?** Answer rate, average call length, booking rate, cost per booking.
4. **When should we be calling?** Answer rate by hour of day and day of week, not just call volume. Volume heatmaps are common and near useless; the operator wants to know which hours *connect*.
5. **What are leads actually saying?** Sentiment, intent, objections raised, recurring topics.
6. **Where is the money going?** Minutes and spend by sequence and by agent, and cost per booked appointment.
7. **What is breaking?** Failed and skipped dispatches by reason, no-shows, self-healing events.

## Data that actually exists

Design only against these. Anything not listed here cannot be populated, and a chart we cannot fill is worse than no chart.

**`calls`** (written by the VAPI webhook, one row per call)
`vapi_call_id`, `agent_id`, `duration_seconds`, `cost`, `status`, `ended_reason`, `started_at`, `ended_at`, `customer_number`, `type` (`inboundPhoneCall` / `outboundPhoneCall`), `summary` (AI-written), `transcript`, `recording_url`, `structured_data` (JSON the agent extracted per its analysis plan)

**`contact_interactions`** (one row per touch, both directions, all channels)
`channel` (`sms` | `email` | `voice`), `direction` (`outbound` | `inbound`), `content_body`, `outcome` (`delivered` | `replied` | `answered` | `voicemail` | `no_answer` | `bounced` | `opened` | `clicked` | `failed`), `sentiment` (`positive` | `negative` | `neutral` | `objection` | `interested` | `confused`), `intent` (`interested` | `not_interested` | `stop` | `reschedule` | `question` | `unknown`), `call_duration_seconds`, `call_disposition`, `appointment_booked`, `objections_raised[]`, `key_topics[]`, `created_at`

**`sequence_enrollments`** (one row per lead per campaign)
`status` (`active` | `awaiting_outcome` | `generating_next_step` | `paused` | `completed` | `replied` | `booked` | `failed` | `unenrolled` | `manual_stop`), `current_step_order`, `enrolled_at`, `completed_at`, `total_attempts`, `calls_made`, `sms_sent`, `emails_sent`, `contact_replied`, `contact_answered_call`, `appointment_booked`, `enrollment_source`, `is_test`

**`sequence_execution_log`** (one row per dispatch attempt)
`channel`, `action`, `status` (`sent` | `failed` | `skipped` | `skipped_conditions` | `skipped_opt_out` | `skipped_capacity` | `blocked_empty_body` | `blocked_placeholder` | `held_contact_fatigue`), `call_status`, `call_duration_seconds`, `sms_status`, `executed_at`

**`sequences`** `name`, `is_active`, `generation_mode`, goal / channels / cadence / duration / max touches, daily call cap, calling window, calling days, bound agent

**`agents`** `name`, `vapi_id`, `agent_type` (`inbound` | `outbound`)

**`appointments`** `customer_name`, `scheduled_at`, `duration_minutes`, `status` (`booked` | `cancelled` | `rescheduled` | `failed` | `no_show`), `service_type`, linked `vapi_call_id`

**`usage_records`** `vapi_call_id`, `duration_seconds`, `minutes_charged`, `cost_to_us`, `price_charged`, `recorded_at`

**`minute_balances`** available, plan allowance, lifetime purchased, lifetime used

**`step_mutations`** and **`healing_log`** where the AI rewrote or repaired a step

### Explicitly not available

- No revenue or deal value on any record. Do not design ROI, pipeline value, or revenue attribution.
- No cost breakdown by component. Only a total cost per call.
- `usage_records` links to a call, not to a sequence or agent, so cost per sequence is a derived join and should be treated as approximate.
- Email is configured for very few tenants. Keep email a minor element, never a headline.

## Design constraints

This has to sit inside an existing dashboard. Match it, do not invent a new visual language.

- **Typography**: Inter. No second typeface, no monospace family. Use tabular figures for all numbers.
- **Color, one meaning per hue**: emerald = running / healthy / primary actions, blue = the lead responded, violet = booked, amber = paused or warning, red = failed, neutral gray = finished or nothing yet. Do not introduce a new accent.
- **Surfaces**: white cards on a gray-50 page, 1px gray-200 hairline borders, 8px radius, no drop shadows.
- **Text**: muted copy is gray-500, never lighter. Section labels are 10px uppercase with wide tracking.
- **Layout**: full height and full width. Fixed header, then internal scrolling regions. The page itself must never scroll as one long document, and nothing should be capped to a narrow centered column.
- **Header pattern already used elsewhere**: a 32px rounded square tile in emerald-100 with the section icon in emerald-600, then a 17px semibold title with an 11.5px gray-500 subtitle beside it, and actions on the right.
- **KPI strip pattern already used elsewhere**: a row of six equal cells divided by hairlines, each with a small colored dot, a 10px uppercase label, a 21px number and a small qualifier next to it.
- **Copy**: no em dashes anywhere. Use commas, colons or full stops.
- A 216px sidebar already exists to the left. Design the main pane only.

## Also worth designing

- A **time range control** (last 7 days, 30 days, 90 days, this cycle). Every number on the page should respond to it.
- An **empty and low-data state**. New accounts have a handful of calls, and the page currently looks broken for them.
- A **comparison affordance**: this period against the previous one, as deltas next to the headline numbers.

## What is there today, and why it is not enough

One row of totals (calls, minutes, average duration, success rate, balance), a call volume line chart, a call outcomes donut, an agent table, a call volume heatmap and a sentiment donut. It reports call activity and nothing about outcomes: nothing about sequences, replies, bookings, cost efficiency, or what leads actually said. Treat it as a starting point to replace, not to extend.
