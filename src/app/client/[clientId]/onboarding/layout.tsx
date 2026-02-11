/**
 * Onboarding layout — renders children directly without the parent layout's sidebar.
 * The onboarding wizard has its own sidebar stepper, so we don't want the app sidebar.
 *
 * In Next.js App Router, child layouts are nested inside parent layouts.
 * We can't remove the parent sidebar from here, but we can use CSS to override
 * the parent's flex layout so the onboarding fills the full viewport.
 */
export default function OnboardingLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="fixed inset-0 z-50 bg-gray-50">
            {children}
        </div>
    );
}
