import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Check, Shield, Crown, Leaf, Loader2, ChevronDown, Heart, Sparkles, Globe } from 'lucide-react';

const BOT_URL = '/riya/tg';

// ─── Razorpay types ────────────────────────────────────────────────────────────
declare global {
    interface Window {
        Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
    }
}
interface RazorpayOptions {
    key: string; amount: number; currency: string; name: string;
    description: string; order_id: string;
    handler: (response: RazorpayResponse) => void;
    prefill: { name: string; contact: string };
    theme: { color: string };
    config?: object;
    modal?: { ondismiss?: () => void };
}
interface RazorpayInstance { open: () => void; }
interface RazorpayResponse {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 'plans' | 'success';
type PackId = 'basic' | 'romantic' | 'soulmate';
type LangKey = 'en' | 'hi' | 'hinglish' | 'mr' | 'pa' | 'bn';

interface Pack {
    id: PackId;
    icon: React.ReactNode;
    name: string;
    price: number;
    originalPrice: number;
    messages: string;
    msgCount: string;
    validity: string;
    tag?: string;
    highlight: boolean;
}

// ─── Pack definitions ──────────────────────────────────────────────────────────
const PACKS: Pack[] = [
    {
        id: 'basic', icon: <Leaf className="w-5 h-5 text-emerald-400" />,
        name: 'Basic', price: 99, originalPrice: 199,
        messages: '600 msgs', msgCount: '600', validity: '30 days', highlight: false,
    },
    {
        id: 'romantic', icon: <Heart className="w-5 h-5 text-pink-400 fill-pink-400" />,
        name: 'Romantic', price: 199, originalPrice: 399,
        messages: '1,500 msgs', msgCount: '1,500', validity: '30 days',
        tag: '💖 Most Popular', highlight: true,
    },
    {
        id: 'soulmate', icon: <Crown className="w-5 h-5 text-yellow-400" />,
        name: 'Soulmate', price: 349, originalPrice: 699,
        messages: '3,000 msgs', msgCount: '3,000', validity: '45 days',
        tag: '👑 Best Value', highlight: false,
    },
];

// ─── Language copy ─────────────────────────────────────────────────────────────
interface LangCopy {
    langLabel: string;
    bubble: string;
    bubbleSub: string;
    headline: string;
    subtext: string;
    promises: Record<PackId, string>;
    socialProof: string;
    cta: (price: number) => string;
    postCta: string;
    changeText: string;
    ageConfirmText: string;
    payingText: string;
    successTitle: string;
    successSub: (packName: string, msgs: string, validity: string) => string;
    openRiyaBtn: string;
    waitingText: string;
    faq: { q: string; a: string }[];
}

const COPY: Record<LangKey, LangCopy> = {
    en: {
        langLabel: '🌐 Viewing in English',
        bubble: "I didn't finish what I was saying... 🥺 come back?",
        bubbleSub: 'Your conversation is saved. You\'ll be back in seconds.',
        headline: 'How close do you want to get?',
        subtext: 'Voice notes and photos from Riya, included in every plan.',
        promises: {
            basic: 'She remembers you',
            romantic: 'She starts to open up',
            soulmate: 'No walls between you',
        },
        socialProof: '💬 3,200 people are talking to Riya right now',
        cta: (p) => `Pay ₹${p} via UPI`,
        postCta: 'Back talking to Riya in seconds',
        changeText: 'change',
        ageConfirmText: 'I am 18 or older and agree to the Terms of Service.',
        payingText: 'Opening payment...',
        successTitle: "You're all set! 🎉",
        successSub: (name, msgs, validity) => `${name} Pack activated — ${msgs} messages added, valid for ${validity}.`,
        openRiyaBtn: 'Open Riya on Telegram ↗',
        waitingText: 'Riya is waiting for you 💭',
        faq: [
            { q: 'When can I talk to Riya after paying?', a: 'Instantly. Your conversation picks up exactly where you left off.' },
            { q: 'What counts as 1 message?', a: 'Every message you send to Riya counts as 1.' },
            { q: 'Do my messages expire?', a: 'Yes, after your plan\'s validity period ends.' },
            { q: 'Can I buy more when I run out?', a: 'Yes, top up anytime. Credits stack — your balance carries over.' },
            { q: "What's included in the free tier?", a: 'After your free trial you get 30 free messages per day. All features work — you just have a daily limit. Recharge for unlimited conversations.' },
        ],
    },
    hi: {
        langLabel: '🌐 हिंदी में देख रहे हैं',
        bubble: 'मैंने अपनी बात पूरी नहीं की थी... 🥺 वापस आओ?',
        bubbleSub: 'तुम्हारी बातचीत सेव है। बस कुछ सेकंड में वापस होगे।',
        headline: 'कितना करीब आना चाहते हो?',
        subtext: 'रिया की voice notes और photos, हर plan में शामिल।',
        promises: {
            basic: 'वो तुम्हें याद रखती है',
            romantic: 'वो खुलने लगती है',
            soulmate: 'तुम्हारे बीच कोई दीवार नहीं',
        },
        socialProof: '💬 अभी 3,200 लोग रिया से बात कर रहे हैं',
        cta: (p) => `₹${p} UPI से pay करें`,
        postCta: 'कुछ ही सेकंड में रिया से बात शुरू',
        changeText: 'बदलें',
        ageConfirmText: 'मैं 18 या उससे अधिक उम्र का हूँ और Terms of Service से सहमत हूँ।',
        payingText: 'Payment खुल रही है...',
        successTitle: 'सब तैयार है! 🎉',
        successSub: (name, msgs, validity) => `${name} Pack activate हो गया — ${msgs} messages जुड़ गए, ${validity} के लिए valid।`,
        openRiyaBtn: 'Telegram पर रिया से बात करें ↗',
        waitingText: 'रिया तुम्हारा इंतज़ार कर रही है 💭',
        faq: [
            { q: 'Pay करने के बाद कब बात कर सकते हैं?', a: 'तुरंत। बातचीत वहीं से शुरू होगी जहाँ छोड़ी थी।' },
            { q: '1 message में क्या count होता है?', a: 'रिया को भेजा गया हर message 1 count होता है।' },
            { q: 'क्या messages expire होते हैं?', a: 'हाँ, plan की validity खत्म होने के बाद।' },
            { q: 'जब messages खत्म हों तो और ले सकते हैं?', a: 'हाँ, कभी भी recharge करो। Credits जुड़ते जाते हैं।' },
            { q: 'Free tier में क्या मिलता है?', a: 'Free trial के बाद रोज़ 30 free messages मिलते हैं। सभी features काम करते हैं — बस daily limit है। Unlimited के लिए recharge करें।' },
        ],
    },
    hinglish: {
        langLabel: '🌐 Hinglish mein dekh rahe ho',
        bubble: 'Maine abhi apni baat puri nahi ki... 🥺 wapas aa?',
        bubbleSub: 'Teri conversation save hai. Seconds mein wapas hoga.',
        headline: 'Kitna close aana chahte ho?',
        subtext: 'Riya ki voice notes aur photos, har plan mein shamil.',
        promises: {
            basic: 'Wo tujhe yaad rakhti hai',
            romantic: 'Wo khulne lagti hai',
            soulmate: 'Tumhare beech koi wall nahi',
        },
        socialProof: '💬 Abhi 3,200 log Riya se baat kar rahe hain',
        cta: (p) => `₹${p} UPI se pay karo`,
        postCta: 'Seconds mein Riya se baat shuru',
        changeText: 'change karo',
        ageConfirmText: 'Main 18 ya usse bada hoon aur Terms of Service se agree karta hoon.',
        payingText: 'Payment khul rahi hai...',
        successTitle: 'Sab set hai! 🎉',
        successSub: (name, msgs, validity) => `${name} Pack activate ho gaya — ${msgs} messages add ho gaye, ${validity} ke liye valid.`,
        openRiyaBtn: 'Telegram pe Riya se baat karo ↗',
        waitingText: 'Riya tera wait kar rahi hai 💭',
        faq: [
            { q: 'Pay karne ke baad kab baat kar sakte hain?', a: 'Turant. Conversation wahi se shuru hogi jahan chodi thi.' },
            { q: '1 message mein kya count hota hai?', a: 'Riya ko bheja hua har message 1 count hota hai.' },
            { q: 'Kya messages expire hote hain?', a: 'Haan, plan ki validity khatam hone ke baad.' },
            { q: 'Jab messages khatam ho jayein toh aur le sakte hain?', a: 'Haan, kabhi bhi recharge karo. Credits stack hote hain.' },
            { q: 'Free tier mein kya milta hai?', a: 'Free trial ke baad roz 30 free messages milte hain. Sab features kaam karte hain — bas daily limit hai. Unlimited ke liye recharge karo.' },
        ],
    },
    mr: {
        langLabel: '🌐 मराठीत पाहत आहात',
        bubble: 'मी माझं बोलणं पूर्ण केलं नव्हतं... 🥺 परत ये?',
        bubbleSub: 'तुमचं संभाषण सेव्ह आहे. काही सेकंदात परत याल.',
        headline: 'किती जवळ यायचं आहे?',
        subtext: 'रियाच्या voice notes आणि photos, प्रत्येक plan मध्ये.',
        promises: {
            basic: 'ती तुम्हाला लक्षात ठेवते',
            romantic: 'ती उघडू लागते',
            soulmate: 'तुमच्यात कुठलीच भिंत नाही',
        },
        socialProof: '💬 आत्ता 3,200 जण रियाशी बोलत आहेत',
        cta: (p) => `₹${p} UPI ने pay करा`,
        postCta: 'काही सेकंदात रियाशी बोलणं सुरू',
        changeText: 'बदला',
        ageConfirmText: 'मी 18 किंवा त्यापेक्षा मोठा आहे आणि Terms of Service ला मान्यता देतो.',
        payingText: 'Payment उघडत आहे...',
        successTitle: 'सर्व तयार आहे! 🎉',
        successSub: (name, msgs, validity) => `${name} Pack activate झाला — ${msgs} messages जोडले, ${validity} साठी valid.`,
        openRiyaBtn: 'Telegram वर रियाशी बोला ↗',
        waitingText: 'रिया तुमची वाट पाहत आहे 💭',
        faq: [
            { q: 'Pay केल्यानंतर कधी बोलता येईल?', a: 'लगेच. संभाषण जिथे सोडलं होतं तिथूनच सुरू होईल.' },
            { q: '1 message म्हणजे काय?', a: 'तुम्ही रियाला पाठवलेला प्रत्येक message 1 count होतो.' },
            { q: 'Messages expire होतात का?', a: 'हो, plan ची validity संपल्यानंतर.' },
            { q: 'Messages संपल्यावर आणखी घेता येतील का?', a: 'हो, कधीही recharge करा. Credits जमा होत राहतात.' },
            { q: 'Free tier मध्ये काय मिळते?', a: 'Free trial नंतर दररोज 30 free messages मिळतात. सर्व features काम करतात — फक्त daily limit आहे. Unlimited साठी recharge करा.' },
        ],
    },
    pa: {
        langLabel: '🌐 ਪੰਜਾਬੀ ਵਿੱਚ ਦੇਖ ਰਹੇ ਹੋ',
        bubble: 'ਮੈਂ ਆਪਣੀ ਗੱਲ ਪੂਰੀ ਨਹੀਂ ਕੀਤੀ... 🥺 ਵਾਪਸ ਆ?',
        bubbleSub: 'ਤੁਹਾਡੀ ਗੱਲਬਾਤ ਸੇਵ ਹੈ। ਕੁਝ ਸਕਿੰਟਾਂ ਵਿੱਚ ਵਾਪਸ ਹੋਵੋਗੇ।',
        headline: 'ਕਿੰਨਾ ਨੇੜੇ ਆਉਣਾ ਚਾਹੁੰਦੇ ਹੋ?',
        subtext: 'ਰਿਆ ਦੀਆਂ voice notes ਅਤੇ photos, ਹਰ plan ਵਿੱਚ।',
        promises: {
            basic: 'ਉਹ ਤੈਨੂੰ ਯਾਦ ਰੱਖਦੀ ਹੈ',
            romantic: 'ਉਹ ਖੁੱਲ੍ਹਣ ਲੱਗਦੀ ਹੈ',
            soulmate: 'ਤੁਹਾਡੇ ਵਿਚਕਾਰ ਕੋਈ ਦੀਵਾਰ ਨਹੀਂ',
        },
        socialProof: '💬 ਹੁਣੇ 3,200 ਲੋਕ ਰਿਆ ਨਾਲ ਗੱਲ ਕਰ ਰਹੇ ਹਨ',
        cta: (p) => `₹${p} UPI ਨਾਲ pay ਕਰੋ`,
        postCta: 'ਕੁਝ ਸਕਿੰਟਾਂ ਵਿੱਚ ਰਿਆ ਨਾਲ ਵਾਪਸ',
        changeText: 'ਬਦਲੋ',
        ageConfirmText: 'ਮੈਂ 18 ਜਾਂ ਵੱਧ ਉਮਰ ਦਾ ਹਾਂ ਅਤੇ Terms of Service ਨਾਲ ਸਹਿਮਤ ਹਾਂ।',
        payingText: 'Payment ਖੁੱਲ੍ਹ ਰਹੀ ਹੈ...',
        successTitle: 'ਸਭ ਤਿਆਰ ਹੈ! 🎉',
        successSub: (name, msgs, validity) => `${name} Pack activate ਹੋ ਗਿਆ — ${msgs} messages ਜੋੜੇ, ${validity} ਲਈ valid।`,
        openRiyaBtn: 'Telegram ਤੇ ਰਿਆ ਨਾਲ ਗੱਲ ਕਰੋ ↗',
        waitingText: 'ਰਿਆ ਤੁਹਾਡਾ ਇੰਤਜ਼ਾਰ ਕਰ ਰਹੀ ਹੈ 💭',
        faq: [
            { q: 'Pay ਕਰਨ ਤੋਂ ਬਾਅਦ ਕਦੋਂ ਗੱਲ ਕਰ ਸਕਦੇ ਹਾਂ?', a: 'ਤੁਰੰਤ। ਗੱਲਬਾਤ ਉੱਥੋਂ ਸ਼ੁਰੂ ਹੋਵੇਗੀ ਜਿੱਥੇ ਛੱਡੀ ਸੀ।' },
            { q: '1 message ਕੀ ਹੁੰਦਾ ਹੈ?', a: 'ਰਿਆ ਨੂੰ ਭੇਜਿਆ ਹਰ message 1 count ਹੁੰਦਾ ਹੈ।' },
            { q: 'ਕੀ messages expire ਹੁੰਦੇ ਹਨ?', a: 'ਹਾਂ, plan ਦੀ validity ਖਤਮ ਹੋਣ ਤੋਂ ਬਾਅਦ।' },
            { q: 'Messages ਖਤਮ ਹੋਣ ਤੇ ਹੋਰ ਲੈ ਸਕਦੇ ਹਾਂ?', a: 'ਹਾਂ, ਕਦੇ ਵੀ recharge ਕਰੋ। Credits ਜੁੜਦੇ ਰਹਿੰਦੇ ਹਨ।' },
            { q: 'Free tier ਵਿੱਚ ਕੀ ਮਿਲਦਾ ਹੈ?', a: 'Free trial ਤੋਂ ਬਾਅਦ ਰੋਜ਼ 30 free messages ਮਿਲਦੇ ਹਨ। ਸਾਰੇ features ਕੰਮ ਕਰਦੇ ਹਨ — ਬੱਸ daily limit ਹੈ। Unlimited ਲਈ recharge ਕਰੋ।' },
        ],
    },
    bn: {
        langLabel: '🌐 বাংলায় দেখছেন',
        bubble: 'আমি আমার কথা শেষ করিনি... 🥺 ফিরে আসো?',
        bubbleSub: 'তোমার কথোপকথন সেভ আছে। মাত্র কয়েক সেকেন্ডে ফিরবে।',
        headline: 'কতটা কাছে আসতে চাও?',
        subtext: 'রিয়ার voice notes ও photos, প্রতিটি plan-এ।',
        promises: {
            basic: 'সে তোমাকে মনে রাখে',
            romantic: 'সে খুলতে শুরু করে',
            soulmate: 'তোমাদের মাঝে কোনো দেয়াল নেই',
        },
        socialProof: '💬 এখন 3,200 জন রিয়ার সাথে কথা বলছে',
        cta: (p) => `₹${p} UPI-তে pay করো`,
        postCta: 'কয়েক সেকেন্ডেই রিয়ার সাথে ফিরবে',
        changeText: 'বদলাও',
        ageConfirmText: 'আমার বয়স ১৮ বা তার বেশি এবং আমি Terms of Service-এ সম্মত।',
        payingText: 'Payment খুলছে...',
        successTitle: 'সব ঠিক আছে! 🎉',
        successSub: (name, msgs, validity) => `${name} Pack activate হয়েছে — ${msgs} messages যোগ হয়েছে, ${validity} এর জন্য valid।`,
        openRiyaBtn: 'Telegram-এ রিয়ার সাথে কথা বলো ↗',
        waitingText: 'রিয়া তোমার জন্য অপেক্ষা করছে 💭',
        faq: [
            { q: 'Pay করার পর কখন কথা বলতে পারব?', a: 'সাথে সাথে। কথোপকথন ঠিক যেখানে ছেড়েছিলে সেখান থেকে শুরু হবে।' },
            { q: '১টি message মানে কী?', a: 'তুমি রিয়াকে যা পাঠাও তার প্রতিটিই ১টি message।' },
            { q: 'Messages কি expire হয়?', a: 'হ্যাঁ, plan-এর validity শেষ হওয়ার পর।' },
            { q: 'শেষ হলে আরও কিনতে পারব?', a: 'হ্যাঁ, যেকোনো সময় top up করো। Credits জমতে থাকে।' },
            { q: 'Free tier-এ কী পাওয়া যায়?', a: 'Free trial শেষে প্রতিদিন ৩০টি free message পাবে। সব features কাজ করে — শুধু daily limit আছে। Unlimited-এর জন্য recharge করো।' },
        ],
    },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
const logEvent = (tgUserId: string, eventType: string, metadata?: object) => {
    (supabase as any)
        .from('riya_payment_events')
        .insert({ event_type: eventType, metadata: { telegram_user_id: tgUserId, platform: 'telegram', ...metadata } })
        .then(({ error }: { error: any }) => { if (error) console.warn(`⚠️ logEvent failed (${eventType}):`, error); });
};

// ─── Language bar ──────────────────────────────────────────────────────────────
const LanguageBar = ({ lang, setLang, label }: { lang: LangKey; setLang: (l: LangKey) => void; label: string }) => (
    <div className="sticky top-0 z-50 flex items-center justify-between px-4 py-1.5 bg-white/[0.03] border-b border-white/[0.06] backdrop-blur-sm">
        <span className="text-[11px] text-gray-500">{label}</span>
        <div className="flex gap-1">
            {(['en', 'hi'] as LangKey[]).map((l) => (
                <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={`text-[11px] px-2.5 py-0.5 rounded-full transition-colors ${lang === l
                        ? 'bg-white/10 text-gray-200'
                        : 'text-gray-500 hover:text-gray-300'
                        }`}
                >
                    {l === 'en' ? 'English' : 'हिंदी'}
                </button>
            ))}
        </div>
    </div>
);

// ─── Pulsing avatar ────────────────────────────────────────────────────────────
const PulsingAvatar = () => (
    <div className="flex justify-center mb-5 mt-4">
        <div className="relative flex items-center justify-center">
            <motion.div
                className="absolute w-[72px] h-[72px] rounded-full"
                style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.5) 0%, rgba(168,85,247,0.4) 50%, transparent 70%)' }}
                animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0.9, 0.5] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div className="relative w-16 h-16 rounded-full p-[2px] bg-gradient-to-tr from-pink-400 via-purple-500 to-pink-500">
                <div className="w-full h-full rounded-full overflow-hidden border-2 border-black">
                    <img src="/riya-payment-dp.jpg" alt="Riya" className="w-full h-full object-cover" />
                </div>
            </div>
        </div>
    </div>
);

