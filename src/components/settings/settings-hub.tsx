"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, User, Users, ChevronRight, Webhook, Plug, Mail } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { staggerContainer, staggerItem } from "@/lib/settings-animations";
import { UpdateProfileForm } from "./update-profile-form";

interface SettingsHubProps {
    clientId: string;
    client: { id: string; created_at: string };
    clerkUser: {
        imageUrl?: string;
        firstName?: string | null;
        lastName?: string | null;
        email?: string;
    } | null;
    memberCount: number;
    webhookCount: number;
    updateProfile: (formData: FormData) => Promise<void>;
    currentName: string;
    currentEmail: string;
    currentBusinessName?: string;
}

const navLinks = [
    {
        key: "team",
        path: "settings/team",
        icon: Users,
        iconBg: "bg-emerald-100",
        iconColor: "text-emerald-600",
        gradient: "from-emerald-500 via-emerald-500 to-emerald-600",
        title: "Team Members",
        description: (count: number) =>
            `${count} member${count !== 1 ? "s" : ""} \u00B7 Manage who can access this account`,
    },
    {
        key: "email",
        path: "settings/email",
        icon: Mail,
        iconBg: "bg-emerald-100",
        iconColor: "text-emerald-600",
        gradient: "from-emerald-500 via-teal-500 to-emerald-600",
        title: "Email (SMTP)",
        description: () => "Configure SMTP settings for sequence emails",
    },
    {
        key: "integrations",
        path: "settings/integrations",
        icon: Plug,
        iconBg: "bg-blue-100",
        iconColor: "text-blue-600",
        gradient: "from-blue-500 via-sky-500 to-blue-600",
        title: "Integrations",
        description: () => "Connect Google Calendar and other services",
    },
    {
        key: "webhooks",
        path: "settings/webhooks",
        icon: Webhook,
        iconBg: "bg-emerald-100",
        iconColor: "text-emerald-600",
        gradient: "from-emerald-500 via-emerald-500 to-emerald-600",
        title: "Webhooks",
        description: (count: number) =>
            `${count} webhook${count !== 1 ? "s" : ""} \u00B7 Receive real-time call notifications`,
    },
];

export function SettingsHub({
    clientId,
    client,
    clerkUser,
    memberCount,
    webhookCount,
    updateProfile,
    currentName,
    currentEmail,
    currentBusinessName,
}: SettingsHubProps) {
    return (
        <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="space-y-8"
        >
            {/* Account Details Card */}
            <motion.div variants={staggerItem}>
                <Card>
                    <CardHeader className="border-b border-gray-200 bg-gray-50 flex-row items-center gap-3 space-y-0 px-6 py-4">
                        <Shield className="w-5 h-5 text-gray-600" />
                        <h2 className="text-lg font-semibold text-gray-900">Account Details</h2>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm text-gray-500">Account ID</p>
                                <p className="font-mono text-sm text-gray-900">{client.id}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Member Since</p>
                                <p className="text-gray-900">
                                    {new Date(client.created_at).toLocaleDateString()}
                                </p>
                            </div>
                        </div>
                        {clerkUser && (
                            <div className="pt-4 border-t border-gray-100">
                                <p className="text-sm text-gray-500 mb-2">Signed in as</p>
                                <div className="flex items-center gap-3">
                                    <Avatar>
                                        {clerkUser.imageUrl && (
                                            <AvatarImage src={clerkUser.imageUrl} alt="Profile" />
                                        )}
                                        <AvatarFallback className="bg-emerald-100 text-emerald-700">
                                            {clerkUser.firstName?.[0] || "U"}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <p className="font-medium text-gray-900">
                                            {clerkUser.firstName} {clerkUser.lastName}
                                        </p>
                                        <p className="text-sm text-gray-500">{clerkUser.email}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </motion.div>

            {/* Profile Settings */}
            <motion.div variants={staggerItem}>
                <Card>
                    <CardHeader className="border-b border-gray-200 bg-gray-50 flex-row items-center gap-3 space-y-0 px-6 py-4">
                        <User className="w-5 h-5 text-gray-600" />
                        <h2 className="text-lg font-semibold text-gray-900">Profile Information</h2>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <UpdateProfileForm
                            currentName={currentName}
                            currentEmail={currentEmail}
                            currentBusinessName={currentBusinessName}
                            updateProfile={updateProfile}
                        />
                    </CardContent>
                </Card>
            </motion.div>

            {/* Navigation Links */}
            {navLinks.map((link) => {
                const Icon = link.icon;
                const count = link.key === "team" ? memberCount : webhookCount;
                return (
                    <motion.div key={link.key} variants={staggerItem}>
                        <Link href={`/client/${clientId}/${link.path}`} className="block group">
                            <Card className="overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/5">
                                <div className={`h-[3px] bg-gradient-to-r ${link.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-200`} />
                                <div className="px-6 py-4 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-lg ${link.iconBg}`}>
                                            <Icon className={`w-5 h-5 ${link.iconColor}`} />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-semibold text-gray-900">
                                                {link.title}
                                            </h2>
                                            <p className="text-sm text-gray-500">
                                                {link.description(count)}
                                            </p>
                                        </div>
                                    </div>
                                    <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
                                </div>
                            </Card>
                        </Link>
                    </motion.div>
                );
            })}
        </motion.div>
    );
}
