import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ConfirmState } from "../../types/merchant";
import { Button } from "../ui/Button";

type ConfirmDialogProps = {
  confirm: ConfirmState | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({ confirm, onCancel, onConfirm }: ConfirmDialogProps) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    setIsClosing(false);
  }, [confirm]);

  if (!confirm) return null;

  const danger = confirm.tone === "danger";
  const requestCancel = () => {
    setIsClosing(true);
    window.setTimeout(onCancel, 160);
  };

  return (
    <div className={isClosing ? "modal-backdrop confirm-backdrop is-closing" : "modal-backdrop confirm-backdrop"} onClick={requestCancel}>
      <section className="confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <span className={danger ? "confirm-icon danger" : "confirm-icon"}>
          {danger ? <AlertTriangle size={24} /> : <CheckCircle2 size={24} />}
        </span>
        <h2>{confirm.title}</h2>
        <p>{confirm.message}</p>
        <div className="button-row confirm-actions">
          <Button onClick={requestCancel}>{confirm.cancelText ?? "取消"}</Button>
          <Button tone={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirm.confirmText ?? "确认"}
          </Button>
        </div>
      </section>
    </div>
  );
}
