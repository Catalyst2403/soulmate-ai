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
                        Last updated on Dec 27th 2025
                    </p>

                    <div className="prose prose-invert max-w-none space-y-4 text-foreground/90">
                        <p>
                            Miten Solanki believes in helping its customers as far as possible, and has
                            therefore a liberal cancellation policy. Under this policy:
                        </p>

                        <div className="space-y-4">
                            <div className="p-4 rounded-lg bg-foreground/5 border border-border/50">
                                <h3 className="font-semibold text-foreground mb-2">📋 Cancellations</h3>
                                <p className="text-sm">
                                    Cancellations will be considered only if the request is made within 7 days
                                    of placing the order. However, the cancellation request may not be entertained
                                    if the orders have been communicated to the vendors/merchants and they have
                                    initiated the process of shipping them.
                                </p>
                            </div>

                            <div className="p-4 rounded-lg bg-foreground/5 border border-border/50">
                                <h3 className="font-semibold text-foreground mb-2">🔍 Product Not as Described</h3>
                                <p className="text-sm">
                                    In case you do not like the chatbot experience, we'll refund your money within 7 days of your purchase.
                                </p>
                            </div>
                        </div>

                        <div className="mt-8 p-4 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20">
                            <h3 className="font-semibold text-neon-cyan mb-2">💳 Refund Processing</h3>
                            <p className="text-sm">
                                In case of any Refunds approved by Miten Solanki, it'll take{' '}
                                <strong>3-5 business days</strong> for the refund to be processed to the end customer.
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
