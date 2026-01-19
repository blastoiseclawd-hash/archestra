import PromptModel from "@/models/prompt";
import PromptAgentModel from "@/models/prompt-agent";
import ToolModel from "@/models/tool";
import { describe, expect, test } from "@/test";

describe("GET /api/prompts/:id/tools", () => {
  test("returns agent delegation tools for a prompt", async ({
    makeOrganization,
    makeAgent,
    seedArchestraCatalog,
  }) => {
    await seedArchestraCatalog();
    const org = await makeOrganization();

    // Create parent agent and prompt
    const parentAgent = await makeAgent({
      name: "Parent Agent",
      teams: [],
    });

    const parentPrompt = await PromptModel.create(org.id, {
      name: "Parent Prompt",
      llmProxyId: parentAgent.id,
    });

    // Create child agent and prompt
    const childAgent = await makeAgent({
      name: "Child Agent",
      teams: [],
    });

    const childPrompt = await PromptModel.create(org.id, {
      name: "Child Prompt",
      llmProxyId: childAgent.id,
      systemPrompt: "I am a child agent",
    });

    // Assign child prompt as agent to parent prompt
    await PromptAgentModel.create({
      promptId: parentPrompt.id,
      agentPromptId: childPrompt.id,
    });

    // Verify tool was created
    const tools = await ToolModel.getAgentDelegationToolsByPrompt(
      parentPrompt.id,
    );
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("agent__child_prompt");

    // Verify the detailed query also works
    const toolsWithDetails = await ToolModel.getAgentDelegationToolsWithDetails(
      parentPrompt.id,
    );
    expect(toolsWithDetails).toHaveLength(1);
    expect(toolsWithDetails[0].llmProxyId).toBe(childAgent.id);
  });
});
