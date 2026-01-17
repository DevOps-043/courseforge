
'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, Filter, MoreHorizontal, User, Shield, Mail, Calendar, Edit, Trash2, X } from 'lucide-react';
import UserModal from './UserModal';

export default function UsersTable({ initialUsers }: { initialUsers: any[] }) {
  const [users, setUsers] = useState(initialUsers || []);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modal States
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);

  // Actions Menu State
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number, left: number } | null>(null);

  const toggleMenu = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (openMenuId === id) {
        setOpenMenuId(null);
        setMenuPosition(null);
    } else {
        const rect = e.currentTarget.getBoundingClientRect();
        // Calculate position: right aligned with the button, slightly below
        setMenuPosition({ 
            top: rect.bottom + 5, 
            left: rect.right - 192 // 192px is w-48 (12rem)
        }); 
        setOpenMenuId(id);
    }
  };

  // Close menu on scroll or resize to avoid detachment
  useEffect(() => {
    const handleScroll = () => {
        if(openMenuId) {
            setOpenMenuId(null);
            setMenuPosition(null);
        }
    }
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleScroll);
    }
  }, [openMenuId]);

  const handleDelete = (id: string) => {
    if (confirm('¿Estás seguro de que deseas eliminar este usuario?')) {
        setUsers(users.filter(u => u.id !== id));
        setOpenMenuId(null);
    }
  };

  const handleEdit = (user: any) => {
      setEditingUser(user);
      setOpenMenuId(null);
  };

  const handleSaveUser = (userData: any) => {
      if (editingUser) {
          // Edit Logic
          setUsers(users.map(u => u.id === userData.id ? { 
              ...u, 
              first_name: userData.firstName, 
              last_name_father: userData.lastNameFather,
              last_name_mother: userData.lastNameMother,
              email: userData.email,
              platform_role: userData.role,
              username: userData.username
          } : u));
          setEditingUser(null);
      } else {
          // Create Logic
          const newUser = {
              id: crypto.randomUUID(),
              first_name: userData.firstName,
              last_name_father: userData.lastNameFather,
              last_name_mother: userData.lastNameMother,
              email: userData.email,
              platform_role: userData.role,
              username: userData.username,
              created_at: new Date().toISOString(),
              status: 'active'
          };
          setUsers([newUser, ...users]);
          setIsCreateOpen(false);
      }
  };

  // Filter users based on search
  const filteredUsers = users.filter(user => 
    user.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.last_name_father?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeUser = users.find(u => u.id === openMenuId);

  return (
    <div className="space-y-8 relative">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Usuarios</h1>
          <p className="text-[#94A3B8]">Gestiona los usuarios y sus permisos en la plataforma.</p>
        </div>
        <button 
            onClick={() => setIsCreateOpen(true)}
            className="group relative bg-[#00D4B3] hover:bg-[#00D4B3]/90 text-black px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 overflow-hidden"
        >
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform"/>
            <User size={18} className="relative z-10" />
            <span className="relative z-10">Nuevo Usuario</span>
        </button>
      </div>

      {/* Filters & Search */}
      <div className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl p-4 flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" size={18} />
            <input 
                type="text" 
                placeholder="Buscar usuarios..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-xl py-2 pl-10 pr-4 text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 transition-colors"
            />
        </div>
        <div className="flex gap-2 w-full md:w-auto">
            <button className="flex items-center gap-2 px-4 py-2 bg-[#0F1419] border border-[#6C757D]/20 rounded-xl text-[#94A3B8] hover:text-white hover:border-[#6C757D]/40 transition-colors text-sm">
                <Filter size={16} />
                <span>Filtrar</span>
            </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl overflow-visible min-h-[400px]">
        <div className="overflow-x-auto pb-32"> {/* Added padding bottom to allow menu space if inline, but fixed menu ignores this */}
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="border-b border-[#6C757D]/10 bg-[#0F1419]/50">
                        <th className="p-4 text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">Usuario</th>
                        <th className="p-4 text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">Rol</th>
                        <th className="p-4 text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">Estado</th>
                        <th className="p-4 text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">Fecha Registro</th>
                        <th className="p-4 text-xs font-semibold text-[#94A3B8] uppercase tracking-wider text-right">Acciones</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[#6C757D]/10">
                    {filteredUsers?.map((user) => (
                        <tr key={user.id} className="group hover:bg-[#1E2329] transition-colors relative">
                            <td className="p-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-[#00D4B3]/10 flex items-center justify-center text-[#00D4B3] font-bold">
                                        {user.first_name?.[0] || user.username?.[0] || 'U'}
                                    </div>
                                    <div>
                                        <p className="font-medium text-white">{user.first_name} {user.last_name_father}</p>
                                        <div className="flex items-center gap-1 text-xs text-[#94A3B8]">
                                            <Mail size={12} />
                                            <span>{user.email || 'Sin email'}</span>
                                        </div>
                                    </div>
                                </div>
                            </td>
                            <td className="p-4">
                                <div className="flex items-center gap-2">
                                    <Shield size={14} className="text-[#1F5AF6]" />
                                    <span className="text-sm text-gray-300 capitalize">
                                        {user.platform_role === 'ADMIN' ? 'Administrador' : 
                                         user.platform_role === 'ARQUITECTO' ? 'Arquitecto' : 
                                         'Constructor'}
                                    </span>
                                </div>
                            </td>
                            <td className="p-4">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium border ${user.status === 'inactive' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20'}`}>
                                    {user.status === 'inactive' ? 'Inactivo' : 'Activo'}
                                </span>
                            </td>
                            <td className="p-4">
                                <div className="flex items-center gap-2 text-sm text-[#94A3B8]">
                                    <Calendar size={14} />
                                    <span>{user.created_at ? new Date(user.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}</span>
                                </div>
                            </td>
                            <td className="p-4 text-right">
                                <button 
                                    onClick={(e) => toggleMenu(e, user.id)}
                                    className={`p-2 rounded-lg transition-colors ${openMenuId === user.id ? 'bg-[#00D4B3] text-black' : 'text-[#94A3B8] hover:text-white hover:bg-[#2C333D]'}`}
                                >
                                    <MoreHorizontal size={18} />
                                </button>
                            </td>
                        </tr>
                    ))}
                    {filteredUsers?.length === 0 && (
                        <tr>
                            <td colSpan={5} className="p-8 text-center text-[#94A3B8]">
                                No se encontraron usuarios.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </div>

      {/* Fixed Dropdown Menu - Rendered outside of table overflow */}
      {openMenuId && menuPosition && activeUser && (
        <>
            <div className="fixed inset-0 z-40" onClick={() => setOpenMenuId(null)} />
            <div 
                className="fixed w-48 bg-[#151A21] border border-[#6C757D]/30 rounded-xl shadow-2xl z-50 py-1 overflow-hidden"
                style={{ top: menuPosition.top, left: menuPosition.left }}
            >
                <div className="px-3 py-2 border-b border-[#6C757D]/10 bg-[#1E2329]/50">
                    <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider font-semibold">Acciones</p>
                    <p className="text-xs text-white truncate font-medium">{activeUser.first_name}</p>
                </div>
                <button 
                    onClick={() => handleEdit(activeUser)}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-[#00D4B3]/10 hover:text-[#00D4B3] flex items-center gap-2 transition-colors"
                >
                    <Edit size={14} />
                    Editar Información
                </button>
                <button 
                    onClick={() => handleDelete(activeUser.id)}
                    className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                >
                    <Trash2 size={14} />
                    Eliminar Usuario
                </button>
            </div>
        </>
      )}

      {/* Modals */}
      <UserModal 
        isOpen={isCreateOpen} 
        onClose={() => setIsCreateOpen(false)} 
        onSave={handleSaveUser}
      />
      
      <UserModal 
        isOpen={!!editingUser} 
        onClose={() => setEditingUser(null)} 
        user={editingUser}
        onSave={handleSaveUser}
      />

    </div>
  );
}
