import { useEffect, useState } from 'react';

// Server-side edge function: reads real client IP, does geo lookup, redirects to Telegram
// Deployed at: supabase/functions/tg-redirect/index.ts
const BOT_USERNAME = 'thisisriya_bot';
const REDIRECT_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tg-redirect`;

export default function TelegramRedirect() {
    const [status, setStatus] = useState<'loading' | 'redirecting'>('loading');

    useEffect(() => {
        setStatus('redirecting');
        // Hand off to edge function — it does geo server-side and 302s to Telegram
        window.location.href = REDIRECT_FUNCTION_URL;
    }, []);

    return (
        <div
            style={{
                minHeight: '100dvh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #0f0f0f 0%, #1a0a1e 100%)',
                fontFamily: 'system-ui, sans-serif',
                color: '#fff',
                gap: '20px',
                padding: '24px',
                textAlign: 'center',
            }}
        >
            {/* Avatar placeholder — replace src with actual Riya image if available */}
            <div
                style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #e91e8c, #9c27b0)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 36,
                    animation: 'pulse 1.5s ease-in-out infinite',
                }}
            >
                🫶
            </div>

            <p style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.3px' }}>
                {status === 'loading' ? 'just a sec...' : 'opening Telegram ✨'}
            </p>

            <p style={{ margin: 0, fontSize: 13, color: '#888', maxWidth: 260 }}>
                riya is waiting for you
            </p>

            {/* Fallback manual link in case auto-redirect is blocked (e.g. some mobile browsers) */}
            <a
                href={`https://t.me/${BOT_USERNAME}`}
                rel="noopener noreferrer"
                style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: '#555',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                }}
            >
                tap here if not redirected
            </a>

            <style>{`
                @keyframes pulse {
                    0%, 100% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.08); opacity: 0.85; }
                }
            `}</style>
        </div>
    );
}
