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
                        Last updated on Dec 27th 2025
                    </p>

                    <div className="prose prose-invert max-w-none space-y-4 text-foreground/90">
                        <p>
                            For International buyers, orders are shipped and delivered through registered
                            international courier companies and/or International speed post only. For domestic
                            buyers, orders are shipped through registered domestic courier companies and/or
                            speed post only.
                        </p>

                        <p>
                            Orders are shipped within 0-7 days or as per the delivery date agreed at the time
                            of order confirmation and delivering of the shipment subject to Courier Company /
                            post office norms.
                        </p>

                        <p>
                            Miten Solanki is not liable for any delay in delivery by the courier company /
                            postal authorities and only guarantees to hand over the consignment to the courier
                            company or postal authorities within 0-7 days from the date of the order and payment
                            or as per the delivery date agreed at the time of order confirmation.
                        </p>

                        <p>
                            Delivery of all orders will be to the address provided by the buyer. Delivery of our
                            services will be confirmed on your mail ID as specified during registration.
                        </p>

                        <div className="mt-8 p-4 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20">
                            <h3 className="font-semibold text-neon-cyan mb-2">Need Help?</h3>
                            <p className="text-sm">
                                For any issues in utilizing our services you may contact our helpdesk at{' '}
                                <a href="tel:8511173773" className="text-neon-cyan hover:underline">8511173773</a>{' '}
                                or{' '}
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
