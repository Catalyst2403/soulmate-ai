import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Terms & Conditions Page
 * Content sourced from Razorpay policy generator
 */
const TermsAndConditions = () => {
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
                        Terms & Conditions
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
                            For the purpose of these Terms and Conditions, The term "we", "us", "our" used
                            anywhere on this page shall mean Miten Solanki, whose registered/operational office
                            is Bh2, LNMIIT Jaipur RAJASTHAN 302031. "you", "your", "user", "visitor" shall mean
                            any natural or legal person who is visiting our website and/or agreed to purchase from us.
                        </p>

                        <p className="font-medium">
                            Your use of the website and/or purchase from us are governed by following Terms and Conditions:
                        </p>

                        <ul className="list-disc pl-6 space-y-3">
                            <li>
                                The content of the pages of this website is subject to change without notice.
                            </li>
                            <li>
                                Neither we nor any third parties provide any warranty or guarantee as to the accuracy,
                                timeliness, performance, completeness or suitability of the information and materials
                                found or offered on this website for any particular purpose. You acknowledge that such
                                information and materials may contain inaccuracies or errors and we expressly exclude
                                liability for any such inaccuracies or errors to the fullest extent permitted by law.
                            </li>
                            <li>
                                Your use of any information or materials on our website and/or product pages is entirely
                                at your own risk, for which we shall not be liable. It shall be your own responsibility
                                to ensure that any products, services or information available through our website and/or
                                product pages meet your specific requirements.
                            </li>
                            <li>
                                Our website contains material which is owned by or licensed to us. This material includes,
                                but is not limited to, the design, layout, look, appearance and graphics. Reproduction is
                                prohibited other than in accordance with the copyright notice, which forms part of these
                                terms and conditions.
                            </li>
                            <li>
                                All trademarks reproduced in our website which are not the property of, or licensed to,
                                the operator are acknowledged on the website.
                            </li>
                            <li>
                                Unauthorized use of information provided by us shall give rise to a claim for damages
                                and/or be a criminal offense.
                            </li>
                            <li>
                                From time to time our website may also include links to other websites. These links are
                                provided for your convenience to provide further information.
                            </li>
                            <li>
                                You may not create a link to our website from another website or document without
                                Miten Solanki's prior written consent.
                            </li>
                            <li>
                                Any dispute arising out of use of our website and/or purchase with us and/or any
                                engagement with us is subject to the laws of India.
                            </li>
                            <li>
                                We shall be under no liability whatsoever in respect of any loss or damage arising
                                directly or indirectly out of the decline of authorization for any Transaction, on
                                Account of the Cardholder having exceeded the preset limit mutually agreed by us with
                                our acquiring bank from time to time.
                            </li>
                        </ul>
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

export default TermsAndConditions;
