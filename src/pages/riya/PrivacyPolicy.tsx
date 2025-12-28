import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Privacy Policy Page
 * Standard MVP privacy policy template
 */
const PrivacyPolicy = () => {
    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
                <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
                    <Link to="/riya">
                        <Button variant="ghost" size="icon" className="shrink-0">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <h1 className="font-display text-xl font-bold text-foreground">
                        Privacy Policy
                    </h1>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-3xl mx-auto px-4 py-8">
                <div className="glass-card p-6 md:p-8 space-y-6">
                    <p className="text-sm text-muted-foreground">
                        Last updated on Dec 27th 2025
                    </p>

                    <div className="prose prose-invert max-w-none space-y-6 text-foreground/90">
                        <p>
                            This Privacy Policy describes how Miten Solanki ("we", "us", or "our") collects,
                            uses, and shares your personal information when you use our service.
                        </p>

                        <section>
                            <h2 className="text-lg font-semibold text-foreground mb-3">
                                1. Information We Collect
                            </h2>
                            <p className="mb-3">We collect the following types of information:</p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    <strong>Account Information:</strong> When you sign in with Google, we receive
                                    your email address and basic profile information.
                                </li>
                                <li>
                                    <strong>Profile Information:</strong> Information you provide during onboarding,
                                    such as your name, age, and gender preferences.
                                </li>
                                <li>
                                    <strong>Conversation Data:</strong> Messages you exchange with our AI companion
                                    to provide personalized responses and improve the service.
                                </li>
                                <li>
                                    <strong>Usage Data:</strong> Information about how you interact with our service,
                                    including timestamps and session information.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-foreground mb-3">
                                2. How We Use Your Information
                            </h2>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>To provide and maintain our service</li>
                                <li>To personalize your AI companion experience based on your preferences</li>
                                <li>To process transactions and send related information</li>
                                <li>To send you updates, security alerts, and support messages</li>
                                <li>To improve and optimize our service</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-foreground mb-3">
                                3. Data Security
                            </h2>
                            <p className="text-sm">
                                We implement appropriate technical and organizational security measures to protect
                                your personal information. Your data is stored securely using industry-standard
                                encryption and security practices. However, no method of transmission over the
                                Internet or electronic storage is 100% secure.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-foreground mb-3">
                                4. Data Sharing
                            </h2>
                            <p className="text-sm mb-3">
                                We do not sell your personal information. We may share your information only in
                                the following circumstances:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>With service providers who assist in operating our service</li>
                                <li>To comply with legal obligations</li>
                                <li>To protect our rights and prevent fraud</li>
                                <li>With your consent or at your direction</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-foreground mb-3">
                                5. Data Retention
                            </h2>
                            <p className="text-sm">
                                We retain your personal information for as long as your account is active or as
                                needed to provide you services. You may request deletion of your account and
                                associated data by contacting us.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-foreground mb-3">
                                6. Your Rights
                            </h2>
                            <p className="text-sm mb-3">Depending on your location, you may have the right to:</p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>Access the personal information we hold about you</li>
                                <li>Request correction of inaccurate information</li>
                                <li>Request deletion of your personal information</li>
                                <li>Object to or restrict certain processing of your data</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-foreground mb-3">
                                7. Children's Privacy
                            </h2>
                            <p className="text-sm">
                                Our service is not intended for users under the age of 13. We do not knowingly
                                collect personal information from children under 13. If you believe we have
                                collected such information, please contact us immediately.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-foreground mb-3">
                                8. Changes to This Policy
                            </h2>
                            <p className="text-sm">
                                We may update this Privacy Policy from time to time. We will notify you of any
                                changes by posting the new Privacy Policy on this page and updating the "Last
                                updated" date.
                            </p>
                        </section>

                        <div className="mt-8 p-4 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20">
                            <h3 className="font-semibold text-neon-cyan mb-2">Contact Us</h3>
                            <p className="text-sm">
                                If you have any questions about this Privacy Policy, please contact us at{' '}
                                <a href="mailto:catalystvibe2403@gmail.com" className="text-neon-cyan hover:underline">
                                    catalystvibe2403@gmail.com
                                </a>
                            </p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default PrivacyPolicy;
