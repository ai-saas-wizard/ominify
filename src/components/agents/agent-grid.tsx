"use client";

import { VapiAgent } from "@/lib/vapi";
import { motion } from "framer-motion";
import { Bot, Calendar, Mic, Brain, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Animation Variants ──────────────────────────────────────────────────────

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.07, delayChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 280, damping: 22 },
  },
};

// ─── Component ───────────────────────────────────────────────────────────────

interface AgentGridProps {
  agents: VapiAgent[];
}

export const AgentGrid = ({ agents }: AgentGridProps) => {
  const params = useParams();
  const clientId = params.clientId as string;

  if (agents.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="h-[420px] flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-2xl bg-gradient-to-b from-gray-50/80 to-white"
      >
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-5 shadow-lg shadow-emerald-500/20">
          <Bot className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">
          No agents yet
        </h3>
        <p className="text-sm text-gray-500 mb-6 max-w-sm text-center leading-relaxed">
          Create your first AI voice agent to start handling calls automatically.
        </p>
      </motion.div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"
      >
        {agents.map((agent) => {
          const voiceProvider = agent.voice?.provider || "Default";
          const modelName =
            agent.model?.model?.split("/").pop()?.replace(/-/g, " ") ||
            "gpt-3.5-turbo";

          return (
            <motion.div key={agent.id} variants={item}>
              <Link href={`/client/${clientId}/agents/${agent.id}`}>
                <Card className="group relative overflow-hidden border border-gray-200 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-500/5 transition-all duration-300 cursor-pointer hover:-translate-y-1">
                  {/* Gradient accent bar */}
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  <div className="p-5">
                    {/* Header: Avatar + Name + Status */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3.5">
                        <div className="relative shrink-0">
                          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-500/25 group-hover:shadow-lg group-hover:shadow-emerald-500/30 transition-shadow duration-300">
                            <Bot className="w-5 h-5" />
                          </div>
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-gray-900 truncate group-hover:text-emerald-700 transition-colors duration-200">
                            {agent.name || "Untitled Agent"}
                          </h3>
                          <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                            ID: {agent.id.slice(0, 10)}
                          </p>
                        </div>
                      </div>

                      {/* Active status pulse */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1.5 shrink-0 mt-1">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Agent is active</TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Metadata badges */}
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      <Badge
                        variant="secondary"
                        className="gap-1 text-[11px] px-2 py-0.5"
                      >
                        <Mic className="w-3 h-3 text-emerald-500" />
                        {voiceProvider}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className="gap-1 text-[11px] px-2 py-0.5"
                      >
                        <Brain className="w-3 h-3 text-emerald-500" />
                        <span className="truncate max-w-[100px]">
                          {modelName}
                        </span>
                      </Badge>
                    </div>

                    <Separator />

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-4">
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <Calendar className="w-3 h-3" />
                        {new Date(agent.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </div>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-200">
                        Configure
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                </Card>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>
    </TooltipProvider>
  );
};
