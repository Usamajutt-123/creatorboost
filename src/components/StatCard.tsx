import { type LucideIcon } from 'lucide-react';

const colorMap: Record<string, string> = {
  purple: 'from-purple-500/15 to-blue-500/15 text-purple-300',
  blue: 'from-blue-500/15 to-cyan-500/15 text-blue-300',
  green: 'from-green-500/15 to-emerald-500/15 text-green-300',
  pink: 'from-pink-500/15 to-purple-500/15 text-pink-300',
  yellow: 'from-yellow-500/15 to-orange-500/15 text-yellow-300',
  orange: 'from-orange-500/15 to-red-500/15 text-orange-300',
  cyan: 'from-cyan-500/15 to-blue-500/15 text-cyan-300',
};

export default function StatCard({ label, value, change, icon: Icon, color = 'purple' }: {
  label: string;
  value: string;
  change: string;
  icon: LucideIcon;
  color?: keyof typeof colorMap;
}) {
  return (
    <div className={`glass rounded-2xl p-5 stat-card bg-gradient-to-br ${colorMap[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-400">{label}</div>
        <Icon className="w-5 h-5 opacity-70" />
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-green-400 mt-1">{change}</div>
    </div>
  );
}
