import { BaseMessage, FunctionMessage, FunctionMessageFieldsWithName, SystemMessage } from "@langchain/core/messages";
import { RunnableConfig, RunnableFunc, RunnableLambda } from "@langchain/core/runnables";
import { SchedulerInput, Task } from "src/utils/types/PlanAndSchedule";
import ThreadPoolExecutor from "src/utils/types/ThreadPoolExecutor";
import { createPlannerAgent } from "./plannerAgent";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { DynamicTool, Tool } from "@langchain/core/tools";
import { z } from "zod"
import { SupabaseService } from "src/services/supabase.service";

function getObservations(messages: BaseMessage[]): {[key: number]: any} {
    let results: { [key: number]: any } = {};
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message instanceof FunctionMessage) {
            results[message.additional_kwargs["idx"] as number] = message.content;
        }
    }
    return results;
}

async function executeTask(task: Task, observations: { [key: number]: any}, config: RunnableConfig){
    // console.log("Now executing task... ")
    // console.log(task)
    const toolToUse = task.tool
    if (typeof toolToUse == 'string'){
        return toolToUse
    }

    // console.log("Executing task...")
    // console.log(task)

    const args = task.args
    let resolveArgs: {[key: string]: any} = {}

    try{
        if (typeof args == "string"){
            resolveArgs = resolveArg(args, observations)
        } else if (args instanceof Object && Object.keys(args).length > 0){
            for (const key of Object.keys(args)){
                resolveArgs[key] = resolveArg(args[key], observations)
            }
        } else {
            resolveArgs = args
        }
    } catch (e){
        return "ERROR(Failed to call " + toolToUse.name + " with args " + resolveArgs + "\n Args could not be resolved. Error: " + e
        
    }
    try{
        // console.log("Arguments for task: ")
        // console.log(resolveArgs)
        // console.log("Tool for task")
        // console.log(toolToUse)
        const answer = await toolToUse.invoke(resolveArgs, config)
        // console.log("Task results: ")
        // console.log(answer)
        return answer
    } catch (e){
        return "ERROR(Failed to call " + toolToUse.name + " with args " + resolveArgs + " \n Args resolved to brr. Error: " + e
    }
}

function resolveArg(arg: string | any, observations: { [key: string]: any }){
    const ID_PATTERN = /\$\{?(\d+)\}?/g;

    function replaceMatch(match: string, p1: string): string {
        const idx = parseInt(p1, 10);
        return observations[idx] !== undefined ? String(observations[idx]) : match;
    }

    if (typeof arg == "string") {
        return arg.replace(ID_PATTERN, replaceMatch);
    } else if (Array.isArray(arg)) {
        return arg.map(a => resolveArg(a, observations));
    } else {
        return String(arg);
    }
}

async function scheduleTask(taskInputs: {[key: string]: any}, config: RunnableConfig){
    const task: Task = taskInputs.task
    const observations: {[key: number]: any} =  taskInputs.observations
    let observation: any = null
    try{
        const obs = await executeTask(task, observations, config)
        // console.log("Task results:")
        // console.log(obs)
        observation = obs
    } catch (e){
        observation = e
    }
    // console.log("observation")
    // console.log(observation)
    observations[task.idx] = observation
}

async function schedulePendingTask(
    task: Task,
    observations: {[key: number]: any}
){
    const retryAfter = 0.2
    while(1){
        const deps = task.dependencies
        if (deps.keys.length > 0 && deps.keys.every(dep => !Object.keys(observations).map(key => Number(key)).includes(Number(dep)))){
            setTimeout(() => {}, retryAfter)
            continue
        }
        await scheduleTask({task: task, observations: observations}, null)
    }
}

