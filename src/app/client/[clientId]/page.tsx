export default function DashboardPage() {
    return (
        <div className="p-4 lg:p-8 h-full">
            <div className="mb-8 space-y-4">
                <h2 className="text-2xl md:text-4xl font-bold text-center lg:text-left">
                    Dashboard
                </h2>
                <p className="text-muted-foreground font-light text-sm md:text-lg text-center lg:text-left">
                    Overview of your voice agents and performance.
                </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Placeholders for Metrics */}
                <div className="p-6 bg-white border rounded-xl shadow-sm">
                    <div className="text-sm font-medium text-gray-500">Total Agents</div>
                    <div className="text-3xl font-bold">0</div>
                </div>
                <div className="p-6 bg-white border rounded-xl shadow-sm">
                    <div className="text-sm font-medium text-gray-500">Total Calls</div>
                    <div className="text-3xl font-bold">0</div>
                </div>
                <div className="p-6 bg-white border rounded-xl shadow-sm">
                    <div className="text-sm font-medium text-gray-500">Total Minutes</div>
                    <div className="text-3xl font-bold">0</div>
                </div>
                <div className="p-6 bg-white border rounded-xl shadow-sm">
                    <div className="text-sm font-medium text-gray-500">Active Custom Clients</div>
                    <div className="text-3xl font-bold">0</div>
                </div>
            </div>
        </div>
    );
}
