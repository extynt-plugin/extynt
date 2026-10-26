// The tool call every dispatch step of the chat agent receives, and the runners that re-enter the agent as the same turn.
import { type JsonObject } from "@extynt/decode";
import type { AgentRunInput } from "./agent-types.js";
import type { AgentCallState, AgentToolReply, ChatAgentInput } from "./server-chat-agent-types.js";

/** One tool call as the native tools see it: its name, its arguments and the turn it belongs to. */
export interface NativeToolCall {
  readonly name: string;
  readonly args: JsonObject;
  readonly input: ChatAgentInput;
}

/** One tool call of a turn, with the state its sibling calls share. */
export interface AgentToolCall extends NativeToolCall {
  readonly state: AgentCallState;
}

/** The arguments of a tool call as the agent loop and the workflow modules pass them. */
export type ToolArgs = Parameters<AgentRunInput["callTool"]>[1];

/** Runs a tool as the calling turn would, under the call state of the caller. */
export type AgentToolRunner = (name: string, args: ToolArgs) => Promise<AgentToolReply>;

/** Runs a tool as the turn would, under the call state given (the turn's own, or the designer's). */
export type TurnToolRunner = (name: string, args: ToolArgs, state: AgentCallState) => Promise<AgentToolReply>;

/** The runner that answers under one call state. */
export function runnerIn(tools: TurnToolRunner, state: AgentCallState): AgentToolRunner {
  return (name, args) => tools(name, args, state);
}
