import { RouteId } from "@shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import logger from "@/logging";
import { Bedrock, constructResponseSchema, UuidIdSchema } from "@/types";
import { bedrockAdapterFactory } from "../adapterV2";
import { PROXY_API_PREFIX, PROXY_BODY_LIMIT } from "../common";
import { handleLLMProxy } from "../llm-proxy-handler";
import * as utils from "../utils";

/**
 * Shared handler for all Bedrock routes.
 * Logs the request, extracts user context, and forwards to LLM proxy.
 */
async function handleBedrockRequest(params: {
  request: FastifyRequest;
  reply: FastifyReply;
  body: Bedrock.Types.ConverseRequest;
  agentId?: string;
  modelIdFromPath?: string;
  logMessage: string;
}) {
  const { request, reply, body, agentId, modelIdFromPath, logMessage } = params;
  const headers = request.headers as Bedrock.Types.ConverseHeaders;

  logger.info(
    {
      url: request.url,
      ...(agentId && { agentId }),
      ...(modelIdFromPath && { modelId: modelIdFromPath }),
      headers: {
        ...headers,
        "x-amz-secret-access-key": headers["x-amz-secret-access-key"]
          ? "***"
          : undefined,
        "x-amz-session-token": headers["x-amz-session-token"]
          ? "***"
          : undefined,
      },
      bodyKeys: Object.keys(body || {}),
    },
    logMessage,
  );

  const externalAgentId = utils.externalAgentId.getExternalAgentId(headers);
  const userId = await utils.userId.getUserId(headers);

  // Merge model ID from path into body if provided
  const finalBody = modelIdFromPath
    ? { ...body, modelId: decodeURIComponent(modelIdFromPath) }
    : body;

  return handleLLMProxy(finalBody, headers, reply, bedrockAdapterFactory, {
    organizationId: request.organizationId,
    agentId,
    externalAgentId,
    userId,
  });
}

