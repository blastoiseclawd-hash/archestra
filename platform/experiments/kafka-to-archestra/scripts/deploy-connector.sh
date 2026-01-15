#!/bin/bash
#
# Deploy HTTP Sink Connectors to route Kafka events to Archestra
#
# Usage:
#   export ARCHESTRA_TOKEN=your-token
#   export CUSTOMER_SUPPORT_PROMPT_ID=xxx
#   export ORDER_PROCESSING_PROMPT_ID=xxx
#   export ANALYTICS_PROMPT_ID=xxx
#   ./scripts/deploy-connector.sh

set -e

KAFKA_CONNECT_URL="${KAFKA_CONNECT_URL:-http://localhost:8083}"
ARCHESTRA_URL="${ARCHESTRA_URL:-http://host.docker.internal:9000}"

echo "Waiting for Kafka Connect to be ready..."
until curl -s "${KAFKA_CONNECT_URL}/connectors" > /dev/null 2>&1; do
  echo "  Kafka Connect not ready, waiting..."
  sleep 5
done
echo "Kafka Connect is ready!"

# Check required environment variables
if [ -z "$ARCHESTRA_TOKEN" ]; then
  echo "ERROR: ARCHESTRA_TOKEN environment variable is required"
  exit 1
fi

# Function to deploy a connector
deploy_connector() {
  local name=$1
  local topic=$2
  local prompt_id=$3

  if [ -z "$prompt_id" ]; then
    echo "Skipping $name - no prompt ID configured"
    return
  fi

  echo "Deploying connector: $name"
  echo "  Topic: $topic"
  echo "  Prompt ID: $prompt_id"

  # Delete existing connector if it exists
  curl -s -X DELETE "${KAFKA_CONNECT_URL}/connectors/${name}" > /dev/null 2>&1 || true

  # Create new connector
  # Note: The HTTP Sink connector doesn't support request body templating out of the box
  # We use a workaround with RegexRouter SMT and custom headers
  curl -s -X POST "${KAFKA_CONNECT_URL}/connectors" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "'"${name}"'",
      "config": {
        "connector.class": "io.confluent.connect.http.HttpSinkConnector",
        "tasks.max": "1",
        "topics": "'"${topic}"'",
        "http.api.url": "'"${ARCHESTRA_URL}"'/v1/a2a/'"${prompt_id}"'",
        "headers": "Content-Type:application/json|Authorization:Bearer '"${ARCHESTRA_TOKEN}"'",
        "request.method": "POST",
        "batch.max.size": "1",
        "retry.on.status.codes": "408,429,500,502,503,504",
        "max.retries": "3",
        "retry.backoff.ms": "1000",
        "behavior.on.error": "log",
        "reporter.bootstrap.servers": "kafka:29092",
        "reporter.result.topic.name": "archestra-responses",
        "reporter.error.topic.name": "archestra-errors",
        "key.converter": "org.apache.kafka.connect.storage.StringConverter",
        "value.converter": "org.apache.kafka.connect.storage.StringConverter",
        "transforms": "wrapA2A",
        "transforms.wrapA2A.type": "org.apache.kafka.connect.transforms.HoistField$Value",
        "transforms.wrapA2A.field": "message"
      }
    }' | jq .

  echo ""
}

# Deploy connectors for each topic
echo ""
echo "=== Deploying HTTP Sink Connectors ==="
echo ""

deploy_connector "archestra-customer-support" "customer.events" "$CUSTOMER_SUPPORT_PROMPT_ID"
deploy_connector "archestra-order-processing" "orders.events" "$ORDER_PROCESSING_PROMPT_ID"
deploy_connector "archestra-analytics" "analytics.events" "$ANALYTICS_PROMPT_ID"

echo ""
echo "=== Connector Status ==="
curl -s "${KAFKA_CONNECT_URL}/connectors" | jq .

echo ""
echo "Done! Check connector status with:"
echo "  curl ${KAFKA_CONNECT_URL}/connectors/<name>/status"
