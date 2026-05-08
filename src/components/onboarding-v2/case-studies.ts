export interface CaseStudy {
    id: string;
    industries: string[];
    quote: string;
    name: string;
    role: string;
    company: string;
    metric?: string;
}

export const ONBOARDING_CASE_STUDIES: CaseStudy[] = [
    {
        id: "re-flipper-md",
        industries: ["real_estate", "real_estate_investor"],
        quote: "We had Omnify answering seller calls within an hour of the onboarding call. Booked our first qualified appointment the same afternoon.",
        name: "Marcus D.",
        role: "Owner",
        company: "Maryland Capital Homes",
        metric: "First booked appointment in 3 hours",
    },
    {
        id: "hvac-ny",
        industries: ["home_services", "hvac", "plumbing"],
        quote: "I was nervous about handing the phone to AI. After the call I had two agents live, and our after-hours coverage doubled.",
        name: "Lena R.",
        role: "Operations Lead",
        company: "Northside HVAC",
        metric: "2x after-hours coverage",
    },
    {
        id: "agency-fl",
        industries: ["agency", "marketing"],
        quote: "Onboarding was the fastest tool setup I've ever done. By minute 25 my agents were calling test leads.",
        name: "Diego P.",
        role: "Founder",
        company: "BrightLine Outreach",
    },
];

export function getCaseStudiesForIndustry(
    industry: string | null | undefined,
    limit = 2
): CaseStudy[] {
    if (industry) {
        const matched = ONBOARDING_CASE_STUDIES.filter((c) =>
            c.industries.some((i) => industry.toLowerCase().includes(i))
        );
        if (matched.length > 0) return matched.slice(0, limit);
    }
    return ONBOARDING_CASE_STUDIES.slice(0, limit);
}
