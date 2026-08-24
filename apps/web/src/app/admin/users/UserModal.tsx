'use client';

import { useEffect, useState } from 'react';
import {
  AtSign,
  DraftingCompass,
  Hammer,
  IdCard,
  Mail,
  Save,
  ShieldCheck,
  UserRoundCog,
} from 'lucide-react';
import { EngineDialog } from '@/components/ui/EngineDialog';
import type { PlatformRole, PlatformUser, UserModalFormData } from './user-management.types';
import styles from './UserModal.module.css';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: PlatformUser | null;
  onSave?: (userData: UserModalFormData) => void;
}

const ROLE_OPTIONS: Array<{
  description: string;
  icon: typeof Hammer;
  label: string;
  value: PlatformRole;
}> = [
  {
    value: 'CONSTRUCTOR',
    label: 'Constructor',
    description: 'Crea y desarrolla contenido.',
    icon: Hammer,
  },
  {
    value: 'ARQUITECTO',
    label: 'Arquitecto',
    description: 'Diseña y valida estructuras.',
    icon: DraftingCompass,
  },
  {
    value: 'ADMIN',
    label: 'Administrador',
    description: 'Gestiona plataforma y usuarios.',
    icon: ShieldCheck,
  },
];

const EMPTY_FORM: UserModalFormData = {
  firstName: '',
  lastNameFather: '',
  lastNameMother: '',
  email: '',
  role: 'CONSTRUCTOR',
  username: '',
  password: '',
};

export default function UserModal({ isOpen, onClose, user, onSave }: UserModalProps) {
  const [formData, setFormData] = useState<UserModalFormData>(EMPTY_FORM);

  useEffect(() => {
    if (!isOpen) return;
    setFormData(user ? {
      firstName: user.first_name || '',
      lastNameFather: user.last_name_father || '',
      lastNameMother: user.last_name_mother || '',
      email: user.email || '',
      role: user.platform_role || 'CONSTRUCTOR',
      username: user.username || '',
      password: '',
    } : EMPTY_FORM);
  }, [user, isOpen]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSave?.({ ...formData, id: user?.id });
    onClose();
  };

  const displayName = formData.firstName && formData.lastNameFather
    ? `${formData.firstName} ${formData.lastNameFather}`
    : formData.username || 'Usuario de SofLIA';
  const initials = (formData.firstName?.[0] || formData.username?.[0] || 'U').toUpperCase();

  return (
    <EngineDialog
      isOpen={isOpen}
      onClose={onClose}
      size="wide"
      eyebrow="Gestión de acceso"
      title="Rol y permisos"
      description="Consulta la identidad centralizada y define el nivel de acceso en Engine."
      icon={<UserRoundCog />}
      footer={(
        <>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>Cancelar</button>
          <button type="submit" form="user-role-form" className={styles.primaryButton}>
            <Save size={15} />
            Guardar cambios
          </button>
        </>
      )}
    >
      <form id="user-role-form" className={styles.form} onSubmit={handleSubmit}>
        <section className={styles.identity} aria-label="Identidad del usuario">
          <span className={styles.avatar}>{initials}</span>
          <div>
            <h3 className={styles.identityTitle}>{displayName}</h3>
            <p className={styles.identityMeta}>{formData.email || 'Sin correo registrado'}</p>
          </div>
          <span className={styles.status}>Cuenta activa</span>
        </section>

        <section className={styles.section}>
          <p className={styles.sectionLabel}>Información sincronizada</p>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Nombre</span>
              <span className={styles.inputWrap}>
                <IdCard />
                <input className={styles.input} value={formData.firstName} disabled />
              </span>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Apellidos</span>
              <span className={styles.inputWrap}>
                <IdCard />
                <input className={styles.input} value={[formData.lastNameFather, formData.lastNameMother].filter(Boolean).join(' ')} disabled />
              </span>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Usuario</span>
              <span className={styles.inputWrap}>
                <AtSign />
                <input className={styles.input} value={formData.username} disabled />
              </span>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Correo electrónico</span>
              <span className={styles.inputWrap}>
                <Mail />
                <input className={styles.input} value={formData.email} disabled />
              </span>
            </label>
          </div>
        </section>

        <section className={styles.section}>
          <p className={styles.sectionLabel}>Permisos de plataforma</p>
          <div className={styles.roleGrid}>
            {ROLE_OPTIONS.map((role) => {
              const RoleIcon = role.icon;
              const selected = formData.role === role.value;
              return (
                <button
                  key={role.value}
                  type="button"
                  aria-pressed={selected}
                  className={`${styles.roleCard} ${selected ? styles.roleCardActive : ''}`}
                  onClick={() => setFormData((current) => ({ ...current, role: role.value }))}
                >
                  <span className={styles.roleIcon}><RoleIcon /></span>
                  <span>
                    <span className={styles.roleName}>{role.label}</span>
                    <span className={styles.roleDescription}>{role.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </form>
    </EngineDialog>
  );
}
