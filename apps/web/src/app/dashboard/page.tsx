import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Image from 'next/image'
import UserMenu from '@/components/layout/UserMenu'
import { logoutAction } from '../login/actions'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return redirect('/login')
  }

  // Obtener perfil para mostrar nombre/avatar
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0F1419] text-gray-900 dark:text-white transition-colors duration-300">

      {/* Header / Navbar */}
      <header className="sticky top-0 z-40 w-full border-b border-gray-200 dark:border-white/5 bg-white/80 dark:bg-[#0F1419]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo area */}
          <div className="flex items-center gap-2">
            <div className="relative w-8 h-8">
              <Image src="/Logo.png" alt="CourseForge" fill className="object-contain" />
            </div>
            <span className="font-bold text-lg tracking-tight">Course<span className="text-[#00D4B3]">Forge</span></span>
          </div>

          {/* Actions area */}
          <div className="flex items-center gap-4">
            <UserMenu
              userEmail={user.email}
              profile={profile}
              logoutAction={logoutAction}
              align="top" // Dropdown opens down
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
          <p className="text-gray-600 dark:text-[#94A3B8]">Bienvenido de nuevo, <span className="text-[#00D4B3] font-medium">{profile?.first_name || user.email}</span></p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Example Content Check cards or empty state */}
          <div className="col-span-full p-8 bg-white dark:bg-[#1E2329] rounded-2xl border border-gray-200 dark:border-[#6C757D]/20 shadow-sm flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-gray-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Tus Cursos</h3>
            <p className="text-gray-500 max-w-md mb-6">Aquí verás tus cursos y materiales generados. Actualmente estamos en construcción.</p>
            <button className="px-5 py-2.5 bg-[#00D4B3] hover:bg-[#00bda0] text-white font-medium rounded-xl transition-colors shadow-lg shadow-[#00D4B3]/20">
              Crear Nuevo Proyecto
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
