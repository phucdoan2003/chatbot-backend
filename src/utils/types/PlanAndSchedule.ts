import { BaseMessage } from "@langchain/core/messages";
import { Runnable, RunnableConfig } from "@langchain/core/runnables";
import { Tool } from "@langchain/core/tools";

export type SchedulerInput = {
    messages: BaseMessage[];
    tasks: Task[]
}

export type PlanAndScheduleInput = {
    messages: BaseMessage[],
    config: RunnableConfig,
    planner: Runnable
}

export type Task = {
    idx: number;
    tool: Tool | string;
    args: { [key: string]: any};
    dependencies: { [key: string]: string[]};
    thought?: string;
}