import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Shipping & Delivery Policy Page
 * Content sourced from Razorpay policy generator
 */
const ShippingPolicy = () => {
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
                        Shipping & Delivery Policy
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
                        <div className="p-4 rounded-lg bg-neon-cyan/10 border border-neon-cyan/30 mb-6">
                            <p className="text-sm font-semibold text-neon-cyan">
                                ℹ️ Riya AI is a digital service. There are no physical products or shipments involved.
                            </p>
                        </div>

                        <section>
                            <h3 className="font-semibold text-foreground mb-3">1. Nature of Service</h3>
                            <p className="text-sm">
                                Riya AI is an artificial intelligence-powered digital companion service delivered
                                entirely online. As a purely digital service, there are no physical goods, products,
                                or materials to be shipped or delivered to any address.
                            </p>
                        </section>

                        <section>
                            <h3 className="font-semibold text-foreground mb-3">2. Instant Digital Delivery</h3>
                            <p className="text-sm mb-3">
                                Upon successful completion of payment for any subscription or premium service:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    <strong>Immediate Access:</strong> Premium features are activated instantly
                                    and are immediately available on your registered account.
                                </li>
                                <li>
                                    <strong>No Waiting Period:</strong> There is no processing or shipping time.
                                    Your upgraded access begins the moment your payment is confirmed.
                                </li>
                                <li>
                                    <strong>Email Confirmation:</strong> A confirmation of your purchase and
                                    service activation will be sent to your registered email address.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h3 className="font-semibold text-foreground mb-3">3. Service Availability</h3>
                            <p className="text-sm">
                                Our digital service is accessible 24 hours a day, 7 days a week, from anywhere
                                in the world with an internet connection. While we strive for 99.9% uptime,
                                we do not guarantee uninterrupted access and are not liable for temporary
                                unavailability due to:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm mt-2">
                                <li>Scheduled maintenance and system updates</li>
                                <li>Technical issues beyond our reasonable control</li>
                                <li>Third-party service provider outages</li>
                                <li>Internet connectivity issues on the user's end</li>
                            </ul>
                        </section>

                        <section>
                            <h3 className="font-semibold text-foreground mb-3">4. Access Requirements</h3>
                            <p className="text-sm">
                                To access Riya AI services, you will need:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm mt-2">
                                <li>A compatible device (smartphone, tablet, or computer)</li>
                                <li>A stable internet connection</li>
                                <li>A modern web browser</li>
                                <li>A valid registered account</li>
                            </ul>
                        </section>

                        <div className="mt-8 p-4 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20">
                            <h3 className="font-semibold text-neon-cyan mb-2">📧 Need Help?</h3>
                            <p className="text-sm">
                                If you experience any issues accessing our service after payment, please
                                contact us immediately at{' '}
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

export default ShippingPolicy;
