"use client";

import { VapiAgent } from "@/lib/vapi";
import { motion } from "framer-motion";
import { Bot, Mic, Brain, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface AgentDetailHeaderProps {
  agent: VapiAgent;
}

export function AgentDetailHeader({ agent }: AgentDetailHeaderProps) {
  const voiceProvider = agent.voice?.provider || "Default";
  const modelName =
    agent.model?.model?.split("/").pop()?.replace(/-/g, " ") || "gpt-3.5-turbo";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex items-center gap-5"
    >
      {/* Avatar */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 20 }}
        className="relative shrink-0"
      >
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/25">
          <Bot className="w-8 h-8" />
        </div>
        {/* Status dot */}
        <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-white" />
        </span>
      </motion.div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 mb-1.5">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight truncate">
            {agent.name}
          </h1>
          <Badge variant="ai-high" className="shrink-0">Active</Badge>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Mic className="w-3 h-3 text-violet-500" />
            {voiceProvider}
          </div>
          <span className="w-1 h-1 rounded-full bg-gray-300" />
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Brain className="w-3 h-3 text-indigo-500" />
            {modelName}
          </div>
          <span className="w-1 h-1 rounded-full bg-gray-300" />
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Clock className="w-3 h-3" />
            Created{" "}
            {new Date(agent.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