async function scheduleTasks(schedulerInput: SchedulerInput): Promise<FunctionMessage[]>{
    const tasks = schedulerInput.tasks
    let argsForTasks = {}
    const messages = schedulerInput.messages
    const observations: {[key: number]: any} = getObservations(messages)
    let taskNames = {}
    const it: Iterable<number> = Object.keys(observations).map(key => Number(key))
    const originals = new Set<number>(it)
    let futures = []
    const retryAfter = 0.25
    const pool = new ThreadPoolExecutor('./src/utils/types/Worker.ts', tasks.length);
    // console.log(tasks)
    for (const task of tasks){
        const deps = task.dependencies
        taskNames[task.idx] = typeof task.tool === 'string' ? task.tool : task.tool.name
        argsForTasks[task.idx] = task.args
        // console.log(deps)
        if (deps.keys.length > 0 && deps.keys.every(dep => !Object.keys(observations).map(key => Number(key)).includes(Number(dep)))) {
            futures.push(new Promise((resolve, reject) => {
                // console.log("Pushing futures")
                pool.submit({
                    schedulePendingTask,
                    task,
                    observations,
                    resolve,
                    reject
                })
            }))
        } else {
            // console.log("Schedule Task")
            await scheduleTask({task: task, observations: observations}, null)
        }
    }
    await Promise.all(futures)


    // console.log("Final observation")
    // console.log(observations)
    let newObservations: {[key: number]: any} = {}

    for (const k of Object.keys(observations).filter(value => !originals.has(Number(value)))){
        newObservations[k] = {
            name: taskNames[k],
            taskArgs: argsForTasks[k],
            observation: observations[k]
        }
    }
    // console.log("new observations")
    // console.log(newObservations)
    let toolMessages: FunctionMessage[] = []
    for (const k of Object.keys(newObservations).map(obs => Number(obs))){
        const fields: FunctionMessageFieldsWithName = {
            name: newObservations[k].name,
            content: newObservations[k].observation,
            additional_kwargs:{
                idx: k,
                args: newObservations[k].taskArgs
            }
        }
        toolMessages.push(new FunctionMessage(fields))
    }
    // console.log(toolMessages)
    return toolMessages
}

export const planAndSchedule: RunnableFunc<{[key: string]: any}, any> = async (
    messages: BaseMessage[],
    config: RunnableConfig
) => {
    // console.log("Plan and Schedule")
    const llm = new ChatOpenAI({
        model: 'gpt-4o',
    });
  
    const basePrompt = ChatPromptTemplate.fromMessages([
        ["system", `Given a user query, create a plan to solve it with the utmost parallelizability. Each plan should comprise an action from the following {numTools} types:
      {toolDescriptions}
      {numTools}. join(): Collects and combines results from prior actions.
      
       - An LLM agent is called upon invoking join() to either finalize the user query or wait until the plans are executed.
       - join should always be the last action in the plan, and will be called in two scenarios:
         (a) if the answer can be determined by gathering the outputs from tasks to generate the final response.
         (b) if the answer cannot be determined in the planning phase before you execute the plans. Guidelines:
       - Each action described above contains input/output types and description.
          - You must strictly adhere to the input and output types for each action.
          - The action descriptions contain the guidelines. You MUST strictly follow those guidelines when you use the actions.
       - Each action in the plan should strictly be one of the above types. Follow the Python conventions for each action.
       - Each action MUST have a unique ID, which is strictly increasing.
       - Inputs for actions can either be constants or outputs from preceding actions. In the latter case, use the format $id to denote the ID of the previous action whose output will be the input.
       - Always call join as the last action in the plan. Say '<END_OF_PLAN>' after you call join
       - Ensure the plan maximizes parallelizability.
       - Only use the provided action types. If a query cannot be addressed using these, invoke the join action for the next steps.
       - Never introduce new actions other than the ones provided.`],
        ["placeholder", "{messages}"],
        ["system", `Remember, ONLY respond with the task list in the correct format! E.g.:
      idx. tool(arg_name=args)`],
        ["system", "{replan}"]
      ])

    
    const tools = defineTools()
  
    const planner = await createPlannerAgent(llm, tools, basePrompt);
    const tasks = await planner.invoke(messages, config)
    const runnableScheduleTasks = new RunnableLambda<SchedulerInput, Promise<FunctionMessage[]>>({
        func: scheduleTasks,
    })
    const scheduledTasks = await runnableScheduleTasks.invoke({
        messages: messages,
        tasks: tasks
    })

    return scheduledTasks
}


function defineTools(): Tool[]{
    const tavilyTool = new TavilySearchResults({ maxResults: 3 });
    tavilyTool.description =
    'tavily_search_results_json(input="the search query") - a search engine.';

    const supabase = new SupabaseService()

    const supabaseTool = new DynamicTool({
        name: "supabase_similarity_search_results_json",
        description: 'supabase_similarity_search_results_json(input="the search query") - a similarity search engine in vectorstore database. You can use this tool to search for context of this conversation',
        func: supabase.searchEmbeddings
    })

    return [tavilyTool, supabaseTool]
}
