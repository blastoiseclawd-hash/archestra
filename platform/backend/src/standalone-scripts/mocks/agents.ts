import { randomUUID } from "node:crypto";
import type { InsertLlmProxy } from "@/types";
import { randomElement } from "./utils";

const AGENT_NAME_TEMPLATES = [
  "Data Analyst",
  "API Monitor",
  "Security Scanner",
  "Performance Optimizer",
  "Code Reviewer",
  "Content Moderator",
  "Quality Assurance",
  "System Administrator",
  "Database Manager",
  "Network Engineer",
  "Cloud Architect",
  "DevOps Specialist",
  "Frontend Developer",
  "Backend Developer",
  "Full Stack Engineer",
  "Machine Learning Engineer",
  "Data Scientist",
  "Automation Specialist",
  "Integration Expert",
  "Support Agent",
];

const AGENT_SUFFIXES = [
  "",
  " Pro",
  " Advanced",
  " Enterprise",
  " Plus",
  " AI",
  " Assistant",
  " Bot",
  " v2",
  " Next",
];

/**
 * Generate a unique agent name by combining templates and suffixes
 */
function generateAgentName(index: number): string {
  const template = randomElement(AGENT_NAME_TEMPLATES);
  const suffix =
    index < AGENT_NAME_TEMPLATES.length * 3
      ? randomElement(AGENT_SUFFIXES)
      : ` #${Math.floor(index / 10) + 1}`;
  return `${template}${suffix}`;
}

type MockLlmProxy = InsertLlmProxy & { id: string };

/**
 * Generate mock LLM proxy data
 * @param count - Number of profiles to generate (defaults to 90)
 */
export function generateMockAgents(count = 90): MockLlmProxy[] {
  const proxies: MockLlmProxy[] = [];

  for (let i = 0; i < count; i++) {
    proxies.push({
      id: randomUUID(),
      organizationId: "default-org-id",
      name: generateAgentName(i),
      teams: [],
    });
  }

  return proxies;
}
