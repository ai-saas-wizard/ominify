"use client";

import { VapiAgent, VapiVoice } from "@/lib/vapi";
import { updateAgentAction } from "@/app/actions/agent-actions";
import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  MoreVertical,
  Upload,
  Info,
  Sparkles,
  User,
  MessageSquare,
  Globe,
  Mic,
  Image as ImageIcon,
  FileText,
  Paperclip,
  Check,
} from "lucide-react";
import { PromptEditor } from "@/components/agents/prompt-editor";
import { useFormStatus } from "react-dom";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Submit Button ───────────────────────────────────────────────────────────

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white px-5 py-2 rounded-xl font-semibold text-sm shadow-md shadow-violet-500/20 hover:shadow-lg hover:shadow-violet-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Check className="w-4 h-4" />
      )}
      Save Changes
    </button>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentEditorProps {
  agent: VapiAgent;
  voices: VapiVoice[];
  clientId: string;
}

const LANGUAGES = [
  "English",
  "English (United States)",
  "English (United Kingdom)",
  "English (Australia)",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Polish",
  "Hindi",
  "Japanese",
  "Chinese",
  "Korean",
  "Dutch",
  "Turkish",
  "Swedish",
  "Indonesian",
  "Filipino",
  "Greek",
];

// ─── Tabs ────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "role", label: "Role & Prompt", icon: MessageSquare },
] as const;

// ─── Tab content animation ───────────────────────────────────────────────────

const tabVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: "easeOut" as const },
  },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
};

// ─── Component ───────────────────────────────────────────────────────────────

