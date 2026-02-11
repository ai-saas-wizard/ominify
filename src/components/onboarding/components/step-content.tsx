"use client";

import { motion, AnimatePresence } from "framer-motion";

interface StepContentProps {
    stepKey: number;
    direction: number;
    children: React.ReactNode;
}

const variants = {
    enter: (direction: number) => ({
        x: direction > 0 ? 40 : -40,
        opacity: 0,
    }),
    center: {
        x: 0,
        opacity: 1,
    },
    exit: (direction: number) => ({
        x: direction < 0 ? 40 : -40,
        opacity: 0,
    }),
};

export function StepContent({ stepKey, direction, children }: StepContentProps) {
    return (
        <AnimatePresence mode="wait" custom={direction}>
            <motion.div
                key={stepKey}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: "easeInOut" }}
            >
                {children}
            </motion.div>
        </AnimatePresence>
    );
}
