import { Link } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, MapPin, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Contact Us Page
 * Contact information for customer support
 */
const ContactUs = () => {
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
                        Contact Us
                    </h1>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-3xl mx-auto px-4 py-8">
                <div className="glass-card p-6 md:p-8 space-y-8">
                    {/* Intro */}
                    <div className="text-center space-y-2">
                        <h2 className="text-2xl font-bold text-foreground">
                            We're Here to Help 💬
                        </h2>
                        <p className="text-muted-foreground">
                            Have questions or need assistance? Reach out to us through any of the channels below.
                        </p>
                    </div>

                    {/* Contact Cards */}
                    <div className="grid gap-4 md:grid-cols-2">
                        {/* Phone */}
                        <a
                            href="tel:8511173773"
                            className="p-6 rounded-xl bg-foreground/5 border border-border/50 hover:border-neon-cyan/50 hover:bg-neon-cyan/5 transition-all group"
                        >
                            <div className="flex items-start gap-4">
                                <div className="p-3 rounded-lg bg-neon-cyan/10 text-neon-cyan group-hover:bg-neon-cyan/20 transition-colors">
                                    <Phone className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-foreground mb-1">Phone</h3>
                                    <p className="text-neon-cyan font-medium">+91 8511173773</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Tap to call us directly
                                    </p>
                                </div>
                            </div>
                        </a>

                        {/* Email */}
                        <a
                            href="mailto:catalystvibe2403@gmail.com"
                            className="p-6 rounded-xl bg-foreground/5 border border-border/50 hover:border-neon-magenta/50 hover:bg-neon-magenta/5 transition-all group"
                        >
                            <div className="flex items-start gap-4">
                                <div className="p-3 rounded-lg bg-neon-magenta/10 text-neon-magenta group-hover:bg-neon-magenta/20 transition-colors">
                                    <Mail className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-foreground mb-1">Email</h3>
                                    <p className="text-neon-magenta font-medium break-all">
                                        catalystvibe2403@gmail.com
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        We'll respond within 24 hours
                                    </p>
                                </div>
                            </div>
                        </a>
                    </div>

                    {/* Additional Info */}
                    <div className="grid gap-4 md:grid-cols-2">
                        {/* Address */}
                        <div className="p-6 rounded-xl bg-foreground/5 border border-border/50">
                            <div className="flex items-start gap-4">
                                <div className="p-3 rounded-lg bg-foreground/10 text-foreground/70">
                                    <MapPin className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-foreground mb-1">Address</h3>
                                    <p className="text-sm text-muted-foreground">
                                        Bh2, LNMIIT<br />
                                        Jaipur, Rajasthan 302031<br />
                                        India
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Business Hours */}
                        <div className="p-6 rounded-xl bg-foreground/5 border border-border/50">
                            <div className="flex items-start gap-4">
                                <div className="p-3 rounded-lg bg-foreground/10 text-foreground/70">
                                    <Clock className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-foreground mb-1">Business Hours</h3>
                                    <p className="text-sm text-muted-foreground">
                                        Monday - Saturday<br />
                                        10:00 AM - 6:00 PM IST
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* FAQ Section */}
                    <div className="border-t border-border/50 pt-6">
                        <h3 className="font-semibold text-foreground mb-4">Frequently Asked Questions</h3>
                        <div className="space-y-4">
                            <div className="p-4 rounded-lg bg-foreground/5">
                                <h4 className="font-medium text-foreground text-sm mb-1">
                                    How do I cancel my subscription?
                                </h4>
                                <p className="text-xs text-muted-foreground">
                                    You can cancel your subscription anytime from your account settings.
                                    Please refer to our Cancellation & Refund Policy for more details.
                                </p>
                            </div>
                            <div className="p-4 rounded-lg bg-foreground/5">
                                <h4 className="font-medium text-foreground text-sm mb-1">
                                    How long does it take to get a refund?
                                </h4>
                                <p className="text-xs text-muted-foreground">
                                    Once approved, refunds are processed within 3-5 business days.
                                </p>
                            </div>
                            <div className="p-4 rounded-lg bg-foreground/5">
                                <h4 className="font-medium text-foreground text-sm mb-1">
                                    Is my data secure?
                                </h4>
                                <p className="text-xs text-muted-foreground">
                                    Yes, we use industry-standard encryption to protect your data.
                                    Please read our Privacy Policy for more details.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default ContactUs;
