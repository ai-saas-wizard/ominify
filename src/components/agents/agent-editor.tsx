"use client";

import { VapiAgent, VapiVoice } from "@/lib/vapi";
import { updateAgentAction } from "@/app/actions/agent-actions";
import { useState } from "react";
import { Loader2, Save, MoreVertical, Upload, Info } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <button
            type="submit"
            disabled={pending}
            className="flex items-center justify-center bg-violet-600 hover:bg-violet-700 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
            {pending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save Changes
        </button>
    );
}

interface AgentEditorProps {
    agent: VapiAgent;
    voices: VapiVoice[];
}

// Common Vapi/ElevenLabs supported languages
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
    "Greek"
];

export const AgentEditor = ({ agent, voices }: AgentEditorProps) => {
    const [activeTab, setActiveTab] = useState("profile");

    const initialSystemPrompt = agent.model?.systemPrompt ||
        (Array.isArray(agent.model?.messages)
            ? agent.model.messages.find((m: any) => m.role === 'system')?.content
            : "");

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
            {/* Tabs Header */}
            <div className="px-6 pt-4 border-b border-gray-200">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="bg-transparent h-12 p-0 -mb-px gap-6 justify-start">
                        <TabsTrigger
                            value="profile"
                            className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-violet-600 rounded-none px-1 py-3 text-sm font-medium text-gray-500 data-[state=active]:text-gray-900"
                        >
                            Profile
                        </TabsTrigger>
                        <TabsTrigger
                            value="role"
                            className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-violet-600 rounded-none px-1 py-3 text-sm font-medium text-gray-500 data-[state=active]:text-gray-900"
                        >
                            Role
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            <form action={async (formData) => {
                const result = await updateAgentAction(agent.id, formData);
                if (result.success) {
                    alert("Saved successfully");
                } else {
                    alert("Failed to save");
                }
            }} className="flex-1 flex flex-col relative">

                {/* Floating Save Button */}
                <div className="absolute top-6 right-6 z-10">
                    <SubmitButton />
                </div>

                <div className="p-8 max-w-5xl mx-auto w-full">
                    {activeTab === "profile" && (
                        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            {/* Profile Info */}
                            <div className="grid grid-cols-2 gap-8">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                                        Profile image <Info className="w-3.5 h-3.5 text-gray-400" />
                                    </label>
                                    <div className="border border-gray-200 rounded-lg p-1.5 flex items-center gap-3 bg-white">
                                        <div className="h-10 w-10 bg-black rounded-full flex items-center justify-center text-white font-bold shrink-0">LT</div>
                                        <div className="text-sm text-gray-500 font-medium flex-1">Upload Image</div>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                                        Name <Info className="w-3.5 h-3.5 text-gray-400" />
                                    </label>
                                    <input
                                        name="name"
                                        defaultValue={agent.name}
                                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all font-medium text-gray-900"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">Title</label>
                                    <input
                                        defaultValue="Wizard"
                                        disabled
                                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500"
                                    />
                                </div>

                                {/* Removed Timezone as requested */}

                                <div className="space-y-1.5">
                                    <label className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">Language</label>
                                    <select className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 appearance-none">
                                        {LANGUAGES.map(lang => (
                                            <option key={lang}>{lang}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">Voice</label>
                                    <select
                                        name="voiceId"
                                        defaultValue={agent.voice?.voiceId}
                                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 appearance-none"
                                    >
                                        {voices.map(voice => (
                                            <option key={voice.voiceId} value={voice.voiceId}>
                                                {voice.name} ({voice.provider})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Removed Call Settings and Speech Settings as requested */}
                        </div>
                    )}

                    {activeTab === "role" && (
                        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-bold text-gray-900">Welcome Message</label>
                                </div>
                                <div className="border border-gray-200 rounded-lg p-3 flex items-center justify-between bg-white text-sm">
                                    <span className="text-gray-900">AI Agent Initiates: AI Agent starts with a dynamic message.</span>
                                    <MoreVertical className="w-4 h-4 text-gray-400 rotate-90" />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-bold text-gray-900 flex items-center gap-2">
                                        Prompt <Info className="w-4 h-4 text-gray-400" />
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <button type="button" className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-md hover:bg-gray-50 text-gray-700">Use templates</button>
                                        <button type="button" className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-md hover:bg-gray-50 text-gray-700">Ask Copilot</button>
                                    </div>
                                </div>

                                <div className="flex gap-6 items-start">
                                    <textarea
                                        name="systemPrompt"
                                        defaultValue={initialSystemPrompt}
                                        className="flex-1 min-h-[600px] p-4 border border-gray-200 rounded-lg text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 resize-y text-gray-800"
                                        placeholder="Enter your system prompt here..."
                                    />
                                    <div className="w-[300px] space-y-2">
                                        <label className="text-sm font-bold text-gray-900">Add attachment</label>
                                        <p className="text-xs text-gray-500 mb-2">Give AI agents intelligence with sources</p>
                                        <div className="border border-gray-200 rounded-lg p-2.5 flex items-center justify-between bg-white text-sm cursor-pointer hover:bg-gray-50">
                                            <span className="text-gray-600">Select file</span>
                                            <MoreVertical className="w-4 h-4 text-gray-400 rotate-90" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </form>
        </div>
    );
};
