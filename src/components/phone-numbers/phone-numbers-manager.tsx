"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Phone } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/settings-animations";
import { TwilioAccountSetup } from "./twilio-account-setup";
import { TwilioAccountStatus } from "./twilio-account-status";
import { PhoneNumbersList } from "./phone-numbers-list";
import { A2PStatusCard } from "./a2p-status-card";

interface Props {
    clientId: string;
    clientName: string;
    twilioAccount: any;
    initialPhoneNumbers: any[];
    a2pRegistration: any;
    tenantProfile: any;
    agentMap?: Record<string, string>;
    agents?: { id: string; name: string }[];
}

export function PhoneNumbersManager({
    clientId,
    clientName,
    twilioAccount,
    initialPhoneNumbers,
    a2pRegistration,
    tenantProfile,
    agentMap = {},
    agents = [],
}: Props) {
    const hasAccount = !!twilioAccount;
    const isBYOT = twilioAccount?.account_type === "type_a_byoa";
    const activeNumberCount = initialPhoneNumbers.filter(
        (n: any) => n.status === "active"
    ).length;

    return (
        <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="space-y-6"
        >
            {/* Header */}
            <motion.div variants={staggerItem}>
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-emerald-100 rounded-xl">
                        <Phone className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Phone Numbers</h1>
                        <p className="text-gray-500 text-sm">
                            Manage your Twilio phone numbers and A2P 10DLC compliance
                        </p>
                    </div>
                </div>
            </motion.div>

            {/* Account Setup or Status */}
            <AnimatePresence mode="wait">
                {!hasAccount ? (
                    <motion.div
                        key="setup"
                        variants={staggerItem}
                        initial="hidden"
                        animate="show"
                        exit={{ opacity: 0, y: -12, transition: { duration: 0.2 } }}
                    >
                        <TwilioAccountSetup clientId={clientId} />
                    </motion.div>
                ) : (
                    <motion.div
                        key="connected"
                        variants={staggerContainer}
                        initial="hidden"
                        animate="show"
                        className="space-y-6"
                    >
                        {/* Account Status */}
                        <motion.div variants={staggerItem}>
                            <TwilioAccountStatus
                                clientId={clientId}
                                twilioAccount={twilioAccount}
                                activeNumberCount={activeNumberCount}
                            />
                        </motion.div>

                        {/* Phone Numbers List */}
                        <motion.div variants={staggerItem}>
                            <PhoneNumbersList
                                clientId={clientId}
                                initialPhoneNumbers={initialPhoneNumbers}
                                agentMap={agentMap}
                                agents={agents}
                                isBYOT={isBYOT}
                            />
                        </motion.div>

                        {/* A2P 10DLC Status */}
                        <motion.div variants={staggerItem}>
                            <A2PStatusCard
                                clientId={clientId}
                                a2pRegistration={a2pRegistration}
                                tenantProfile={tenantProfile}
                            />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
