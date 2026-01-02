"use client";

import { VapiAgent } from "@/lib/vapi";
import { motion } from "framer-motion";
import { Bot, MoreVertical, Phone, Calendar } from "lucide-react";
import Link from "next/link";

interface AgentGridProps {
    agents: VapiAgent[];
}

export const AgentGrid = ({ agents }: AgentGridProps) => {
    if (agents.length === 0) {
        return (
            <div className="h-[400px] flex flex-col items-center justify-center border border-dashed rounded-xl bg-gray-50/50">
                <Bot className="w-12 h-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-900">No agents found</h3>
                <p className="text-gray-500 mb-6">Create your first voice agent to get started.</p>
            </div>
        )
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent, index) => (
                <motion.div
                    key={agent.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.1 }}
                    className="group relative bg-white border rounded-xl p-5 hover:shadow-md transition-all cursor-pointer hover:border-violet-200"
                >
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center text-violet-600">
                                <Bot className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-gray-900 group-hover:text-violet-600 transition-colors">
                                    {agent.name || "Untitled Agent"}
                                </h3>
                                <p className="text-xs text-gray-500">{agent.id.slice(0, 8)}...</p>
                            </div>
                        </div>
                        <button className="text-gray-400 hover:text-gray-600">
                            <MoreVertical className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="space-y-2 mb-4">
                        <div className="flex items-center text-sm text-gray-600">
                            <span className="w-20 text-xs font-medium text-gray-400 uppercase">Voice</span>
                            <span className="truncate">{agent.voice?.provider || 'Default'} / {agent.voice?.voiceId?.slice(0, 8) || '-'}</span>
                        </div>
                        <div className="flex items-center text-sm text-gray-600">
                            <span className="w-20 text-xs font-medium text-gray-400 uppercase">Model</span>
                            <span>{agent.model?.model || 'gpt-3.5-turbo'}</span>
                        </div>
                    </div>

                    <div className="pt-4 border-t flex items-center justify-between text-xs text-gray-500">
                        <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(agent.createdAt).toLocaleDateString()}
                        </div>
                        <Link href={`/dashboard/agents/${agent.id}`}>
                            <span className="px-3 py-1.5 rounded-full bg-violet-50 text-violet-700 font-medium hover:bg-violet-100 transition-colors">
                                Edit Agent
                            </span>
                        </Link>
                    </div>
                </motion.div>
            ))}
        </div>
    );
}
