"use client";

import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { useState, useEffect, useCallback } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// Testimonials data
const testimonials = [
    {
        id: 1,
        name: "Sarah Johnson",
        role: "CEO, TechStart",
        avatar: "/avatars/sarah.jpg",
        content: "Omnify has completely transformed how we handle customer calls. The AI agents are incredibly natural and our customer satisfaction scores have increased by 40%.",
        highlight: "Omnify"
    },
    {
        id: 2,
        name: "Michael Chen",
        role: "Operations Director, PropertyHub",
        avatar: "/avatars/michael.jpg",
        content: "We integrated Omnify for our leasing inquiries and it's been a game-changer. The system handles hundreds of calls daily with remarkable accuracy and professionalism.",
        highlight: "Omnify"
    },
    {
        id: 3,
        name: "Emily Rodriguez",
        role: "Founder, GrowthLabs",
        avatar: "/avatars/emily.jpg",
        content: "The quality of AI voice interactions is outstanding. Our leads don't even realize they're talking to an AI. It's revolutionized our sales process completely.",
        highlight: "AI voice interactions"
    },
    {
        id: 4,
        name: "David Park",
        role: "CTO, InnovateCorp",
        avatar: "/avatars/david.jpg",
        content: "Setting up was incredibly simple. Within hours, we had AI agents handling our entire call workflow. The ROI has been phenomenal — 60% reduction in operational costs.",
        highlight: "60% reduction"
    },
    {
        id: 5,
        name: "Lisa Thompson",
        role: "VP Sales, CloudScale",
        avatar: "/avatars/lisa.jpg",
        content: "The Omnify team truly cares about building something great. They went out of their way to open a direct line of communication for support and feedback. Highly recommended!",
        highlight: "truly cares"
    }
];

// Soft, dashboard-aligned background
function SoftBackdrop() {
    return (
        <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 via-white to-gray-50" />
            <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-emerald-300/20 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-1/3 left-1/4 w-72 h-72 bg-emerald-400/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
            <svg className="absolute inset-0 w-full h-full opacity-40">
                <defs>
                    <pattern id="dotPattern" width="30" height="30" patternUnits="userSpaceOnUse">
                        <circle cx="2" cy="2" r="1" fill="#059669" opacity="0.18" />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#dotPattern)" />
            </svg>
        </div>
    );
}

