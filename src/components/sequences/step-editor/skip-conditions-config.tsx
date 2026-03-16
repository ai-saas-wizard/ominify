"use client";

interface SkipConditionsConfigProps {
  selected: string[];
  onChange: (conditions: string[]) => void;
}

const SKIP_CONDITION_OPTIONS = [
  { key: "contact_replied", label: "Contact has replied (SMS/email)" },
  { key: "contact_answered_call", label: "Contact answered a call" },
  { key: "appointment_booked", label: "Appointment has been booked" },
];

export default function SkipConditionsConfig({ selected, onChange }: SkipConditionsConfigProps) {
  function handleToggle(key: string) {
    if (selected.includes(key)) {
      onChange(selected.filter((k) => k !== key));
    } else {
      onChange([...selected, key]);
    }
  }

  return (
    <div>
      <label className="text-sm font-medium text-gray-700 mb-2 block">
        Skip this step if...
      </label>
      <div className="space-y-1">
        {SKIP_CONDITION_OPTIONS.map((option) => (
          <label key={option.key} className="flex items-center gap-2.5 py-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(option.key)}
              onChange={() => handleToggle(option.key)}
              className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
            />
            <span className="text-sm text-gray-700">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
