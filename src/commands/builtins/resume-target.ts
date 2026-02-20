/**
 * Resume target semantics shared across commands + overlays.
 */

export type ResumeDialogTarget = "new_tab" | "replace_current";

export function getResumeTargetLabel(target: ResumeDialogTarget): string {
  if (target === "replace_current") {
    return "Replace current tab";
  }

  return "Open in new tab";
}

export function getCrossWorkbookResumeConfirmMessage(target: ResumeDialogTarget): string {
  if (target === "replace_current") {
    return "This session was created for a different workbook. Resume anyway and replace the current chat?";
  }

  return "This session was created for a different workbook. Resume anyway in a new tab?";
}
