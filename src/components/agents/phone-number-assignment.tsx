"use client";

import { useState } from "react";
import { Phone, Loader2, Unlink, Link2, ExternalLink } from "lucide-react";
import {
  assignPhoneNumberToAgent,
  unassignPhoneNumberFromAgent,
} from "@/app/actions/phone-assignment-actions";
import { useRouter } from "next/navigation";

interface PhoneNumber {
  id: string;
  phone_number: string;
  friendly_name?: string;
  agent_id?: string | null;
}

interface Props {
  clientId: string;
  agentDbId: string;
  assignedNumber: PhoneNumber | null;
  availableNumbers: PhoneNumber[];
}

export function PhoneNumberAssignment({
  clientId,
  agentDbId,
  assignedNumber,
  availableNumbers,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [selectedNumberId, setSelectedNumberId] = useState("");
  const [error, setError] = useState("");

  async function handleAssign() {
    if (!selectedNumberId) return;
    setLoading(true);
    setError("");
    try {
      const result = await assignPhoneNumberToAgent(
        clientId,
        selectedNumberId,
        agentDbId
      );
      if (result.success) {
        setSelectedNumberId("");
        router.refresh();
      } else {
        setError(result.error || "Failed to assign");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUnassign() {
    if (!assignedNumber) return;
    setLoading(true);
    setError("");
    try {
      const result = await unassignPhoneNumberFromAgent(
        clientId,
        assignedNumber.id
      );
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error || "Failed to unassign");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
        Phone Number
      </label>

      {assignedNumber ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3.5 bg-emerald-50/80 rounded-xl border border-emerald-200/60">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Phone className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="text-gray-900 font-mono tracking-wide text-sm font-medium">
                {assignedNumber.phone_number}
              </span>
            </div>
            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              Connected
            </span>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Inbound calls route to this agent. Outbound calls use this as
            caller ID.
          </p>
          <button
            onClick={handleUnassign}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Unlink className="w-3 h-3" />
            )}
            Unassign Number
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {availableNumbers.length > 0 ? (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <select
                  value={selectedNumberId}
                  onChange={(e) => setSelectedNumberId(e.target.value)}
                  disabled={loading}
                  className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 disabled:opacity-50 appearance-none transition-all"
                >
                  <option value="">Select a number...</option>
                  {availableNumbers.map((num) => (
                    <option key={num.id} value={num.id}>
                      {num.phone_number}
                      {num.friendly_name ? ` (${num.friendly_name})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleAssign}
                disabled={loading || !selectedNumberId}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-600 text-white rounded-xl text-sm font-semibold hover:from-emerald-700 hover:to-emerald-700 shadow-sm shadow-emerald-500/20 transition-all disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Link2 className="w-3.5 h-3.5" />
                )}
                Assign
              </button>
            </div>
          ) : (
            <div className="p-4 bg-gray-50/80 rounded-xl border border-gray-200/60 text-center space-y-2">
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center mx-auto">
                <Phone className="w-5 h-5 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-500">
                No available numbers
              </p>
              <a
                href={`/client/${clientId}/phone-numbers`}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
              >
                Purchase a number
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Assign a phone number to enable inbound calls and consistent
            outbound caller ID.
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 font-medium">{error}</p>
      )}
    </div>
  );
}
