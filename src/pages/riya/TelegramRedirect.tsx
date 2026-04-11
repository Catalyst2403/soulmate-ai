import { useEffect, useState } from 'react';

const BOT_USERNAME = 'thisisriya_bot';

function sanitizeParam(value: string): string {
    // Keep only letters, spaces, hyphens — then trim and replace spaces with hyphens
    return value.replace(/[^A-Za-z\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 30);
}

function buildStartParam(city: string, regionCode: string): string {
    const c = sanitizeParam(city);
    const r = sanitizeParam(regionCode).toUpperCase().slice(0, 5);
    if (!c) return '';
    const param = r ? `${c}_${r}` : c;
    // Telegram start param max 64 chars
    return param.slice(0, 64);
}

export default function TelegramRedirect() {
    const [status, setStatus] = useState<'loading' | 'redirecting'>('loading');

    useEffect(() => {
        let cancelled = false;

        async function detectAndRedirect() {
            let startParam = '';

            try {
                // ipapi.co supports HTTPS on free tier (unlike ip-api.com which is HTTP-only free)
                // Returns: { city, region, country_code, ... }
                const geoPromise = fetch('https://ipapi.co/json/', { cache: 'no-store' })
                    .then(r => r.json())
                    .catch(() => null);

                // Race against a 1.5s timeout so redirect is never blocked
                const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 1500));

                const geo = await Promise.race([geoPromise, timeoutPromise]);

                if (
                    geo &&
                    !geo.error &&
                    typeof geo.city === 'string' &&
                    typeof geo.region === 'string'
                ) {
                    startParam = buildStartParam(geo.city, geo.region);
                }
            } catch {
                // Geo failed — proceed without location, bot handles null city gracefully
            }

            if (cancelled) return;

            setStatus('redirecting');

            const url = startParam
                ? `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(startParam)}`
                : `https://t.me/${BOT_USERNAME}`;

            // Small visual pause so the redirect feels intentional, not like a broken page
            setTimeout(() => {
                if (!cancelled) window.location.href = url;
            }, 300);
        }

        detectAndRedirect();
        return () => { cancelled = true; };
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
