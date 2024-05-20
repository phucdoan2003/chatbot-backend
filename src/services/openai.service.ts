import { Injectable } from "@nestjs/common";
import { ChatPromptTemplate } from "@langchain/core/prompts"
import { ChatOpenAI } from "@langchain/openai";
import { createOpenAIToolsAgent } from "langchain/agents";
import { pull } from "langchain/hub"
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";

@Injectable()
export class OpenAIService {
    
}