"use client";

interface PeakHoursData {
    heatmap: number[][];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function PeakHoursHeatmap({ data }: { data: number[][] }) {
    // Find max for normalization
    const maxValue = Math.max(...data.flat().filter(v => v > 0), 1);

    const getColor = (value: number) => {
        if (value === 0) return 'bg-gray-50';
        const intensity = value / maxValue;
        if (intensity >= 0.8) return 'bg-indigo-600';
        if (intensity >= 0.6) return 'bg-indigo-500';
        if (intensity >= 0.4) return 'bg-indigo-400';
        if (intensity >= 0.2) return 'bg-indigo-300';
        return 'bg-indigo-200';
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Peak Hours</h3>
            <p className="text-sm text-gray-500 mb-4">Call volume by day and hour</p>

            <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                    {/* Hour labels */}
                    <div className="flex mb-1">
                        <div className="w-10"></div>
                        {HOURS.filter((_, i) => i % 3 === 0).map(hour => (
                            <div
                                key={hour}
                                className="flex-1 text-center text-[10px] text-gray-400"
                                style={{ minWidth: '20px' }}
                            >
                                {hour}:00
                            </div>
                        ))}
                    </div>

                    {/* Heatmap grid */}
                    {DAYS.map((day, dayIndex) => (
                        <div key={day} className="flex items-center mb-0.5">
                            <div className="w-10 text-xs text-gray-500 font-medium">{day}</div>
                            <div className="flex flex-1 gap-0.5">
                                {HOURS.map(hour => (
                                    <div
                                        key={hour}
                                        className={`aspect-square flex-1 rounded-sm ${getColor(data[dayIndex]?.[hour] || 0)} transition-colors hover:ring-1 hover:ring-indigo-400`}
                                        title={`${day} ${hour}:00 - ${data[dayIndex]?.[hour] || 0} calls`}
                                        style={{ minWidth: '12px', maxWidth: '24px' }}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}

                    {/* Legend */}
                    <div className="flex items-center justify-end mt-4 gap-1 text-[10px] text-gray-500">
                        <span>Less</span>
                        <div className="w-3 h-3 rounded-sm bg-gray-50 border border-gray-100"></div>
                        <div className="w-3 h-3 rounded-sm bg-indigo-200"></div>
                        <div className="w-3 h-3 rounded-sm bg-indigo-400"></div>
                        <div className="w-3 h-3 rounded-sm bg-indigo-600"></div>
                        <span>More</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
