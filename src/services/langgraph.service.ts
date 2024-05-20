import { ChatPromptTemplate } from '@langchain/core/prompts';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { convertToOpenAIFunction } from '@langchain/core/utils/function_calling';
import { ChatOpenAI } from '@langchain/openai';
import { Injectable } from '@nestjs/common';
import { z } from "zod"
import { JsonOutputFunctionsParser, StructuredOutputParser } from "langchain/output_parsers";
import { TavilySearchService } from './tavily.service';
import { RunnableSequence } from '@langchain/core/runnables';
import { PlanAndExecuteState} from 'src/controllers/types/langgraph';
import { END, START, StateGraph } from '@langchain/langgraph';
import { CompiledStateGraph } from '@langchain/langgraph/dist/graph/state';
import { AgentExecutor } from 'langchain/agents';
import { FunctionDefinition } from '@langchain/core/language_models/base';

@Injectable()
export class PlanAndExecuteGraph {
    private schemas = {
        plan: z.object({
            steps: z.array(z.string()).describe(
                "Different steps to follow, should be in sorted order",
            ),
        }),

        response: z.object({
            response: z.string().describe("Response to user")
        }),

        tavily: z.object({
            results: z.array(z.object({
                information: z.string().describe("the most important information obtained from the source"),
                source: z.string().describe("the url where the information came from")
            })).describe("array that contains multiple search results")
        })
    }

    private formats = {
        plan: StructuredOutputParser.fromZodSchema(this.schemas.plan).getFormatInstructions(),
        response: StructuredOutputParser.fromZodSchema(this.schemas.response).getFormatInstructions(),
        tavily: StructuredOutputParser.fromZodSchema(this.schemas.tavily).getFormatInstructions()
    }

    private parser = new JsonOutputFunctionsParser({argsOnly: true})

    private agents = {
        planner: RunnableSequence.prototype,
        replanner: RunnableSequence.prototype,
        tools: {
            "tavily": AgentExecutor.prototype,
            "compiler": RunnableSequence.prototype
        }
    }

    async createOpenAIFunctions(){
        const planFunction = await convertToOpenAIFunction(new DynamicStructuredTool({
            name: "plan",
            description: "This tool is used to plan the steps to follow",
            schema: this.schemas.plan,
            func: async () => ""
        }))

        const responseFunction = await convertToOpenAIFunction(new DynamicStructuredTool({
            name: "response",
            description: "Response to user",
            schema: this.schemas.response,
            func: async (input): Promise<any> => { 
                return {
                    response: input.response
                }
            }
        }))

        const compileFunction = await convertToOpenAIFunction(new DynamicStructuredTool({
            name: "compile",
            description: "This tool is used to compile the search results and return a response to user",
            schema: this.schemas.response,
            func: async () => ""
        }))

        return [planFunction, responseFunction, compileFunction]
    }

    async createPlannerAgent(planFunction: FunctionDefinition){
        const prompt = ChatPromptTemplate.fromTemplate(
            `For the given objective, come up with a simple step by step plan. \
            This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add any superfluous steps. \
            The result of the final step should be the final answer. Make sure that each step has all the information needed - do not skip steps. \
            There are a couple of search tools at your disposal, use these tools in your plan: Tavily
            {format_instructions}\
            {objective}`,
        )

        const llm = new ChatOpenAI({
            model: "gpt-3.5-turbo-0125",
            temperature: 0,
        }).bind({
            functions: [planFunction],
            function_call: planFunction
        })

        const planner = RunnableSequence.from([
            prompt,
            llm,
            this.parser,
        ])

        return planner
    }

    async createReplannerAgent(planFunction: FunctionDefinition, responseFunction: FunctionDefinition){
        const prompt = ChatPromptTemplate.fromTemplate(
            `For the given objective, come up with a simple step by step plan.
            This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add any superfluous steps.
            The result of the final step should be the final answer. Make sure that each step has all the information needed - do not skip steps.
            
            Your objective was this:
            {input}
            
            Your original plan was this:
            {plan}
            
            You have currently done the follow steps:
            {pastSteps}
            
            Update your plan accordingly. If no more steps are needed and you can return to the user, then respond with that and use the 'response' function
            Otherwise, fill out the plan.
            Only add steps to the plan that still NEED to be done. Do not return previously done steps as part of the plan.`,
        );

        const llm = new ChatOpenAI({
            model: "gpt-3.5-turbo-0125",
            temperature: 0,
        }).bind({
            functions: [responseFunction, planFunction],
        })

        const replanner = RunnableSequence.from([
            prompt,
            llm,
            this.parser
        ])

        return replanner
    }

