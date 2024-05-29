import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableFunc, RunnableLambda } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { convertToOpenAIFunction } from '@langchain/core/utils/function_calling';
import { ChatOpenAI } from '@langchain/openai';
import { JsonOutputFunctionsParser } from 'langchain/output_parsers';
import { SupabaseService } from 'src/services/supabase.service';
import { z } from 'zod';

const FinalResponse = z.object({
  response: z.string(),
});

const Replan = z.object({
  feedback: z
    .string()
    .describe(
      'Analysis of the previous attempts and recommendations on what needs to be fixed.',
    ),
});

const JoinOutput = z.object({
  thought: z
    .string()
    .describe('The chain of thought reasoning for the selected action'),
  action: z.union([FinalResponse, Replan]),
});

type FinalResponse = z.infer<typeof FinalResponse>
type Replan = z.infer<typeof Replan>
type JoinOutput = {
	thought: string,
	action: {
		[key: string]: any
	}
}

export async function createJoinerAgent() {
  const joinerFunction = convertToOpenAIFunction(new DynamicStructuredTool({
      name: 'join',
      description:
        'This tool is used to join the results and select to return a response or replan',
      schema: JoinOutput,
      func: async () => '',
    }))
  

  const joinerPrompt = await ChatPromptTemplate.fromMessages([
		["system", `Solve a question answering task. Here are some guidelines:
	- In the Assistant Scratchpad, you will be given results of a plan you have executed to answer the user's question.
	- Thought needs to reason about the question based on the Observations in 1-2 sentences.
	- Ignore irrelevant action results.
	- If the required information is present, give a concise but complete and helpful answer to the user's question.
	- If you are unable to give a satisfactory finishing answer, replan to get the required information. Respond in the following format:
	
	Thought: <reason about the task results and whether you have sufficient information to answer the question>
	Action: <action to take>
	Available actions:
	(1) Finish(the final answer to return to the user): returns the answer and finishes the task.
	(2) Replan(the reasoning and other information that will help you plan again. Can be a line of any length): instructs why we must replan`],
		["placeholder", "{messages}"],
		["system", `Using the above previous actions, decide whether to replan or finish. If all the required information is present. You may finish. If you have made many attempts to find the information without success, admit so and respond with whatever information you have gathered so the user can work well with you.
	
	{examples}`],
	]).partial({
		examples: ""
	})

    const llm = new ChatOpenAI({
		model: 'gpt-4o'
	}).bind({
		functions: [joinerFunction],
		function_call: joinerFunction
	})
	
	const parser = new JsonOutputFunctionsParser({argsOnly: true})

	const runnableJoiner = joinerPrompt.pipe(llm)
	.pipe(parser)

	
	const runnableSelectRecentMessage = new RunnableLambda({
		func: selectRecentMessages
	})
	

	const runnable = runnableSelectRecentMessage.pipe(runnableJoiner).pipe(parseJoinerOutput)

	return runnable
}


const parseJoinerOutput: RunnableFunc<JoinOutput, BaseMessage[]> = (decision: JoinOutput): BaseMessage[] => {
	const response = [new AIMessage({content: "Thought: " + decision.thought})]
	// console.log(Object.keys(decision.action))
	if (Object.keys(decision.action).includes('feedback')){
		response.push(new SystemMessage({ content: "Context from last attempt: " + decision.action.feedback }))
	} else if (Object.keys(decision.action).includes('response')) {
		response.push(new AIMessage({ content: decision.action.response}))
	}
	console.log(response)
	return response
}

const selectRecentMessages: RunnableFunc<BaseMessage[], {[key: string]: any}> = async (messages: BaseMessage[]): Promise<{[key: string]: any}> => {
	// console.log("Joiner")
	let selected: BaseMessage[] = []
	for (let i = messages.length - 1; i >= 0; i--){
		selected.push(messages[i])
		if(messages[i] instanceof HumanMessage){
			break
		}
	}
	// console.log(selected.reverse())
	return {messages: selected.reverse()}
}