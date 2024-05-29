import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseMessage, FunctionMessage, SystemMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableBranch, RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import { Tool } from "@langchain/core/tools";
import { SupabaseService } from "src/services/supabase.service";
import { LLMCompilerPlanParser } from "src/utils/types/LLMCompilerPlanParser";
import { Task } from "src/utils/types/PlanAndSchedule";

export async function createPlannerAgent(
    llm: BaseChatModel,
    tools: Tool[],
    basePrompt: ChatPromptTemplate,
  ) {
    const toolDescriptions = tools
		.map((tool, i) => `${i + 1}. ${tool.description}\n`)
		.join('');

    // console.log(toolDescriptions);

    const plannerPrompt = await basePrompt.partial({
      replan: '',
      numTools: (tools.length + 1).toString(),
      toolDescriptions: toolDescriptions,
    });

    const replannerPrompt = await basePrompt.partial({
      replan: ` - You are given "Previous Plan" which is the plan that the previous agent created along with the execution results '
            "(given as Observation) of each plan and a general thought (given as Thought) about the executed results."
            'You MUST use these information to create the next plan under "Current Plan".\n'
            ' - When starting the Current Plan, you should start with "Thought" that outlines the strategy for the next plan.\n'
            " - In the Current Plan, you should NEVER repeat the actions that are already executed in the Previous Plan.\n"
            " - You must continue the task index from the end of the previous one. Do not repeat task indices."`,
      numTools: (tools.length + 1).toString(),
      toolDescriptions: toolDescriptions,
    });

    const shouldReplan = (state: BaseMessage[]): boolean => {
      return state[state.length - 1] instanceof SystemMessage;
    };

    const wrapMessages = (state: BaseMessage[]): {[key: string]: BaseMessage[]} => {
    //   console.log(state)
      return { messages: state }
    };

    const wrapAndGetLastIndex = (state: BaseMessage[]): {[key: string]: BaseMessage[]} => {
      let nextTask = 0;
      for (let i = state.length - 1; i >= 0; i--) {
        const message = state[i];
        if (message instanceof FunctionMessage ) {
          nextTask = (message.additional_kwargs['idx'] as number) + 1;
          break;
        }
      }
      state[state.length - 1].content += ` - Begin counting at : ${nextTask}`;
    //   console.log("Replan")
    //   console.log(state)
      return { messages: state };
    };

    const runnableWrapMessage = new RunnableLambda<BaseMessage[], {[key: string]: BaseMessage[]}>({
      func: wrapMessages,
    });


    const runnableWrapAndGetLastIndex = new RunnableLambda<BaseMessage[], {[key: string]: BaseMessage[]}>({
      func: wrapAndGetLastIndex,
    });

    const printPlan = new RunnableLambda<Task[], Task[]>({
      func: async (plan: Task[]): Promise<Task[]> => {
		console.log(plan)
		return plan
      }
    })

    // return plannerPrompt
    //   .pipe(llm)
    //   .pipe(new LLMCompilerPlanParser((tools = tools)));

    return RunnableSequence.from([
        RunnableBranch.from([
            [
              (state: BaseMessage[]) => shouldReplan(state),
              () => RunnableSequence.from([runnableWrapAndGetLastIndex, replannerPrompt]),
            ],
            () => RunnableSequence.from([runnableWrapMessage, plannerPrompt]),
          ]),
        llm,
        new LLMCompilerPlanParser(tools),
		printPlan
    ])
  }