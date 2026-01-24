import { createClient } from '@/utils/supabase/server';
import { ArrowUpRight, Users, Code, Activity, Server, UserPlus } from 'lucide-react';

export default async function AdminPage() {
  const supabase = await createClient();

  // Fetch Stats
  const { count: totalUsers } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });

  // 1. Get recent logins (fetch enough to get 5 unique users)
  const { data: recentLogins } = await supabase
    .from('login_history')
    .select('user_id, login_at')
    .order('login_at', { ascending: false })
    .limit(20);

  // 2. Client-side dedupe to get unique users and their latest login
  const uniqueLogins = new Map<string, string>();
  recentLogins?.forEach((log: any) => {
    if (!uniqueLogins.has(log.user_id)) {
      uniqueLogins.set(log.user_id, log.login_at);
    }
  });

  const topUserIds = Array.from(uniqueLogins.keys()).slice(0, 5);

  // 3. Fetch profiles for these users
  const { data: profilesData } = await supabase
    .from('profiles')
    .select('*')
    .in('id', topUserIds);

  // 4. Merge ordered data
  const recentUsers = topUserIds.map(id => {
      const profile = profilesData?.find(p => p.id === id);
      return profile ? { ...profile, last_seen_at: uniqueLogins.get(id) } : null;
  }).filter(Boolean);

  // Fetch real artifact count
  const { count: artifactsCount } = await supabase
    .from('artifacts')
    .select('*', { count: 'exact', head: true });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Visión General</h1>
        <p className="text-gray-600 dark:text-[#94A3B8]">Bienvenido al centro de control de CourseGen.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Usuarios Totales" 
          val={totalUsers?.toLocaleString() || "0"} 
          trend="Actualizado" 
          icon={<Users className="text-[#00D4B3]" size={24} />} 
        />
        <StatCard 
          title="Artefactos Generados" 
          val={artifactsCount.toLocaleString()} 
          trend="--%" 
          positive={true}
          icon={<Code className="text-[#1F5AF6]" size={24} />} 
        />
        <StatCard 
          title="Actividad del Sistema" 
          val="100%" 
          trend="Stable" 
          icon={<Activity className="text-purple-400" size={24} />} 
        />
        <StatCard 
          title="Carga de Servidor" 
          val="Baja" 
          trend="Optimo" 
          positive={true} 
          icon={<Server className="text-orange-400" size={24} />} 
        />
      </div>

      {/* Main Content Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Recent Activity (Wide) */}
        <div className="lg:col-span-2 bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 shadow-sm dark:shadow-none transition-colors">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Usuarios Activos Recientemente</h3>
            <button className="text-sm text-[#00D4B3] hover:underline">Ver todo</button>
          </div>
          <div className="space-y-4">
            {recentUsers?.map((user: any) => (
              <div key={user.id} className="flex items-center gap-4 p-3 hover:bg-gray-50 dark:hover:bg-[#1E2329] rounded-xl transition-colors cursor-default group border border-transparent hover:border-gray-100 dark:hover:border-transparent">
                <div className="w-10 h-10 rounded-full bg-[#00D4B3]/10 flex items-center justify-center text-[#00D4B3]">
                  <UserPlus size={18} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-[#00D4B3] transition-colors">
                    {user.first_name} {user.last_name_father} ({user.username || 'Sin usuario'})
                  </p>
                  <p className="text-xs text-gray-500 dark:text-[#94A3B8]">{user.email}</p>
                </div>
                <div className="text-xs text-gray-400 dark:text-[#6C757D]">
                    {user.last_seen_at ? timeAgo(user.last_seen_at) : 'Recién registrado'}
                </div>
              </div>
            ))}
            
            {recentUsers?.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-4">No hay actividad reciente.</p>
            )}
          </div>
        </div>

        {/* Quick Actions / System Status */}
        <div className="space-y-6">
             {/* Create Artifact Widget */}
            <div className="bg-[#0A2540] border border-[#1F5AF6]/30 rounded-2xl p-6 relative overflow-hidden group hover:border-[#1F5AF6] transition-all cursor-pointer shadow-lg">
                <div className="absolute top-[-20%] right-[-20%] w-[150px] h-[150px] bg-[#1F5AF6]/20 rounded-full blur-[40px]" />
                <h3 className="text-lg font-bold text-white mb-2 relative z-10">Nuevo Artefacto</h3>
                <p className="text-sm text-[#94A3B8] mb-4 relative z-10">Crear un nuevo componente o curso manualmente.</p>
                <div className="w-10 h-10 bg-[#1F5AF6] rounded-full flex items-center justify-center text-white relative z-10 group-hover:scale-110 transition-transform">
                     <ArrowUpRight size={20} />
                </div>
            </div>

            {/* System Health */}
            <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 shadow-sm dark:shadow-none transition-colors">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Estado de Servicios</h3>
                <div className="space-y-3">
                    <StatusItem label="Base de Datos (Supabase)" status="active" />
                    <StatusItem label="API Gateway" status="active" />
                    <StatusItem label="Generación IA (Gemini)" status="active" />
                </div>
            </div>
        </div>

      </div>
    </div>
  );
}

function timeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `Hace ${seconds} seg`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days} días`;
}

function StatCard({ title, val, trend, icon, positive = true }: any) {
    return (
        <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-5 hover:border-gray-300 dark:hover:border-[#6C757D]/30 transition-all shadow-sm dark:shadow-none">
            <div className="flex items-start justify-between mb-4">
                <div className="p-2 bg-gray-50 dark:bg-[#0F1419] rounded-lg border border-gray-100 dark:border-[#6C757D]/10">
                    {icon}
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${positive ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                    {trend}
                </span>
            </div>
            <div>
                <p className="text-sm text-gray-500 dark:text-[#94A3B8] mb-1">{title}</p>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{val}</h3>
            </div>
        </div>
    )
}

function StatusItem({ label, status }: { label: string, status: 'active' | 'down' }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-[#94A3B8]">{label}</span>
            <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-green-600 dark:text-green-400">Operativo</span>
                <span className="w-2 h-2 rounded-full bg-green-500 dark:bg-green-400 animate-pulse" />
            </div>
        </div>
    )
}
