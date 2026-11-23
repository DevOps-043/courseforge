"use client";

import { useId } from "react";
import { EngineSelect } from "@/components/ui/EngineSelect";
import { deliveryConfigSchema, type DeliveryConfig } from "../types/delivery.schemas";
import { DELIVERY_LIMITS } from "../config/delivery.config";
import styles from "./delivery-ui.module.css";
import { FieldHelp } from "../../../components/ui/FieldHelp";
import { deliveryApproachHelp, deliveryBalanceHelp, deliveryModeHelp } from "../lib/delivery-field-help";

const modalities = [
  { mode: "NEXUS", title: "Asíncrono", description: "Lecciones que cada participante realiza a su ritmo." },
  { mode: "SYNCHRONOUS", title: "Síncrono", description: "Taller en vivo con instructor y materiales de apoyo." },
  { mode: "HYBRID", title: "Híbrido", description: "Lecciones a tu ritmo y sesiones en vivo conectadas." },
] as const;

export function DeliveryConfigurationFields({ value, onChange, disabled = false, sessionsEnabled = true }: {
  value: DeliveryConfig;
  onChange: (value: DeliveryConfig) => void;
  disabled?: boolean;
  sessionsEnabled?: boolean;
}) {
  const id = useId();
  const hasSessions = value.mode !== "NEXUS";
  const validation = deliveryConfigSchema.safeParse(value);
  return <fieldset className={styles.configuration} disabled={disabled}>
    <legend className={styles.configurationLegend}><span>¿Qué tipo de curso o taller quieres desarrollar?</span><FieldHelp label="Modalidad del curso o taller"
      description="Define cómo participará el estudiante. La modalidad determina qué ajustes y materiales necesitas preparar." selection={deliveryModeHelp[value.mode]} /></legend>
    <div className={styles.modalityChoices}>
      {modalities.map(item => <label key={item.mode} className={styles.modalityChoice} data-selected={value.mode === item.mode}>
        <input type="radio" name={`${id}-modality`} value={item.mode} checked={value.mode === item.mode}
          disabled={!sessionsEnabled && item.mode !== "NEXUS"} onChange={() => onChange({ ...value, mode: item.mode })} />
        <span><strong>{item.title}</strong><small>{item.description}</small></span>
      </label>)}
    </div>
    {!sessionsEnabled && <p className={styles.configurationHint}>Las modalidades con sesiones en vivo aún no están habilitadas en este entorno.</p>}
    {hasSessions && <div className={styles.configurationFields}>
      <div><div className={styles.configurationLabel}><label htmlFor={`${id}-count`}>Número de sesiones <span>(opcional)</span></label><FieldHelp label="Número de sesiones"
        description={`Indica en cuántas sesiones en vivo se distribuirá el contenido. Puedes elegir entre 1 y ${DELIVERY_LIMITS.sessions}; si lo dejas vacío, se propone una sesión por módulo.`} /></div><input id={`${id}-count`} type="number" min={1} max={DELIVERY_LIMITS.sessions}
        value={value.sessionCount ?? ""} placeholder="Una por módulo" onChange={event => onChange({ ...value, sessionCount: event.target.value ? Number(event.target.value) : null })} /></div>
      <div><div className={styles.configurationLabel}><label htmlFor={`${id}-minutes`}>Minutos por sesión</label><FieldHelp label="Minutos por sesión"
        description={`Duración inicial de cada encuentro en vivo, de 15 a ${DELIVERY_LIMITS.sessionMinutes} minutos. La agenda y sus bloques deben respetar el tiempo de la sesión.`} /></div><input id={`${id}-minutes`} type="number" min={15} max={DELIVERY_LIMITS.sessionMinutes}
        value={value.sessionMinutes} onChange={event => onChange({ ...value, sessionMinutes: Number(event.target.value) })} /></div>
      <div><div className={styles.configurationLabel}><label htmlFor={`${id}-balance`}>Enfoque del taller</label><FieldHelp label="Enfoque del taller"
        description="Orienta el equilibrio entre explicación del instructor y aplicación por parte del participante durante las sesiones." selection={deliveryBalanceHelp[value.balance]} /></div>
        <EngineSelect
          id={`${id}-balance`}
          className={styles.selectField}
          disabled={disabled}
          value={value.balance}
          onValueChange={balance => onChange({ ...value, balance: balance as DeliveryConfig["balance"] })}
          options={[
            { value: "EXPLANATION", label: "Más explicación" },
            { value: "BALANCED", label: "Explicación y práctica" },
            { value: "PRACTICE", label: "Más práctica" },
          ]}
        />
      </div>
      {value.mode === "HYBRID" && <div><div className={styles.configurationLabel}><label htmlFor={`${id}-approach`}>Relación con las lecciones asíncronas</label><FieldHelp label="Relación con las lecciones asíncronas"
        description="Indica cómo se conectan las sesiones en vivo con las lecciones que se estudian en Academy." selection={deliveryApproachHelp[value.approach]} /></div>
        <EngineSelect
          id={`${id}-approach`}
          className={styles.selectField}
          disabled={disabled}
          value={value.approach}
          onValueChange={approach => onChange({ ...value, approach: approach as DeliveryConfig["approach"] })}
          options={[
            { value: "COMPLEMENTARY", label: "Taller complementario" },
            { value: "CLASS_VERSION", label: "Versión en vivo de la clase" },
          ]}
        />
      </div>}
    </div>}
    {hasSessions && !validation.success && <p role="alert" className={styles.configurationError}>Elige entre 1 y {DELIVERY_LIMITS.sessions} sesiones, con una duración de 15 a {DELIVERY_LIMITS.sessionMinutes} minutos por sesión.</p>}
  </fieldset>;
}
