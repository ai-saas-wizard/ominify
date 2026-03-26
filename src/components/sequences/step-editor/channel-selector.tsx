"use client";

import { MessageSquare, Mail, Phone, Clock, GitBranch } from "lucide-react";

const CHANNEL_OPTIONS = [
  { value: "sms", label: "SMS", icon: MessageSquare },
  { value: "email", label: "Email", icon: Mail },
  { value: "voice", label: "Voice Call", icon: Phone },
  { value: "wait", label: "Wait / Delay", icon: Clock },
  { value: "condition", label: "Condition / Branch", icon: GitBranch },
];

interface ChannelSelectorProps {
  value: string;
  onChange: (channel: string) => void;
}

export default function ChannelSelector({ value, onChange }: ChannelSelectorProps) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {CHANNEL_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isSelected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs font-medium transition-colors ${
              isSelected
                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                : "border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
          >
            <Icon className="w-4 h-4" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
