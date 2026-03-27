# Domain Conventions

Each domain in `apps/web/src/domains` follows the same capability-based rule:

- `actions/` for server mutations or orchestration entry points
- `components/` for UI
- `config/` for static domain configuration, prompts, or presets
- `hooks/` for client state and interaction logic
- `lib/` for pure helpers and adapters
- `services/` for external/data-facing behavior
- `types/` for contracts and DTOs
- `validators/` for schemas and validation rules

Not every domain must contain every folder. The convention is:

1. keep the same naming across domains
2. add folders only when the domain actually needs that capability
3. do not create empty placeholder folders
4. keep business rules out of UI components and route handlers

This standard keeps domains consistent without forcing artificial structure.
