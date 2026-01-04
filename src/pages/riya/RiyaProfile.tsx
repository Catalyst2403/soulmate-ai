import { ArrowLeft, MessageCircle, Image, FileText } from "lucide-react";
import { RIYA_PERSONALITIES, RiyaAge } from "../../constants/riyaPersonalities";
import { useEffect, useState } from "react";

interface RiyaProfileProps {
    age: number;
    onClose: () => void;
}

export default function RiyaProfile({ age, onClose }: RiyaProfileProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [showFullscreenImage, setShowFullscreenImage] = useState(false);

    // Map user age to Riya's age variant using same logic as backend
    // Backend: ≤17 -> riya_17, ≤25 -> riya_23, ≤40 -> riya_28, >40 -> riya_35
    const getRiyaAge = (userAge: number): RiyaAge => {
        if (userAge <= 17) return 17;
        if (userAge <= 25) return 23;
        if (userAge <= 40) return 28;
        return 35;
    };

    const riyaAge = getRiyaAge(age);
    const personality = RIYA_PERSONALITIES[riyaAge];

    useEffect(() => {
        // Trigger animation after mount
        setTimeout(() => setIsVisible(true), 10);
    }, []);

    const handleClose = () => {
        setIsVisible(false);
        setTimeout(onClose, 300); // Wait for animation to complete
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity duration-300 ${isVisible ? "opacity-100" : "opacity-0"
                    }`}
                onClick={handleClose}
            />

            {/* Profile Panel */}
            <div
                className={`fixed top-0 right-0 h-full w-full md:w-[400px] bg-[#111B21] z-50 shadow-2xl transform transition-transform duration-300 ease-out ${isVisible ? "translate-x-0" : "translate-x-full"
                    }`}
            >
                {/* Header */}
                <div className="bg-[#202C33] px-4 py-6 flex items-center gap-4">
                    <button
                        onClick={handleClose}
                        className="text-[#8696A0] hover:text-white transition-colors"
                    >
                        <ArrowLeft size={24} />
                    </button>
                    <h1 className="text-white text-lg font-medium">Contact Info</h1>
                </div>

                {/* Scrollable Content */}
                <div className="overflow-y-auto h-[calc(100%-76px)] custom-scrollbar">
                    {/* Hero Section */}
                    <div className="bg-[#202C33] px-6 py-8 flex flex-col items-center text-center">
                        <div className="relative mb-4 cursor-pointer group" onClick={() => setShowFullscreenImage(true)}>
                            <img
                                src="/riya-avatar.jpg"
                                alt="Riya"
                                className="w-32 h-32 rounded-full object-cover border-4 border-[#00A884] transition-transform group-hover:scale-105"
                            />
                            <div className="absolute bottom-1 right-1 w-5 h-5 bg-[#00A884] rounded-full border-2 border-[#202C33]" />
                            {/* Hover overlay */}
                            <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <span className="text-white text-xs">View</span>
                            </div>
                        </div>
                        <h2 className="text-white text-2xl font-semibold mb-1">Riya</h2>
                        <p className="text-[#00A884] text-sm">Online</p>
                    </div>

                    {/* About Section */}
                    <div className="bg-[#111B21] px-6 py-5 border-b border-[#2A3942]">
                        <h3 className="text-[#00A884] text-sm font-medium mb-3 uppercase tracking-wider">
                            About
                        </h3>
                        <p className="text-[#E9EDEF] text-base leading-relaxed">
                            {personality.description}
                        </p>
                    </div>

                    {/* Info Section */}
                    <div className="bg-[#111B21] px-6 py-5 border-b border-[#2A3942]">
                        <h3 className="text-[#00A884] text-sm font-medium mb-4 uppercase tracking-wider">
                            Info
                        </h3>
                        <div className="space-y-4">
                            <InfoItem label="Age" value={personality.age.toString()} />
                            <InfoItem label="Role" value={personality.role} />
                            <InfoItem label="Location" value={personality.location} />
                            <InfoItem label="Vibe" value={personality.vibe} />
                        </div>
                    </div>

                    {/* Actions Section */}
                    <div className="bg-[#111B21] px-6 py-5">
                        <ActionItem
                            icon={<MessageCircle size={20} />}
                            label="Media, links, and docs"
                            value="Coming soon"
                        />
                        <ActionItem
                            icon={<Image size={20} />}
                            label="Wallpaper & theme"
                            value="Default"
                        />
                    </div>

                    {/* Footer Info */}
                    <div className="px-6 py-8 text-center">
                        <p className="text-[#8696A0] text-xs leading-relaxed">
                            Riya is your AI companion designed to feel like a real friend. Your conversations are private and secure.
                        </p>
                    </div>
                </div>
            </div>

            {/* Fullscreen Image Viewer */}
            {showFullscreenImage && (
                <div
                    className="fixed inset-0 bg-black/95 z-[60] flex items-center justify-center p-4 cursor-zoom-out"
                    onClick={() => setShowFullscreenImage(false)}
                >
                    <div className="relative max-w-2xl w-full">
                        <img
                            src="/riya-avatar.jpg"
                            alt="Riya"
                            className="w-full h-auto rounded-lg"
                        />
                        <button
                            onClick={() => setShowFullscreenImage(false)}
                            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

function InfoItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[#8696A0] text-xs uppercase tracking-wide">{label}</span>
            <span className="text-[#E9EDEF] text-base">{value}</span>
        </div>
    );
}

function ActionItem({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
}) {
    return (
        <div className="flex items-center gap-4 py-3 cursor-pointer hover:bg-[#202C33] -mx-6 px-6 rounded transition-colors">
            <div className="text-[#8696A0]">{icon}</div>
            <div className="flex-1">
                <p className="text-[#E9EDEF] text-sm">{label}</p>
                <p className="text-[#8696A0] text-xs mt-0.5">{value}</p>
            </div>
        </div>
    );
}
