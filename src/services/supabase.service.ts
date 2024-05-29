import { Injectable } from "@nestjs/common";
import { OpenAIEmbeddings } from "@langchain/openai";
import { SupabaseClient, createClient } from "@supabase/supabase-js";
import { BaseMessage } from "@langchain/core/messages";
import { config } from "dotenv"

interface Document {
    content: string,
    embedding: number[],
    metadata: {[key: string]: string}
}

@Injectable()
export class SupabaseService {
    constructor(){
        config()
    }

    async uploadEmbeddings(messages: BaseMessage[]) {
        const supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PRIVATE_KEY)
        const embedModel = new OpenAIEmbeddings()
        const documents: Document[] = []
        
        for (const message of messages){
            if(message._getType() == "system" || message.name == "join" || message.name == "supabase_similarity_search_results_json"){
                continue
            }

            const content = JSON.stringify(message.content).replaceAll("\n", " ").replaceAll(String.fromCharCode(92), "")

            const document: Document = {
                content: content,
                embedding: await embedModel.embedQuery(message.content as string),
                metadata: {
                    messageType: message._getType(),
                    createdAt: (new Date()).toString(),
                    toolUsed: (message.name?message.name:"None")
                }
            }
            documents.push(document)
        }
        
        const res = await supabaseClient
        .from('documents')
        .insert(documents)
        
        return res
    }

    async searchEmbeddings(input: string){
        const supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PRIVATE_KEY)
        const embedModel = new OpenAIEmbeddings()
        const embeddings = await embedModel.embedQuery(input)
        const results = await supabaseClient
        .rpc("match_documents",{
            query_embedding: embeddings,
            match_threshold: 0.78, 
            match_count: 10,
        })
        
        if(results.data.length == 0){
            return "No entries found in vector database"
        }
        // console.log(results)
        return JSON.stringify(results.data)
    }

}