// Single testimonial card
function TestimonialCard({ testimonial, isActive }: { testimonial: typeof testimonials[0]; isActive: boolean }) {
    const highlightText = (text: string, highlight: string) => {
        const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
        return parts.map((part, i) =>
            part.toLowerCase() === highlight.toLowerCase() ? (
                <span key={i} className="text-emerald-700 font-medium">{part}</span>
            ) : (
                <span key={i}>{part}</span>
            )
        );
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: isActive ? 1 : 0.4, y: 0, scale: isActive ? 1 : 0.95 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
            className={`bg-white/85 backdrop-blur-lg border border-emerald-200/60 rounded-xl p-6 max-w-md shadow-sm ${isActive ? 'shadow-xl shadow-emerald-500/10' : ''
                }`}
        >
            <div className="flex items-center gap-3 mb-4">
                <Avatar className="h-12 w-12 border-2 border-emerald-200">
                    <AvatarImage src={testimonial.avatar} alt={testimonial.name} />
                    <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-semibold">
                        {testimonial.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                </Avatar>
                <div>
                    <h4 className="text-gray-900 font-semibold">{testimonial.name}</h4>
                    <p className="text-emerald-700/80 text-sm">{testimonial.role}</p>
                </div>
            </div>
            <p className="text-gray-700 text-sm leading-relaxed">
                {highlightText(testimonial.content, testimonial.highlight)}
            </p>
        </motion.div>
    );
}

// Animated testimonials section
function AnimatedTestimonials() {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [direction, setDirection] = useState<'up' | 'down'>('up');

    const nextTestimonial = useCallback(() => {
        setDirection('up');
        setCurrentIndex((prev) => (prev + 1) % testimonials.length);
    }, []);

    useEffect(() => {
        const interval = setInterval(nextTestimonial, 5000);
        return () => clearInterval(interval);
    }, [nextTestimonial]);

    const getVisibleTestimonials = () => {
        const indices = [];
        for (let i = -1; i <= 1; i++) {
            const index = (currentIndex + i + testimonials.length) % testimonials.length;
            indices.push(index);
        }
        return indices;
    };

    return (
        <div className="relative h-full flex flex-col items-center justify-center overflow-hidden py-12">
            <AnimatePresence mode="popLayout" initial={false}>
                {getVisibleTestimonials().map((index, position) => {
                    const offset = position - 1;

                    return (
                        <motion.div
                            key={`${testimonials[index].id}-${position}`}
                            initial={{
                                opacity: 0,
                                y: direction === 'up' ? 100 : -100,
                                scale: 0.9
                            }}
                            animate={{
                                opacity: position === 1 ? 1 : 0.4,
                                y: `${offset * 110}%`,
                                scale: position === 1 ? 1 : 0.85,
                                filter: position === 1 ? 'blur(0px)' : 'blur(2px)',
                                zIndex: position === 1 ? 10 : 0
                            }}
                            exit={{
                                opacity: 0,
                                y: direction === 'up' ? -100 : 100,
                                scale: 0.9
                            }}
                            transition={{
                                duration: 0.6,
                                ease: [0.25, 0.1, 0.25, 1]
                            }}
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md px-6"
                        >
                            <TestimonialCard
                                testimonial={testimonials[index]}
                                isActive={position === 1}
                            />
                        </motion.div>
                    );
                })}
            </AnimatePresence>

            {/* Scroll indicators */}
            <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col gap-2">
                {testimonials.map((_, index) => (
                    <button
                        key={index}
                        onClick={() => {
                            setDirection(index > currentIndex ? 'up' : 'down');
                            setCurrentIndex(index);
                        }}
                        className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${index === currentIndex
                                ? 'bg-emerald-600 h-6'
                                : 'bg-gray-300 hover:bg-gray-400'
                            }`}
                        aria-label={`Go to testimonial ${index + 1}`}
                    />
                ))}
            </div>
        </div>
    );
}

interface AuthLayoutProps {
    children: React.ReactNode;
    title: string;
    subtitle: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
    return (
        <div className="min-h-screen flex bg-white text-gray-900 overflow-hidden">
            {/* Left side - Auth form */}
            <div className="w-full lg:w-[45%] flex flex-col relative z-20 border-r border-gray-200 bg-gradient-to-b from-white via-white to-emerald-50/30 overflow-hidden">
                {/* Soft accent orbs */}
                <div className="pointer-events-none absolute -top-32 -left-32 w-80 h-80 rounded-full bg-emerald-200/30 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-40 -right-24 w-96 h-96 rounded-full bg-emerald-300/20 blur-3xl" />
                {/* Faint dot grid */}
                <svg className="pointer-events-none absolute inset-0 w-full h-full opacity-[0.18]">
                    <defs>
                        <pattern id="authDotPattern" width="28" height="28" patternUnits="userSpaceOnUse">
                            <circle cx="2" cy="2" r="1" fill="#059669" opacity="0.5" />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#authDotPattern)" />
                </svg>

                {/* Logo */}
                <div className="p-8 relative">
                    <div className="flex items-center gap-2.5">
                        <Image
                            src="/omnify-logo.png"
                            alt="Omnify"
                            width={36}
                            height={36}
                            className="rounded-lg"
                        />
                        <span className="text-lg font-bold tracking-tight text-gray-900">
                            Omnify
                        </span>
                    </div>
                </div>

                {/* Form container */}
                <div className="flex-1 flex items-center justify-center p-6 sm:p-10 relative">
                    <div className="w-full max-w-[420px] bg-white/90 backdrop-blur-sm border border-gray-200/80 rounded-2xl shadow-xl shadow-emerald-900/[0.04] p-8 sm:p-10">
                        <div className="mb-7 text-center sm:text-left">
                            <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">{title}</h1>
                            <p className="text-gray-500 text-base">{subtitle}</p>
                        </div>
                        {children}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-8 text-center sm:text-left space-y-1 relative">
                    <p className="text-gray-400 text-xs">
                        © {new Date().getFullYear()} Omnify. All rights reserved.
                    </p>
                    <p className="text-gray-400 text-[11px]">
                        Built by{" "}
                        <span className="font-medium text-gray-500">
                            Elevate With AI
                        </span>
                    </p>
                </div>
            </div>

            {/* Right side - Testimonials (hidden on mobile) */}
            <div className="hidden lg:block lg:w-[55%] relative overflow-hidden bg-emerald-50/40">
                <SoftBackdrop />
                <div className="absolute inset-0 bg-gradient-to-t from-white/40 via-transparent to-white/40 z-10 pointer-events-none" />
                <AnimatedTestimonials />

                {/* Social links */}
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-6 z-20 bg-white/70 backdrop-blur-md px-6 py-3 rounded-full border border-emerald-200/60 shadow-sm">
                    <a href="#" className="text-gray-500 hover:text-emerald-700 transition-colors transform hover:scale-110">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                    </a>
                    <a href="#" className="text-gray-500 hover:text-emerald-700 transition-colors transform hover:scale-110">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                        </svg>
                    </a>
                    <a href="#" className="text-gray-500 hover:text-emerald-700 transition-colors transform hover:scale-110">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9460 2.4189-2.1568 2.4189z" />
                        </svg>
                    </a>
                </div>
            </div>
        </div>
    );
}
