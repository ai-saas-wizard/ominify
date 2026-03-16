"use client";

interface SuccessFailureConfigProps {
  onSuccess: { action: string; target_step?: number };
  onFailure: { action: string; retry_delay?: number };
  onSuccessChange: (value: { action: string; target_step?: number }) => void;
  onFailureChange: (value: { action: string; retry_delay?: number }) => void;
}

export default function SuccessFailureConfig({
  onSuccess,
  onFailure,
  onSuccessChange,
  onFailureChange,
}: SuccessFailureConfigProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="text-sm font-medium text-gray-700">On Success</label>
        <select
          value={onSuccess.action}
          onChange={(e) =>
            onSuccessChange({
              action: e.target.value,
              target_step: e.target.value === "jump_to_step" ? onSuccess.target_step ?? 1 : undefined,
            })
          }
          className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-violet-500 mt-1"
        >
          <option value="continue">Continue to Next</option>
          <option value="jump_to_step">Jump to Step</option>
          <option value="end_sequence">End Sequence</option>
        </select>
        {onSuccess.action === "jump_to_step" && (
          <input
            type="number"
            min={1}
            value={onSuccess.target_step ?? 1}
            onChange={(e) =>
              onSuccessChange({
                action: onSuccess.action,
                target_step: Math.max(1, parseInt(e.target.value) || 1),
              })
            }
            placeholder="Step number"
            className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-violet-500 mt-2"
          />
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700">On Failure</label>
        <select
          value={onFailure.action}
          onChange={(e) =>
            onFailureChange({
              action: e.target.value,
              retry_delay: e.target.value === "retry_after_seconds" ? onFailure.retry_delay ?? 60 : undefined,
            })
          }
          className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-violet-500 mt-1"
        >
          <option value="skip">Skip and Continue</option>
          <option value="end_sequence">End Sequence</option>
          <option value="retry_after_seconds">Retry After Delay</option>
        </select>
        {onFailure.action === "retry_after_seconds" && (
          <input
            type="number"
            min={1}
            value={onFailure.retry_delay ?? 60}
            onChange={(e) =>
              onFailureChange({
                action: onFailure.action,
                retry_delay: Math.max(1, parseInt(e.target.value) || 1),
              })
            }
            placeholder="Seconds"
            className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-violet-500 mt-2"
          />
        )}
      </div>
    </div>
  );
}
