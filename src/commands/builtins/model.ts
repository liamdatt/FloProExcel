/**
 * Builtin model-related commands.
 */

import type { Agent } from "@mariozechner/pi-agent-core";
import { ModelSelector } from "@mariozechner/pi-web-ui/dist/dialogs/ModelSelector.js";

import type { SlashCommand } from "../types.js";
import { showToast } from "../../ui/toast.js";

export type ActiveAgentProvider = () => Agent | null;

function openModelSelector(getActiveAgent: ActiveAgentProvider): void {
  const agent = getActiveAgent();
  if (!agent) {
    showToast("No active session");
    return;
  }

  void ModelSelector.open(agent.state.model, (model) => {
    agent.setModel(model);
    document.dispatchEvent(new CustomEvent("pi:model-changed"));
    document.dispatchEvent(new CustomEvent("pi:status-update"));
  });
}

export function createModelCommands(getActiveAgent: ActiveAgentProvider): SlashCommand[] {
  return [
    {
      name: "model",
      description: "Change the AI model",
      source: "builtin",
      execute: () => {
        openModelSelector(getActiveAgent);
      },
    },
    {
      name: "default-models",
      description: "Cycle models with Ctrl+P",
      source: "builtin",
      execute: () => {
        // TODO: implement scoped models dialog
        // For now, open model selector as a placeholder
        openModelSelector(getActiveAgent);
      },
    },
  ];
}
