import type { CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";
import "./IconTabs.css";

/**
 * A panel's tabs as icon-over-label buttons in a grid: two even rows in a narrow panel, one row when it's wide. Every
 * tab is always in view (no More menu), and none moves when another is picked.
 */
export function IconTabs<T extends string>({
  tabs,
  value,
  onPick,
  label,
  idPrefix,
}: {
  tabs: { id: T; label: string; icon: IconName }[];
  /** The open tab; null when the panel shows something else (a settings panel). */
  value: T | null;
  onPick: (id: T) => void;
  label: string;
  /** Each tab's id is `<idPrefix>-<tab id>`, for the panel's aria-labelledby. */
  idPrefix: string;
}) {
  return (
    <div className="icon-tabs-box">
      <div className="icon-tabs" role="tablist" aria-label={label} data-count={tabs.length} style={{ "--narrow": Math.ceil(tabs.length / 2) } as CSSProperties}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`${idPrefix}-${t.id}`} aria-selected={t.id === value} className="icon-tabs__tab" onClick={() => onPick(t.id)}>
            <Icon name={t.icon} size={15} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
