import type { Variants } from "framer-motion";

export const staggerContainer: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { staggerChildren: 0.07, delayChildren: 0.1 },
    },
};

export const staggerItem: Variants = {
    hidden: { opacity: 0, y: 24, scale: 0.96 },
    show: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { type: "spring", stiffness: 280, damping: 22 },
    },
};

export const fadeIn: Variants = {
    hidden: { opacity: 0, y: 6 },
    show: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.25, ease: "easeOut" },
    },
    exit: {
        opacity: 0,
        y: -6,
        transition: { duration: 0.15 },
    },
};

export const expandCollapse: Variants = {
    hidden: { height: 0, opacity: 0, overflow: "hidden" },
    show: {
        height: "auto",
        opacity: 1,
        overflow: "hidden",
        transition: { duration: 0.25, ease: "easeOut" },
    },
    exit: {
        height: 0,
        opacity: 0,
        overflow: "hidden",
        transition: { duration: 0.2, ease: "easeIn" },
    },
};
