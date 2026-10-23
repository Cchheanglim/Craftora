import { useEffect, useRef, useState } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { inDesktopApp } from "../lib/engine";
import "./TextMenu.css";

type Field = HTMLInputElement | HTMLTextAreaElement;

const TEXT_INPUTS = new Set(["text", "url", "search", "password", "email", "number", ""]);

function textField(target: EventTarget | null): Field | null {
  const field = target instanceof Element ? target.closest("input, textarea") : null;
  if (field instanceof HTMLTextAreaElement) return field;
  return field instanceof HTMLInputElement && TEXT_INPUTS.has(field.type) ? field : null;
}

/**
 * Craftora's own right-click menu. The browser engine's menu (Back, Refresh, Print, Inspect,
 * "Import passwords"…) made the app feel like a web page, so it's hidden everywhere; text fields
 * get Cut, Copy, Paste and Select all instead. Installed copies also ignore the browser keys that
 * would reload or print the app.
 */
export function TextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; field: Field } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = (e: MouseEvent) => {
      e.preventDefault();
      const field = textField(e.target);
      setMenu(field ? { x: e.clientX, y: e.clientY, field } : null);
    };
    const closeOutside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setMenu(null);
    };
    const close = () => setMenu(null);
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
      const ctrl = e.ctrlKey || e.metaKey;
      const browserKey = e.key === "F5" || (ctrl && (e.key.toLowerCase() === "r" || e.key.toLowerCase() === "p"));
      if (browserKey && import.meta.env.PROD) e.preventDefault();
    };
    window.addEventListener("contextmenu", open);
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", keys);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("contextmenu", open);
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", keys);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  if (!menu) return null;
  const { field } = menu;
  const selected = (field.selectionEnd ?? 0) > (field.selectionStart ?? 0);
  const editable = !field.readOnly && !field.disabled;
  const secret = field instanceof HTMLInputElement && field.type === "password";

  const run = (action: () => void | Promise<void>) => async () => {
    setMenu(null);
    field.focus();
    await action();
  };
  const items = [
    { label: "Cut", keys: "Ctrl+X", enabled: selected && editable && !secret, act: () => void document.execCommand("cut") },
    { label: "Copy", keys: "Ctrl+C", enabled: selected && !secret, act: () => void document.execCommand("copy") },
    {
      label: "Paste",
      keys: "Ctrl+V",
      enabled: editable,
      // Through Tauri in the app: the web clipboard API made the window ask for permission.
      // insertText goes through the field's normal input events, so React sees the change.
      act: async () => {
        const text = await (inDesktopApp ? readText() : navigator.clipboard.readText()).catch(() => "");
        if (text) document.execCommand("insertText", false, text);
      },
    },
    { label: "Select all", keys: "Ctrl+A", enabled: field.value.length > 0, act: () => field.select() },
  ];

  // Keep the menu inside the window.
  const x = Math.min(menu.x, window.innerWidth - 200);
  const y = Math.min(menu.y, window.innerHeight - 4 * 32 - 12);
  return (
    <div ref={box} className="text-menu" role="menu" style={{ left: x, top: y }}>
      {items.map((item) => (
        <button key={item.label} type="button" role="menuitem" disabled={!item.enabled} onClick={run(item.act)}>
          <span>{item.label}</span>
          <kbd>{item.keys}</kbd>
        </button>
      ))}
    </div>
  );
}