const bedrockProxyRoutesV2: FastifyPluginAsyncZod = async (fastify) => {
  const BEDROCK_PREFIX = `${PROXY_API_PREFIX}/bedrock`;
  const CONVERSE_SUFFIX = "/converse";

  logger.info("[UnifiedProxy] Registering unified Amazon Bedrock routes");

  // =========================================================================
  // LLM Proxy Routes - Used by external clients calling the proxy directly
  // =========================================================================

  /**
   * Bedrock Converse API (default agent)
   * POST /v1/bedrock/converse
   */
  fastify.post(
    `${BEDROCK_PREFIX}${CONVERSE_SUFFIX}`,
    {
      bodyLimit: PROXY_BODY_LIMIT,
      schema: {
        operationId: RouteId.BedrockConverseWithDefaultAgent,
        description: "Send a message to Amazon Bedrock using the default agent",
        tags: ["llm-proxy"],
        body: Bedrock.API.ConverseRequestSchema,
        headers: Bedrock.API.ConverseHeadersSchema,
        response: constructResponseSchema(Bedrock.API.ConverseResponseSchema),
      },
    },
    (request, reply) =>
      handleBedrockRequest({
        request,
        reply,
        body: request.body,
        logMessage: "[UnifiedProxy] Handling Bedrock request (default agent)",
      }),
  );

  /**
   * Bedrock Converse API (with agent)
   * POST /v1/bedrock/:agentId/converse
   */
  fastify.post(
    `${BEDROCK_PREFIX}/:agentId${CONVERSE_SUFFIX}`,
    {
      bodyLimit: PROXY_BODY_LIMIT,
      schema: {
        operationId: RouteId.BedrockConverseWithAgent,
        description: "Send a message to Amazon Bedrock using a specific agent",
        tags: ["llm-proxy"],
        params: z.object({
          agentId: UuidIdSchema,
        }),
        body: Bedrock.API.ConverseRequestSchema,
        headers: Bedrock.API.ConverseHeadersSchema,
        response: constructResponseSchema(Bedrock.API.ConverseResponseSchema),
      },
    },
    (request, reply) =>
      handleBedrockRequest({
        request,
        reply,
        body: request.body,
        agentId: request.params.agentId,
        logMessage: "[UnifiedProxy] Handling Bedrock request (with agent)",
      }),
  );

  // =========================================================================
  // AI SDK Routes - Used by Vercel AI SDK for Chat feature
  // The SDK generates URLs with model ID in the path
  // =========================================================================

  /**
   * Bedrock Converse API with agent and model ID in path
   * POST /v1/bedrock/:agentId/model/:modelId/converse
   */
  fastify.post(
    `${BEDROCK_PREFIX}/:agentId/model/:modelId${CONVERSE_SUFFIX}`,
    {
      bodyLimit: PROXY_BODY_LIMIT,
      schema: {
        operationId: RouteId.BedrockConverseWithAgent + "_model",
        description:
          "Send a message to Amazon Bedrock with agent and model ID in path",
        tags: ["llm-proxy"],
        params: z.object({
          agentId: UuidIdSchema,
          modelId: z.string(),
        }),
        body: Bedrock.API.ConverseRequestSchema.omit({ modelId: true }),
        headers: Bedrock.API.ConverseHeadersSchema,
        response: constructResponseSchema(Bedrock.API.ConverseResponseSchema),
      },
    },
    (request, reply) =>
      handleBedrockRequest({
        request,
        reply,
        body: request.body as Bedrock.Types.ConverseRequest,
        agentId: request.params.agentId,
        modelIdFromPath: request.params.modelId,
        logMessage:
          "[UnifiedProxy] Handling Bedrock request (agent + model in path)",
      }),
  );

  /**
   * Bedrock Converse Stream API with agent and model ID in path
   * POST /v1/bedrock/:agentId/model/:modelId/converse-stream
   */
  fastify.post(
    `${BEDROCK_PREFIX}/:agentId/model/:modelId/converse-stream`,
    {
      bodyLimit: PROXY_BODY_LIMIT,
      schema: {
        operationId: RouteId.BedrockConverseWithAgent + "_model_stream",
        description:
          "Stream a message to Amazon Bedrock with agent and model ID in path",
        tags: ["llm-proxy"],
        params: z.object({
          agentId: UuidIdSchema,
          modelId: z.string(),
        }),
        body: Bedrock.API.ConverseRequestSchema.omit({ modelId: true }),
        headers: Bedrock.API.ConverseHeadersSchema,
        response: constructResponseSchema(Bedrock.API.ConverseResponseSchema),
      },
    },
    (request, reply) =>
      handleBedrockRequest({
        request,
        reply,
        body: request.body as Bedrock.Types.ConverseRequest,
        agentId: request.params.agentId,
        modelIdFromPath: request.params.modelId,
        logMessage:
          "[UnifiedProxy] Handling Bedrock streaming request (agent + model in path)",
      }),
  );

  // =========================================================================
  // LLM Proxy Alternative Route - Model in path, default agent
  // =========================================================================

  /**
   * Bedrock Converse API with model ID in path (default agent)
   * POST /v1/bedrock/model/:modelId/converse
   */
  fastify.post(
    `${BEDROCK_PREFIX}/model/:modelId${CONVERSE_SUFFIX}`,
    {
      bodyLimit: PROXY_BODY_LIMIT,
      schema: {
        operationId: RouteId.BedrockConverseWithDefaultAgent + "_model",
        description: "Send a message to Amazon Bedrock with model ID in path",
        tags: ["llm-proxy"],
        params: z.object({
          modelId: z.string(),
        }),
        body: Bedrock.API.ConverseRequestSchema.omit({ modelId: true }),
        headers: Bedrock.API.ConverseHeadersSchema,
        response: constructResponseSchema(Bedrock.API.ConverseResponseSchema),
      },
    },
    (request, reply) =>
      handleBedrockRequest({
        request,
        reply,
        body: request.body as Bedrock.Types.ConverseRequest,
        modelIdFromPath: request.params.modelId,
        logMessage: "[UnifiedProxy] Handling Bedrock request (model in path)",
      }),
  );
};

export default bedrockProxyRoutesV2;