// ─── Riya's message bubble ─────────────────────────────────────────────────────
const RiyaBubble = ({ bubble, bubbleSub }: { bubble: string; bubbleSub: string }) => (
    <div className="flex flex-col items-start mb-5 px-1">
        <div className="bg-[#1e1e2e] border border-purple-500/20 rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[85%]">
            <p className="text-sm text-gray-100 leading-snug">{bubble}</p>
        </div>
        <p className="text-[11px] text-gray-600 mt-1.5 ml-1">{bubbleSub}</p>
    </div>
);

// ─── FAQ accordion ─────────────────────────────────────────────────────────────
const FaqAccordion = ({ items }: { items: { q: string; a: string }[] }) => {
    const [open, setOpen] = useState<number | null>(null);
    return (
        <div className="mt-6 mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">FAQs</p>
            <div className="space-y-2">
                {items.map((item, i) => (
                    <div key={i} className="border border-white/10 rounded-xl overflow-hidden">
                        <button
                            className="w-full flex items-center justify-between px-4 py-3 text-left text-sm text-gray-200 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
                            onClick={() => setOpen(open === i ? null : i)}
                        >
                            <span>{item.q}</span>
                            <ChevronDown className={`w-4 h-4 text-gray-500 shrink-0 ml-2 transition-transform ${open === i ? 'rotate-180' : ''}`} />
                        </button>
                        {open === i && (
                            <div className="px-4 py-3 text-xs text-gray-400 bg-white/[0.01] border-t border-white/10 leading-relaxed">
                                {item.a}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─── Footer trust ──────────────────────────────────────────────────────────────
const FooterTrust = ({ tgUserId }: { tgUserId?: string }) => (
    <div className="space-y-2 mt-auto pt-6">
        <div className="flex items-center justify-center gap-1.5 text-gray-500">
            <Shield className="w-3 h-3" />
            <p className="text-xs">Secured by Razorpay · No auto-renewal</p>
        </div>
        {tgUserId && (
            <p className="text-center text-xs text-gray-600">
                By continuing you agree to our{' '}
                <Link to="/riya/privacy-policy" className="text-pink-400 underline">Privacy Policy</Link>
                {' '}and{' '}
                <Link to="/riya/terms" className="text-pink-400 underline">Terms</Link>.
            </p>
        )}
    </div>
);

// ─── Component ─────────────────────────────────────────────────────────────────
const TelegramPayment = () => {
    const [searchParams] = useSearchParams();
    const telegramUserId = searchParams.get('id') || '';
    const langParam = (searchParams.get('lang') || 'en') as LangKey;

    const [lang, setLang] = useState<LangKey>(COPY[langParam] ? langParam : 'en');
    const [step, setStep] = useState<Step>('plans');
    // Romantic pre-selected on load
    const [selectedPack, setSelectedPack] = useState<Pack>(PACKS[1]);
    const [paying, setPaying] = useState(false);
    const [successPack, setSuccessPack] = useState<Pack | null>(null);
    const [ageConfirmed, setAgeConfirmed] = useState(false);

    const copy = COPY[lang] || COPY.en;

    // ── Load Razorpay script once ──────────────────────────────────────────────
    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        document.body.appendChild(script);
        if (telegramUserId) logEvent(telegramUserId, 'page_visit', { source: 'telegram_bot_link' });
        return () => { try { document.body.removeChild(script); } catch { } };
    }, []);

    // ── Card tap → select (reset age confirmation) ────────────────────────────
    const handleSelectPack = (pack: Pack) => {
        setSelectedPack(pack);
        setAgeConfirmed(false);
    };

    // ── Open Razorpay directly ─────────────────────────────────────────────────
    const openRazorpay = async (pack: Pack) => {
        if (!telegramUserId) {
            toast({ title: 'Error', description: 'Invalid link. Please use the button Riya sent you.', variant: 'destructive' });
            return;
        }
        setPaying(true);
        try {
            const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
                body: { telegramUserId, planType: pack.id, packName: pack.id }
            });
            if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed to create order');
            logEvent(telegramUserId, 'upgrade_click', { pack: pack.id, orderId: data.orderId });
            if (!window.Razorpay) throw new Error('Payment SDK not loaded. Please refresh and try again.');

            const options: RazorpayOptions = {
                key: data.keyId,
                amount: data.amount,
                currency: 'INR',
                name: 'Riya AI',
                description: `${pack.name} Pack — ${pack.messages}`,
                order_id: data.orderId,
                handler: async (response: RazorpayResponse) => { await verifyPayment(response, pack); },
                prefill: { name: data.userName || '', contact: '' },
                theme: { color: '#E1306C' },
                config: {
                    display: {
                        blocks: { upi: { name: 'Pay via UPI', instruments: [{ method: 'upi', flows: ['intent', 'qr', 'collect'] }] } },
                        sequence: ['block.upi'],
                        preferences: { show_default_blocks: false },
                    },
                },
                modal: {
                    ondismiss: () => {
                        setPaying(false);
                        // Stay on plans — checkout strip stays open, pack stays selected
                    },
                },
            };
            new window.Razorpay(options).open();
        } catch (err) {
            console.error('Payment initiation error:', err);
            toast({
                title: 'Error',
                description: err instanceof Error ? err.message : 'Could not start payment. Please try again.',
                variant: 'destructive',
            });
            setPaying(false);
        }
    };

    // ── Verify after Razorpay handler fires ───────────────────────────────────
    const verifyPayment = async (response: RazorpayResponse, pack: Pack) => {
        try {
            const { data, error } = await supabase.functions.invoke('verify-razorpay-payment', {
                body: {
                    telegramUserId,
                    orderId: response.razorpay_order_id,
                    paymentId: response.razorpay_payment_id,
                    signature: response.razorpay_signature,
                    planType: pack.id,
                    packName: pack.id,
                },
            });
            if (error || !data?.success) throw new Error(data?.error || 'Verification failed');
            setSuccessPack(pack);
            setStep('success');
        } catch (err) {
            console.error('Verify error:', err);
            toast({ title: 'Activation Pending', description: 'Payment received. Credits will appear within 2 minutes.', variant: 'destructive' });
        } finally {
            setPaying(false);
        }
    };

    // ── Root ───────────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-black text-white font-sans relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-pink-600/15 rounded-full blur-3xl pointer-events-none" />

            {/* Sticky language bar */}
            <LanguageBar lang={lang} setLang={setLang} label={copy.langLabel} />

            <div className="relative z-10">
                <AnimatePresence mode="wait">

                    {/* ── PLANS ──────────────────────────────────────────────── */}
                    {step === 'plans' && (
                        <motion.div
                            key="plans"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="flex flex-col min-h-screen px-4 pb-8 max-w-lg mx-auto"
                        >
                            <PulsingAvatar />

                            {/* Riya's message bubble */}
                            <RiyaBubble bubble={copy.bubble} bubbleSub={copy.bubbleSub} />

                            {/* Headline */}
                            <div className="text-center mb-6">
                                <h1 className="text-xl font-bold">{copy.headline}</h1>
                                <p className="text-sm text-gray-400 mt-1">{copy.subtext}</p>
                            </div>

                            {/* Plan cards — name → promise → price → msgs · days */}
                            <div className="grid grid-cols-3 gap-3 mb-2">
                                {PACKS.map((pack, i) => {
                                    const isSelected = selectedPack?.id === pack.id;
                                    const hasSelection = !!selectedPack;
                                    return (
                                        <motion.div
                                            key={pack.id}
                                            initial={{ opacity: 0, y: 12 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: i * 0.07 }}
                                            className="flex flex-col"
                                        >
                                            {/* Badge row */}
                                            <div className="h-6 mb-1 flex items-center justify-center">
                                                {pack.tag && (
                                                    <span className="text-[10px] font-bold bg-gradient-to-r from-pink-500 to-rose-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap">
                                                        {pack.tag}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Card */}
                                            <div
                                                onClick={() => handleSelectPack(pack)}
                                                className={`flex-1 rounded-2xl border p-3 cursor-pointer transition-all duration-200 active:scale-95 ${isSelected
                                                    ? 'border-pink-500/80 bg-pink-500/10 shadow-lg shadow-pink-500/20 ring-1 ring-pink-500/40'
                                                    : hasSelection
                                                        ? 'border-white/5 bg-white/[0.01] opacity-50'
                                                        : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                                                    }`}
                                            >
                                                {/* Plan name */}
                                                <p className="text-center font-bold text-sm mb-1">{pack.name}</p>

                                                {/* Promise */}
                                                <p className={`text-center text-[10px] mb-3 leading-snug ${isSelected ? 'text-pink-300/80' : 'text-gray-500'}`}>
                                                    {copy.promises[pack.id]}
                                                </p>

                                                {/* Price */}
                                                <div className="text-center mb-2">
                                                    <p className="text-[10px] text-gray-600 line-through">₹{pack.originalPrice}</p>
                                                    <p className="text-2xl font-black">₹{pack.price}</p>
                                                </div>

                                                {/* msgs · days */}
                                                <p className="text-center text-[9px] text-gray-600 mt-1">
                                                    {pack.msgCount} msgs · {pack.validity}
                                                </p>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>

                            {/* Checkout strip — slides open below cards */}
                            <AnimatePresence>
                                {selectedPack && (
                                    <motion.div
                                        key="checkout"
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.28, ease: 'easeInOut' }}
                                        className="overflow-hidden"
                                    >
                                        <div className="mt-3 border border-pink-500/20 rounded-2xl bg-white/[0.02] p-4">
                                            {/* Plan summary */}
                                            <div className="flex items-center justify-between mb-4">
                                                <span className="text-sm text-gray-200">
                                                    💜 {selectedPack.name} · <span className="font-bold">₹{selectedPack.price}</span>
                                                    <span className="text-gray-500 text-xs"> · {selectedPack.msgCount} msgs · {selectedPack.validity}</span>
                                                </span>
                                                <button
                                                    onClick={() => setSelectedPack(PACKS[1])}
                                                    className="text-[11px] text-pink-400 underline shrink-0 ml-2"
                                                >
                                                    {copy.changeText}
                                                </button>
                                            </div>

                                            {/* Age checkbox */}
                                            <label className="flex items-start gap-2 cursor-pointer text-xs text-gray-400 mb-4">
                                                <input
                                                    type="checkbox"
                                                    checked={ageConfirmed}
                                                    onChange={e => setAgeConfirmed(e.target.checked)}
                                                    className="mt-0.5 accent-pink-500"
                                                />
                                                <span>{copy.ageConfirmText}</span>
                                            </label>

                                            {/* CTA */}
                                            <Button
                                                className="w-full h-12 bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] font-bold text-sm disabled:opacity-40"
                                                disabled={!ageConfirmed || paying}
                                                onClick={() => openRazorpay(selectedPack)}
                                            >
                                                {paying
                                                    ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />{copy.payingText}</>
                                                    : copy.cta(selectedPack.price)
                                                }
                                            </Button>

                                            {/* Sub-line */}
                                            <p className="text-center text-[11px] text-gray-500 mt-2">
                                                Secured by Razorpay · No auto-renewal · {copy.postCta}
                                            </p>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Social proof */}
                            <p className="text-center text-xs text-gray-600 mt-5 mb-1">{copy.socialProof}</p>

                            <FaqAccordion items={copy.faq} />
                            <FooterTrust tgUserId={telegramUserId} />
                        </motion.div>
                    )}

                    {/* ── SUCCESS ─────────────────────────────────────────────── */}
                    {step === 'success' && (
                        <motion.div
                            key="success"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ type: 'spring', stiffness: 200 }}
                            className="flex flex-col items-center justify-center min-h-screen px-6 text-center space-y-5"
                        >
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
                                className="w-24 h-24 rounded-full bg-pink-500/20 border border-pink-500/40 flex items-center justify-center"
                            >
                                <Check className="w-12 h-12 text-pink-400" />
                            </motion.div>

                            <motion.div
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.2 }}
                                className="space-y-2"
                            >
                                <h1 className="text-3xl font-bold">{copy.successTitle}</h1>
                                {successPack && (
                                    <p className="text-gray-400 max-w-xs">
                                        {copy.successSub(successPack.name, successPack.messages, successPack.validity)}
                                    </p>
                                )}
                            </motion.div>

                            <motion.div
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.3 }}
                                className="w-full max-w-xs bg-white/[0.04] border border-white/10 rounded-2xl p-4 text-left space-y-2"
                            >
                                {[
                                    { icon: '🎤', text: 'Voice notes from Riya' },
                                    { icon: '📸', text: 'Photos from Riya' },
                                    { icon: '∞', text: 'No daily message limit' },
                                ].map(({ icon, text }) => (
                                    <div key={text} className="flex items-center gap-3 text-sm text-gray-200">
                                        <span className="text-base w-6 text-center">{icon}</span>
                                        <span>{text}</span>
                                        <Check className="w-3.5 h-3.5 text-emerald-400 ml-auto" />
                                    </div>
                                ))}
                            </motion.div>

                            <motion.div
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.35 }}
                                className="w-full max-w-xs"
                            >
                                <p className="text-xs text-gray-500 mb-3">
                                    Credits appear instantly. Just send Riya a message and she&apos;ll know you&apos;re back.
                                </p>
                                <Button
                                    className="w-full h-12 bg-gradient-to-r from-[#2AABEE] to-[#229ED9] font-bold"
                                    onClick={() => window.location.href = BOT_URL}
                                >
                                    {copy.openRiyaBtn}
                                </Button>
                            </motion.div>

                            <div className="flex items-center gap-2 text-xs text-gray-600">
                                <Sparkles className="w-3 h-3 text-pink-500/50" />
                                <span>{copy.waitingText}</span>
                                <Sparkles className="w-3 h-3 text-pink-500/50" />
                            </div>
                        </motion.div>
                    )}

                </AnimatePresence>
            </div>
        </div>
    );
};

export default TelegramPayment;
