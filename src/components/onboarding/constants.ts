import {
    Globe,
    Building2,
    Wrench,
    MessageSquare,
    Clock,
    Target,
    CheckCircle,
} from "lucide-react";
import type { OnboardingStep } from "./types";

// ─── STEPS ───

export const STEPS: OnboardingStep[] = [
    { label: "Website Analysis", icon: Globe, description: "Let AI analyze your business" },
    { label: "Business Identity", icon: Building2, description: "Review your business info" },
    { label: "Service Details", icon: Wrench, description: "Your services and area" },
    { label: "Brand Voice", icon: MessageSquare, description: "How you communicate" },
    { label: "Business Hours", icon: Clock, description: "When you operate" },
    { label: "Lead Config", icon: Target, description: "How you handle leads" },
    { label: "Review & Complete", icon: CheckCircle, description: "Final review" },
];

// ─── ANALYSIS STAGES ───

export const ANALYSIS_STAGES = [
    { label: "Connecting to website...", duration: 2000 },
    { label: "Scanning business information...", duration: 3000 },
    { label: "Analyzing services & offerings...", duration: 3000 },
    { label: "Identifying brand voice...", duration: 2000 },
    { label: "Generating your profile...", duration: 2000 },
];

// ─── INDUSTRIES ───

export const INDUSTRIES = [
    { value: "home_services", label: "Home Services" },
    { value: "real_estate", label: "Real Estate" },
    { value: "healthcare", label: "Healthcare" },
    { value: "legal", label: "Legal" },
    { value: "automotive", label: "Automotive" },
    { value: "restaurant", label: "Restaurant" },
    { value: "retail", label: "Retail" },
    { value: "professional_services", label: "Professional Services" },
    { value: "other", label: "Other" },
];

// ─── BRAND VOICES ───

export const BRAND_VOICES = [
    { value: "professional", label: "Professional", desc: "Polished and businesslike" },
    { value: "friendly", label: "Friendly", desc: "Warm and approachable" },
    { value: "casual", label: "Casual", desc: "Relaxed and conversational" },
    { value: "authoritative", label: "Authoritative", desc: "Confident and expert" },
];

// ─── TIMEZONES ───

export const TIMEZONES = [
    { value: "America/New_York", label: "Eastern Time (ET)" },
    { value: "America/Chicago", label: "Central Time (CT)" },
    { value: "America/Denver", label: "Mountain Time (MT)" },
    { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
    { value: "America/Phoenix", label: "Arizona (no DST)" },
    { value: "America/Anchorage", label: "Alaska Time (AKT)" },
    { value: "Pacific/Honolulu", label: "Hawaii Time (HST)" },
];

// ─── DAYS OF WEEK ───

export const DAYS_OF_WEEK = [
    { key: "mon", label: "Monday" },
    { key: "tue", label: "Tuesday" },
    { key: "wed", label: "Wednesday" },
    { key: "thu", label: "Thursday" },
    { key: "fri", label: "Friday" },
    { key: "sat", label: "Saturday" },
    { key: "sun", label: "Sunday" },
];

// ─── LEAD SOURCES ───

export const LEAD_SOURCE_OPTIONS = [
    "google_ads",
    "facebook_ads",
    "yelp",
    "thumbtack",
    "angi",
    "homeadvisor",
    "referral",
    "website_form",
    "phone_call",
    "other",
];

// ─── GOAL OPTIONS ───

export const GOAL_OPTIONS = [
    { value: "book_appointment", label: "Book Appointment" },
    { value: "phone_qualification", label: "Phone Qualification" },
    { value: "direct_schedule", label: "Direct Schedule" },
    { value: "collect_info", label: "Collect Information" },
    { value: "transfer_to_agent", label: "Transfer to Live Agent" },
];

// ─── HELPERS ───

export function formatLeadSourceLabel(source: string): string {
    return source
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}
