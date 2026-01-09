import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

// Get or create session ID (persists in localStorage)
const getSessionId = (): string => {
    let sessionId = localStorage.getItem('analytics_session_id');

    if (!sessionId) {
        sessionId = crypto.randomUUID();
        localStorage.setItem('analytics_session_id', sessionId);
    }

    return sessionId;
};

// Detect device type from user agent
const getDeviceType = (): 'Mobile' | 'Desktop' | 'Tablet' => {
    const ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
        return 'Tablet';
    }
    if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
        return 'Mobile';
    }
    return 'Desktop';
};

// Detect operating system
const getOS = (): string => {
    const ua = navigator.userAgent;
    if (ua.indexOf('Win') !== -1) return 'Windows';
    if (ua.indexOf('Mac') !== -1) return 'macOS';
    if (ua.indexOf('Linux') !== -1) return 'Linux';
    if (ua.indexOf('Android') !== -1) return 'Android';
    if (ua.indexOf('like Mac') !== -1) return 'iOS';
    return 'Unknown';
};

// Detect browser
const getBrowser = (): string => {
    const ua = navigator.userAgent;
    if (ua.indexOf('Firefox') !== -1) return 'Firefox';
    if (ua.indexOf('SamsungBrowser') !== -1) return 'Samsung Internet';
    if (ua.indexOf('Opera') !== -1 || ua.indexOf('OPR') !== -1) return 'Opera';
    if (ua.indexOf('Trident') !== -1) return 'IE';
    if (ua.indexOf('Edge') !== -1) return 'Edge';
    if (ua.indexOf('Chrome') !== -1) return 'Chrome';
    if (ua.indexOf('Safari') !== -1) return 'Safari';
    return 'Unknown';
};

// Extract clean domain from referrer URL
const getReferrerSource = (referrer: string): string | null => {
    if (!referrer || referrer === '') return null;

    try {
        const url = new URL(referrer);
        // Remove 'www.' prefix for cleaner display
        return url.hostname.replace('www.', '');
    } catch {
        return null;
    }
};

// Get country from IP using free ipapi.co service
// NOTE: Free tier = 1,000 requests/day, should be enough for most sites
const getCountryFromIP = async (): Promise<{ country: string; code: string } | null> => {
    try {
        const response = await fetch('https://ipapi.co/json/', {
            method: 'GET',
            // Timeout after 3 seconds to avoid blocking page load
            signal: AbortSignal.timeout(3000)
        });

        if (!response.ok) {
            console.warn('IP geolocation API returned error:', response.status);
            return null;
        }

        const data = await response.json();

        // Validate response has required fields
        if (!data.country_name || !data.country_code) {
            console.warn('IP geolocation response missing country data');
            return null;
        }

        return {
            country: data.country_name,
            code: data.country_code
        };
    } catch (error) {
        // Don't let geolocation failure break analytics
        console.warn('Failed to get country from IP:', error);
        return null;
    }
};

/**
 * Analytics tracking hook
 * Automatically tracks page views on route changes
 */
export const useAnalytics = () => {
    const location = useLocation();

    useEffect(() => {
        const trackPageView = async () => {
            // Skip tracking in development mode
            if (import.meta.env.DEV) {
                return;
            }

            // Don't track admin/analytics pages (to avoid inflating metrics)
            if (
                location.pathname.includes('/admin') ||
                location.pathname.includes('/analytics')
            ) {
                return;
            }

            try {
                const sessionId = getSessionId();
                const country = await getCountryFromIP();

                const eventData = {
                    session_id: sessionId,
                    page_path: location.pathname,
                    page_title: document.title || 'Untitled',
                    referrer: document.referrer || null,
                    referrer_source: getReferrerSource(document.referrer),
                    country: country?.country || null,
                    country_code: country?.code || null,
                    device_type: getDeviceType(),
                    os: getOS(),
                    browser: getBrowser(),
                    user_id: null // Can be populated if user is logged in
                };

                // Insert analytics event
                const { error } = await supabase
                    .from('web_analytics')
                    .insert(eventData);

                if (error) {
                    console.error('Analytics tracking failed:', error.message);
                }
            } catch (error) {
                // Silently fail - don't break the app over analytics
                console.error('Analytics error:', error instanceof Error ? error.message : 'Unknown error');
            }
        };

        trackPageView();
    }, [location.pathname]); // Track on path change only
};
