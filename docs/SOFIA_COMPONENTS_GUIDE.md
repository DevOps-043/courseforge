# Guía de Componentes Premium SOFIA

Esta guía describe cómo usar los nuevos componentes premium implementados según el sistema de diseño SOFIA.

## Componentes Disponibles

### 1. SplitPanelModal

Modal de dos paneles (preview + formulario) inspirado en Notion/Linear.

**Ubicación**: `src/shared/components/ui/SplitPanelModal.tsx`

**Uso**:
```tsx
import { SplitPanelModal } from '@/shared/components/ui/SplitPanelModal'

const [isOpen, setIsOpen] = useState(false)

<SplitPanelModal
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="Crear Nuevo Equipo"
  subtitle="Completa la información para crear un equipo"
  primaryColor="#1a2332"
  accentColor="#00D4D4"
  previewPanel={
    <div>
      {/* Contenido del panel izquierdo */}
      <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[#1a2332] to-[#00D4D4]" />
      <h3 className="mt-4 text-lg font-semibold">Preview</h3>
    </div>
  }
  footer={
    <div className="flex justify-end gap-3">
      <Button variant="outline" onClick={() => setIsOpen(false)}>
        Cancelar
      </Button>
      <Button variant="default">Guardar</Button>
    </div>
  }
>
  {/* Contenido del formulario */}
  <div className="space-y-4">
    <input className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10" />
  </div>
</SplitPanelModal>
```

### 2. PremiumDropdown

Dropdown personalizado que reemplaza los `<select>` nativos.

**Ubicación**: `src/shared/components/ui/PremiumDropdown.tsx`

**Uso**:
```tsx
import { PremiumDropdown, type DropdownOption } from '@/shared/components/ui/PremiumDropdown'

const options: DropdownOption[] = [
  { value: "all", label: "Todas las opciones" },
  { value: "option1", label: "Opción 1" },
  { value: "option2", label: "Opción 2" },
]

const [selected, setSelected] = useState("all")

<PremiumDropdown
  options={options}
  value={selected}
  onChange={setSelected}
  placeholder="Seleccionar opción"
  primaryColor="#00D4D4"
/>
```

### 3. PremiumDatePicker

Selector de fechas premium con calendario visual.

**Ubicación**: `src/shared/components/ui/PremiumDatePicker.tsx`

**Uso**:
```tsx
import { PremiumDatePicker } from '@/shared/components/ui/PremiumDatePicker'

const [date, setDate] = useState('')

<PremiumDatePicker
  value={date}
  onChange={setDate}
  placeholder="Seleccionar fecha"
  minDate={new Date()}
  primaryColor="#1a2332" // Azul oscuro profundo
  accentColor="#00D4D4" // Teal vibrante
/>
```

### 4. StandardUserDropdown

Menú de usuario unificado con avatar y opciones.

**Ubicación**: `src/shared/components/ui/StandardUserDropdown.tsx`

**Uso**:
```tsx
import { StandardUserDropdown, type UserMenuItem } from '@/shared/components/ui/StandardUserDropdown'
import { User, Settings, LogOut } from 'lucide-react'

const [isOpen, setIsOpen] = useState(false)

const menuItems: UserMenuItem[] = [
  {
    icon: User,
    label: "Editar Perfil",
    onClick: () => console.log('Editar perfil'),
  },
  {
    icon: Settings,
    label: "Configuración",
    onClick: () => console.log('Configuración'),
  },
  {
    icon: LogOut,
    label: "Cerrar Sesión",
    onClick: () => console.log('Cerrar sesión'),
    isDestructive: true,
  },
]

<StandardUserDropdown
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  user={{
    name: "Juan Pérez",
    email: "juan@example.com",
    role: "Administrador",
    avatar: "/avatar.jpg", // Opcional
  }}
  items={menuItems}
  primaryColor="#1a2332" // Azul oscuro profundo
  accentColor="#00D4D4" // Teal vibrante
/>
```

## Colores - Tema Oscuro (Inspirado en Pulse Hub)

Los componentes usan los siguientes colores por defecto:

- **Azul Oscuro Profundo (Primary)**: `#1a2332` (HSL: 220 25% 12%)
- **Teal Vibrante (Accent)**: `#00D4D4` (HSL: 180 70% 50%)
- **Verde Suave (Success)**: `#10B981`
- **Ámbar (Warning)**: `#F59E0B`

Estos colores están disponibles como variables CSS:
- `hsl(var(--primary))` - Azul oscuro profundo
- `hsl(var(--accent))` - Teal vibrante
- `hsl(var(--success))` - Verde suave
- `hsl(var(--warning))` - Ámbar

**Nota**: El tema oscuro está activado por defecto en la aplicación.

## Variantes de Botones

El componente `Button` ahora incluye una variante `accent`:

```tsx
<Button variant="accent">Botón Acento</Button>
```

Variantes disponibles:
- `default` - Azul profundo SOFIA
- `outline` - Borde azul profundo
- `secondary` - Borde con fondo transparente
- `accent` - Aqua SOFIA
- `ghost` - Sin fondo
- `link` - Estilo enlace
- `destructive` - Rojo para acciones destructivas

## Clases CSS Útiles

### Tarjetas
```tsx
<div className="card-sofia p-6">
  {/* Contenido */}
</div>
```

### Botones con Gradiente
```tsx
<button className="btn-gradient-primary px-6 py-3 rounded-xl">
  Acción Principal
</button>
```

### Texto con Gradiente
```tsx
<h1 className="text-gradient-accent">
  Título con Gradiente
</h1>
```

## Tema Oscuro

El tema oscuro está activado por defecto en la aplicación. Todos los componentes están diseñados para funcionar perfectamente con el tema oscuro.

Fondos del tema oscuro:
- Principal: `hsl(220 20% 10%)` - Fondo principal azul-gris oscuro
- Secundario (Cards): `hsl(220 18% 15%)` - Cards oscuras
- Terciario: `hsl(220 25% 6%)` - Fondos muy oscuros

Los colores se ajustan automáticamente usando las variables CSS definidas en `globals.css`.

## Notas de Implementación

1. **Framer Motion**: Los componentes premium requieren `framer-motion` (ya instalado).

2. **Variables CSS**: Los componentes usan variables CSS para colores, permitiendo personalización fácil.

3. **Accesibilidad**: Todos los componentes incluyen:
   - Soporte para teclado
   - ARIA labels donde corresponde
   - Focus visible
   - Estados disabled

4. **Responsive**: Los componentes son responsive y se adaptan a diferentes tamaños de pantalla.

## Próximos Pasos

Para usar estos componentes en tu aplicación:

1. Importa el componente que necesites
2. Configura los props según tu caso de uso
3. Personaliza los colores si es necesario (usando `primaryColor` y `accentColor`)
4. Asegúrate de tener `framer-motion` instalado (ya está en el proyecto)

