import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Terms of Service — Omnify",
    description:
        "Terms of Service for Omnify (Elevate With AI), the AI voice and messaging platform.",
};

const EFFECTIVE_DATE = "April 27, 2026";

export default function TermsPage() {
    return (
        <>
            <h1>Terms of Service</h1>
            <p className="lede">
                Effective: {EFFECTIVE_DATE}. These Terms govern your use of Omnify
                (operated by Elevate With AI). By creating an account, clicking
                &ldquo;I agree,&rdquo; subscribing, or otherwise accessing the Service,
                you agree to be bound by these Terms. If you do not agree, do not use
                the Service.
            </p>

            <div className="callout">
                <strong>Important — read this first.</strong> Omnify provides software
                that <em>you</em> use to place outbound and inbound voice calls and
                send messages to <em>your</em> contacts. <strong>You</strong> — not
                Omnify — are the sender, the caller, the data controller, and the
                party legally responsible for every call, text, voicemail, or message
                that leaves your account, including compliance with the TCPA, FCC and
                FTC rules, the federal and state Do-Not-Call (DNC) registries, GDPR,
                CCPA/CPRA, CASL, and every other communications, consent, recording,
                privacy, or marketing law that applies to you or to the people you
                contact.
            </div>

            <h2>1. The Service</h2>
            <p>
                Omnify is a software-as-a-service platform that enables Customers
                (&ldquo;you,&rdquo; &ldquo;Customer&rdquo;) to configure AI voice
                agents, sequencers, dialers, and messaging workflows that interact
                with Customer&rsquo;s end users (&ldquo;Contacts&rdquo;). Omnify
                routes telephony through third-party providers (including, without
                limitation, VAPI, Twilio, Telnyx, OpenAI, and similar vendors). Omnify
                is a passive technology provider and does not initiate, originate,
                target, script, or supervise any communication on its own behalf.
            </p>

            <h2>2. Eligibility &amp; Account</h2>
            <p>
                You must be at least 18 years old, legally able to form a binding
                contract, and not barred from using the Service under any applicable
                law. You must register a real legal entity or individual identity,
                provide accurate information, and keep your credentials secure. You
                are responsible for all activity under your account, including the
                acts of your employees, contractors, agents, and any AI agents you
                configure.
            </p>

            <h2>3. Customer Responsibilities &amp; Compliance</h2>
            <p>
                You represent, warrant, and covenant — for every Contact and every
                communication generated through the Service — that:
            </p>
            <ol>
                <li>
                    <strong>Consent.</strong> You have obtained <em>prior express
                    written consent</em> (or another lawful basis recognized by the
                    applicable jurisdiction) from each Contact to receive the
                    specific type of communication you send (marketing,
                    informational, transactional, or otherwise), and you can produce
                    documentary proof of that consent on demand.
                </li>
                <li>
                    <strong>DNC scrubbing.</strong> Before placing any outbound call
                    or text, you have scrubbed every number against the federal
                    Do-Not-Call Registry, all applicable state DNC lists, your own
                    internal opt-out list, the wireless porting database, and any
                    reassigned-number database required by the FCC.
                </li>
                <li>
                    <strong>TCPA / FCC / FTC.</strong> You comply with the Telephone
                    Consumer Protection Act, all FCC implementing regulations
                    (including STIR/SHAKEN call-authentication, caller-ID accuracy,
                    quiet-hour restrictions, and identification disclosures), the
                    Telemarketing Sales Rule, and all state mini-TCPA statutes
                    (including but not limited to FTSA, OTSA, WADAD, MTCPA).
                </li>
                <li>
                    <strong>Recording &amp; AI disclosure.</strong> You provide
                    every legally required disclosure that the call is being
                    recorded and/or that the Contact is speaking with an artificial
                    or pre-recorded voice, in every jurisdiction in which the
                    Contact is located, including all two-party-consent states.
                </li>
                <li>
                    <strong>Opt-out.</strong> You honor every opt-out, revocation of
                    consent, STOP keyword, or do-not-contact request immediately and
                    permanently across all channels.
                </li>
                <li>
                    <strong>Privacy &amp; data protection.</strong> You are the
                    Controller (under GDPR/UK GDPR) and Business (under CCPA/CPRA)
                    with respect to all Contact data uploaded into the Service. You
                    have a lawful basis for processing, you have provided every
                    required notice, and you respect every Contact&rsquo;s data
                    subject rights.
                </li>
                <li>
                    <strong>Industry restrictions.</strong> You will not use the
                    Service for any communication that requires a license you do not
                    hold (medical, legal, tax, debt-collection under the FDCPA, or
                    financial advice), and you will not contact any minor, any
                    person on a litigator/professional-plaintiff list you reasonably
                    should know about, or any number you have reason to believe has
                    been reassigned.
                </li>
                <li>
                    <strong>Content.</strong> Your prompts, scripts, and AI agent
                    instructions are accurate, not deceptive, not impersonating any
                    third party (including Omnify), and not designed to extract
                    payment, sensitive personal information, or credentials from a
                    Contact under false pretenses.
                </li>
            </ol>
            <p>
                <strong>You — not Omnify — are the &ldquo;sender,&rdquo;
                &ldquo;caller,&rdquo; &ldquo;telemarketer,&rdquo; and
                &ldquo;initiator&rdquo; of every communication generated through
                your account</strong> for purposes of every applicable law.
            </p>

            <h2>4. Acceptable Use</h2>
            <p>You will not, and will not permit any third party to, use the Service to:</p>
            <ul>
                <li>send spam, robocalls, or junk communications in violation of any law;</li>
                <li>contact any person without a lawful basis;</li>
                <li>spoof caller-ID with intent to defraud, harm, or wrongfully obtain anything of value;</li>
                <li>impersonate Omnify, any government agency, or any third party;</li>
                <li>collect payment information, Social Security numbers, or other sensitive data through an AI agent without separate, compliant disclosures and security controls;</li>
                <li>conduct lead-generation for unlicensed financial, medical, legal, immigration, or debt-collection services;</li>
                <li>attempt to reverse-engineer, scrape, resell, or sublicense the Service except as expressly permitted;</li>
                <li>introduce malware, attempt to breach security, or interfere with the Service or its underlying providers;</li>
                <li>use the Service to harass, threaten, defame, or discriminate against any person or class of persons.</li>
            </ul>
            <p>
                We may suspend or terminate your access immediately, without notice
                and without refund, if we reasonably believe you have violated this
                Section, regardless of whether a regulator, carrier, or third party
                has yet contacted us.
            </p>

            <h2>5. Fees, Subscriptions &amp; Minutes</h2>
            <p>
                Subscription fees, minute allotments, top-up packs, and rollover
                rules are described on the Service. All payments are processed by
                Stripe and are non-refundable except where required by law. Unused
                voice minutes from a paid subscription month may roll over for up
                to two (2) consecutive billing cycles, after which they expire. We
                may change pricing on 30 days&rsquo; notice; continued use after the
                effective date is acceptance of the new pricing. You are responsible
                for all taxes other than taxes on Omnify&rsquo;s net income.
            </p>

            <h2>6. Third-Party Services</h2>
            <p>
                The Service depends on third-party providers, including telecom
                carriers and AI model providers. We do not control them, we do not
                guarantee their availability or accuracy, and we are not liable for
                their acts, omissions, outages, billing errors, content moderation
                decisions, or data practices. Your use of integrations (Calendly,
                Google Calendar, Stripe, etc.) is subject to those providers&rsquo;
                own terms.
            </p>

            <h2>7. AI Output Disclaimer</h2>
            <p>
                The Service uses large language models and synthetic voice
                technology. AI output can be inaccurate, incomplete, biased, or
                fabricated. You are solely responsible for reviewing, verifying, and
                approving every prompt, script, and AI behavior before it reaches a
                Contact, and for any consequence of relying on AI output. Omnify
                makes <strong>no representation</strong> that AI output is
                accurate, lawful, fit for any particular purpose, or compliant in
                your jurisdiction.
            </p>

            <h2>8. Customer Data</h2>
            <p>
                You retain all rights to data you upload (&ldquo;Customer
                Data&rdquo;). You grant Omnify a worldwide, royalty-free license to
                host, transmit, process, and display Customer Data solely to provide
                and improve the Service, to comply with law, and to enforce these
                Terms. You represent that you have all rights, consents, and lawful
                bases necessary to grant this license. We may use aggregated,
                de-identified data for analytics and product development.
            </p>

            <h2>9. Intellectual Property</h2>
            <p>
                Omnify, the Omnify and Elevate With AI marks, the Service, and all
                software, models, prompts, templates, documentation, and
                derivatives thereof are and remain the exclusive property of
                Elevate With AI and its licensors. Subject to these Terms, we grant
                you a limited, non-exclusive, non-transferable, revocable license to
                use the Service during your paid subscription. No other rights are
                granted by implication or estoppel.
            </p>

            <h2>10. Disclaimers</h2>
            <p className="all-caps">
                The service is provided &ldquo;as is&rdquo; and &ldquo;as
                available,&rdquo; with all faults. To the maximum extent permitted
                by law, omnify and its affiliates, officers, directors, employees,
                agents, suppliers, and licensors disclaim all warranties of any
                kind, express, implied, statutory, or otherwise, including without
                limitation merchantability, fitness for a particular purpose,
                title, non-infringement, accuracy, uptime, error-free operation,
                and any warranty arising from course of dealing or trade usage.
                omnify does not warrant that any communication will be delivered,
                received, or compliant in any jurisdiction.
            </p>

            <h2>11. Indemnification</h2>
            <p>
                <strong>You will defend, indemnify, and hold harmless</strong>{" "}
                Omnify, Elevate With AI, and their respective parents, subsidiaries,
                affiliates, officers, directors, employees, agents, vendors, and
                licensors (the &ldquo;Indemnified Parties&rdquo;) from and against
                any and all claims, demands, investigations, regulatory actions,
                class actions, suits, fines, penalties, settlements, judgments,
                losses, damages, liabilities, costs, and expenses (including
                reasonable attorneys&rsquo; fees and the costs of regulatory
                response) arising out of or related to:
            </p>
            <ul>
                <li>your use of the Service;</li>
                <li>any communication, call, text, voicemail, recording, or message originated from your account;</li>
                <li>any actual or alleged violation by you of the TCPA, FCC or FTC rules, the federal or any state Do-Not-Call registry, any state telemarketing or anti-robocall statute, GDPR, UK GDPR, CCPA/CPRA, CASL, HIPAA, GLBA, FDCPA, FCRA, or any other communications, consent, recording, privacy, marketing, financial, or healthcare law;</li>
                <li>your Customer Data, prompts, scripts, or AI agent configurations;</li>
                <li>your breach of these Terms or any representation or warranty you make;</li>
                <li>any dispute between you and a Contact, employee, regulator, carrier, or third party.</li>
            </ul>
            <p>
                We may, at our option, assume exclusive control of the defense and
                settlement of any indemnified matter at your expense. You will not
                settle any matter that imposes any obligation, admission, or
                liability on an Indemnified Party without our prior written consent.
            </p>

            <h2>12. Limitation of Liability</h2>
            <p className="all-caps">
                To the maximum extent permitted by law, in no event will the
                indemnified parties be liable for any indirect, incidental,
                special, consequential, exemplary, or punitive damages, including
                lost profits, lost revenue, lost data, business interruption,
                regulatory penalties, or reputational harm, even if advised of the
                possibility of such damages. The indemnified parties&rsquo; total
                aggregate liability arising out of or relating to these terms or
                the service, regardless of the theory of liability, will not
                exceed the lesser of (a) the amounts you paid to omnify for the
                service in the three (3) months immediately preceding the event
                giving rise to the claim, or (b) one hundred U.S. dollars
                ($100.00). multiple claims do not enlarge this cap.
            </p>

            <h2>13. Term &amp; Termination</h2>
            <p>
                These Terms remain in effect while you have an account or use the
                Service. We may suspend or terminate your access at any time, with
                or without cause, with or without notice, and without refund. You
                may terminate by canceling your subscription and ceasing all use.
                Sections 3, 7, 8, 9, 10, 11, 12, 14, 15, and any provision that by
                its nature should survive termination will survive.
            </p>

            <h2>14. Governing Law; Arbitration; Class Waiver</h2>
            <p>
                These Terms are governed by the laws of the State of Delaware, USA,
                without regard to its conflict-of-laws principles. Any dispute,
                controversy, or claim arising out of or related to these Terms or
                the Service will be resolved exclusively by{" "}
                <strong>final and binding individual arbitration</strong>{" "}
                administered by the American Arbitration Association under its
                Commercial Arbitration Rules, in Wilmington, Delaware, before a
                single arbitrator. Judgment on the award may be entered in any
                court of competent jurisdiction. <strong>You waive any right to a
                jury trial and any right to participate in a class, collective, or
                representative action.</strong> Either party may seek injunctive
                relief in court for infringement of intellectual property or
                violation of confidentiality. If any portion of this Section is
                found unenforceable, the remainder remains in full force.
            </p>

            <h2>15. Changes to These Terms</h2>
            <p>
                We may update these Terms at any time by posting a revised version
                with a new effective date. Material changes will take effect 30
                days after posting. Your continued use after the effective date
                constitutes acceptance.
            </p>

            <h2>16. Miscellaneous</h2>
            <p>
                These Terms, together with the{" "}
                <a href="/legal/privacy">Privacy Policy</a> and any order form,
                constitute the entire agreement between you and Omnify and
                supersede all prior agreements on the subject. If any provision is
                held unenforceable, the remaining provisions remain in full
                effect. Failure to enforce a provision is not a waiver. You may
                not assign these Terms without our prior written consent; we may
                assign freely. Notices to you may be sent to the email associated
                with your account; notices to us must be sent to the contact
                address below. Nothing in these Terms creates an agency,
                partnership, joint venture, or employment relationship.
            </p>

            <h2>17. Contact</h2>
            <p>
                Elevate With AI / Omnify — Legal Department.
                <br />
                Email:{" "}
                <a href="mailto:legal@elevatewithai.com">legal@elevatewithai.com</a>
            </p>

            <p className="lede" style={{ marginTop: "3rem" }}>
                Last updated: {EFFECTIVE_DATE}.
            </p>
        </>
    );
}
