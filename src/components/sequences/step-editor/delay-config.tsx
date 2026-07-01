"use client";

import { useState, useEffect } from "react";

interface DelayConfigProps {
  delayMinutes: number;
  onDelayMinutesChange: (minutes: number) => void;
}

function deriveUnit(minutes: number): { amount: number; unit: string } {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    return { amount: minutes / 1440, unit: "days" };
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    return { amount: minutes / 60, unit: "hours" };
  }
  return { amount: minutes, unit: "minutes" };
}

export default function DelayConfig({
  delayMinutes,
  onDelayMinutesChange,
}: DelayConfigProps) {
  const initial = deriveUnit(delayMinutes);
  const [amount, setAmount] = useState(initial.amount);
  const [unit, setUnit] = useState(initial.unit);

  useEffect(() => {
    const derived = deriveUnit(delayMinutes);
    setAmount(derived.amount);
    setUnit(derived.unit);
  }, [delayMinutes]);

  function toMinutes(amt: number, u: string): number {
    if (u === "days") return amt * 1440;
    if (u === "hours") return amt * 60;
    return amt;
  }

  function handleAmountChange(newAmount: number) {
    setAmount(newAmount);
    onDelayMinutesChange(toMinutes(newAmount, unit));
  }

  function handleUnitChange(newUnit: string) {
    setUnit(newUnit);
    onDelayMinutesChange(toMinutes(amount, newUnit));
  }

  return (
    <div>
      <label className="text-sm font-medium text-gray-700">Delay before this step</label>
      <div className="flex gap-2 mt-1 max-w-xs">
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => handleAmountChange(Math.max(1, parseInt(e.target.value) || 1))}
          className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <select
          value={unit}
          onChange={(e) => handleUnitChange(e.target.value)}
          className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </div>
    </div>
  );
}
