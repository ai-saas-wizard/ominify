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
        content: "Elevate With AI has completely transformed how we handle customer calls. The AI agents are incredibly natural and our customer satisfaction scores have increased by 40%.",
        highlight: "Elevate With AI"
    },
    {
        id: 2,
        name: "Michael Chen",
        role: "Operations Director, PropertyHub",
        avatar: "/avatars/michael.jpg",
        content: "We integrated Elevate With AI for our leasing inquiries and it's been a game-changer. The system handles hundreds of calls daily with remarkable accuracy and professionalism.",
        highlight: "Elevate With AI"
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
        content: "Setting up was incredibly simple. Within hours, we had AI agents handling our entire call workflow. The ROI has been phenomenal - 60% reduction in operational costs.",
        highlight: "60% reduction"
    },
    {
        id: 5,
        name: "Lisa Thompson",
        role: "VP Sales, CloudScale",
        avatar: "/avatars/lisa.jpg",
        content: "These guys truly care about building something great. They went out of their way to open a direct line of communication for support and feedback. Highly recommended!",
        highlight: "truly care"
    }
];

// Starfield background component
function Starfield() {
    return (
        <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-[#0a0f1c] via-[#0d1424] to-[#0a0f1c]" />
            {/* Animated gradient orbs */}
            <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-1/3 left-1/4 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
            {/* Dot grid pattern */}
            <svg className="absolute inset-0 w-full h-full opacity-30">
                <defs>
                    <pattern id="dotPattern" width="30" height="30" patternUnits="userSpaceOnUse">
                        <circle cx="2" cy="2" r="1" fill="#2dd4bf" opacity="0.3" />
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
                <span key={i} className="text-teal-400">{part}</span>
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
            className={`bg-slate-900/60 backdrop-blur-lg border border-teal-500/20 rounded-xl p-6 max-w-md ${isActive ? 'shadow-xl shadow-teal-500/10' : ''
                }`}
        >
            <div className="flex items-center gap-3 mb-4">
                <Avatar className="h-12 w-12 border-2 border-teal-500/30">
                    <AvatarImage src={testimonial.avatar} alt={testimonial.name} />
                    <AvatarFallback className="bg-gradient-to-br from-teal-500 to-blue-600 text-white font-semibold">
                        {testimonial.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                </Avatar>
                <div>
                    <h4 className="text-white font-semibold">{testimonial.name}</h4>
                    <p className="text-teal-400/70 text-sm">{testimonial.role}</p>
                </div>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed">
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

    // Get visible testimonials (current and adjacent ones)
    const getVisibleTestimonials = () => {
        const indices = [];
        for (let i = -1; i <= 1; i++) {
            const index = (currentIndex + i + testimonials.length) % testimonials.length;
            indices.push(index);
        }
        return indices;
    };

    return (
        <div className="relative h-full flex flex-col items-center justify-center gap-6 overflow-hidden py-12">
            <AnimatePresence mode="popLayout">
                {getVisibleTestimonials().map((index, position) => (
                    <motion.div
                        key={testimonials[index].id}
                        initial={{
                            opacity: 0,
                            y: direction === 'up' ? 100 : -100,
                            scale: 0.9
                        }}
                        animate={{
                            opacity: position === 1 ? 1 : 0.5,
                            y: (position - 1) * 20,
                            scale: position === 1 ? 1 : 0.9,
                            filter: position === 1 ? 'blur(0px)' : 'blur(2px)'
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
                        className="absolute"
                        style={{
                            top: `${30 + position * 25}%`,
                        }}
                    >
                        <TestimonialCard
                            testimonial={testimonials[index]}
                            isActive={position === 1}
                        />
                    </motion.div>
                ))}
            </AnimatePresence>

            {/* Scroll indicators */}
            <div className="absolute bottom-8 flex gap-2">
                {testimonials.map((_, index) => (
                    <button
                        key={index}
                        onClick={() => {
                            setDirection(index > currentIndex ? 'up' : 'down');
                            setCurrentIndex(index);
                        }}
                        className={`w-2 h-2 rounded-full transition-all duration-300 ${index === currentIndex
                                ? 'bg-teal-400 w-6'
                                : 'bg-slate-600 hover:bg-slate-500'
                            }`}
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
        <div className="min-h-screen flex">
            {/* Left side - Auth form */}
            <div className="w-full lg:w-1/2 bg-[#0a0f1c] flex flex-col">
                {/* Logo */}
                <div className="p-6">
                    <div className="flex items-center gap-2">
                        <Image
                            src="/elevate-lightbulb-logo.png"
                            alt="Elevate With AI"
                            width={40}
                            height={40}
                            className="drop-shadow-lg"
                        />
                        <Image
                            src="/elevate-with-ai-logo.png"
                            alt="Elevate With AI"
                            width={150}
                            height={30}
                            className="drop-shadow-lg hidden sm:block"
                        />
                    </div>
                </div>

                {/* Form container */}
                <div className="flex-1 flex items-center justify-center p-8">
                    <div className="w-full max-w-md">
                        <div className="mb-6">
                            <h1 className="text-2xl font-bold text-white mb-2">{title}</h1>
                            <p className="text-slate-400 text-sm">{subtitle}</p>
                        </div>
                        {children}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 text-center lg:text-left">
                    <p className="text-slate-500 text-xs">
                        By using Elevate With AI you agree to our{' '}
                        <a href="#" className="text-slate-400 hover:text-teal-400 underline">Terms of Service</a>,{' '}
                        <a href="#" className="text-slate-400 hover:text-teal-400 underline">Privacy</a>, and{' '}
                        <a href="#" className="text-slate-400 hover:text-teal-400 underline">Security policies</a>.
                    </p>
                </div>
            </div>

            {/* Right side - Testimonials (hidden on mobile) */}
            <div className="hidden lg:block lg:w-1/2 relative">
                <Starfield />
                <AnimatedTestimonials />

                {/* Social links */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4">
                    <a href="#" className="text-slate-500 hover:text-teal-400 transition-colors">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                    </a>
                    <a href="#" className="text-slate-500 hover:text-teal-400 transition-colors">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                        </svg>
                    </a>
                    <a href="#" className="text-slate-500 hover:text-teal-400 transition-colors">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9460 2.4189-2.1568 2.4189z" />
                        </svg>
                    </a>
                </div>
            </div>
        </div>
    );
}
