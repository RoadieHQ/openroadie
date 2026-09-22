# AI Backend

AI Backend plugin provides agent-based AI services using the AI SDK v5. This replaces the previous Mastra-based implementation while maintaining API compatibility.

## Architecture

The AI Backend consists of several key components:

- **Agent Registry**: Manages agent definitions and configurations
- **Toolset Registry**: Manages tool collections that agents can use
- **Model Registry**: Handles different AI models (OpenAI, Anthropic, etc.)
- **Agent Service**: Handles agent execution and streaming
- **AI Service**: Main orchestration layer

## Features

### Multi-Step Agent Execution

AI SDK v5 agents support multi-step execution with tool calls. By default, agents stop after making tool calls, but can be configured to continue processing:

```typescript
const agent = new Agent({
  model,
  system: agentConfig.system,
  tools,
  stopWhen: stepCountIs(agentConfig.maxSteps || 3), // Allow multiple steps
});
```

### Agent Configuration

```typescript
export type AgentConfig = {
  id: string;
  name: string;
  description?: string;
  system: string; // System prompt (replaces 'instructions')
  model: AgenticModelRef;
  tools?: Record<string, Tool>;
  maxSteps?: number; // Configurable step limit
  toolChoice?: ToolChoice<Record<string, Tool>>; // Tool usage control
};
```

### Tool Integration

Tools use the AI SDK v5 `tool()` function with Zod schemas:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const exampleTool = tool({
  description: 'Example tool that processes input',
  inputSchema: z.object({
    input: z.string().describe('The input to process'),
  }),
  execute: async ({ input }, { experimental_context }) => {
    // Tool implementation
    return { result: `Processed: ${input}` };
  },
});
```

## Best Practices

### Agent Configuration

1. **Set appropriate `maxSteps`**:
   - Simple agents: 1-3 steps
   - Tool-using agents: 3-5 steps
   - Complex workflows: 5-10 steps

2. **System prompt clarity**:
   - Be explicit about when to use tools
   - Specify expected response format
   - Guide multi-step reasoning

3. **Tool design**:
   - Keep tools focused and atomic
   - Provide clear descriptions
   - Use proper input schemas

### Common Usage Patterns

**Simple Agent (no tools):**

```typescript
agentRegistry.createAgent(agentRef, {
  id: 'simple-agent',
  name: 'Simple Agent',
  system: 'You are a helpful assistant.',
  model: 'haiku-3',
});
```

**Tool-Using Agent:**

```typescript
agentRegistry.createAgent(agentRef, {
  id: 'tool-agent',
  name: 'Tool Agent',
  system: 'Use tools when needed to help the user.',
  model: 'haiku-3',
  maxSteps: 5, // Allow complex tool interactions
});

agentRegistry.attachToolset(agentRef, toolsetRef);
```

## Troubleshooting

### Agent Consuming Tokens But No Response Text

**Problem**: Agent uses tokens but returns empty streaming response.

**Cause**: Agent stops after tool calls with `finishReason: 'tool-calls'` and doesn't continue to generate text.

**Solution**: Configure `maxSteps > 1` to allow multi-step execution:

```typescript
agentRegistry.createAgent(agentRef, {
  // ... other config
  maxSteps: 3, // Allow tool execution + follow-up response
});
```

### Tools Called But Results Not Used

**Problem**: Tools execute successfully but agent doesn't incorporate results into response.

**Solution**: Update system prompt to guide post-tool behavior:

```typescript
system: `Use available tools when needed. After using a tool, provide a helpful response based on the tool's results.`;
```

## API Endpoints

- `POST /api/ai/agents/{agentId}/call` - Execute agent with query
- `POST /api/ai/agents/{agentId}/stream` - Stream agent response
- `GET /api/ai/agents` - List available agents
- `GET /api/ai/models` - List available models

## Development

See the `ai-examples-module` for comprehensive examples of agent configurations and tool usage patterns.
