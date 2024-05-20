import { RunnableSequence } from "@langchain/core/runnables"
import { AgentExecutor } from "langchain/agents"

export type PlanAndExecuteState = {
    objective: string |null,
    input: string | null,
    plan: Array<string>,
    pastSteps: Array<string>,
    response: string | null
}


