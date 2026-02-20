/**
 * Builtin help / UX commands.
 */

import type { SlashCommand } from "../types.js";
import { showShortcutsDialog } from "./overlays.js";

export function createHelpCommands(): SlashCommand[] {
  return [
    {
      name: "shortcuts",
      description: "Show keyboard shortcuts",
      source: "builtin",
      execute: () => {
        showShortcutsDialog();
      },
    },
  ];
}
