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
  modelId: string;
  streaming?: boolean;
}) {
  const { request, reply, body, agentId, modelId, streaming = false } = params;
  const headers = request.headers as Bedrock.Types.ConverseHeaders;

  logger.info(
    {
      url: request.url,
      agentId,
      modelId,
      streaming,
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
    "[UnifiedProxy] Handling Bedrock request",
  );

  const externalAgentId = utils.externalAgentId.getExternalAgentId(headers);
  const userId = await utils.userId.getUserId(headers);

  const finalBody = { ...body, modelId };

  return handleLLMProxy(finalBody, headers, reply, bedrockAdapterFactory, {
    organizationId: request.organizationId,
    agentId,
    externalAgentId,
    userId,
  });
}

/**
 * Bedrock Converse API routes following native AWS API format.
 * Native Bedrock API: POST /model/{modelId}/converse
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
 */
const bedrockProxyRoutesV2: FastifyPluginAsyncZod = async (fastify) => {
  const BEDROCK_PREFIX = `${PROXY_API_PREFIX}/bedrock`;

  logger.info("[UnifiedProxy] Registering unified Amazon Bedrock routes");

  /**
   * Bedrock Converse API with agent and model ID in path
   * POST /v1/bedrock/:agentId/model/:modelId/converse
   * POST /v1/bedrock/:agentId/model/:modelId/converse-stream
   */
  fastify.post(
    `${BEDROCK_PREFIX}/:agentId/model/:modelId/:action(converse|converse-stream)`,
    {
      bodyLimit: PROXY_BODY_LIMIT,
      schema: {
        operationId: RouteId.BedrockConverseWithAgent,
        description:
          "Send a message to Amazon Bedrock with agent and model ID in path",
        tags: ["llm-proxy"],
        params: z.object({
          agentId: UuidIdSchema,
          modelId: z.string(),
          action: z.enum(["converse", "converse-stream"]),
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
        modelId: decodeURIComponent(request.params.modelId),
        streaming: request.params.action === "converse-stream",
      }),
  );

  /**
   * Bedrock Converse API with model ID in path (default agent)
   * POST /v1/bedrock/model/:modelId/converse
   * POST /v1/bedrock/model/:modelId/converse-stream
   */
  fastify.post(
    `${BEDROCK_PREFIX}/model/:modelId/:action(converse|converse-stream)`,
    {
      bodyLimit: PROXY_BODY_LIMIT,
      schema: {
        operationId: RouteId.BedrockConverseWithDefaultAgent,
        description: "Send a message to Amazon Bedrock with model ID in path",
        tags: ["llm-proxy"],
        params: z.object({
          modelId: z.string(),
          action: z.enum(["converse", "converse-stream"]),
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
        modelId: decodeURIComponent(request.params.modelId),
        streaming: request.params.action === "converse-stream",
      }),
  );
};

export default bedrockProxyRoutesV2;
