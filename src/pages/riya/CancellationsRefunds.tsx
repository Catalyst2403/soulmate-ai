import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Cancellation & Refund Policy Page
 * Content sourced from Razorpay policy generator
 */
const CancellationsRefunds = () => {
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
                        Cancellation & Refund Policy
                    </h1>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-3xl mx-auto px-4 py-8">
                <div className="glass-card p-6 md:p-8 space-y-6">
                    <p className="text-sm text-muted-foreground">
                        Last updated on Jan 10th 2026
                    </p>

                    <div className="prose prose-invert max-w-none space-y-4 text-foreground/90">
                        {/* <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 mb-6">
                            <p className="text-sm font-semibold text-red-400">
                                ⚠️ IMPORTANT: All payments are final and non-refundable. Please read this policy carefully before making a purchase.
                            </p>
                        </div> */}

                        <section>
                            <h3 className="font-semibold text-foreground mb-3">1. No Refund Policy</h3>
                            <p className="text-sm mb-3">
                                All payments made for subscription plans, premium features, and any other paid
                                services offered by Miten Solanki ("Riya AI") are <strong>FINAL AND NON-REFUNDABLE</strong>.
                                By completing a purchase, you expressly acknowledge and agree to the following:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    All charges are non-refundable, regardless of whether you choose to use the
                                    service or not after purchase.
                                </li>
                                <li>
                                    No pro-rata, partial, or proportionate refunds shall be provided for any
                                    unused portion of your subscription period.
                                </li>
                                <li>
                                    Dissatisfaction with the service, change of mind, or failure to use the
                                    service does not entitle you to a refund.
                                </li>
                                <li>
                                    Technical issues on your end (device compatibility, internet connectivity,
                                    etc.) do not qualify for refunds.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h3 className="font-semibold text-foreground mb-3">2. Digital Services Acknowledgment</h3>
                            <p className="text-sm">
                                You acknowledge that Riya AI is a digital service that is delivered immediately
                                upon successful payment. As such, you expressly waive any statutory "cooling-off"
                                period or right of withdrawal that may otherwise apply to consumer transactions,
                                to the extent permitted by applicable law. The nature of digital goods and services
                                makes them non-returnable once access has been granted.
                            </p>
                        </section>

                        <section>
                            <h3 className="font-semibold text-foreground mb-3">3. Subscription Cancellation</h3>
                            <p className="text-sm mb-3">
                                You may cancel your subscription at any time through your account settings or by
                                contacting our support team. Upon cancellation:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    Your subscription will remain active until the end of your current billing period.
                                </li>
                                <li>
                                    You will not be charged for subsequent billing periods after cancellation.
                                </li>
                                <li>
                                    <strong>No refund will be issued</strong> for the remaining days of your
                                    current billing period or any prior billing periods.
                                </li>
                                <li>
                                    After the billing period ends, your account will revert to free tier access.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h3 className="font-semibold text-foreground mb-3">4. Exceptional Circumstances</h3>
                            <p className="text-sm">
                                Refunds may be considered solely at the discretion of Miten Solanki in cases of:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm mt-2">
                                <li>Duplicate or erroneous charges caused by payment processing errors</li>
                                <li>Unauthorized transactions (subject to verification and investigation)</li>
                            </ul>
                            <p className="text-sm mt-3">
                                Any such refund requests must be submitted within 7 days of the transaction
                                date with supporting documentation. Approval of refunds under exceptional
                                circumstances is not guaranteed and remains at our sole discretion.
                            </p>
                        </section>

                        <section>
                            <h3 className="font-semibold text-foreground mb-3">5. Legal Compliance</h3>
                            <p className="text-sm">
                                This no-refund policy is established in accordance with applicable consumer
                                protection laws governing digital services and intangible goods in India.
                                By making a purchase, you confirm that you have read, understood, and agreed
                                to this policy.
                            </p>
                        </section>

                        <div className="mt-8 p-4 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20">
                            <h3 className="font-semibold text-neon-cyan mb-2">📧 Contact Us</h3>
                            <p className="text-sm">
                                For any questions regarding this policy or to report payment issues, please
                                contact us at{' '}
                                <a href="mailto:catalystvibe2403@gmail.com" className="text-neon-cyan hover:underline">
                                    catalystvibe2403@gmail.com
                                </a>
                            </p>
                        </div>
                    </div>

                    <p className="text-xs text-muted-foreground border-t border-border/50 pt-4 mt-6">
                        <strong>Disclaimer:</strong> The above content is created at Miten Solanki's sole discretion.
                        Razorpay shall not be liable for any content provided here and shall not be responsible for
                        any claims and liability that may arise due to merchant's non-adherence to it.
                    </p>
                </div>
            </main>
        </div>
    );
};

export default CancellationsRefunds;
