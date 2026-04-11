// tg-redirect: server-side geo lookup + redirect to Telegram bot with location start param
// Called from /riya/tg (React page) — runs server-side so ip-api.com HTTP works fine

const BOT_USERNAME = 'thisisriya_bot';

function sanitize(value: string): string {
    return value.replace(/[^A-Za-z\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 30);
}

function getClientIP(req: Request): string | null {
    return (
        req.headers.get('cf-connecting-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        req.headers.get('x-real-ip') ||
        null
    );
}

Deno.serve(async (req) => {
    // CORS preflight (browser may send OPTIONS before redirect)
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
            },
        });
    }

    let startParam = '';

    try {
        const ip = getClientIP(req);

        if (ip && !ip.startsWith('127.') && !ip.startsWith('192.168.') && !ip.startsWith('10.') && !ip.startsWith('172.')) {
            const geoRes = await fetch(
                `http://ip-api.com/json/${ip}?fields=status,city,regionName`,
                { signal: AbortSignal.timeout(2500) },
            );
            const geo = await geoRes.json();

            if (geo.status === 'success' && geo.city) {
                const city = sanitize(geo.city);
                const region = sanitize(geo.regionName || '').toUpperCase().slice(0, 5);
                const param = region ? `${city}_${region}` : city;
                startParam = param.slice(0, 64);
                console.log(`📍 Geo: ${geo.city}, ${geo.regionName} (IP: ${ip}) → param: ${startParam}`);
            } else {
                console.log(`📍 Geo failed for IP ${ip}: ${JSON.stringify(geo)}`);
            }
        } else {
            console.log(`📍 Skipping geo — private/missing IP: ${ip}`);
        }
    } catch (e) {
        console.log(`📍 Geo error: ${e}`);
    }

    const telegramUrl = startParam
        ? `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(startParam)}`
        : `https://t.me/${BOT_USERNAME}`;

    return new Response(null, {
        status: 302,
        headers: {
            'Location': telegramUrl,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
        },
    });
});
