import { Injectable } from "@nestjs/common";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { pull } from "langchain/hub";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { AgentActionOutputParser, AgentExecutor, createOpenAIFunctionsAgent, createOpenAIToolsAgent } from "langchain/agents";
import { AgentRunnableSequence } from "langchain/dist/agents/agent";
import {} from "@langchain/community/tools/tavily_search"
import { JsonOutputFunctionsParser, JsonOutputToolsParser, StructuredOutputParser } from "langchain/output_parsers";
import { convertToOpenAIFunction } from "@langchain/core/utils/function_calling";
import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";


@Injectable()
export class TavilySearchService {
    async getTavilyAgent(){
        const prompt = ChatPromptTemplate.fromMessages([
            ["system",`For the given input, use the Tavily Search Tool to find related information\
            Return information from at least 3 search results
            {input}`],
            new MessagesPlaceholder("agent_scratchpad")
        ])

        
        const tools = [new TavilySearchResults({
            maxResults: 5,
        })]
        
        const llm = new ChatOpenAI({
            model: "gpt-4o",
            temperature: 0
        })

        const agent = await createOpenAIFunctionsAgent({
            llm,
            tools,
            prompt,
        });
          
        const agentExecutor = new AgentExecutor({
            agent,
            tools,
            verbose: true
        });

        const parser = new JsonOutputFunctionsParser()

        const parsedAgent = RunnableSequence.from([
            agentExecutor,
            parser
        ])

        return agentExecutor
    }
}