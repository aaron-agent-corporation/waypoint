import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "waypoint_ping",
    label: "Waypoint Ping",
    description: "Ping the Waypoint host. Returns the env-provided host URL and an echo of the name.",
    parameters: Type.Object({
      name: Type.String({ description: "Name to echo" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const url = process.env.WAYPOINT_HOST_URL ?? "(unset)";
      const token = process.env.WAYPOINT_HOST_TOKEN ? "present" : "(unset)";
      return {
        content: [{ type: "text", text: `pong name=${params.name} url=${url} token=${token}` }],
        details: {},
      };
    },
  });
}
