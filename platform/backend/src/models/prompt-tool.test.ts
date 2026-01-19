import { describe, expect, test } from "@/test";
import PromptToolModel from "./prompt-tool";

describe("PromptToolModel", () => {
  describe("create", () => {
    test("should create a prompt-tool relationship", async ({
      makeAgent,
      makeTool,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const tool = await makeTool();
      const prompt = await makePrompt(agent.id, org.id);

      const promptTool = await PromptToolModel.create(prompt.id, tool.id);

      expect(promptTool.id).toBeDefined();
      expect(promptTool.promptId).toBe(prompt.id);
      expect(promptTool.toolId).toBe(tool.id);
      expect(promptTool.responseModifierTemplate).toBeNull();
      expect(promptTool.credentialSourceMcpServerId).toBeNull();
      expect(promptTool.executionSourceMcpServerId).toBeNull();
      expect(promptTool.useDynamicTeamCredential).toBe(false);
    });

    test("should create with optional fields", async ({
      makeAgent,
      makeTool,
      makeOrganization,
      makePrompt,
      makeMcpServer,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const tool = await makeTool();
      const prompt = await makePrompt(agent.id, org.id);
      const mcpServer = await makeMcpServer();

      const promptTool = await PromptToolModel.create(prompt.id, tool.id, {
        responseModifierTemplate: "Modified: {{result}}",
        credentialSourceMcpServerId: mcpServer.id,
        useDynamicTeamCredential: true,
      });

      expect(promptTool.responseModifierTemplate).toBe("Modified: {{result}}");
      expect(promptTool.credentialSourceMcpServerId).toBe(mcpServer.id);
      expect(promptTool.useDynamicTeamCredential).toBe(true);
    });
  });

  describe("delete", () => {
    test("should delete a prompt-tool relationship", async ({
      makeAgent,
      makeTool,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const tool = await makeTool();
      const prompt = await makePrompt(agent.id, org.id);

      await PromptToolModel.create(prompt.id, tool.id);

      // Verify it exists before deleting
      const existsBefore = await PromptToolModel.exists(prompt.id, tool.id);
      expect(existsBefore).toBe(true);

      // Delete the relationship
      await PromptToolModel.delete(prompt.id, tool.id);

      // Verify it's deleted
      const existsAfter = await PromptToolModel.exists(prompt.id, tool.id);
      expect(existsAfter).toBe(false);
    });

    test("should handle deleting non-existent relationship gracefully", async ({
      makeAgent,
      makeTool,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const tool = await makeTool();
      const prompt = await makePrompt(agent.id, org.id);

      // Should not throw when deleting non-existent relationship
      await PromptToolModel.delete(prompt.id, tool.id);

      // Verify it still doesn't exist
      const exists = await PromptToolModel.exists(prompt.id, tool.id);
      expect(exists).toBe(false);
    });
  });

  describe("exists", () => {
    test("should return true when relationship exists", async ({
      makeAgent,
      makeTool,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const tool = await makeTool();
      const prompt = await makePrompt(agent.id, org.id);

      await PromptToolModel.create(prompt.id, tool.id);

      const exists = await PromptToolModel.exists(prompt.id, tool.id);
      expect(exists).toBe(true);
    });

    test("should return false when relationship does not exist", async ({
      makeAgent,
      makeTool,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const tool = await makeTool();
      const prompt = await makePrompt(agent.id, org.id);

      const exists = await PromptToolModel.exists(prompt.id, tool.id);
      expect(exists).toBe(false);
    });
  });

  describe("findToolIdsByPrompt", () => {
    test("should return tool IDs for a prompt", async ({
      makeAgent,
      makeTool,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const tool1 = await makeTool({ name: "tool-1" });
      const tool2 = await makeTool({ name: "tool-2" });
      const prompt = await makePrompt(agent.id, org.id);

      await PromptToolModel.create(prompt.id, tool1.id);
      await PromptToolModel.create(prompt.id, tool2.id);

      const toolIds = await PromptToolModel.findToolIdsByPrompt(prompt.id);

      expect(toolIds).toHaveLength(2);
      expect(toolIds).toContain(tool1.id);
      expect(toolIds).toContain(tool2.id);
    });

    test("should return empty array when no tools assigned", async ({
      makeAgent,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const prompt = await makePrompt(agent.id, org.id);

      const toolIds = await PromptToolModel.findToolIdsByPrompt(prompt.id);

      expect(toolIds).toEqual([]);
    });
  });

  describe("createIfNotExists", () => {
    test("should create when not exists", async ({
      makeAgent,
      makeTool,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const tool = await makeTool();
      const prompt = await makePrompt(agent.id, org.id);

      const promptTool = await PromptToolModel.createIfNotExists(
        prompt.id,
        tool.id,
      );

      expect(promptTool).not.toBeNull();
      expect(promptTool?.promptId).toBe(prompt.id);
      expect(promptTool?.toolId).toBe(tool.id);
    });

    test("should return null when already exists", async ({
      makeAgent,
      makeTool,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const tool = await makeTool();
      const prompt = await makePrompt(agent.id, org.id);

      // Create first
      await PromptToolModel.create(prompt.id, tool.id);

      // Try to create again
      const result = await PromptToolModel.createIfNotExists(
        prompt.id,
        tool.id,
      );

      expect(result).toBeNull();
    });
  });

  describe("syncToolsForPrompt", () => {
    test("should add new tools and remove old ones", async ({
      makeAgent,
      makeTool,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const tool1 = await makeTool({ name: "tool-1" });
      const tool2 = await makeTool({ name: "tool-2" });
      const tool3 = await makeTool({ name: "tool-3" });
      const prompt = await makePrompt(agent.id, org.id);

      // Start with tool1 and tool2
      await PromptToolModel.create(prompt.id, tool1.id);
      await PromptToolModel.create(prompt.id, tool2.id);

      // Sync to tool2 and tool3 (remove tool1, keep tool2, add tool3)
      const result = await PromptToolModel.syncToolsForPrompt(prompt.id, [
        tool2.id,
        tool3.id,
      ]);

      expect(result.added).toBe(1);
      expect(result.removed).toBe(1);

      // Verify final state
      const toolIds = await PromptToolModel.findToolIdsByPrompt(prompt.id);
      expect(toolIds).toHaveLength(2);
      expect(toolIds).toContain(tool2.id);
      expect(toolIds).toContain(tool3.id);
      expect(toolIds).not.toContain(tool1.id);
    });

    test("should clear all tools when given empty array", async ({
      makeAgent,
      makeTool,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const tool1 = await makeTool({ name: "tool-1" });
      const tool2 = await makeTool({ name: "tool-2" });
      const prompt = await makePrompt(agent.id, org.id);

      await PromptToolModel.create(prompt.id, tool1.id);
      await PromptToolModel.create(prompt.id, tool2.id);

      const result = await PromptToolModel.syncToolsForPrompt(prompt.id, []);

      expect(result.added).toBe(0);
      expect(result.removed).toBe(2);

      const toolIds = await PromptToolModel.findToolIdsByPrompt(prompt.id);
      expect(toolIds).toEqual([]);
    });
  });

  describe("getToolsForPrompt", () => {
    test("should return prompt-tool relationships with tool details", async ({
      makeAgent,
      makeTool,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const tool = await makeTool({ name: "test-tool" });
      const prompt = await makePrompt(agent.id, org.id);

      await PromptToolModel.create(prompt.id, tool.id);

      const promptTools = await PromptToolModel.getToolsForPrompt(prompt.id);

      expect(promptTools).toHaveLength(1);
      expect(promptTools[0].toolName).toBe("test-tool");
      expect(promptTools[0].toolId).toBe(tool.id);
    });

    test("should return empty array when no tools assigned", async ({
      makeAgent,
      makeOrganization,
      makePrompt,
    }) => {
      const org = await makeOrganization();
      const agent = await makeAgent();
      const prompt = await makePrompt(agent.id, org.id);

      const promptTools = await PromptToolModel.getToolsForPrompt(prompt.id);

      expect(promptTools).toEqual([]);
    });
  });
});
