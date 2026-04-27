import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Privacy Policy — Omnify",
    description:
        "Privacy Policy for Omnify (Elevate With AI), describing how we process Customer and Contact data.",
};

const EFFECTIVE_DATE = "April 27, 2026";

export default function PrivacyPage() {
    return (
        <>
            <h1>Privacy Policy</h1>
            <p className="lede">
                Effective: {EFFECTIVE_DATE}. This Privacy Policy explains how
                Omnify (operated by Elevate With AI) (&ldquo;Omnify,&rdquo;
                &ldquo;we,&rdquo; &ldquo;us&rdquo;) collects and processes
                personal information when you use our website, dashboard,
                APIs, and AI voice and messaging platform (the
                &ldquo;Service&rdquo;).
            </p>

            <div className="callout">
                <strong>Roles &mdash; please read.</strong> Omnify is the{" "}
                <strong>Controller</strong> only of personal information about
                its own account holders (&ldquo;Customers&rdquo;). For all
                personal information about <em>your end users</em>{" "}
                (&ldquo;Contacts&rdquo;) that you upload, generate, capture, or
                process through the Service &mdash; including phone numbers,
                names, email addresses, call recordings, transcripts, and
                anything spoken or typed to your AI agents &mdash;{" "}
                <strong>you (the Customer) are the Controller / Business and
                Omnify is the Processor / Service Provider</strong> acting on
                your documented instructions. You alone are responsible for
                lawful basis, notice, and consent with respect to that data.
            </div>

            <h2>1. Information We Collect</h2>

            <h3>1.1 Account &amp; Customer information</h3>
            <ul>
                <li>name, business name, email, phone, role;</li>
                <li>authentication identifiers (via Clerk);</li>
                <li>billing information (processed by Stripe; we do not store full card numbers);</li>
                <li>configuration data (assistant prompts, sequencer settings, integrations).</li>
            </ul>

            <h3>1.2 Contact information processed on your behalf</h3>
            <ul>
                <li>names, phone numbers, email addresses, and other CRM fields you upload;</li>
                <li>call recordings, transcripts, voicemail, SMS bodies, and metadata generated when your AI agents interact with Contacts;</li>
                <li>event metadata (call duration, outcome, timestamps, IP addresses of inbound callers via our telephony providers).</li>
            </ul>
            <p>
                We process this category strictly to provide the Service to you.
                We do not sell it, do not use it to train third-party foundation
                models, and do not use it to market to your Contacts.
            </p>

            <h3>1.3 Technical &amp; usage data</h3>
            <ul>
                <li>device, browser, OS, IP address, referrer, locale;</li>
                <li>page views, feature usage, error logs;</li>
                <li>cookies and similar technologies as described in Section 7.</li>
            </ul>

            <h2>2. How We Use Information</h2>
            <ul>
                <li>to provide, maintain, secure, and improve the Service;</li>
                <li>to authenticate users and prevent fraud and abuse;</li>
                <li>to process payments and manage subscriptions;</li>
                <li>to provide customer support and respond to inquiries;</li>
                <li>to comply with law and enforce our <a href="/legal/terms">Terms of Service</a>;</li>
                <li>to communicate with Customers about product, security, and billing;</li>
                <li>to generate aggregated, de-identified analytics that do not identify any individual.</li>
            </ul>

            <h2>3. Legal Bases (EEA / UK)</h2>
            <p>
                Where GDPR or UK GDPR applies, our legal bases for processing
                Customer information are: (a) performance of a contract with you;
                (b) our legitimate interests in operating, securing, and
                improving the Service; (c) compliance with legal obligations;
                and (d) consent where required. For Contact information, the
                Customer is the Controller and is responsible for establishing
                the lawful basis.
            </p>

            <h2>4. Sharing &amp; Sub-processors</h2>
            <p>We share information only as follows:</p>
            <ul>
                <li>
                    <strong>Sub-processors</strong> who help us run the Service,
                    bound by written data-processing terms. Current sub-processors
                    include, without limitation: Vercel (hosting), Supabase
                    (database), Clerk (authentication), Stripe (billing), VAPI
                    (voice agent runtime), Twilio and/or Telnyx (telephony),
                    OpenAI and Anthropic (AI models), Google (Calendar and OAuth),
                    Calendly (scheduling).
                </li>
                <li>
                    <strong>Professional advisors</strong> (lawyers, auditors,
                    accountants) under confidentiality.
                </li>
                <li>
                    <strong>Authorities</strong> when required by law, subpoena,
                    court order, or to protect rights, safety, or property.
                </li>
                <li>
                    <strong>Business transfers</strong> in connection with a
                    merger, acquisition, financing, or sale of assets.
                </li>
            </ul>
            <p>
                <strong>We do not sell personal information</strong> as
                &ldquo;sale&rdquo; is defined under CCPA/CPRA, and we do not
                share personal information for cross-context behavioral
                advertising.
            </p>

            <h2>5. International Transfers</h2>
            <p>
                Personal information may be processed in the United States and
                other countries where our sub-processors operate. Where
                required, we rely on Standard Contractual Clauses, the UK IDTA,
                or other valid transfer mechanisms.
            </p>

            <h2>6. Retention</h2>
            <p>
                We retain Customer account information for as long as the
                account is active and for a reasonable period thereafter to
                comply with legal, tax, and audit obligations. We retain
                Contact information for the period instructed by the Customer
                or until the Customer deletes it through the Service. Backups
                are purged on a rolling cycle of up to 30 days. Aggregated,
                de-identified data may be retained indefinitely.
            </p>

            <h2>7. Cookies</h2>
            <p>
                We use strictly necessary cookies (authentication, security,
                load balancing) and a small number of analytics cookies to
                understand product usage. You can control cookies through your
                browser settings. Disabling strictly necessary cookies will
                break the Service.
            </p>

            <h2>8. Your Rights</h2>

            <h3>8.1 If you are a Customer</h3>
            <p>
                Subject to applicable law, you may request access, correction,
                deletion, portability, or restriction of personal information
                we hold about you as a Customer; object to certain processing;
                and withdraw consent where processing is based on consent.
                Contact{" "}
                <a href="mailto:privacy@elevatewithai.com">privacy@elevatewithai.com</a>.
            </p>

            <h3>8.2 If you are a Contact</h3>
            <p>
                If you received a call, text, or message generated by an Omnify
                Customer and you wish to exercise data-subject rights (access,
                deletion, opt-out, do-not-call) or revoke consent, please
                contact <strong>the Customer who contacted you</strong> &mdash;
                they are the Controller of your data and can act on your
                request. If you cannot identify the Customer, email{" "}
                <a href="mailto:privacy@elevatewithai.com">privacy@elevatewithai.com</a>{" "}
                with the date, time, and originating phone number and we will
                make a reasonable effort to route your request to the
                appropriate Customer. We do not have authority to act on your
                request without the Customer&rsquo;s instruction except as
                required by law.
            </p>

            <h3>8.3 California, Virginia, Colorado, Connecticut, Utah, Texas, and similar U.S. state rights</h3>
            <p>
                Eligible residents may have rights to know, access, delete,
                correct, port, opt out of sale or sharing, and opt out of
                certain profiling. We do not sell personal information and do
                not engage in cross-context behavioral advertising. To
                exercise rights as a Customer, email{" "}
                <a href="mailto:privacy@elevatewithai.com">privacy@elevatewithai.com</a>;
                to exercise rights as a Contact, see Section 8.2.
            </p>

            <h2>9. Security</h2>
            <p>
                We implement reasonable administrative, technical, and physical
                safeguards designed to protect personal information, including
                encryption in transit, encryption at rest where supported by
                our infrastructure, role-based access controls, and audit
                logging. No system is perfectly secure; we cannot guarantee
                absolute security.
            </p>

            <h2>10. Children</h2>
            <p>
                The Service is not directed to children under 16, and we do not
                knowingly collect personal information from children. If you
                believe a child has provided us personal information, please
                contact us and we will delete it.
            </p>

            <h2>11. AI Processing &amp; Automated Decision-Making</h2>
            <p>
                The Service routes content (prompts, transcripts, recordings) to
                AI model providers under contracts that prohibit those providers
                from using the content to train their models. AI agents make
                conversational decisions in real time. To the extent any
                processing constitutes solely automated decision-making with
                legal or similarly significant effect, the Customer is
                responsible under GDPR Article 22 and equivalent laws for
                providing meaningful human review, notice, and the right to
                contest a decision.
            </p>

            <h2>12. Call Recording &amp; AI Voice Disclosure</h2>
            <p>
                The Service can record calls and use synthetic voices.{" "}
                <strong>The Customer is responsible</strong> for delivering all
                legally required disclosures to Contacts, including
                two-party-consent recording disclosures, AI/synthetic-voice
                disclosures (such as those required by California SB 1001 and
                similar laws), and any disclosures required at the start of an
                outbound telemarketing call.
            </p>

            <h2>13. Data-Processing Addendum</h2>
            <p>
                Customers required to enter a Data-Processing Addendum (DPA) in
                order to use the Service in compliance with GDPR, UK GDPR, or
                CCPA/CPRA may request our standard DPA at{" "}
                <a href="mailto:privacy@elevatewithai.com">privacy@elevatewithai.com</a>.
                Our standard DPA is incorporated by reference into the Terms
                upon execution.
            </p>

            <h2>14. Changes to This Policy</h2>
            <p>
                We may update this Policy by posting a revised version with a
                new effective date. Material changes will be communicated by
                in-product notice or email. Continued use after the effective
                date constitutes acceptance.
            </p>

            <h2>15. Contact</h2>
            <p>
                Elevate With AI / Omnify &mdash; Privacy Office.
                <br />
                Email:{" "}
                <a href="mailto:privacy@elevatewithai.com">privacy@elevatewithai.com</a>
            </p>

            <p className="lede" style={{ marginTop: "3rem" }}>
                Last updated: {EFFECTIVE_DATE}.
            </p>
        </>
    );
}
