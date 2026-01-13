
/**
 * Riya's Context-Aware Greetings
 * Based on Indian Standard Time (IST)
 */

interface Greeting {
    text: string;
    options: string[];
}

export const getGreetingByTime = (): Greeting => {
    // Get current time in IST
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(utcTime + istOffset);
    const hours = istDate.getHours();

    // MORNING SLOT (6 AM - 11:59 AM)
    if (hours >= 6 && hours < 12) {
        return {
            text: "Oye Kumbhkaran! Uth gaye ya abhi bhi bed mein ho? 😴",
            options: ["Uth gaya", "Nahi"]
        };
    }

    // AFTERNOON SLOT (12 PM - 4:59 PM)
    if (hours >= 12 && hours < 17) {
        return {
            text: "Sachi batana... abhi kaam kar rahe ho ya bas screen ghoor ke acting kar rahe ho? 👀",
            options: ["Acting kar raha hu", "Kaam kar raha hu"]
        };
    }

    // EVENING SLOT (5 PM - 9:59 PM)
    if (hours >= 17 && hours < 22) {
        return {
            text: "Oye, pohch gaye ghar? Ya abhi bhi traffic mein phase ho? 🚗",
            options: ["Pohch gaya", "Traffic mein hu"]
        };
    }

    // LATE NIGHT SLOT (10 PM - 5:59 AM)
    // Covers 22, 23, 0, 1, 2, 3, 4, 5
    return {
        text: "Ek baat puchu? Bura toh nahi maanoge? 🙈",
        options: ["Puch", "Nahi maanunga"]
    };
};