export const AgentEditor = ({ agent, voices, clientId }: AgentEditorProps) => {
  const [activeTab, setActiveTab] = useState<string>("profile");
  const [showCopilot, setShowCopilot] = useState(false);
  const [saved, setSaved] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const initialSystemPrompt =
    agent.model?.systemPrompt ||
    (Array.isArray(agent.model?.messages)
      ? agent.model.messages.find((m: any) => m.role === "system")?.content
      : "");

  return (
    <TooltipProvider>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
        {/* ── Tab Navigation ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 border-b border-gray-200">
          <div className="flex items-center -mb-px">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "text-violet-700"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {isActive && (
                    <motion.div
                      layoutId="tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Save status */}
          <AnimatePresence>
            {saved && (
              <motion.span
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="text-xs font-medium text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full"
              >
                Saved
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* ── Form ────────────────────────────────────────────────────── */}
        <form
          action={async (formData) => {
            const result = await updateAgentAction(agent.id, clientId, formData);
            if (result.success) {
              setSaved(true);
              setTimeout(() => setSaved(false), 2500);
            } else {
              alert("Failed to save");
            }
          }}
          className="flex-1 flex flex-col relative"
        >
          {/* Floating save */}
          <div className="absolute top-5 right-6 z-10">
            <SubmitButton />
          </div>

          <div className="flex-1 overflow-auto">
            <div className="p-6 lg:p-8 max-w-4xl">
              <AnimatePresence mode="wait">
                {/* ── Profile Tab ──────────────────────────────────────── */}
                {activeTab === "profile" && (
                  <motion.div
                    key="profile"
                    variants={tabVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="space-y-8"
                  >
                    {/* Identity Section */}
                    <div className="space-y-5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center">
                          <User className="w-3.5 h-3.5 text-violet-600" />
                        </div>
                        <h3 className="text-sm font-bold text-gray-900">Identity</h3>
                      </div>

                      <div className="grid grid-cols-2 gap-5">
                        {/* Profile image */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 uppercase tracking-wide">
                            Profile Image
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-3 h-3 text-gray-400" />
                              </TooltipTrigger>
                              <TooltipContent>
                                Upload a custom avatar for this agent
                              </TooltipContent>
                            </Tooltip>
                          </label>
                          <div className="group border-2 border-dashed border-gray-200 hover:border-violet-300 rounded-xl p-3 flex items-center gap-3 bg-gray-50/50 hover:bg-violet-50/30 cursor-pointer transition-all">
                            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold shrink-0 text-sm shadow-sm">
                              {agent.name?.[0]?.toUpperCase() || "A"}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-700 group-hover:text-violet-700 transition-colors">
                                Upload Image
                              </p>
                              <p className="text-[10px] text-gray-400">
                                PNG, JPG up to 2MB
                              </p>
                            </div>
                            <Upload className="w-4 h-4 text-gray-400 group-hover:text-violet-500 transition-colors" />
                          </div>
                        </div>

                        {/* Name */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                            Agent Name
                          </label>
                          <input
                            name="name"
                            defaultValue={agent.name}
                            className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-all placeholder:text-gray-400"
                            placeholder="e.g., Sales Assistant"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Voice & Language Section */}
                    <div className="space-y-5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
                          <Mic className="w-3.5 h-3.5 text-indigo-600" />
                        </div>
                        <h3 className="text-sm font-bold text-gray-900">
                          Voice & Language
                        </h3>
                      </div>

                      <div className="grid grid-cols-2 gap-5">
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                            Language
                          </label>
                          <div className="relative">
                            <Globe className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                            <select className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 appearance-none transition-all">
                              {LANGUAGES.map((lang) => (
                                <option key={lang}>{lang}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                            Voice
                          </label>
                          <div className="relative">
                            <Mic className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                            <select
                              name="voiceId"
                              defaultValue={agent.voice?.voiceId}
                              className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 appearance-none transition-all"
                            >
                              {voices.map((voice) => (
                                <option
                                  key={voice.voiceId}
                                  value={voice.voiceId}
                                >
                                  {voice.name} ({voice.provider})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* ── Role Tab ─────────────────────────────────────────── */}
                {activeTab === "role" && (
                  <motion.div
                    key="role"
                    variants={tabVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="space-y-8"
                  >
                    {/* Welcome Message */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
                          <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                        </div>
                        <h3 className="text-sm font-bold text-gray-900">
                          Welcome Message
                        </h3>
                      </div>
                      <div className="border border-gray-200 rounded-xl p-3.5 flex items-center justify-between bg-gray-50/50 text-sm">
                        <span className="text-gray-700">
                          AI Agent Initiates: AI Agent starts with a dynamic
                          message.
                        </span>
                        <MoreVertical className="w-4 h-4 text-gray-400 rotate-90 shrink-0 ml-2" />
                      </div>
                    </div>

                    {/* System Prompt */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center">
                            <FileText className="w-3.5 h-3.5 text-violet-600" />
                          </div>
                          <h3 className="text-sm font-bold text-gray-900">
                            System Prompt
                          </h3>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3.5 h-3.5 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              The system prompt defines your agent&apos;s
                              personality, behavior, and instructions.
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
                          >
                            Use templates
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowCopilot(true)}
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-lg shadow-sm shadow-violet-500/20 transition-all"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            Edit with AI
                          </button>
                        </div>
                      </div>

                      <div className="flex gap-5 items-start">
                        <textarea
                          ref={promptRef}
                          name="systemPrompt"
                          defaultValue={initialSystemPrompt}
                          className="flex-1 min-h-[500px] p-4 border border-gray-200 rounded-xl text-sm font-mono leading-relaxed text-gray-800 bg-gray-50/30 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 resize-y transition-all placeholder:text-gray-400"
                          placeholder="Enter your system prompt here..."
                        />

                        {/* Attachments sidebar */}
                        <div className="w-[260px] shrink-0 space-y-3">
                          <div className="flex items-center gap-2">
                            <Paperclip className="w-3.5 h-3.5 text-gray-500" />
                            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                              Attachments
                            </label>
                          </div>
                          <p className="text-[11px] text-gray-500 leading-relaxed">
                            Upload documents to give your agent additional
                            knowledge and context.
                          </p>
                          <div className="group border-2 border-dashed border-gray-200 hover:border-violet-300 rounded-xl p-4 flex flex-col items-center justify-center text-center bg-gray-50/50 hover:bg-violet-50/20 cursor-pointer transition-all min-h-[100px]">
                            <Upload className="w-5 h-5 text-gray-400 group-hover:text-violet-500 mb-2 transition-colors" />
                            <span className="text-xs font-medium text-gray-500 group-hover:text-violet-600 transition-colors">
                              Drop files or click to upload
                            </span>
                            <span className="text-[10px] text-gray-400 mt-1">
                              PDF, TXT, DOCX
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </form>

        {/* ── AI Prompt Editor Modal ──────────────────────────────────── */}
        {showCopilot && (
          <PromptEditor
            agentId={agent.id}
            initialPrompt={promptRef.current?.value || initialSystemPrompt}
            onSave={async (newPrompt) => {
              if (promptRef.current) {
                promptRef.current.value = newPrompt;
              }
              const formData = new FormData();
              formData.set("systemPrompt", newPrompt);
              const result = await updateAgentAction(agent.id, clientId, formData);
              if (!result.success) throw new Error(result.error);
            }}
            onClose={() => setShowCopilot(false)}
          />
        )}
      </div>
    </TooltipProvider>
  );
};