    async createCompilerAgent(compileTool: FunctionDefinition){
        const prompt = ChatPromptTemplate.fromTemplate(
            `Analyse the given information and return a response to the user objective\
            {information}
            {objective}
            {format_instructions}`
        )

        const llm = new ChatOpenAI({
            model: "gpt-3.5-turbo-0125",
            temperature: 0
        }).bind({
            functions: [compileTool],
            function_call: compileTool
        })

        const compiler = RunnableSequence.from([
            prompt,
            llm,
            this.parser
        ])

        return compiler
    }

    async setupAgent() {
        const [planFunction, responseFunction, compileFunction] = await this.createOpenAIFunctions()
        
        this.agents.planner = await this.createPlannerAgent(planFunction)
        this.agents.replanner = await this.createReplannerAgent(planFunction, responseFunction)
        this.agents.tools["tavily"] = await new TavilySearchService().getTavilyAgent()
        this.agents.tools["compiler"] = await this.createCompilerAgent(compileFunction)

    }


    shouldEnd(
        state: PlanAndExecuteState
    ): string {
        if(state.response){
            return "true"
        }
        return "false"
        
    }

    async setupGraph(){
        await this.setupAgent()

    
        const planNode = async (
            state: PlanAndExecuteState
        ): Promise<Partial<PlanAndExecuteState>> => {
            const plan: any = await this.agents.planner.invoke({
                objective: state.input,
                format_instructions: this.formats.plan
            })
            return {
                objective: state.input,
                plan: plan.steps
            }
        }
    
        const replanNode = async (
            state: PlanAndExecuteState
        ): Promise<Partial<PlanAndExecuteState>> => {
            const output: any = await this.agents.replanner.invoke({
                input: state.input,
                plan: state.plan? state.plan.join("\n"): "",
                pastSteps: state.pastSteps.join("\n")
            })
            if ("response" in output){
                return { response: output.response }
            }
    
            return { plan: output.steps }
            
        }

        const tavilySearchNode = async (
            state: PlanAndExecuteState
        ): Promise<Partial<PlanAndExecuteState>> => {
            const task = state.input
            const agentResponse: any = await this.agents.tools["tavily"].invoke({
                input: task,
                format_instructions: this.formats.tavily
            })
            if(agentResponse){
                return {
                    input: agentResponse.output,
                    pastSteps: [task, agentResponse.output]
                }
            }
        }

        const compileNode = async (
            state: PlanAndExecuteState
        ): Promise<Partial<PlanAndExecuteState>> => {
            const output: any = await this.agents.tools["compiler"].invoke({
                information: state.input,
                objective: state.objective,
                format_instructions: this.formats.response
            })
            if(output){
                return output
            }
        }

        const planExecuteState = {
            objective: {
                value: null
            },
            input: {
              value: null,
            },
            plan: {
              value: null,
              default: () => [],
            },
            pastSteps: {
              value: (x: string[], y: string[]) => x.concat(y),
              default: () => [],
            },
            response: {
              value: null,
            },
        };


        const workflow = new StateGraph<PlanAndExecuteState, Partial<PlanAndExecuteState>, string>({
            channels: planExecuteState,
        })

        workflow.addNode("planner", planNode)

        workflow.addNode("tavilyAgent", tavilySearchNode)

        // workflow.addNode("replan", replanNode)

        workflow.addNode("compile", compileNode)

        workflow.addEdge(START, "planner")

        workflow.addEdge("planner", "tavilyAgent")

        // workflow.addEdge("planner", END)

        workflow.addEdge("tavilyAgent", "compile")

        // workflow.addConditionalEdges(
        //     "replan",
        //     this.shouldEnd,
        //     {
        //         "true": END,
        //         "false": "planner",
        //     },
        // )

        // workflow.addEdge("tavilyAgent", END)

        workflow.addEdge("compile", END)

        const app = workflow.compile();
        return app
    }

    async executeGraph(app: CompiledStateGraph<PlanAndExecuteState, Partial<PlanAndExecuteState>, string>, input: string){
        const config = {
            recursionLimit: 10
        }

        const inputs = {
            input,
        };
        
        // for await (const event of await app.stream(inputs, config)) {
        //     console.log(event);
        // }

        return await app.invoke({
            input
        })
    }
}
